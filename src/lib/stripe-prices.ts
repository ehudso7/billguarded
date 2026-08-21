import { serverEnv } from "@/lib/env";
import { OFFERS, offerFromPriceId, type OfferId } from "@/lib/offers";

function isLiveStripeKey(key: string) {
  return key.startsWith("sk_live_") || key.startsWith("rk_live_");
}

function configuredPrice(offerId: OfferId) {
  const env = serverEnv();
  const offer = OFFERS[offerId];
  const configured = env[offer.priceEnv];

  if (configured) return configured;

  if (isLiveStripeKey(env.STRIPE_SECRET_KEY)) {
    throw new Error(`Missing live Stripe Price ID for ${offerId}.`);
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
