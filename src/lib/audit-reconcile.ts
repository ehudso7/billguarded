/**
 * Deterministic 3PL invoice reconciliation.
 *
 * Pure functions only: no storage, network, or clock access, so the same
 * rate card and invoice rows always yield byte-identical findings. All I/O
 * (document download, run/finding persistence, retries) lives in
 * audit-engine.ts. Imports are relative on purpose so this module runs under
 * plain Node type-stripping in tests without path-alias resolution.
 */
import {
  firstValue,
  normalizeCode,
  parseMoneyToCents,
  parseNumber,
  type CsvRow,
} from "./audit-csv.ts";

const SERVICE_ALIASES = [
  "service_code",
  "charge_code",
  "fee_code",
  "service",
  "charge_type",
  "fee_type",
  "description",
];
const RATE_ALIASES = [
  "rate",
  "unit_rate",
  "contract_rate",
  "agreed_rate",
  "price",
  "unit_price",
];
const QUANTITY_ALIASES = ["quantity", "qty", "units", "count", "volume"];
const AMOUNT_ALIASES = [
  "amount",
  "line_total",
  "total",
  "extended_amount",
  "charge_amount",
  "billed_amount",
];
const REFERENCE_ALIASES = [
  "line_id",
  "reference",
  "order_id",
  "shipment_id",
  "transaction_id",
  "invoice_line_id",
  "tracking_number",
];

export type AuditFindingInsert = {
  audit_run_id: string;
  audit_request_id: string;
  finding_type:
    | "duplicate_charge"
    | "unsupported_fee"
    | "arithmetic_mismatch"
    | "rate_mismatch";
  severity: "low" | "medium" | "high";
  source_document_id: string;
  source_row: number;
  service_code: string | null;
  description: string;
  billed_amount_cents: number | null;
  expected_amount_cents: number | null;
  potential_recovery_cents: number;
  evidence: Record<string, unknown>;
};

export type DocumentRow = {
  id: string;
  kind: "contract" | "rate_card" | "invoice";
  original_filename: string;
  storage_path: string;
  content_type: string;
  upload_status: string;
};

export type Rate = {
  serviceCode: string;
  rateCents: number;
  sourceDocumentId: string;
  sourceRow: number;
};

export type DuplicateOrigin = {
  documentId: string;
  filename: string;
  row: number;
};

function serviceCode(row: CsvRow) {
  return normalizeCode(firstValue(row, SERVICE_ALIASES));
}

function billedAmount(row: CsvRow) {
  return parseMoneyToCents(firstValue(row, AMOUNT_ALIASES));
}

function unitRate(row: CsvRow) {
  return parseMoneyToCents(firstValue(row, RATE_ALIASES));
}

function quantity(row: CsvRow) {
  return parseNumber(firstValue(row, QUANTITY_ALIASES));
}

function reference(row: CsvRow) {
  const value = firstValue(row, REFERENCE_ALIASES);
  return value?.trim() || null;
}

function potentialRecovery(billed: number | null, expected: number | null) {
  if (billed === null || expected === null) return 0;
  return Math.max(0, billed - expected);
}

export function buildRateMap(rows: CsvRow[], document: DocumentRow) {
  const rates = new Map<string, Rate>();
  rows.forEach((row, index) => {
    const code = serviceCode(row);
    const rateCents = unitRate(row);
    if (!code || rateCents === null || rateCents < 0) return;
    if (!rates.has(code)) {
      rates.set(code, {
        serviceCode: code,
        rateCents,
        sourceDocumentId: document.id,
        sourceRow: index + 2,
      });
    }
  });
  return rates;
}

