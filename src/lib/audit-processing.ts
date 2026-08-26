import { processAuditRequest } from "@/lib/audit-engine";
import { withRetry } from "@/lib/retry";

const RETRY_DELAYS_MS = [0, 1000, 3000, 8000] as const;

export async function processAuditRequestWithRetry(requestId: string) {
  await withRetry(
    () => processAuditRequest(requestId),
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
