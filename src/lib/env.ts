import { z } from "zod";

const optionalStripePrice = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().startsWith("price_").optional(),
);

const stripeServerSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_PRICE_AUDIT_90_DAY: optionalStripePrice,
  STRIPE_PRICE_CONTINUOUS_MONITOR: optionalStripePrice,
});

const supabaseServerSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
});

let cachedStripe: z.infer<typeof stripeServerSchema> | undefined;
let cachedSupabase: z.infer<typeof supabaseServerSchema> | undefined;

export function stripeServerEnv() {
  if (!cachedStripe) {
    cachedStripe = stripeServerSchema.parse({
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_PRICE_AUDIT_90_DAY: process.env.STRIPE_PRICE_AUDIT_90_DAY,
      STRIPE_PRICE_CONTINUOUS_MONITOR:
        process.env.STRIPE_PRICE_CONTINUOUS_MONITOR,
    });
  }

  return cachedStripe;
}

export function supabaseServerEnv() {
  if (!cachedSupabase) {
    cachedSupabase = supabaseServerSchema.parse({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    });
  }

  return cachedSupabase;
}

export function publicSupabaseEnv() {
  const parsed = z
    .object({
      url: z.string().url(),
      publishableKey: z.string().min(1),
    })
    .parse({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });

  return parsed;
}
