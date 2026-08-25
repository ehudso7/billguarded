import { NextResponse } from "next/server";
import {
  createIntakeCookie,
  intakeCookieName,
} from "@/lib/security/intake-cookie";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { intakeSchema } from "@/lib/validation";

const TERMS_VERSION = "2026-08-25";
const MAX_INTAKES_PER_EMAIL_PER_HOUR = 5;

export async function POST(request: Request) {
  const parsed = intakeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter valid company and invoice details and accept the terms." },
      { status: 400 },
    );
  }

  const supabase = supabaseAdmin();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from("audit_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", parsed.data.email)
    .gte("created_at", hourAgo);

  if (countError) {
    console.error("intake_rate_limit_check_failed", countError.code);
    return NextResponse.json(
      { error: "Could not validate the intake request." },
      { status: 503 },
    );
  }

  if ((count ?? 0) >= MAX_INTAKES_PER_EMAIL_PER_HOUR) {
    return NextResponse.json(
      { error: "Too many recent audit requests for this email. Try again later." },
      { status: 429 },
    );
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("audit_requests")
    .insert({
      company: parsed.data.company,
      email: parsed.data.email,
      monthly_3pl_spend_cents: parsed.data.monthly3plSpend * 100,
      invoice_count_monthly: parsed.data.invoiceCount,
      status: "intake",
      terms_accepted_at: now,
      terms_version: TERMS_VERSION,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("intake_insert_failed", error?.code);
    return NextResponse.json(
      { error: "Could not create the audit workspace." },
      { status: 500 },
    );
  }

  const cookie = createIntakeCookie(data.id);
  const response = NextResponse.json({ requestId: data.id });
  response.cookies.set(intakeCookieName, cookie.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: cookie.maxAge,
  });
  return response;
}
