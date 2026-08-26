export const STALE_PROCESSING_MS = 20 * 60 * 1000;
export const PAID_RECOVERY_GRACE_MS = 2 * 1000;

type RecoverableProcessingRun = {
  startedAt: string | null;
  createdAt: string;
  requestStatus: string;
  nowMs?: number;
};

export function shouldRecoverProcessingRun(input: RecoverableProcessingRun) {
  const timestamp = Date.parse(input.startedAt ?? input.createdAt);
  if (!Number.isFinite(timestamp)) return false;

  const ageMs = (input.nowMs ?? Date.now()) - timestamp;
  if (!Number.isFinite(ageMs) || ageMs < 0) return false;

  const threshold =
    input.requestStatus === "paid"
      ? PAID_RECOVERY_GRACE_MS
      : STALE_PROCESSING_MS;

  return ageMs >= threshold;
}
