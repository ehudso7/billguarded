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
};

export const OFFERS: Record<OfferId, Offer> = {
  audit_90_day: {
    id: "audit_90_day",
    name: "Full 90-Day Audit",
    eyebrow: "Recover the past",
    priceLabel: "$1,500",
    cadence: "one time",
    description:
      "Reconcile up to 90 days of 3PL invoices against your contract and rate card, then package evidence-backed discrepancies for review.",
    features: [
      "Contract and rate-card reconciliation",
      "Invoice-line discrepancy analysis",
      "Duplicate and unsupported charge checks",
      "Evidence-linked findings",
      "Dispute-ready findings package",
    ],
    mode: "payment",
    priceEnv: "STRIPE_PRICE_AUDIT_90_DAY",
  },
  continuous_monitor: {
    id: "continuous_monitor",
    name: "Continuous Monitor",
    eyebrow: "Stop the next leak",
    priceLabel: "$599",
    cadence: "per month",
    description:
      "Continuously reconcile new fulfillment invoices against the commercial terms you supplied and surface exceptions for review.",
    features: [
      "Ongoing invoice reconciliation",
      "Recurring discrepancy detection",
      "Evidence-linked exception log",
      "Billing history in Stripe",
      "Self-service subscription management",
    ],
    mode: "subscription",
    priceEnv: "STRIPE_PRICE_CONTINUOUS_MONITOR",
  },
};

export function isOfferId(value: string): value is OfferId {
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
