import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import {
  createPortalCookie,
  portalCookieName,
} from "@/lib/security/portal-cookie";

function customerIdFromSession(
  customer: string | { id: string } | null,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return NextResponse.redirect(new URL("/start?error=checkout", request.url));
  }

  const session = await stripe().checkout.sessions.retrieve(sessionId);
  const paid =
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required";

  if (session.status !== "complete" || !paid) {
    return NextResponse.redirect(
      new URL("/start?error=payment_not_complete", request.url),
    );
  }

  const customerId = customerIdFromSession(session.customer);
  if (!customerId) {
    return NextResponse.redirect(
      new URL("/start?error=customer_missing", request.url),
    );
  }

  const cookie = createPortalCookie(customerId);
  const target = new URL("/success", request.url);
  const requestId = session.metadata?.request_id;
  const offer = session.metadata?.offer;

  if (requestId) target.searchParams.set("request", requestId);
  if (offer) target.searchParams.set("offer", offer);

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
