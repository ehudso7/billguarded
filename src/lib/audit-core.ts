import {
  firstValue,
  normalizeCode,
  parseMoneyToCents,
  parseNumber,
  type CsvRow,
} from "./audit-csv";

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

export type CoreFindingType =
  | "duplicate_charge"
  | "unsupported_fee"
  | "arithmetic_mismatch"
  | "rate_mismatch"
  | "ambiguous_rate";

export type CoreFinding = {
  findingType: CoreFindingType;
  severity: "low" | "medium" | "high";
  sourceRow: number;
  serviceCode: string | null;
  description: string;
  billedAmountCents: number | null;
  expectedAmountCents: number | null;
  potentialRecoveryCents: number;
  evidence: Record<string, unknown>;
};

type RateSource = {
  rateCents: number;
  sourceRow: number;
};

export type RateCard = {
  rates: Map<string, RateSource>;
  ambiguousCodes: Set<string>;
  sourceRowCount: number;
  recognizedRateRows: number;
};

export type InvoiceAnalysis = {
  findings: CoreFinding[];
  rowCount: number;
  evaluatedRowCount: number;
  skippedRowCount: number;
  coveragePercent: number;
  potentialRecoveryCents: number;
  truncated: boolean;
  requiresReview: boolean;
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

export function buildRateCard(rows: CsvRow[]): RateCard {
  const candidates = new Map<string, Map<number, number>>();
  let recognizedRateRows = 0;

  rows.forEach((row, index) => {
    const code = serviceCode(row);
    const rateCents = unitRate(row);
    if (!code || rateCents === null || rateCents < 0) return;

    recognizedRateRows += 1;
    const rates = candidates.get(code) ?? new Map<number, number>();
    if (!rates.has(rateCents)) rates.set(rateCents, index + 2);
    candidates.set(code, rates);
  });

  const rates = new Map<string, RateSource>();
  const ambiguousCodes = new Set<string>();

  for (const [code, distinctRates] of candidates.entries()) {
    if (distinctRates.size !== 1) {
      ambiguousCodes.add(code);
      continue;
    }
    const [rateCents, sourceRow] = [...distinctRates.entries()][0];
    rates.set(code, { rateCents, sourceRow });
  }

  return {
    rates,
    ambiguousCodes,
    sourceRowCount: rows.length,
    recognizedRateRows,
  };
}

export function analyzeInvoiceRows(input: {
  rows: CsvRow[];
  rateCard: RateCard;
  maxRows?: number;
}): InvoiceAnalysis {
  const maxRows = Math.max(1, input.maxRows ?? 25_000);
  const inspectedRows = input.rows.slice(0, maxRows);
  const truncated = input.rows.length > inspectedRows.length;
  const findings: CoreFinding[] = [];
  const seen = new Map<string, number>();
  const recoverableByRow = new Map<number, number>();
  let evaluatedRowCount = 0;
  let skippedRowCount = truncated ? input.rows.length - inspectedRows.length : 0;

  function addFinding(finding: CoreFinding) {
    findings.push(finding);
    const previous = recoverableByRow.get(finding.sourceRow) ?? 0;
    recoverableByRow.set(
      finding.sourceRow,
      Math.max(previous, finding.potentialRecoveryCents),
    );
  }

  inspectedRows.forEach((row, index) => {
    const sourceRow = index + 2;
    const code = serviceCode(row);
    const qty = quantity(row);
    const invoiceUnitRate = unitRate(row);
    const amount = billedAmount(row);
    const ref = reference(row);
    const hasRecognizedShape =
      code !== null ||
      qty !== null ||
      invoiceUnitRate !== null ||
      amount !== null ||
      ref !== null;

    if (!hasRecognizedShape || amount === null) {
      skippedRowCount += 1;
      return;
    }

    evaluatedRowCount += 1;
    const contractRate = code ? input.rateCard.rates.get(code) ?? null : null;
    const ambiguousRate = code
      ? input.rateCard.ambiguousCodes.has(code)
      : false;

    if (ref) {
      const duplicateKey = [
        ref,
        code ?? "",
        qty ?? "",
        invoiceUnitRate ?? "",
        amount,
      ].join("|");
      const firstRow = seen.get(duplicateKey);
      if (firstRow !== undefined) {
        addFinding({
          findingType: "duplicate_charge",
          severity: amount >= 50_000 ? "high" : "medium",
          sourceRow,
          serviceCode: code,
          description: `Possible duplicate charge matching row ${firstRow}.`,
          billedAmountCents: amount,
          expectedAmountCents: 0,
          potentialRecoveryCents: Math.max(0, amount),
          evidence: { reference: ref, matching_row: firstRow },
        });
      } else {
        seen.set(duplicateKey, sourceRow);
      }
    }

    if (code && ambiguousRate) {
      addFinding({
        findingType: "ambiguous_rate",
        severity: "medium",
        sourceRow,
        serviceCode: code,
        description:
          "The supplied rate card contains multiple distinct rates for this service code, so BillGuarded did not assume which rate applies.",
        billedAmountCents: amount,
        expectedAmountCents: null,
        potentialRecoveryCents: 0,
        evidence: { service_code: code, reference: ref },
      });
    } else if (code && !contractRate) {
      addFinding({
        findingType: "unsupported_fee",
        severity: "medium",
        sourceRow,
        serviceCode: code,
        description: "Invoice service code was not found in the supplied rate card.",
        billedAmountCents: amount,
        expectedAmountCents: null,
        potentialRecoveryCents: 0,
        evidence: { service_code: code, reference: ref },
      });
    }

    if (qty !== null && invoiceUnitRate !== null) {
      const calculated = Math.round(qty * invoiceUnitRate);
      if (Math.abs(calculated - amount) > 1) {
        addFinding({
          findingType: "arithmetic_mismatch",
          severity: Math.abs(amount - calculated) >= 50_000 ? "high" : "medium",
          sourceRow,
          serviceCode: code,
          description:
            "Billed line total does not equal quantity × billed unit rate.",
          billedAmountCents: amount,
          expectedAmountCents: calculated,
          potentialRecoveryCents: potentialRecovery(amount, calculated),
          evidence: { quantity: qty, billed_unit_rate_cents: invoiceUnitRate },
        });
      }
    }

    if (
      contractRate &&
      invoiceUnitRate !== null &&
      Math.abs(invoiceUnitRate - contractRate.rateCents) > 1
    ) {
      const expected = qty !== null ? Math.round(qty * contractRate.rateCents) : null;
      addFinding({
        findingType: "rate_mismatch",
        severity:
          expected !== null && amount - expected >= 50_000 ? "high" : "medium",
        sourceRow,
        serviceCode: code,
        description:
          "Billed unit rate differs from the supplied contract/rate-card rate.",
        billedAmountCents: amount,
        expectedAmountCents: expected,
        potentialRecoveryCents: potentialRecovery(amount, expected),
        evidence: {
          billed_unit_rate_cents: invoiceUnitRate,
          contract_unit_rate_cents: contractRate.rateCents,
          rate_card_row: contractRate.sourceRow,
          quantity: qty,
          reference: ref,
        },
      });
    }
  });

  const rowCount = input.rows.length;
  const coveragePercent =
    rowCount === 0 ? 0 : Math.round((evaluatedRowCount / rowCount) * 100);
  const potentialRecoveryCents = [...recoverableByRow.values()].reduce(
    (sum, amount) => sum + amount,
    0,
  );
  const requiresReview =
    rowCount === 0 || truncated || coveragePercent < 80 || evaluatedRowCount === 0;

  return {
    findings,
    rowCount,
    evaluatedRowCount,
    skippedRowCount,
    coveragePercent,
    potentialRecoveryCents,
    truncated,
    requiresReview,
  };
}
