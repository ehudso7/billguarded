import assert from "node:assert/strict";
import test from "node:test";
import {
  PAID_RECOVERY_GRACE_MS,
  STALE_PROCESSING_MS,
  shouldRecoverProcessingRun,
} from "../src/lib/audit-recovery.ts";

const NOW = Date.parse("2026-08-26T03:00:00.000Z");

function iso(millisecondsAgo: number) {
  return new Date(NOW - millisecondsAgo).toISOString();
}

test("a normally processing audit is recovered only after the stale threshold", () => {
  assert.equal(
    shouldRecoverProcessingRun({
      startedAt: iso(STALE_PROCESSING_MS - 1),
      createdAt: iso(STALE_PROCESSING_MS - 1),
      requestStatus: "processing",
      nowMs: NOW,
    }),
    false,
  );

  assert.equal(
    shouldRecoverProcessingRun({
      startedAt: iso(STALE_PROCESSING_MS),
      createdAt: iso(STALE_PROCESSING_MS),
      requestStatus: "processing",
      nowMs: NOW,
    }),
    true,
  );
});

test("a paid request with an orphan processing run uses the short recovery grace", () => {
  assert.equal(
    shouldRecoverProcessingRun({
      startedAt: iso(PAID_RECOVERY_GRACE_MS - 1),
      createdAt: iso(PAID_RECOVERY_GRACE_MS - 1),
      requestStatus: "paid",
      nowMs: NOW,
    }),
    false,
  );

  assert.equal(
    shouldRecoverProcessingRun({
      startedAt: iso(PAID_RECOVERY_GRACE_MS),
      createdAt: iso(PAID_RECOVERY_GRACE_MS),
      requestStatus: "paid",
      nowMs: NOW,
    }),
    true,
  );
});

test("invalid and future timestamps are never recovered", () => {
  assert.equal(
    shouldRecoverProcessingRun({
      startedAt: "not-a-date",
      createdAt: "also-not-a-date",
      requestStatus: "processing",
      nowMs: NOW,
    }),
    false,
  );

  assert.equal(
    shouldRecoverProcessingRun({
      startedAt: new Date(NOW + 1).toISOString(),
      createdAt: new Date(NOW + 1).toISOString(),
      requestStatus: "paid",
      nowMs: NOW,
    }),
    false,
  );
});
