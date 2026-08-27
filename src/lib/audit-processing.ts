import { processAuditRequest } from "@/lib/audit-engine";
import { withRetry } from "@/lib/retry";
import { supabaseAdmin } from "@/lib/supabase-admin";

const RETRY_DELAYS_MS = [0, 1000, 3000, 8000, 15000] as const;

async function verifyAuditProcessingState(requestId: string) {
  const supabase = supabaseAdmin();
  const [{ data: request, error: requestError }, { data: run, error: runError }] =
    await Promise.all([
      supabase
        .from("audit_requests")
        .select("status")
        .eq("id", requestId)
        .maybeSingle(),
      supabase
        .from("audit_runs")
        .select("status,error_code")
        .eq("audit_request_id", requestId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (requestError) throw requestError;
  if (runError) throw runError;
  if (!request) return;

  if (request.status === "complete" || run?.status === "complete") return;
  if (run?.status === "needs_review") return;
  if (request.status === "cancelled") return;

  if (run?.status === "failed") {
    throw new Error(run.error_code || "audit_run_failed");
  }

  if (
    request.status === "paid" ||
    request.status === "processing" ||
    run?.status === "queued" ||
    run?.status === "processing"
  ) {
    throw new Error("audit_processing_in_progress");
  }
}

export async function processAuditRequestWithRetry(requestId: string) {
  await withRetry(
    async () => {
      await processAuditRequest(requestId);
      await verifyAuditProcessingState(requestId);
    },
    {
      delaysMs: RETRY_DELAYS_MS,
      onAttemptFailure(error, attempt, final) {
        console.warn(
          final
            ? "billguarded_audit_retry_exhausted"
            : "billguarded_audit_retry",
          requestId,
          attempt,
          error instanceof Error
            ? error.message.slice(0, 160)
            : "unknown_error",
        );
      },
    },
  );
}
