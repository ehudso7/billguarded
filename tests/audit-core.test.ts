import assert from "node:assert/strict";
import test from "node:test";
import { analyzeInvoiceRows, buildRateCard } from "../src/lib/audit-core";
import { parseCsv, parseCsvDocument } from "../src/lib/audit-csv";

test("controlled fixture returns four findings and $68 without counting unsupported fee", () => {
  const rateRows = parseCsv(`service_code,description,unit_rate\npick_pack,Pick & pack per order,1.20\nstorage,Storage per pallet,18.00\nreturns,Return processing,3.50\n`);
  const invoiceRows = parseCsv(`reference,service_code,quantity,unit_rate,amount\nORD1001,pick_pack,100,1.35,135.00\nORD1002,pick_pack,50,1.20,60.00\nORD1003,storage,4,18.00,90.00\nORD1004,tech_fee,1,75.00,75.00\nORD1005,returns,10,3.50,35.00\nORD1005,returns,10,3.50,35.00\n`);

  const analysis = analyzeInvoiceRows({
    rows: invoiceRows,
    rateCard: buildRateCard(rateRows),
  });

  assert.equal(analysis.findings.length, 4);
  assert.equal(analysis.potentialRecoveryCents, 6_800);
  assert.deepEqual(
    analysis.findings.map((finding) => finding.findingType).sort(),
    [
      "arithmetic_mismatch",
      "duplicate_charge",
      "rate_mismatch",
      "unsupported_fee",
    ],
  );
  assert.equal(
    analysis.findings.find((finding) => finding.findingType === "unsupported_fee")
      ?.potentialRecoveryCents,
    0,
  );
});

test("overlapping discrepancies on one invoice row are not double counted", () => {
  const rateCard = buildRateCard(parseCsv("service_code,unit_rate\npick,1.00\n"));
  const rows = parseCsv(
    "reference,service_code,quantity,unit_rate,amount\nA1,pick,2,2.00,5.00\n",
  );

  const analysis = analyzeInvoiceRows({ rows, rateCard });
  assert.equal(analysis.findings.length, 2);
  assert.equal(analysis.potentialRecoveryCents, 300);
});

test("ambiguous contract rates are flagged and never assumed", () => {
  const rateCard = buildRateCard(
    parseCsv("service_code,unit_rate\nstorage,10.00\nstorage,12.00\n"),
  );
  const analysis = analyzeInvoiceRows({
    rows: parseCsv(
      "reference,service_code,quantity,unit_rate,amount\nS1,storage,1,15.00,15.00\n",
    ),
    rateCard,
  });

  assert.equal(rateCard.ambiguousCodes.has("storage"), true);
  assert.equal(analysis.potentialRecoveryCents, 0);
  assert.equal(analysis.findings[0]?.findingType, "ambiguous_rate");
});

test("CSV parser preserves quoted multiline fields as one record", () => {
  const parsed = parseCsvDocument(
    'service_code,description,unit_rate\npick,"Pick, pack\nand label",1.25\n',
  );
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]?.description, "Pick, pack\nand label");
  assert.equal(parsed.rows[0]?.unit_rate, "1.25");
});

test("low parse coverage fails closed for review", () => {
  const rateCard = buildRateCard(parseCsv("service_code,unit_rate\npick,1.00\n"));
  const analysis = analyzeInvoiceRows({
    rows: parseCsv(
      "reference,service_code,quantity,unit_rate,amount\nA1,pick,1,1.00,1.00\nA2,pick,1,1.00,not-a-number\nA3,pick,1,1.00,not-a-number\n",
    ),
    rateCard,
  });

  assert.equal(analysis.coveragePercent, 33);
  assert.equal(analysis.requiresReview, true);
});
