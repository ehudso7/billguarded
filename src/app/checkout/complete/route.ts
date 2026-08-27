import { after, NextRequest, NextResponse } from "next/server";
import { processAuditRequestWithRetry } from "@/lib/audit-processing";
import { applicationOrigin } from "@/lib/origin";
import { isOfferId } from "@/lib/offers";
import {
  createPortalCookie,
  portalCookieName,
} from "@/lib/security/portal-cookie";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 300;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function customerIdFromSession(
  customer: string | { id: string } | null,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function promotePaidSandboxCheckout(input: {
  requestId: string;
  customerId: string;
  sessionId: string;
  offer: string | undefined;
  email: string | null;
  name: string | null;
}) {
  if (!isOfferId(input.offer)) {
    throw new Error("sandbox_checkout_offer_missing");
  }

  const supabase = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: audit, error: auditError } = await supabase
    .from("audit_requests")
    .select("id,status,stripe_checkout_session_id")
    .eq("id", input.requestId)
    .maybeSingle();

  if (auditError) throw auditError;
  if (!audit) throw new Error("sandbox_checkout_request_missing");
  if (
    audit.stripe_checkout_session_id &&
    audit.stripe_checkout_session_id !== input.sessionId
  ) {
    throw new Error("sandbox_checkout_session_mismatch");
  }

  const { error: customerError } = await supabase
    .from("billing_customers")
    .upsert(
      {
        stripe_customer_id: input.customerId,
        email: input.email,
        name: input.name,
        updated_at: now,
      },
      { onConflict: "stripe_customer_id" },
    );
  if (customerError) throw customerError;

  const { error: entitlementError } = await supabase
    .from("billing_entitlements")
    .upsert(
      {
        stripe_customer_id: input.customerId,
        offer: input.offer,
        status: "active",
        stripe_checkout_session_id: input.sessionId,
        updated_at: now,
      },
      { onConflict: "stripe_customer_id,offer" },
    );
  if (entitlementError) throw entitlementError;

  if (audit.status === "checkout_started" || audit.status === "intake") {
    const { error: requestError } = await supabase
      .from("audit_requests")
      .update({
        status: "paid",
        stripe_customer_id: input.customerId,
        stripe_checkout_session_id: input.sessionId,
        selected_offer: input.offer,
        paid_at: now,
        updated_at: now,
      })
      .eq("id", input.requestId);
    if (requestError) throw requestError;
  }
}

async function startPaidAudit(requestId: string) {
  const supabase = supabaseAdmin();
  const delays = [0, 500, 1000, 2000, 4000];

  for (const delay of delays) {
    if (delay > 0) await sleep(delay);

    const { data, error } = await supabase
      .from("audit_requests")
      .select("status")
      .eq("id", requestId)
      .maybeSingle();

    if (error) {
      console.warn("billguarded_audit_status_poll_failed", requestId, error.code);
      continue;
    }

    if (data?.status === "paid" || data?.status === "processing") {
      await processAuditRequestWithRetry(requestId);
      return;
    }

    if (data?.status === "complete" || data?.status === "cancelled") return;
  }

  console.warn("billguarded_audit_waiting_for_webhook", requestId);
}

export async function GET(request: NextRequest) {
  const origin = applicationOrigin(request.url);
  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return NextResponse.redirect(new URL("/start?error=checkout", origin));
  }

  let session;
  try {
    session = await stripe().checkout.sessions.retrieve(sessionId);
  } catch {
    return NextResponse.redirect(
      new URL("/start?error=checkout_lookup", origin),
    );
  }

  if (session.status !== "complete") {
    return NextResponse.redirect(
      new URL("/start?error=checkout_not_complete", origin),
    );
  }

  const requestId = session.metadata?.request_id;
  const offer = session.metadata?.offer;
  if (!requestId || !UUID_PATTERN.test(requestId) || !isOfferId(offer)) {
    return NextResponse.redirect(
      new URL("/start?error=checkout_metadata", origin),
    );
  }

  const customerId = customerIdFromSession(session.customer);
  if (!customerId) {
    return NextResponse.redirect(
      new URL("/start?error=customer_missing", origin),
    );
  }

  const paid =
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required";
  const cookie = createPortalCookie(customerId);
  const target = new URL("/success", origin);

  target.searchParams.set("request", requestId);
  target.searchParams.set("offer", offer);
  if (!paid) target.searchParams.set("pending", "1");

  if (paid) {
    if (!session.livemode) {
      await promotePaidSandboxCheckout({
        requestId,
        customerId,
        sessionId: session.id,
        offer,
        email: session.customer_details?.email ?? session.customer_email ?? null,
        name: session.customer_details?.name ?? null,
      });
    }

    after(() => startPaidAudit(requestId));
  }

  const response = NextResponse.redirect(target);
  response.cookies.set(portalCookieName, cookie.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: cookie.maxAge,
  });

  return response;
}
