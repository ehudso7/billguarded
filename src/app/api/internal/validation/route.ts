import type Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { POST as intakePost } from "@/app/api/intake/route";
import { POST as uploadUrlPost } from "@/app/api/intake/upload-url/route";
import { POST as confirmUploadPost } from "@/app/api/intake/confirm-upload/route";
import { POST as checkoutPost } from "@/app/api/stripe/checkout/route";
import { POST as webhookPost } from "@/app/api/stripe/webhook/route";
import { stripeServerEnv } from "@/lib/env";
import { stripePriceId } from "@/lib/stripe-prices";
import { stripe } from "@/lib/stripe";
import { stripeWebhookSecret } from "@/lib/stripe-webhook-secret";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONTENT_TYPE = "application/pdf";
const VALIDATION_EMAIL = "reqovr-validation@example.com";

function isSandboxKey(key: string) {
  return key.startsWith("sk_test_") || key.startsWith("rk_test_");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function expectJson<T>(response: Response, expectedStatus = 200) {
  const body = (await response.json()) as T & { error?: string };
  if (response.status !== expectedStatus) {
    throw new Error(body.error ?? `unexpected_status_${response.status}`);
  }
  return body;
}

async function createAudit(origin: string, label: string) {
  const response = await intakePost(
    new Request(`${origin}/api/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        company: `Reqovr Validation ${label}`,
        email: VALIDATION_EMAIL,
        monthly3plSpend: 25000,
        invoiceCount: 3,
      }),
    }),
  );

  const body = await expectJson<{ requestId: string }>(response);
  return body.requestId;
}

async function uploadDocument(input: {
  origin: string;
  requestId: string;
  kind: "contract" | "invoice";
  filename: string;
  marker: string;
}) {
  const bytes = new TextEncoder().encode(
    `%PDF-1.4\n% Reqovr validation ${input.marker}\n1 0 obj<<>>endobj\n%%EOF\n`,
  );

  const reservationResponse = await uploadUrlPost(
    new Request(`${input.origin}/api/intake/upload-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: input.requestId,
        filename: input.filename,
        contentType: CONTENT_TYPE,
        size: bytes.byteLength,
        kind: input.kind,
      }),
    }),
  );

  const reservation = await expectJson<{ path: string; token: string }>(
    reservationResponse,
  );

  const { error: uploadError } = await supabaseAdmin()
    .storage.from("audit-documents")
    .uploadToSignedUrl(reservation.path, reservation.token, bytes, {
      contentType: CONTENT_TYPE,
    });

  if (uploadError) {
    throw new Error(`signed_upload_failed:${uploadError.message}`);
  }

  const confirmationResponse = await confirmUploadPost(
    new Request(`${input.origin}/api/intake/confirm-upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: input.requestId,
        originalFilename: input.filename,
        contentType: CONTENT_TYPE,
        size: bytes.byteLength,
        kind: input.kind,
        storagePath: reservation.path,
      }),
    }),
  );

  await expectJson<{ ok: true }>(confirmationResponse);
  return reservation.path;
}

async function createCheckout(input: {
  origin: string;
  requestId: string;
  offer: "audit_90_day" | "continuous_monitor";
}) {
  const response = await checkoutPost(
    new Request(`${input.origin}/api/stripe/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: input.requestId, offer: input.offer }),
    }),
  );

  const body = await expectJson<{ url: string }>(response);
  if (!body.url.startsWith("https://checkout.stripe.com/")) {
    throw new Error("checkout_url_invalid");
  }

  const { data: audit, error } = await supabaseAdmin()
    .from("audit_requests")
    .select("stripe_checkout_session_id")
    .eq("id", input.requestId)
    .single();

  if (error || !audit?.stripe_checkout_session_id) {
    throw new Error("checkout_session_not_persisted");
  }

  const session = await stripe().checkout.sessions.retrieve(
    audit.stripe_checkout_session_id,
  );
  if (session.livemode) {
    throw new Error("live_checkout_forbidden");
  }

  return session;
}

