import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { sweepOneDelivery } from "@/lib/audit-delivery";
import { sweepOneAuditWork } from "@/lib/audit-processing";
import { fulfillmentWorkerEnv } from "@/lib/env";
import { workerAuthorizationValid } from "@/lib/security/worker-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: Request) {
  let secret: string;
  try {
    secret = fulfillmentWorkerEnv().CRON_SECRET;
  } catch {
    console.error("billguarded_fulfillment_worker_not_configured");
    return privateJson({ error: "worker_not_configured" }, { status: 503 });
  }

  if (
    !workerAuthorizationValid(
      request.headers.get("authorization"),
      secret,
    )
  ) {
    return privateJson({ error: "unauthorized" }, { status: 401 });
  }

  const workerId = `vercel:${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}:${randomUUID()}`;

  try {
    const audit = await sweepOneAuditWork(workerId);
    const delivery = await sweepOneDelivery(workerId);

    const { data: incidents, error: incidentError } = await supabaseAdmin()
      .from("billguarded_fulfillment_operations")
      .select("incident")
      .not("incident", "is", null);
    if (incidentError) throw incidentError;

    const incidentCounts = (incidents ?? []).reduce<Record<string, number>>(
      (counts, row) => {
        const incident = row.incident ?? "unknown";
        counts[incident] = (counts[incident] ?? 0) + 1;
        return counts;
      },
      {},
    );

    const attentionRequired =
      audit.state === "permanently_failed" ||
      delivery.state === "failed" ||
      delivery.state === "acceptance_uncertain" ||
      Object.keys(incidentCounts).some((incident) =>
        [
          "paid_without_work_item",
          "processing_terminal_failure",
          "complete_without_delivery",
          "delivery_acceptance_uncertain",
          "delivery_attention_required",
        ].includes(incident),
      );

    if (attentionRequired) {
      console.error(
        "billguarded_fulfillment_attention_required",
        JSON.stringify(incidentCounts),
      );
    }

    return privateJson(
      {
        ok: !attentionRequired,
        audit: audit.state,
        delivery: delivery.state,
        incidents: incidentCounts,
      },
      { status: attentionRequired ? 503 : 200 },
    );
  } catch (error) {
    console.error(
      "billguarded_fulfillment_sweep_failed",
      error instanceof Error ? error.message.slice(0, 160) : "unknown_error",
    );
    return privateJson({ error: "sweep_failed" }, { status: 500 });
  }
}
