import { NextResponse } from "next/server";
import { checkoutSchema } from "@/lib/validation";
import { OFFERS } from "@/lib/offers";
import { stripePriceId } from "@/lib/stripe-prices";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

  const csvDocuments = documents?.filter(isCsvDocument) ?? [];
  const hasCsvTerms = csvDocuments.some(
    (document) => document.kind === "contract" || document.kind === "rate_card",
  );
  const hasCsvInvoice = csvDocuments.some(
    (document) => document.kind === "invoice",
  );

  if (documentError || !hasCsvTerms || !hasCsvInvoice) {
    return NextResponse.json(
      {
        error:
          "Automated BillGuarded audits currently require a CSV contract/rate card and at least one CSV invoice before payment. No charge was created.",
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

  const common = {
    customer_email: audit.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/start?offer=${offer.id}&cancelled=1`,
    metadata,
    integration_identifier: INTEGRATION_IDENTIFIER,
  };

  const session =
    offer.mode === "subscription"
      ? await stripe().checkout.sessions.create({
          ...common,
          mode: "subscription",
          subscription_data: { metadata },
        })
      : await stripe().checkout.sessions.create({
          ...common,
          mode: "payment",
          customer_creation: "always",
        });

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe did not return a checkout URL." },
      { status: 502 },
    );
  }

  await supabase
    .from("audit_requests")
    .update({
      selected_offer: offer.id,
      stripe_checkout_session_id: session.id,
      status: "checkout_started",
      updated_at: new Date().toISOString(),
    })
    .eq("id", audit.id);

  return NextResponse.json({ url: session.url });
}