async function sendSignedOneTimeWebhook(input: {
  origin: string;
  session: Stripe.Checkout.Session;
  customerId: string;
}) {
  const eventId = `evt_reqovr_validation_${Date.now()}`;
  const sessionObject = {
    ...input.session,
    customer: input.customerId,
    customer_details: {
      address: null,
      business_name: null,
      email: VALIDATION_EMAIL,
      individual_name: null,
      name: "Reqovr Validation",
      phone: null,
      tax_exempt: "none",
      tax_ids: [],
    },
    payment_status: "paid",
    status: "complete",
  };

  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    api_version: "2026-07-29.dahlia",
    created: Math.floor(Date.now() / 1000),
    data: { object: sessionObject },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: "checkout.session.completed",
  });

  const signature = stripe().webhooks.generateTestHeaderString({
    payload,
    secret: await stripeWebhookSecret(),
  });

  const response = await webhookPost(
    new Request(`${input.origin}/api/stripe/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      body: payload,
    }),
  );

  await expectJson<{ received: true }>(response);
  return eventId;
}

async function waitForSubscriptionEntitlement(subscriptionId: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data } = await supabaseAdmin()
      .from("billing_entitlements")
      .select("status, stripe_customer_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (data?.status === "active" || data?.status === "trialing") {
      return data;
    }

    await sleep(750);
  }

  throw new Error("subscription_webhook_not_observed");
}

async function waitForCanceledEntitlement(subscriptionId: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data } = await supabaseAdmin()
      .from("billing_entitlements")
      .select("status")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (data?.status === "canceled") return true;
    await sleep(750);
  }

  return false;
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ error: "production_validation_only" }, { status: 404 });
  }

  const providedToken = request.nextUrl.searchParams.get("token") ?? "";
  const { data: tokenAccepted, error: tokenError } = await supabaseAdmin().rpc(
    "consume_reqovr_validation_token",
    { provided_token: providedToken },
  );

  if (tokenError || tokenAccepted !== true) {
    return NextResponse.json({ error: "validation_not_authorized" }, { status: 404 });
  }

  const origin = request.nextUrl.origin;
  const supabase = supabaseAdmin();
  const auditIds: string[] = [];
  const storagePaths: string[] = [];
  const customerIds: string[] = [];
  let subscriptionId: string | null = null;
  let step = "runtime_configuration";

  try {
    const stripeEnv = stripeServerEnv();
    if (!isSandboxKey(stripeEnv.STRIPE_SECRET_KEY)) {
      throw new Error("sandbox_stripe_key_required");
    }

    const account = await stripe().accounts.retrieve();
    if (account.id !== "acct_1U6prVBOw52KUyWD") {
      throw new Error("unexpected_stripe_account");
    }

    step = "intake_and_signed_uploads";
    const oneTimeAudit = await createAudit(origin, "One-Time");
    const monitorAudit = await createAudit(origin, "Monitor");
    auditIds.push(oneTimeAudit, monitorAudit);

    for (const [requestId, marker] of [
      [oneTimeAudit, "one-time"],
      [monitorAudit, "monitor"],
    ] as const) {
      storagePaths.push(
        await uploadDocument({
          origin,
          requestId,
          kind: "contract",
          filename: `${marker}-terms.pdf`,
          marker: `${marker}-terms`,
        }),
      );
      storagePaths.push(
        await uploadDocument({
          origin,
          requestId,
          kind: "invoice",
          filename: `${marker}-invoice.pdf`,
          marker: `${marker}-invoice`,
        }),
      );
    }

    step = "checkout_sessions";
    const auditSession = await createCheckout({
      origin,
      requestId: oneTimeAudit,
      offer: "audit_90_day",
    });
    const monitorSession = await createCheckout({
      origin,
      requestId: monitorAudit,
      offer: "continuous_monitor",
    });

    if (auditSession.mode !== "payment" || monitorSession.mode !== "subscription") {
      throw new Error("checkout_modes_invalid");
    }

    step = "signed_one_time_webhook";
    const oneTimeCustomer = await stripe().customers.create({
      email: VALIDATION_EMAIL,
      name: "Reqovr Validation One-Time",
      metadata: { validation: "reqovr_e2e" },
    });
    customerIds.push(oneTimeCustomer.id);
    const syntheticEventId = await sendSignedOneTimeWebhook({
      origin,
      session: auditSession,
      customerId: oneTimeCustomer.id,
    });

    const { data: oneTimeEntitlement } = await supabase
      .from("billing_entitlements")
      .select("status")
      .eq("stripe_customer_id", oneTimeCustomer.id)
      .eq("offer", "audit_90_day")
      .maybeSingle();
    const { data: paidAudit } = await supabase
      .from("audit_requests")
      .select("status")
      .eq("id", oneTimeAudit)
      .single();

    if (oneTimeEntitlement?.status !== "active" || paidAudit?.status !== "paid") {
      throw new Error("one_time_webhook_state_invalid");
    }

    step = "real_subscription_and_network_webhook";
    const subscriptionCustomer = await stripe().customers.create({
      email: VALIDATION_EMAIL,
      name: "Reqovr Validation Subscription",
      metadata: { validation: "reqovr_e2e" },
    });
    customerIds.push(subscriptionCustomer.id);

    const paymentMethod = await stripe().paymentMethods.attach("pm_card_visa", {
      customer: subscriptionCustomer.id,
    });
    await stripe().customers.update(subscriptionCustomer.id, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    });

    const subscription = await stripe().subscriptions.create({
      customer: subscriptionCustomer.id,
      items: [{ price: stripePriceId("continuous_monitor") }],
      default_payment_method: paymentMethod.id,
      payment_behavior: "error_if_incomplete",
      metadata: {
        offer: "continuous_monitor",
        validation: "reqovr_e2e",
      },
    });
    subscriptionId = subscription.id;

    if (subscription.livemode || subscription.status !== "active") {
      throw new Error("test_subscription_not_active");
    }

    const invoiceId =
      typeof subscription.latest_invoice === "string"
        ? subscription.latest_invoice
        : subscription.latest_invoice?.id;
    if (!invoiceId) throw new Error("subscription_invoice_missing");

    const invoice = await stripe().invoices.retrieve(invoiceId);
    if (invoice.status !== "paid" || invoice.amount_paid !== 59900) {
      throw new Error("subscription_invoice_not_paid");
    }

    const networkEntitlement = await waitForSubscriptionEntitlement(subscription.id);

    const canceled = await stripe().subscriptions.cancel(subscription.id, {
      invoice_now: false,
      prorate: false,
    });
    if (canceled.status !== "canceled") {
      throw new Error("subscription_cancel_failed");
    }

    const cancelWebhookObserved = await waitForCanceledEntitlement(subscription.id);

    const { data: processedSyntheticEvent } = await supabase
      .from("stripe_events")
      .select("processed")
      .eq("event_id", syntheticEventId)
      .maybeSingle();

    if (processedSyntheticEvent?.processed !== true) {
      throw new Error("signed_webhook_event_not_processed");
    }

    return NextResponse.json({
      ok: true,
      stripeAccount: account.id,
      stripeMode: "test",
      signedUploads: true,
      oneTimeCheckout: auditSession.id,
      subscriptionCheckout: monitorSession.id,
      signedOneTimeWebhook: true,
      paidSubscription: subscription.id,
      paidSubscriptionInvoice: invoice.id,
      paidSubscriptionAmount: invoice.amount_paid,
      networkWebhookEntitlement: networkEntitlement.status,
      cancellationWebhookObserved: cancelWebhookObserved,
      syntheticEventId,
    });
  } catch (error) {
    console.error("reqovr_validation_failed", step);
    return NextResponse.json(
      {
        ok: false,
        step,
        error: error instanceof Error ? error.message : "validation_failed",
      },
      { status: 500 },
    );
  } finally {
    if (subscriptionId) {
      try {
        const current = await stripe().subscriptions.retrieve(subscriptionId);
        if (current.status !== "canceled") {
          await stripe().subscriptions.cancel(subscriptionId, {
            invoice_now: false,
            prorate: false,
          });
        }
      } catch {
        // Best-effort cleanup only.
      }
    }

    if (customerIds.length > 0) {
      await supabase
        .from("billing_entitlements")
        .delete()
        .in("stripe_customer_id", customerIds);
      await supabase
        .from("billing_customers")
        .delete()
        .in("stripe_customer_id", customerIds);

      for (const customerId of customerIds) {
        try {
          await stripe().customers.del(customerId);
        } catch {
          // Best-effort cleanup only.
        }
      }
    }

    if (storagePaths.length > 0) {
      await supabase.storage.from("audit-documents").remove(storagePaths);
    }

    if (auditIds.length > 0) {
      await supabase.from("audit_requests").delete().in("id", auditIds);
    }
  }
}
