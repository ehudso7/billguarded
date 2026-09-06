import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeInvoiceRows,
  buildRateMap,
  type AuditFindingInsert,
  type DocumentRow,
  type DuplicateOrigin,
} from "../src/lib/audit-reconcile.ts";
import { parseCsv } from "../src/lib/audit-csv.ts";
import { conservativePotentialRecoveryCents } from "../src/lib/audit-math.ts";

const RATE_CARD: DocumentRow = {
  id: "doc-rates",
  kind: "rate_card",
  original_filename: "rate-card.csv",
  storage_path: "r/rate-card.csv",
  content_type: "text/csv",
  upload_status: "uploaded",
};

const INVOICE_A: DocumentRow = {
  id: "doc-inv-a",
  kind: "invoice",
  original_filename: "invoice-a.csv",
  storage_path: "r/invoice-a.csv",
  content_type: "text/csv",
  upload_status: "uploaded",
};

const INVOICE_B: DocumentRow = {
  ...INVOICE_A,
  id: "doc-inv-b",
  original_filename: "invoice-b.csv",
  storage_path: "r/invoice-b.csv",
};

const RATE_CARD_CSV = [
  "service_code,rate",
  "PICK_EACH,$1.20",
  "storage-bin,18.00",
  "B2B_CASE,2.50",
  "BAD_RATE,not-a-number",
  "NEG_RATE,-4.00",
  "PICK_EACH,9.99", // duplicate code: first definition wins deterministically
].join("\n");

function analyze(
  csv: string,
  document: DocumentRow,
  seenDuplicates = new Map<string, DuplicateOrigin>(),
) {
  const rateMap = buildRateMap(parseCsv(RATE_CARD_CSV), RATE_CARD);
  return analyzeInvoiceRows({
    rows: parseCsv(csv),
    document,
    rateMap,
    runId: "run-1",
    requestId: "req-1",
    seenDuplicates,
  });
}

function byType(findings: AuditFindingInsert[], type: AuditFindingInsert["finding_type"]) {
  return findings.filter((finding) => finding.finding_type === type);
}

test("rate card parsing normalises codes, keeps the first rate per code, and ignores unusable rates", () => {
  const rateMap = buildRateMap(parseCsv(RATE_CARD_CSV), RATE_CARD);

  assert.deepEqual([...rateMap.keys()].sort(), ["b2b_case", "pick_each", "storage_bin"]);
  assert.equal(rateMap.get("pick_each")?.rateCents, 120);
  assert.equal(rateMap.get("pick_each")?.sourceRow, 2, "first definition wins");
  assert.equal(rateMap.get("storage_bin")?.rateCents, 1800);
  assert.equal(rateMap.get("storage_bin")?.sourceDocumentId, "doc-rates");
});

test("a clean invoice produces no findings", () => {
  const findings = analyze(
    [
      "line_id,service_code,quantity,unit_rate,amount",
      "L1,PICK_EACH,100,1.20,120.00",
      "L2,Storage Bin,2,18.00,36.00",
      "L3,B2B_CASE,4,2.50,10.00",
    ].join("\n"),
    INVOICE_A,
  );

  assert.deepEqual(findings, []);
});

