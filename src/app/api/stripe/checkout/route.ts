import { NextResponse } from "next/server";
import { OFFERS } from "@/lib/offers";
import { hasIntakeAccess } from "@/lib/security/intake-access";
import { stripe } from "@/lib/stripe";
import { stripePriceId } from "@/lib/stripe-prices";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkoutSchema, isAllowedCsvUpload } from "@/lib/validation";

const INTEGRATION_IDENTIFIER = "billguarded_rkqjvmtp";

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

  if (!(await hasIntakeAccess(parsed.data.requestId))) {
    return NextResponse.json({ error: "Audit access expired." }, { status: 403 });
  }

  if (parsed.data.offer === "continuous_monitor") {
    return NextResponse.json(
      {
        error:
          "Continuous Monitor is offered only after a completed first audit. No charge was created.",
      },
      { status: 409 },
    );
  }

  const offer = OFFERS[parsed.data.offer];
  const supabase = supabaseAdmin();

  const { data: audit, error: auditError } = await supabase
    .from("audit_requests")
    .select("id, company, email, status")
    .eq("id", parsed.data.requestId)
    .maybeSingle();

  if (auditError || !audit || audit.status !== "intake") {
    return NextResponse.json(
      { error: "Audit request is not ready for checkout." },
      { status: 404 },
    );
  }

  const { data: documents, error: documentError } = await supabase
    .from("audit_documents")
    .select("kind,content_type,original_filename")
    .eq("audit_request_id", audit.id)
    .eq("upload_status", "uploaded");

  const csvDocuments =
    documents?.filter((document) =>
      isAllowedCsvUpload(document.original_filename, document.content_type),
    ) ?? [];
  const hasCsvTerms = csvDocuments.some(
    (document) => document.kind === "contract" || document.kind === "rate_card",
  );
  const hasCsvInvoice = csvDocuments.some((document) => document.kind === "invoice");

  if (documentError || !hasCsvTerms || !hasCsvInvoice) {
    return NextResponse.json(
      {
        error:
          "BillGuarded requires a CSV contract/rate card and at least one CSV invoice before payment. No charge was created.",
      },
      { status: 409 },
    );
  }

  const priceId = stripePriceId(offer.id);
  const origin = new URL(request.url).origin;
  const metadata = {
    request_id: audit.id,
    offer: offer.id,
    company: audit.company.slice(0, 120),
  };

  const session = await stripe().checkout.sessions.create({
    customer_email: audit.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/start?cancelled=1`,
    metadata,
    integration_identifier: INTEGRATION_IDENTIFIER,
    mode: "payment",
    customer_creation: "always",
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe did not return a checkout URL." },
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
    console.error("checkout_audit_state_update_failed", updateError.code);
    return NextResponse.json(
      { error: "Checkout was created but the audit state could not be saved. Contact support before paying." },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: session.url });
}
