import { NextResponse } from "next/server";
import { checkoutSchema } from "@/lib/validation";
import { OFFERS } from "@/lib/offers";
import { serverEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

const INTEGRATION_IDENTIFIER = "reqovr_rkqjvmtp";

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

  const env = serverEnv();
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

  const { count: documentCount, error: documentError } = await supabase
    .from("audit_documents")
    .select("id", { count: "exact", head: true })
    .eq("audit_request_id", audit.id);

  if (documentError || !documentCount || documentCount < 2) {
    return NextResponse.json(
      { error: "Upload the contract and at least one invoice first." },
      { status: 409 },
    );
  }

  const priceId = env[offer.priceEnv];
  const metadata = {
    request_id: audit.id,
    offer: offer.id,
    company: audit.company.slice(0, 120),
  };

  const common = {
    customer_email: audit.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.APP_URL}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_URL}/start?offer=${offer.id}&cancelled=1`,
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
