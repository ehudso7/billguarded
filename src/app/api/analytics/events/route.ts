import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  clientFunnelEventSchema,
  recordClientFunnelEvent,
} from "@/lib/funnel-analytics";
import { supabaseAdmin } from "@/lib/supabase-admin";

function rateKey(request: Request) {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256")
    .update(`billguarded:analytics:${address}`, "utf8")
    .digest("hex");
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return response({ error: "analytics_origin_rejected" }, 403);
  }

  const parsed = clientFunnelEventSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return response({ error: "analytics_event_invalid" }, 400);
  }

  const { data: allowed, error: limitError } = await supabaseAdmin().rpc(
    "billguarded_consume_intake_rate_limit",
    { p_key: rateKey(request), p_limit: 120, p_window_seconds: 3600 },
  );
  if (limitError || allowed !== true) {
    return response({ error: "analytics_event_limited" }, 429);
  }

  try {
    await recordClientFunnelEvent(parsed.data);
    return response({ accepted: true }, 202);
  } catch (error) {
    console.error(
      "funnel_event_persistence_failed",
      error && typeof error === "object" && "code" in error
        ? String(error.code).slice(0, 80)
        : "unknown_error",
    );
    return response({ error: "analytics_unavailable" }, 503);
  }
}
