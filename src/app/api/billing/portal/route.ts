import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { applicationOrigin } from "@/lib/origin";
import { stripe } from "@/lib/stripe";
import {
  portalCookieName,
  verifyPortalCookie,
} from "@/lib/security/portal-cookie";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const payload = verifyPortalCookie(
    cookieStore.get(portalCookieName)?.value,
  );

  if (!payload) {
    return NextResponse.json(
      { error: "Billing access expired. Complete checkout again or contact support@billguarded.com." },
      { status: 401 },
    );
  }

  const session = await stripe().billingPortal.sessions.create({
    customer: payload.customerId,
    return_url: `${applicationOrigin(request.url)}/success`,
  });

  return NextResponse.redirect(session.url, 303);
}