test("each deterministic class is detected with row-level, evidence-linked traceability", () => {
  const findings = analyze(
    [
      "line_id,service_code,quantity,unit_rate,amount",
      "L1,PICK_EACH,100,1.35,135.00", // rate mismatch: billed 1.35 vs contract 1.20
      "L2,RUSH_FEE,1,25.00,25.00", // unsupported fee: not on the rate card
      "L3,B2B_CASE,4,2.50,12.00", // arithmetic: 4 × 2.50 = 10.00, billed 12.00
      "L4,STORAGE_BIN,1,18.00,18.00",
    ].join("\n"),
    INVOICE_A,
  );

  const [rate] = byType(findings, "rate_mismatch");
  assert.ok(rate, "rate mismatch detected");
  assert.equal(rate.source_document_id, "doc-inv-a");
  assert.equal(rate.source_row, 2, "CSV row numbers are 1-based and skip the header");
  assert.equal(rate.billed_amount_cents, 13500);
  assert.equal(rate.expected_amount_cents, 12000);
  assert.equal(rate.potential_recovery_cents, 1500);
  assert.deepEqual(rate.evidence, {
    billed_unit_rate_cents: 135,
    contract_unit_rate_cents: 120,
    rate_card_document_id: "doc-rates",
    rate_card_row: 2,
    quantity: 100,
    reference: "L1",
  });

  const [unsupported] = byType(findings, "unsupported_fee");
  assert.ok(unsupported, "unsupported fee detected");
  assert.equal(unsupported.source_row, 3);
  assert.equal(unsupported.service_code, "rush_fee");
  assert.equal(unsupported.expected_amount_cents, null);
  assert.equal(
    unsupported.potential_recovery_cents,
    0,
    "unsupported fees are surfaced for review, never counted as recovery",
  );

  const [arithmetic] = byType(findings, "arithmetic_mismatch");
  assert.ok(arithmetic, "arithmetic mismatch detected");
  assert.equal(arithmetic.source_row, 4);
  assert.equal(arithmetic.expected_amount_cents, 1000);
  assert.equal(arithmetic.potential_recovery_cents, 200);
  assert.deepEqual(arithmetic.evidence, { quantity: 4, billed_unit_rate_cents: 250 });

  assert.equal(byType(findings, "duplicate_charge").length, 0);
  assert.equal(findings.length, 3);
});

test("duplicate charges are detected within and across invoice files but only when a reference exists", () => {
  const seen = new Map<string, DuplicateOrigin>();
  const first = analyze(
    [
      "line_id,service_code,quantity,unit_rate,amount",
      "SHP-1,PICK_EACH,10,1.20,12.00",
      "SHP-1,PICK_EACH,10,1.20,12.00", // same file duplicate
      ",PICK_EACH,10,1.20,12.00", // no reference → cannot be matched
      ",PICK_EACH,10,1.20,12.00",
    ].join("\n"),
    INVOICE_A,
    seen,
  );
  const second = analyze(
    [
      "line_id,service_code,quantity,unit_rate,amount",
      "SHP-1,PICK_EACH,10,1.20,12.00", // cross-file duplicate of invoice-a row 2
      "SHP-1,PICK_EACH,11,1.20,13.20", // same reference, different quantity → not a duplicate
    ].join("\n"),
    INVOICE_B,
    seen,
  );

  const firstDuplicates = byType(first, "duplicate_charge");
  assert.equal(firstDuplicates.length, 1);
  assert.equal(firstDuplicates[0].source_row, 3);
  assert.deepEqual(firstDuplicates[0].evidence, {
    reference: "SHP-1",
    matching_document_id: "doc-inv-a",
    matching_filename: "invoice-a.csv",
    matching_row: 2,
  });
  assert.equal(firstDuplicates[0].potential_recovery_cents, 1200);

  const secondDuplicates = byType(second, "duplicate_charge");
  assert.equal(secondDuplicates.length, 1);
  assert.equal(secondDuplicates[0].source_row, 2);
  assert.equal(secondDuplicates[0].evidence.matching_filename, "invoice-a.csv");
  assert.match(secondDuplicates[0].description, /invoice-a\.csv row 2/);
});

