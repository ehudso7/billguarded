import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "@/lib/env";

export function supabaseAdmin() {
  const env = supabaseServerEnv();

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
