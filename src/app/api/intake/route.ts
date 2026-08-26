import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { intakeSchema } from "@/lib/validation";

function intakeRateKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256")
    .update(`billguarded:intake:${address}`, "utf8")
    .digest("hex");
}

export async function POST(request: Request) {
  const parsed = intakeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter valid company and invoice details." },
      { status: 400 },
    );
  }

  const supabase = supabaseAdmin();
  const { data: allowed, error: limitError } = await supabase.rpc(
    "billguarded_consume_intake_rate_limit",
    {
      p_key: intakeRateKey(request),
      p_limit: 10,
      p_window_seconds: 3600,
    },
  );

  if (limitError) {
    console.error("intake_rate_limit_failed", limitError.code);
    return NextResponse.json(
      { error: "Could not validate this intake request. Please try again shortly." },
      { status: 503 },
    );
  }

  if (allowed !== true) {
    return NextResponse.json(
      { error: "Too many audit workspaces were created from this network. Try again later or contact support@billguarded.com." },
      { status: 429 },
    );
  }

  const accessToken = randomBytes(32).toString("base64url");
  const accessTokenHash = createHash("sha256")
    .update(accessToken, "utf8")
    .digest("hex");

  const { data, error } = await supabase
    .from("audit_requests")
    .insert({
      company: parsed.data.company,
      email: parsed.data.email,
      monthly_3pl_spend_cents: parsed.data.monthly3plSpend * 100,
      invoice_count_monthly: parsed.data.invoiceCount,
      access_token_hash: accessTokenHash,
      status: "intake",
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

  return NextResponse.json({ requestId: data.id, accessToken });
}