test("cent-level tolerance and severity thresholds are deterministic", () => {
  const findings = analyze(
    [
      "line_id,service_code,quantity,unit_rate,amount",
      "T1,PICK_EACH,3,1.20,3.61", // 1 cent rounding drift → tolerated
      "T2,PICK_EACH,3,1.20,3.62", // 2 cents → flagged, medium
      "T3,PICK_EACH,1,1.21,1.21", // 1 cent rate drift → tolerated
      "T4,STORAGE_BIN,100,24.00,2400.00", // $600 over contract → high severity rate mismatch
    ].join("\n"),
    INVOICE_A,
  );

  const arithmetic = byType(findings, "arithmetic_mismatch");
  assert.deepEqual(arithmetic.map((f) => f.source_row), [3]);
  assert.equal(arithmetic[0].severity, "medium");

  const rates = byType(findings, "rate_mismatch");
  assert.deepEqual(rates.map((f) => f.source_row), [5]);
  assert.equal(rates[0].severity, "high");
  assert.equal(rates[0].potential_recovery_cents, 60000);
});

test("potential recovery never rewards under-billing and never double counts one row", () => {
  const findings = analyze(
    [
      "line_id,service_code,quantity,unit_rate,amount",
      "U1,PICK_EACH,10,1.00,10.00", // billed below contract → no recovery
      "U2,PICK_EACH,10,1.50,20.00", // rate mismatch (12.00 expected → 8.00) AND arithmetic mismatch (15.00 calc → 5.00)
    ].join("\n"),
    INVOICE_A,
  );

  const under = findings.filter((f) => f.source_row === 2);
  assert.equal(under.length, 1);
  assert.equal(under[0].finding_type, "rate_mismatch");
  assert.equal(under[0].potential_recovery_cents, 0);

  const over = findings.filter((f) => f.source_row === 3);
  assert.deepEqual(over.map((f) => f.finding_type).sort(), ["arithmetic_mismatch", "rate_mismatch"]);
  assert.deepEqual(
    over.map((f) => [f.finding_type, f.potential_recovery_cents]).sort(),
    [
      ["arithmetic_mismatch", 500],
      ["rate_mismatch", 800],
    ],
  );
  assert.equal(
    conservativePotentialRecoveryCents(findings),
    800,
    "one row is recovered once, at the largest single-finding amount, never the sum",
  );
});

test("credit lines and fractional quantities never produce a claimed recovery", () => {
  const findings = analyze(
    [
      "line_id,service_code,quantity,unit_rate,amount",
      "C1,PICK_EACH,-10,1.20,-12.00", // contract-rate credit: arithmetic holds, nothing to recover
      "C1,PICK_EACH,-10,1.20,-12.00", // duplicated credit: flagged, but a credit cannot be "recovered"
      "C2,PICK_EACH,1,-1.20,-1.20", // negative unit rate mismatches the contract rate; still no recovery
      "F1,storage-bin,2.5,18.00,45.00", // fractional quantity that multiplies cleanly
      "F2,storage-bin,0.333,18.00,5.99", // 5.994 rounds to 5.99 — within the cent tolerance
    ].join("\n"),
    INVOICE_A,
  );

  const duplicate = byType(findings, "duplicate_charge");
  assert.equal(duplicate.length, 1);
  assert.equal(duplicate[0].source_row, 3);
  assert.equal(duplicate[0].potential_recovery_cents, 0, "a duplicated credit is never counted as money owed");

  const rateMismatch = byType(findings, "rate_mismatch");
  assert.deepEqual(rateMismatch.map((f) => f.source_row), [4]);
  assert.equal(rateMismatch[0].potential_recovery_cents, 0);

  assert.equal(byType(findings, "arithmetic_mismatch").length, 0, "fractional quantities within one cent are not mismatches");
  assert.equal(byType(findings, "unsupported_fee").length, 0);
  assert.equal(conservativePotentialRecoveryCents(findings), 0);
});

test("the same inputs always produce byte-identical findings (audit reproducibility)", () => {
  const csv = [
    "line_id,service_code,quantity,unit_rate,amount",
    "R1,PICK_EACH,100,1.35,135.00",
    "R2,RUSH_FEE,1,25.00,25.00",
    "R1,PICK_EACH,100,1.35,135.00",
  ].join("\n");

  const a = JSON.stringify(analyze(csv, INVOICE_A));
  const b = JSON.stringify(analyze(csv, INVOICE_A));

  assert.equal(a, b);
});
