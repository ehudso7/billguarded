import test from "node:test";
import assert from "node:assert/strict";
import { conservativePotentialRecoveryCents } from "../src/lib/audit-math.ts";
import {
  DEMO_FINDINGS,
  DEMO_INVOICE,
  DEMO_QUANTIFIED_POTENTIAL_CENTS,
  DEMO_TOTAL_BILLED_CENTS,
  DEMO_UNPRICED_FINDINGS,
} from "../src/lib/demo-audit.ts";

test("synthetic demo covers every production finding class", () => {
  assert.deepEqual(
    new Set(DEMO_FINDINGS.map((finding) => finding.findingType)),
    new Set([
      "duplicate_charge",
      "unsupported_fee",
      "arithmetic_mismatch",
      "rate_mismatch",
    ]),
  );
});

test("synthetic demo keeps unpriced unsupported fees out of quantified discrepancy", () => {
  assert.equal(DEMO_UNPRICED_FINDINGS, 1);
  assert.equal(DEMO_QUANTIFIED_POTENTIAL_CENTS, 9800);
  assert.equal(
    DEMO_FINDINGS.find((finding) => finding.findingType === "unsupported_fee")
      ?.potentialRecoveryCents,
    0,
  );
});

test("synthetic demo total matches production conservative aggregation", () => {
  const productionTotal = conservativePotentialRecoveryCents(
    DEMO_FINDINGS.map((finding) => ({
      source_document_id: "synthetic-invoice.csv",
      source_row: finding.sourceRow,
      potential_recovery_cents: finding.potentialRecoveryCents,
    })),
  );

  assert.equal(productionTotal, DEMO_QUANTIFIED_POTENTIAL_CENTS);
});

test("synthetic demo totals remain deterministic", () => {
  assert.equal(DEMO_INVOICE.length, 6);
  assert.equal(DEMO_TOTAL_BILLED_CENTS, 64500);
});
