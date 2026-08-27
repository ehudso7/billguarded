import { readFile } from "node:fs/promises";
import process from "node:process";

const EXPECTED_LIVE_AUDIT_PRICE = "price_1U76TJB5mhEA8v5jnP70HVCd";
const EXPECTED_ORIGIN = "https://billguarded.com";

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) {
    throw new Error(message);
  }
}

const [prices, checkout, webhook, origin] = await Promise.all([
  read("src/lib/stripe-prices.ts"),
  read("src/app/api/stripe/checkout/route.ts"),
  read("src/app/api/stripe/webhook/route.ts"),
  read("src/lib/origin.ts"),
]);

requireMatch(
  prices,
  new RegExp(`audit_90_day:\\s*\\"${EXPECTED_LIVE_AUDIT_PRICE}\\"`),
  "Canonical live Full 90-Day Audit Stripe Price ID is not bound in source.",
);
requireMatch(
  checkout,
  /parsed\.data\.offer\s*===\s*"continuous_monitor"/,
  "Continuous Monitor must remain blocked from paid Checkout until recurring ingestion is production-ready.",
);
requireMatch(
  checkout,
  /mode:\s*"payment"/,
  "Production Full 90-Day Audit Checkout must remain one-time payment mode.",
);
requireMatch(
  checkout,
  /offer\s*=\s*OFFERS\.audit_90_day/,
  "Checkout must bind the production-ready audit offer explicitly.",
);
requireMatch(
  webhook,
  /webhooks\.constructEvent\(/,
  "Stripe webhook signature verification is missing.",
);
requireMatch(
  webhook,
  /stripeWebhookSecret\(\)/,
  "Stripe webhook signing secret retrieval is missing.",
);
requireMatch(
  webhook,
  /checkout\.session\.completed/,
  "Paid Checkout completion is not handled by the webhook.",
);
requireMatch(
  origin,
  new RegExp(`PRODUCTION_ORIGIN\\s*=\\s*\\"${EXPECTED_ORIGIN}\\"`),
  "Production Checkout origin is not pinned to the canonical BillGuarded domain.",
);

console.log(
  `Live Stripe source contract verified: audit price ${EXPECTED_LIVE_AUDIT_PRICE}, one-time Checkout, signed webhook handling, canonical origin ${EXPECTED_ORIGIN}.`,
);
console.log(
  "This gate intentionally performs no live Stripe API call and uses no live secret; connected-account certification and payment monitoring remain external runtime checks.",
);
process.exit(0);
