import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { intakeSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const parsed = intakeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter valid company and invoice details." },
      { status: 400 },
    );
  }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("audit_requests")
    .insert({
      company: parsed.data.company,
      email: parsed.data.email,
      monthly_3pl_spend_cents: parsed.data.monthly3plSpend * 100,
      invoice_count_monthly: parsed.data.invoiceCount,
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

  return NextResponse.json({ requestId: data.id });
}
