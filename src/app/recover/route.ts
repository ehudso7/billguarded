import { NextRequest, NextResponse } from "next/server";
import { applicationOrigin } from "@/lib/origin";
import {
  createPortalCookie,
  portalCookieName,
} from "@/lib/security/portal-cookie";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

function customerIdFromSession(
  customer: string | { id: string } | null,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function protectRecoveryResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function recoveryError(origin: string, code: string) {
  const target = new URL("/start", origin);
  target.searchParams.set("error", code);
  return protectRecoveryResponse(NextResponse.redirect(target, 303));
}

export async function GET(request: NextRequest) {
  const origin = applicationOrigin(request.url);
  const sessionId = request.nextUrl.searchParams.get("session_id");

  if (!sessionId || !/^cs_(?:live|test)_/.test(sessionId)) {
    return recoveryError(origin, "recovery_link_invalid");
  }

  let session;
  try {
    session = await stripe().checkout.sessions.retrieve(sessionId);
  } catch {
    return recoveryError(origin, "recovery_link_invalid");
  }

  const paid =
    session.status === "complete" &&
    (session.payment_status === "paid" ||
      session.payment_status === "no_payment_required");
  const requestId = session.metadata?.request_id;
  const offer = session.metadata?.offer;
  const customerId = customerIdFromSession(session.customer);

  if (!paid || !requestId || offer !== "audit_90_day" || !customerId) {
    return recoveryError(origin, "recovery_link_unavailable");
  }

  const { data: audit, error } = await supabaseAdmin()
    .from("audit_requests")
    .select("id,status,stripe_checkout_session_id,stripe_customer_id")
    .eq("id", requestId)
    .eq("stripe_checkout_session_id", session.id)
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error || !audit || audit.status === "cancelled") {
    return recoveryError(origin, "recovery_link_unavailable");
  }

  const cookie = createPortalCookie(customerId);
  const target = new URL("/success", origin);
  target.searchParams.set("request", audit.id);

  const response = NextResponse.redirect(target, 303);
  response.cookies.set(portalCookieName, cookie.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: cookie.maxAge,
  });

  return protectRecoveryResponse(response);
}
