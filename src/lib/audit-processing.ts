import { processAuditRequest } from "@/lib/audit-engine";

const RETRY_DELAYS_MS = [0, 1000, 3000];

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function processAuditRequestWithRetry(requestId: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay > 0) await sleep(delay);

    try {
      await processAuditRequest(requestId);
      return;
    } catch (error) {
      lastError = error;
      console.warn(
        "billguarded_audit_retry",
        requestId,
        attempt + 1,
        error instanceof Error ? error.message.slice(0, 160) : "unknown_error",
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("audit_processing_failed_after_retries");
}