export function analyzeInvoiceRows(input: {
  rows: CsvRow[];
  document: DocumentRow;
  rateMap: Map<string, Rate>;
  runId: string;
  requestId: string;
  seenDuplicates: Map<string, DuplicateOrigin>;
}) {
  const findings: AuditFindingInsert[] = [];

  input.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const code = serviceCode(row);
    const qty = quantity(row);
    const invoiceUnitRate = unitRate(row);
    const amount = billedAmount(row);
    const ref = reference(row);
    const contractRate = code ? input.rateMap.get(code) ?? null : null;

    if (ref) {
      const duplicateKey = [
        ref,
        code ?? "",
        qty ?? "",
        invoiceUnitRate ?? "",
        amount ?? "",
      ].join("|");
      const first = input.seenDuplicates.get(duplicateKey);
      if (first) {
        findings.push({
          audit_run_id: input.runId,
          audit_request_id: input.requestId,
          finding_type: "duplicate_charge",
          severity: amount && amount >= 50000 ? "high" : "medium",
          source_document_id: input.document.id,
          source_row: rowNumber,
          service_code: code,
          description: `Possible duplicate charge matching ${first.filename} row ${first.row}.`,
          billed_amount_cents: amount,
          expected_amount_cents: 0,
          potential_recovery_cents: Math.max(0, amount ?? 0),
          evidence: {
            reference: ref,
            matching_document_id: first.documentId,
            matching_filename: first.filename,
            matching_row: first.row,
          },
        });
      } else {
        input.seenDuplicates.set(duplicateKey, {
          documentId: input.document.id,
          filename: input.document.original_filename,
          row: rowNumber,
        });
      }
    }

    if (code && !contractRate) {
      findings.push({
        audit_run_id: input.runId,
        audit_request_id: input.requestId,
        finding_type: "unsupported_fee",
        severity: "medium",
        source_document_id: input.document.id,
        source_row: rowNumber,
        service_code: code,
        description: "Invoice service code was not found in the supplied rate card.",
        billed_amount_cents: amount,
        expected_amount_cents: null,
        potential_recovery_cents: 0,
        evidence: { service_code: code, reference: ref },
      });
    }

    if (qty !== null && invoiceUnitRate !== null && amount !== null) {
      const calculated = Math.round(qty * invoiceUnitRate);
      if (Math.abs(calculated - amount) > 1) {
        findings.push({
          audit_run_id: input.runId,
          audit_request_id: input.requestId,
          finding_type: "arithmetic_mismatch",
          severity:
            Math.abs(amount - calculated) >= 50000 ? "high" : "medium",
          source_document_id: input.document.id,
          source_row: rowNumber,
          service_code: code,
          description:
            "Billed line total does not equal quantity × billed unit rate.",
          billed_amount_cents: amount,
          expected_amount_cents: calculated,
          potential_recovery_cents: potentialRecovery(amount, calculated),
          evidence: { quantity: qty, billed_unit_rate_cents: invoiceUnitRate },
        });
      }
    }

    if (
      contractRate &&
      invoiceUnitRate !== null &&
      Math.abs(invoiceUnitRate - contractRate.rateCents) > 1
    ) {
      const expected =
        qty !== null ? Math.round(qty * contractRate.rateCents) : null;
      findings.push({
        audit_run_id: input.runId,
        audit_request_id: input.requestId,
        finding_type: "rate_mismatch",
        severity:
          amount !== null && expected !== null && amount - expected >= 50000
            ? "high"
            : "medium",
        source_document_id: input.document.id,
        source_row: rowNumber,
        service_code: code,
        description:
          "Billed unit rate differs from the supplied contract/rate-card rate.",
        billed_amount_cents: amount,
        expected_amount_cents: expected,
        potential_recovery_cents: potentialRecovery(amount, expected),
        evidence: {
          billed_unit_rate_cents: invoiceUnitRate,
          contract_unit_rate_cents: contractRate.rateCents,
          rate_card_document_id: contractRate.sourceDocumentId,
          rate_card_row: contractRate.sourceRow,
          quantity: qty,
          reference: ref,
        },
      });
    }
  });

  return findings;
}

