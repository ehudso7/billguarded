import { createHash, randomBytes } from "node:crypto";
import { after, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { intakeSchema } from "@/lib/validation";

export const maxDuration = 60;
const TERMS_VERSION = "2026-08-27";

function intakeRateKey(request: Request) {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256")
    .update(`billguarded:intake:${address}`, "utf8")
    .digest("hex");
}

async function cleanupAbandonedIntakes() {
  const supabase = supabaseAdmin();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: stale, error } = await supabase
    .from("audit_requests")
    .select("id")
    .eq("status", "intake")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(10);

  if (error || !stale?.length) return;

  for (const audit of stale) {
    const { data: documents, error: documentError } = await supabase
      .from("audit_documents")
      .select("storage_path")
      .eq("audit_request_id", audit.id);
    if (documentError) continue;

    const paths = (documents ?? []).map((document) => document.storage_path);
    if (paths.length > 0) {
      const { error: removeError } = await supabase.storage
        .from("audit-documents")
        .remove(paths);
      if (removeError) continue;
    }

    await supabase
      .from("audit_requests")
      .delete()
      .eq("id", audit.id)
      .eq("status", "intake");
  }
}

export async function POST(request: Request) {
  const parsed = intakeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Enter valid company and invoice details and accept the BillGuarded Terms and Privacy Notice.",
      },
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
      {
        error:
          "Too many audit workspaces were created from this network. Try again later or contact support@billguarded.com.",
      },
      { status: 429 },
    );
  }

  after(async () => {
    try {
      await cleanupAbandonedIntakes();
    } catch (error) {
      console.error("abandoned_intake_cleanup_failed", error);
    }
  });

  const accessToken = randomBytes(32).toString("base64url");
  const accessTokenHash = createHash("sha256")
    .update(accessToken, "utf8")
    .digest("hex");
  const acceptedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("audit_requests")
    .insert({
      company: parsed.data.company,
      email: parsed.data.email,
      monthly_3pl_spend_cents: parsed.data.monthly3plSpend * 100,
      invoice_count_monthly: parsed.data.invoiceCount,
      access_token_hash: accessTokenHash,
      terms_accepted_at: acceptedAt,
      terms_version: TERMS_VERSION,
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
