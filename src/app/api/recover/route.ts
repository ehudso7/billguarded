import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createPortalCookie,
  portalCookieName,
} from "@/lib/security/portal-cookie";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

const recoverySchema = z.object({
  sessionId: z
    .string()
    .min(20)
    .max(512)
    .regex(/^cs_(?:live|test)_[A-Za-z0-9_]+$/),
});

function customerIdFromSession(
  customer: string | { id: string } | null,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function protectedJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function POST(request: Request) {
  const parsed = recoverySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return protectedJson({ error: "recovery_invalid" }, { status: 400 });
  }

  let session;
  try {
    session = await stripe().checkout.sessions.retrieve(parsed.data.sessionId);
  } catch {
    return protectedJson({ error: "recovery_unavailable" }, { status: 404 });
  }

  const paid =
    session.status === "complete" &&
    (session.payment_status === "paid" ||
      session.payment_status === "no_payment_required");
  const requestId = session.metadata?.request_id;
  const offer = session.metadata?.offer;
  const customerId = customerIdFromSession(session.customer);

  if (!paid || !requestId || offer !== "audit_90_day" || !customerId) {
    return protectedJson({ error: "recovery_unavailable" }, { status: 404 });
  }

  const { data: audit, error } = await supabaseAdmin()
    .from("audit_requests")
    .select("id,status,stripe_checkout_session_id,stripe_customer_id")
    .eq("id", requestId)
    .eq("stripe_checkout_session_id", session.id)
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error || !audit || audit.status === "cancelled") {
    return protectedJson({ error: "recovery_unavailable" }, { status: 404 });
  }

  const cookie = createPortalCookie(customerId);
  const target = `/success?request=${encodeURIComponent(audit.id)}`;
  const response = protectedJson({ target });
  response.cookies.set(portalCookieName, cookie.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: cookie.maxAge,
  });

  return response;
}
