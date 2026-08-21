import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ error: "production_diagnostic_only" }, { status: 404 });
  }

  const providedToken = request.nextUrl.searchParams.get("token") ?? "";
  const { data: tokenAccepted, error: tokenError } = await supabaseAdmin().rpc(
    "consume_reqovr_validation_token",
    { provided_token: providedToken },
  );

  if (tokenError || tokenAccepted !== true) {
    return NextResponse.json({ error: "diagnostic_not_authorized" }, { status: 404 });
  }

  const stripeEnvKeys = Object.keys(process.env)
    .filter((key) => key.toUpperCase().includes("STRIPE"))
    .sort();

  return NextResponse.json({
    ok: true,
    stripeEnvKeys,
    hasExpectedSecretKey: stripeEnvKeys.includes("STRIPE_SECRET_KEY"),
  });
}
