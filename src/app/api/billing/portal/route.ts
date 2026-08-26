import { cookies } from "next/headers";
import { NextResponse } from "next/server";
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
      {
        error:
          "Billing access expired. Contact support@billguarded.com if you need help with a completed audit.",
      },
      { status: 401 },
    );
  }

  return NextResponse.json(
    {
      error:
        "BillGuarded currently sells a one-time audit only, so there is no recurring subscription to manage. Contact support@billguarded.com for billing help.",
    },
    { status: 409 },
  );
}
