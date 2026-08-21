import { z } from "zod";

const serverSchema = z.object({
  APP_URL: z.string().url(),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_AUDIT_90_DAY: z.string().startsWith("price_"),
  STRIPE_PRICE_CONTINUOUS_MONITOR: z.string().startsWith("price_"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  APP_SIGNING_SECRET: z.string().min(32),
});

let cached: z.infer<typeof serverSchema> | undefined;

export function serverEnv() {
  if (!cached) {
    cached = serverSchema.parse({
      APP_URL: process.env.APP_URL,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      STRIPE_PRICE_AUDIT_90_DAY: process.env.STRIPE_PRICE_AUDIT_90_DAY,
      STRIPE_PRICE_CONTINUOUS_MONITOR: process.env.STRIPE_PRICE_CONTINUOUS_MONITOR,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      APP_SIGNING_SECRET: process.env.APP_SIGNING_SECRET,
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
