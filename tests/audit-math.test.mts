import test from "node:test";
import assert from "node:assert/strict";
import { conservativePotentialRecoveryCents } from "../src/lib/audit-math.ts";

test("recovery aggregation does not double count multiple findings on one invoice row", () => {
  const total = conservativePotentialRecoveryCents([
    {
      source_document_id: "doc-a",
      source_row: 2,
      potential_recovery_cents: 1500,
    },
    {
      source_document_id: "doc-a",
      source_row: 2,
      potential_recovery_cents: 1800,
    },
    {
      source_document_id: "doc-a",
      source_row: 3,
      potential_recovery_cents: 3500,
    },
  ]);

  assert.equal(total, 5300);
});

test("recovery aggregation clamps negative amounts to zero", () => {
  const total = conservativePotentialRecoveryCents([
    {
      source_document_id: "doc-a",
      source_row: 2,
      potential_recovery_cents: -500,
    },
  ]);

  assert.equal(total, 0);
});
