import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ATTRIBUTION_CHANNELS,
  SAFE_UTM_MEDIA,
  SAFE_UTM_SOURCES,
  type SafeAttribution,
  type SafeTouch,
} from "@/lib/funnel-attribution";
import {
  CLIENT_FUNNEL_EVENTS,
  PUBLIC_ANALYTICS_PATHS,
  type FunnelEventName,
} from "@/lib/funnel-events";
import { supabaseAdmin } from "@/lib/supabase-admin";

const safeUtmSource = z.enum(SAFE_UTM_SOURCES).optional();
const safeUtmMedium = z.enum(SAFE_UTM_MEDIA).optional();
const safeCampaign = z
  .string()
  .regex(/^(?:billguarded-|bg-)[a-zA-Z0-9._~-]*$/)
  .max(96)
  .optional();
const touchSchema = z.object({
  channel: z.enum(ATTRIBUTION_CHANNELS),
  utmSource: safeUtmSource,
  utmMedium: safeUtmMedium,
  utmCampaign: safeCampaign,
}).strict();

export const clientFunnelEventSchema = z.object({
  eventName: z.enum(CLIENT_FUNNEL_EVENTS),
  eventId: z.string().uuid(),
  anonymousId: z.string().uuid(),
  path: z.enum(PUBLIC_ANALYTICS_PATHS),
  firstTouch: touchSchema,
  lastTouch: touchSchema,
}).strict();

export const intakeAttributionSchema = z.object({
  anonymousId: z.string().uuid(),
  firstTouch: touchSchema,
  lastTouch: touchSchema,
}).strict();

function digest(parts: string[]) {
  return createHash("sha256")
    .update(parts.join(":"), "utf8")
    .digest("hex");
}

function touchColumns(touch: SafeTouch) {
  return {
    source_channel: touch.channel,
    utm_source: touch.utmSource ?? null,
    utm_medium: touch.utmMedium ?? null,
    utm_campaign: touch.utmCampaign ?? null,
  };
}

async function insertEvent(input: {
  eventKey: string;
  eventName: FunnelEventName;
  auditRequestId?: string | null;
  anonymousIdHash?: string | null;
  touch?: SafeTouch;
  path?: string | null;
  outcome?: string | null;
}) {
  const { error } = await supabaseAdmin().from("funnel_events").upsert(
    {
      event_key: input.eventKey,
      event_name: input.eventName,
      audit_request_id: input.auditRequestId ?? null,
      anonymous_id_hash: input.anonymousIdHash ?? null,
      ...touchColumns(input.touch ?? { channel: "unknown" }),
      path: input.path ?? null,
      outcome: input.outcome ?? null,
    },
    { onConflict: "event_key", ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function recordClientFunnelEvent(
  input: z.infer<typeof clientFunnelEventSchema>,
) {
  await insertEvent({
    eventKey: digest(["client", input.eventName, input.anonymousId, input.eventId]),
    eventName: input.eventName,
    anonymousIdHash: digest(["anonymous", input.anonymousId]),
    touch: input.lastTouch,
    path: input.path,
    outcome:
      input.eventName === "unsupported_file_rejected"
        ? "preflight"
        : input.eventName === "upload_failed"
          ? "upload"
          : input.eventName === "checkout_creation_failed" ||
              input.eventName === "checkout_abandoned"
            ? "checkout"
            : null,
  });
}

export async function recordIntakeAttribution(input: {
  auditRequestId: string;
  attribution?: SafeAttribution;
}) {
  const attribution = input.attribution;
  const anonymousIdHash = attribution
    ? digest(["anonymous", attribution.anonymousId])
    : null;
  const first = attribution?.firstTouch ?? { channel: "unknown" as const };
  const last = attribution?.lastTouch ?? { channel: "unknown" as const };
  const { error } = await supabaseAdmin().from("audit_attribution").upsert({
    audit_request_id: input.auditRequestId,
    anonymous_id_hash: anonymousIdHash,
    first_channel: first.channel,
    first_utm_source: first.utmSource ?? null,
    first_utm_medium: first.utmMedium ?? null,
    first_utm_campaign: first.utmCampaign ?? null,
    last_channel: last.channel,
    last_utm_source: last.utmSource ?? null,
    last_utm_medium: last.utmMedium ?? null,
    last_utm_campaign: last.utmCampaign ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  await insertEvent({
    eventKey: digest(["audit", input.auditRequestId, "intake_completed"]),
    eventName: "intake_completed",
    auditRequestId: input.auditRequestId,
    anonymousIdHash,
    touch: last,
    path: "/start",
  });
}

export async function recordAuditFunnelEvent(input: {
  auditRequestId: string;
  eventName: FunnelEventName;
  dedupePart: string;
  path?: "/recover" | "/success";
  outcome?: "retryable" | "terminal" | "preflight" | "upload" | "checkout" | "provider";
}) {
  const { data: attribution } = await supabaseAdmin()
    .from("audit_attribution")
    .select("anonymous_id_hash,last_channel,last_utm_source,last_utm_medium,last_utm_campaign")
    .eq("audit_request_id", input.auditRequestId)
    .maybeSingle();

  await insertEvent({
    eventKey: digest([
      "audit",
      input.auditRequestId,
      input.eventName,
      input.dedupePart,
    ]),
    eventName: input.eventName,
    auditRequestId: input.auditRequestId,
    anonymousIdHash: attribution?.anonymous_id_hash ?? null,
    touch: {
      channel: attribution?.last_channel ?? "unknown",
      ...(attribution?.last_utm_source
        ? { utmSource: attribution.last_utm_source }
        : {}),
      ...(attribution?.last_utm_medium
        ? { utmMedium: attribution.last_utm_medium }
        : {}),
      ...(attribution?.last_utm_campaign
        ? { utmCampaign: attribution.last_utm_campaign }
        : {}),
    } as SafeTouch,
    path: input.path ?? null,
    outcome: input.outcome ?? null,
  });
}
