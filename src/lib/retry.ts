export type RetryOptions = {
  delaysMs: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
  onAttemptFailure?: (error: unknown, attempt: number, final: boolean) => void;
};

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  if (options.delaysMs.length === 0) {
    throw new Error("retry_schedule_required");
  }

  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let index = 0; index < options.delaysMs.length; index += 1) {
    const delay = options.delaysMs[index];
    if (!Number.isFinite(delay) || delay < 0) {
      throw new Error("retry_delay_invalid");
    }
    if (delay > 0) await sleep(delay);

    try {
      return await operation(index + 1);
    } catch (error) {
      lastError = error;
      options.onAttemptFailure?.(
        error,
        index + 1,
        index === options.delaysMs.length - 1,
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("operation_failed_after_retries");
}
