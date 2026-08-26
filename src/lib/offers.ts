export type OfferId = "audit_90_day" | "continuous_monitor";

export type Offer = {
  id: OfferId;
  name: string;
  eyebrow: string;
  priceLabel: string;
  cadence: string;
  description: string;
  features: string[];
  mode: "payment" | "subscription";
  priceEnv:
    | "STRIPE_PRICE_AUDIT_90_DAY"
    | "STRIPE_PRICE_CONTINUOUS_MONITOR";
  sandboxPriceId: string;
};

export const OFFERS: Record<OfferId, Offer> = {
  audit_90_day: {
    id: "audit_90_day",
    name: "Full 90-Day Audit",
    eyebrow: "Recover the past",
    priceLabel: "$1,500",
    cadence: "one time",
    description:
      "Reconcile up to 90 days of supported 3PL invoice CSVs against your supplied rate card, then review evidence-linked potential discrepancies.",
    features: [
      "Contract and rate-card reconciliation",
      "Invoice-line discrepancy analysis",
      "Duplicate and unsupported charge checks",
      "Evidence-linked findings",
      "Downloadable findings report",
    ],
    mode: "payment",
    priceEnv: "STRIPE_PRICE_AUDIT_90_DAY",
    sandboxPriceId: "price_1U6puoBOw52KUyWD3Rcakbks",
  },
  continuous_monitor: {
    id: "continuous_monitor",
    name: "Continuous Monitor",
    eyebrow: "Stop the next leak",
    priceLabel: "$599",
    cadence: "per month",
    description:
      "Planned recurring reconciliation of new fulfillment invoices against supplied commercial terms. Paid enrollment remains disabled until recurring ingestion is production-ready.",
    features: [
      "Ongoing invoice reconciliation",
      "Recurring discrepancy detection",
      "Evidence-linked exception history",
      "Planned billing self-service",
      "Controlled early access before general availability",
    ],
    mode: "subscription",
    priceEnv: "STRIPE_PRICE_CONTINUOUS_MONITOR",
    sandboxPriceId: "price_1U6pvABOw52KUyWDYj1TH9wv",
  },
};

export function isOfferId(value: unknown): value is OfferId {
  return value === "audit_90_day" || value === "continuous_monitor";
}

export function offerFromPriceId(
  priceId: string | null | undefined,
  auditPriceId: string,
  monitorPriceId: string,
): OfferId | null {
  if (!priceId) return null;
  if (priceId === auditPriceId) return "audit_90_day";
  if (priceId === monitorPriceId) return "continuous_monitor";
  return null;
}
