import { supabaseAdmin } from "@/lib/supabase-admin";

let cachedSecret: Promise<string> | undefined;

async function loadStripeWebhookSecret() {
  const { data, error } = await supabaseAdmin().rpc(
    "billguarded_stripe_webhook_secret",
  );

  if (error || typeof data !== "string" || !data.startsWith("whsec_")) {
    throw new Error("Stripe webhook signing secret is unavailable.");
  }

  return data;
}

export function stripeWebhookSecret() {
  if (!cachedSecret) {
    cachedSecret = loadStripeWebhookSecret().catch((error) => {
      cachedSecret = undefined;
      throw error;
    });
  }

  return cachedSecret;
}
