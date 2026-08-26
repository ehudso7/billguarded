import { NextResponse } from "next/server";
import { preflightAuditDocuments } from "@/lib/audit-preflight";
import { OFFERS } from "@/lib/offers";
import { applicationOrigin } from "@/lib/origin";
import { intakeAccessTokenHash } from "@/lib/security/intake-access";
import { stripePriceId } from "@/lib/stripe-prices";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkoutSchema } from "@/lib/validation";

const INTEGRATION_IDENTIFIER = "reqovr_rkqjvmtp";

function isCsvDocument(document: {
  content_type: string;
  original_filename: string;
}) {
  return (
    document.content_type === "text/csv" ||
    document.original_filename.toLowerCase().endsWith(".csv")
  );
}

export async function POST(request: Request) {
  const parsed = checkoutSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid checkout request." },
      { status: 400 },
    );
  }

  if (parsed.data.offer === "continuous_monitor") {
    return NextResponse.json(
      {
        error:
          "Continuous Monitor is not accepting paid subscriptions yet. Start with the production-ready 90-Day Audit or contact support@billguarded.com for early access.",
      },
      { status: 409 },
    );
  }

  const offer = OFFERS.audit_90_day;
  const supabase = supabaseAdmin();

  const { data: audit, error: auditError } = await supabase
    .from("audit_requests")
    .select("id, company, email, status")
    .eq("id", parsed.data.requestId)
    .eq("access_token_hash", intakeAccessTokenHash(parsed.data.accessToken))
    .maybeSingle();

  if (auditError || !audit || audit.status !== "intake") {
    return NextResponse.json(
      { error: "Audit request is not ready for checkout." },
      { status: 404 },
    );
  }

  const { data: documents, error: documentError } = await supabase
    .from("audit_documents")
    .select(
      "id,kind,content_type,original_filename,storage_path,byte_size",
    )
    .eq("audit_request_id", audit.id)
    .eq("upload_status", "uploaded");

  if (documentError || !documents) {
    return NextResponse.json(
      {
        error:
          "BillGuarded could not validate the uploaded file set. No charge was created. Please retry or contact support@billguarded.com.",
      },
      { status: 503 },
    );
  }

  const csvDocuments = documents.filter(isCsvDocument);
  if (csvDocuments.length !== documents.length) {
    return NextResponse.json(
      {
        error:
          "BillGuarded currently accepts CSV audit inputs only. No charge was created.",
      },
      { status: 409 },
    );
  }

  const hasCsvTerms = csvDocuments.some(
    (document) => document.kind === "contract" || document.kind === "rate_card",
  );
  const hasCsvInvoice = csvDocuments.some(
    (document) => document.kind === "invoice",
  );
  if (!hasCsvTerms || !hasCsvInvoice) {
    return NextResponse.json(
      {
        error:
          "BillGuarded requires one CSV contract/rate card and at least one CSV invoice before payment. No charge was created.",
      },
      { status: 409 },
    );
  }

  const preflight = await preflightAuditDocuments(csvDocuments);
  if (!preflight.ok) {
    return NextResponse.json(
      { error: preflight.message },
      { status: 409 },
    );
  }

  const priceId = stripePriceId(offer.id);
  const origin = applicationOrigin(request.url);
  const metadata = {
    request_id: audit.id,
    offer: offer.id,
    company: audit.company.slice(0, 120),
  };

  let session;
  try {
    session = await stripe().checkout.sessions.create({
      customer_email: audit.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/start?cancelled=1`,
      metadata,
      integration_identifier: INTEGRATION_IDENTIFIER,
      mode: "payment",
      customer_creation: "always",
    });
  } catch (error) {
    console.error(
      "checkout_session_create_failed",
      error instanceof Error ? error.message.slice(0, 160) : "unknown_error",
    );
    return NextResponse.json(
      {
        error:
          "Secure checkout could not be opened. No charge was created. Please try again shortly.",
      },
      { status: 502 },
    );
  }

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe did not return a checkout URL. No charge was created." },
      { status: 502 },
    );
  }

  const { error: updateError } = await supabase
    .from("audit_requests")
    .update({
      selected_offer: offer.id,
      stripe_checkout_session_id: session.id,
      status: "checkout_started",
      updated_at: new Date().toISOString(),
    })
    .eq("id", audit.id)
    .eq("status", "intake");

  if (updateError) {
    console.error("checkout_audit_update_failed", updateError.code);
    return NextResponse.json(
      {
        error:
          "Checkout was prepared but the audit workspace could not be locked for payment. Do not pay from an old tab; contact support@billguarded.com.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: session.url });
}
