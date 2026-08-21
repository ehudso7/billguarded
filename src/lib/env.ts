import { z } from "zod";

const optionalStripePrice = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().startsWith("price_").optional(),
);

const serverSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_PRICE_AUDIT_90_DAY: optionalStripePrice,
  STRIPE_PRICE_CONTINUOUS_MONITOR: optionalStripePrice,
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
});

let cached: z.infer<typeof serverSchema> | undefined;

export function serverEnv() {
  if (!cached) {
    cached = serverSchema.parse({
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_PRICE_AUDIT_90_DAY: process.env.STRIPE_PRICE_AUDIT_90_DAY,
      STRIPE_PRICE_CONTINUOUS_MONITOR:
        process.env.STRIPE_PRICE_CONTINUOUS_MONITOR,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    });
  }
  return cached;
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
