import { stripeServerEnv } from "@/lib/env";
import { OFFERS, offerFromPriceId, type OfferId } from "@/lib/offers";

const LIVE_PRICE_IDS: Record<OfferId, string> = {
  audit_90_day: "price_1U76TJB5mhEA8v5jnP70HVCd",
  continuous_monitor: "price_1U76TRB5mhEA8v5jApmvnbDj",
};

function isLiveStripeKey(key: string) {
  return key.startsWith("sk_live_") || key.startsWith("rk_live_");
}

function configuredPrice(offerId: OfferId) {
  const env = stripeServerEnv();
  const offer = OFFERS[offerId];
  const configured = env[offer.priceEnv];

  if (configured) return configured;

  if (isLiveStripeKey(env.STRIPE_SECRET_KEY)) {
    return LIVE_PRICE_IDS[offerId];
  }

  return offer.sandboxPriceId;
}

export function stripePriceId(offerId: OfferId) {
  return configuredPrice(offerId);
}

export function offerForStripePriceId(priceId: string | null | undefined) {
  return offerFromPriceId(
    priceId,
    configuredPrice("audit_90_day"),
    configuredPrice("continuous_monitor"),
  );
}
