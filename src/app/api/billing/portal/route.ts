import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe";
import {
  portalCookieName,
  verifyPortalCookie,
} from "@/lib/security/portal-cookie";

export async function POST() {
  const cookieStore = await cookies();
  const payload = verifyPortalCookie(
    cookieStore.get(portalCookieName)?.value,
  );

  if (!payload) {
    return NextResponse.json(
      { error: "Billing access expired. Complete checkout again or contact support." },
      { status: 401 },
    );
  }

  const session = await stripe().billingPortal.sessions.create({
    customer: payload.customerId,
    return_url: `${serverEnv().APP_URL}/success`,
  });

  return NextResponse.redirect(session.url, 303);
}
