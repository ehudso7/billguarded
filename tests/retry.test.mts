import assert from "node:assert/strict";
import test from "node:test";
import { withRetry } from "../src/lib/retry.ts";

test("withRetry retries failures in schedule order and returns the success value", async () => {
  const sleeps: number[] = [];
  const failures: Array<{ attempt: number; final: boolean }> = [];
  let attempts = 0;

  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error(`failure-${attempts}`);
      return "complete";
    },
    {
      delaysMs: [0, 10, 20],
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      onAttemptFailure(_error, attempt, final) {
        failures.push({ attempt, final });
      },
    },
  );

  assert.equal(result, "complete");
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [10, 20]);
  assert.deepEqual(failures, [
    { attempt: 1, final: false },
    { attempt: 2, final: false },
  ]);
});

test("withRetry throws the final operation error after exhausting attempts", async () => {
  let attempts = 0;
  const failures: Array<{ attempt: number; final: boolean }> = [];

  await assert.rejects(
    withRetry(
      async () => {
        attempts += 1;
        throw new Error(`failure-${attempts}`);
      },
      {
        delaysMs: [0, 0],
        sleep: async () => undefined,
        onAttemptFailure(_error, attempt, final) {
          failures.push({ attempt, final });
        },
      },
    ),
    /failure-2/,
  );

  assert.equal(attempts, 2);
  assert.deepEqual(failures, [
    { attempt: 1, final: false },
    { attempt: 2, final: true },
  ]);
});

test("withRetry rejects an empty or invalid retry schedule", async () => {
  await assert.rejects(
    withRetry(async () => "never", { delaysMs: [] }),
    /retry_schedule_required/,
  );

  await assert.rejects(
    withRetry(async () => "never", { delaysMs: [0, -1] }),
    /retry_delay_invalid/,
  );
});
