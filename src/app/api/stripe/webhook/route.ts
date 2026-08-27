import type Stripe from "stripe";
import { after, NextResponse } from "next/server";
import { processAuditRequestWithRetry } from "@/lib/audit-processing";
import {
  isOfferId,
  type OfferId,
} from "@/lib/offers";
import { offerForStripePriceId } from "@/lib/stripe-prices";
import { stripe } from "@/lib/stripe";
import { stripeWebhookSecret } from "@/lib/stripe-webhook-secret";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 300;

async function eventAlreadyProcessed(eventId: string) {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from("stripe_events")
    .select("processed")
    .eq("event_id", eventId)
    .maybeSingle();

  return data?.processed === true;
}

async function registerEvent(event: Stripe.Event) {
  const supabase = supabaseAdmin();
  const { error } = await supabase.from("stripe_events").upsert(
    {
      event_id: event.id,
      event_type: event.type,
      stripe_created_at: new Date(event.created * 1000).toISOString(),
      processed: false,
    },
    { onConflict: "event_id", ignoreDuplicates: true },
  );

  if (error) throw error;
}

async function finishEvent(eventId: string) {
  const { error } = await supabaseAdmin()
    .from("stripe_events")
    .update({
      processed: true,
      processed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("event_id", eventId);

  if (error) throw error;
}

async function recordEventError(eventId: string, error: unknown) {
  const message =
    error instanceof Error ? error.message.slice(0, 500) : "unknown error";

  await supabaseAdmin()
    .from("stripe_events")
    .update({ last_error: message })
    .eq("event_id", eventId);
}

function stripeId(
  value: string | { id: string } | null | undefined,
) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function checkoutIsPaid(session: Stripe.Checkout.Session) {
  return (
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required"
  );
}

function firstPriceId(subscription: Stripe.Subscription) {
  return subscription.items.data[0]?.price.id ?? null;
}

function periodEnd(subscription: Stripe.Subscription) {
  const unix = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => b - a)[0];

  return unix ? new Date(unix * 1000).toISOString() : null;
}

async function upsertCustomer(
  customerId: string,
  email: string | null,
  name: string | null,
) {
  const { error } = await supabaseAdmin().from("billing_customers").upsert(
    {
      stripe_customer_id: customerId,
      email,
      name,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_customer_id" },
  );

  if (error) throw error;
}

async function upsertEntitlement(input: {
  customerId: string;
  offer: OfferId;
  status: string;
  checkoutSessionId?: string | null;
  subscriptionId?: string | null;
  currentPeriodEnd?: string | null;
}) {
  const { error } = await supabaseAdmin().from("billing_entitlements").upsert(
    {
      stripe_customer_id: input.customerId,
      offer: input.offer,
      status: input.status,
      stripe_checkout_session_id: input.checkoutSessionId ?? null,
      stripe_subscription_id: input.subscriptionId ?? null,
      current_period_end: input.currentPeriodEnd ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_customer_id,offer" },
  );

  if (error) throw error;
}

async function offerForSubscription(subscription: Stripe.Subscription) {
  const metadataOffer = subscription.metadata.offer;
  if (isOfferId(metadataOffer)) {
    return metadataOffer;
  }

  return offerForStripePriceId(firstPriceId(subscription));
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const customerId = stripeId(subscription.customer);
  const offer = await offerForSubscription(subscription);
  if (!customerId || !offer) {
    throw new Error("subscription_missing_customer_or_offer");
  }

  await upsertEntitlement({
    customerId,
    offer,
    status: subscription.status,
    subscriptionId: subscription.id,
    currentPeriodEnd: periodEnd(subscription),
  });
}

async function subscriptionIdFromInvoice(invoice: Stripe.Invoice) {
  const parent = invoice.parent;
  if (parent?.type !== "subscription_details") return null;
  return stripeId(parent.subscription_details?.subscription);
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (!checkoutIsPaid(session)) return null;

  const customerId = stripeId(session.customer);
  const requestId = session.metadata?.request_id;
  const metadataOffer = session.metadata?.offer;

  if (!requestId || !isOfferId(metadataOffer)) {
    console.warn("stripe_checkout_not_billguarded", session.id);
    return null;
  }

  if (!customerId) {
    throw new Error("checkout_customer_missing");
  }

  await upsertCustomer(
    customerId,
    session.customer_details?.email ?? session.customer_email ?? null,
    session.customer_details?.name ?? null,
  );

  let subscriptionId: string | null = null;
  let entitlementStatus = "active";
  let currentPeriodEnd: string | null = null;

  if (session.subscription) {
    subscriptionId = stripeId(session.subscription);
    if (!subscriptionId) {
      throw new Error("checkout_subscription_id_missing");
    }
    const subscription = await stripe().subscriptions.retrieve(subscriptionId);
    entitlementStatus = subscription.status;
    currentPeriodEnd = periodEnd(subscription);
  }

  await upsertEntitlement({
    customerId,
    offer: metadataOffer,
    status: entitlementStatus,
    checkoutSessionId: session.id,
    subscriptionId,
    currentPeriodEnd,
  });

  const { error } = await supabaseAdmin()
    .from("audit_requests")
    .update({
      status: "paid",
      stripe_customer_id: customerId,
      stripe_checkout_session_id: session.id,
      selected_offer: metadataOffer,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (error) throw error;
  return requestId;
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId = await subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return;
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  await syncSubscription(subscription);
}

async function handleInvoiceFailed(invoice: Stripe.Invoice) {
  const subscriptionId = await subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return;
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  const customerId = stripeId(subscription.customer);
  const offer = await offerForSubscription(subscription);
  if (!customerId || !offer) return;

  await upsertEntitlement({
    customerId,
    offer,
    status: "past_due",
    subscriptionId,
    currentPeriodEnd: periodEnd(subscription),
  });
}

function scheduleAudit(requestId: string) {
  after(async () => {
    try {
      await processAuditRequestWithRetry(requestId);
    } catch (error) {
      console.error("billguarded_audit_processing_failed", requestId, error);
    }
  });
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  let webhookSecret: string;
  try {
    webhookSecret = await stripeWebhookSecret();
  } catch {
    console.error("stripe_webhook_secret_unavailable");
    return NextResponse.json(
      { error: "webhook_not_configured" },
      { status: 503 },
    );
  }

  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      body,
      signature,
      webhookSecret,
    );
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  if (await eventAlreadyProcessed(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  await registerEvent(event);

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const requestId = await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        if (requestId) scheduleAudit(requestId);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_failed":
        await handleInvoiceFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        break;
    }

    await finishEvent(event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("stripe_webhook_processing_failed", event.id, event.type);
    await recordEventError(event.id, error);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
