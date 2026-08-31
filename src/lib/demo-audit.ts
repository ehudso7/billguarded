import { conservativePotentialRecoveryCents } from "@/lib/audit-math";

export type DemoFindingType =
  | "duplicate_charge"
  | "unsupported_fee"
  | "arithmetic_mismatch"
  | "rate_mismatch";

export type DemoRateCardRow = {
  row: number;
  serviceCode: string;
  label: string;
  rateCents: number;
  unit: string;
};

export type DemoInvoiceRow = {
  row: number;
  reference: string;
  serviceCode: string;
  quantity: number;
  unitRateCents: number;
  amountCents: number;
};

export type DemoFinding = {
  findingType: DemoFindingType;
  label: string;
  severity: "medium" | "high";
  sourceRow: number;
  serviceCode: string;
  billedAmountCents: number;
  expectedAmountCents: number | null;
  potentialRecoveryCents: number;
  description: string;
  evidence: string;
};

export const DEMO_RATE_CARD: readonly DemoRateCardRow[] = [
  {
    row: 2,
    serviceCode: "PICK_EACH",
    label: "Pick — each",
    rateCents: 120,
    unit: "each",
  },
  {
    row: 3,
    serviceCode: "STORAGE_BIN",
    label: "Storage — bin",
    rateCents: 1800,
    unit: "bin / month",
  },
  {
    row: 4,
    serviceCode: "B2B_CASE",
    label: "B2B case handling",
    rateCents: 250,
    unit: "case",
  },
] as const;

export const DEMO_INVOICE: readonly DemoInvoiceRow[] = [
  {
    row: 2,
    reference: "ORD-4101",
    serviceCode: "PICK_EACH",
    quantity: 100,
    unitRateCents: 120,
    amountCents: 12000,
  },
  {
    row: 3,
    reference: "ORD-4102",
    serviceCode: "PICK_EACH",
    quantity: 200,
    unitRateCents: 135,
    amountCents: 27000,
  },
  {
    row: 4,
    reference: "INV-AUG-PEAK",
    serviceCode: "PEAK_SURCHARGE",
    quantity: 1,
    unitRateCents: 6500,
    amountCents: 6500,
  },
  {
    row: 5,
    reference: "AUG-STORAGE",
    serviceCode: "STORAGE_BIN",
    quantity: 4,
    unitRateCents: 1800,
    amountCents: 9000,
  },
  {
    row: 6,
    reference: "B2B-771",
    serviceCode: "B2B_CASE",
    quantity: 20,
    unitRateCents: 250,
    amountCents: 5000,
  },
  {
    row: 7,
    reference: "B2B-771",
    serviceCode: "B2B_CASE",
    quantity: 20,
    unitRateCents: 250,
    amountCents: 5000,
  },
] as const;

export const DEMO_FINDINGS: readonly DemoFinding[] = [
  {
    findingType: "rate_mismatch",
    label: "Rate mismatch",
    severity: "medium",
    sourceRow: 3,
    serviceCode: "PICK_EACH",
    billedAmountCents: 27000,
    expectedAmountCents: 24000,
    potentialRecoveryCents: 3000,
    description:
      "Billed unit rate differs from the supplied contract/rate-card rate.",
    evidence: "200 × $1.35 billed vs. 200 × $1.20 on rate-card row 2.",
  },
  {
    findingType: "unsupported_fee",
    label: "Unsupported fee",
    severity: "medium",
    sourceRow: 4,
    serviceCode: "PEAK_SURCHARGE",
    billedAmountCents: 6500,
    expectedAmountCents: null,
    potentialRecoveryCents: 0,
    description: "Invoice service code was not found in the supplied rate card.",
    evidence:
      "PEAK_SURCHARGE is billed for $65.00, but no matching service code exists in the supplied sample rate card.",
  },
  {
    findingType: "arithmetic_mismatch",
    label: "Line-math mismatch",
    severity: "medium",
    sourceRow: 5,
    serviceCode: "STORAGE_BIN",
    billedAmountCents: 9000,
    expectedAmountCents: 7200,
    potentialRecoveryCents: 1800,
    description: "Billed line total does not equal quantity × billed unit rate.",
    evidence: "4 bins × $18.00 = $72.00; the sample invoice line totals $90.00.",
  },
  {
    findingType: "duplicate_charge",
    label: "Possible duplicate",
    severity: "medium",
    sourceRow: 7,
    serviceCode: "B2B_CASE",
    billedAmountCents: 5000,
    expectedAmountCents: 0,
    potentialRecoveryCents: 5000,
    description: "Possible duplicate charge matching sample invoice row 6.",
    evidence:
      "Rows 6 and 7 share the same reference, service code, quantity, unit rate, and amount.",
  },
] as const;

export const DEMO_TOTAL_BILLED_CENTS = DEMO_INVOICE.reduce(
  (total, row) => total + row.amountCents,
  0,
);

export const DEMO_QUANTIFIED_POTENTIAL_CENTS =
  conservativePotentialRecoveryCents(
    DEMO_FINDINGS.map((finding) => ({
      source_document_id: "synthetic-invoice.csv",
      source_row: finding.sourceRow,
      potential_recovery_cents: finding.potentialRecoveryCents,
    })),
  );

export const DEMO_UNPRICED_FINDINGS = DEMO_FINDINGS.filter(
  (finding) => finding.expectedAmountCents === null,
).length;

export function formatDemoMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
