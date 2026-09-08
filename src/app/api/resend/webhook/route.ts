import { NextResponse } from "next/server";
import {
  AUDIT_COMPLETION_SUBJECT,
  BILLGUARDED_SUPPORT_SENDER,
} from "@/lib/audit-delivery-email";
import { resendServerEnv } from "@/lib/env";
import { resend } from "@/lib/resend";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRACKED_EVENTS = new Set([
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.failed",
  "email.suppressed",
  "email.complained",
]);

function noStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(request: Request) {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return noStore({ error: "missing_signature" }, { status: 400 });
  }

  let webhookSecret: string;
  try {
    webhookSecret = resendServerEnv().RESEND_WEBHOOK_SECRET;
  } catch {
    console.error("billguarded_resend_webhook_not_configured");
    return noStore({ error: "webhook_not_configured" }, { status: 503 });
  }

  const payload = await request.text();
  let event;
  try {
    event = resend().webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret,
    });
  } catch {
    return noStore({ error: "invalid_signature" }, { status: 400 });
  }

  if (!TRACKED_EVENTS.has(event.type) || !("from" in event.data)) {
    return noStore({ received: true, ignored: true });
  }

  if (
    event.data.from !== BILLGUARDED_SUPPORT_SENDER &&
    event.data.from !== "support@billguarded.com"
  ) {
    return noStore({ received: true, ignored: true });
  }

  if (event.data.subject !== AUDIT_COMPLETION_SUBJECT) {
    return noStore({ received: true, ignored: true });
  }

  const { data: recorded, error } = await supabaseAdmin().rpc(
    "billguarded_record_resend_event",
    {
      p_event_id: id,
      p_provider_message_id: event.data.email_id,
      p_event_type: event.type,
      p_provider_created_at: event.created_at,
      p_from_address: event.data.from,
    },
  );

  if (error) {
    console.error(
      "billguarded_resend_event_persistence_failed",
      event.type,
      event.data.email_id,
    );
    return noStore({ error: "event_persistence_failed" }, { status: 500 });
  }

  if (!recorded) {
    return noStore({ error: "delivery_not_reconciled" }, { status: 503 });
  }

  return noStore({ received: true });
}
