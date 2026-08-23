import { after, NextRequest, NextResponse } from "next/server";
import { processAuditRequest } from "@/lib/audit-engine";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  createPortalCookie,
  portalCookieName,
} from "@/lib/security/portal-cookie";

export const maxDuration = 300;

function customerIdFromSession(
  customer: string | { id: string } | null,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function startPaidAudit(requestId: string) {
  const supabase = supabaseAdmin();
  const delays = [0, 500, 1000, 2000, 4000];

  for (const delay of delays) {
    if (delay > 0) await sleep(delay);

    const { data } = await supabase
      .from("audit_requests")
      .select("status")
      .eq("id", requestId)
      .maybeSingle();

    if (data?.status === "paid" || data?.status === "processing") {
      await processAuditRequest(requestId);
      return;
    }

    if (data?.status === "complete" || data?.status === "cancelled") return;
  }

  console.warn("billguarded_audit_waiting_for_webhook", requestId);
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!sessionId || !sessionId.startsWith("cs_")) {
    return NextResponse.redirect(new URL("/start?error=checkout", request.url));
  }

  const session = await stripe().checkout.sessions.retrieve(sessionId);
  if (session.status !== "complete") {
    return NextResponse.redirect(
      new URL("/start?error=checkout_not_complete", request.url),
    );
  }

  const customerId = customerIdFromSession(session.customer);
  if (!customerId) {
    return NextResponse.redirect(
      new URL("/start?error=customer_missing", request.url),
    );
  }

  const paid =
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required";
  const cookie = createPortalCookie(customerId);
  const target = new URL("/success", request.url);
  const requestId = session.metadata?.request_id;
  const offer = session.metadata?.offer;

  if (requestId) target.searchParams.set("request", requestId);
  if (offer) target.searchParams.set("offer", offer);
  if (!paid) target.searchParams.set("pending", "1");

  if (paid && requestId) {
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
