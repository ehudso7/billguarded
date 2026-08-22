import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const LIVE_ACCOUNT_ID = "acct_1U6prLB5mhEA8v5j";
const AUDIT_PRICE_ID = "price_1U76TJB5mhEA8v5jnP70HVCd";
const MONITOR_PRICE_ID = "price_1U76TRB5mhEA8v5jApmvnbDj";

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: authorized, error: authorizationError } = await supabaseAdmin().rpc(
    "consume_live_readiness_token",
    { p_token: token },
  );

  if (authorizationError || authorized !== true) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const client = stripe();
    const [account, auditPrice, monitorPrice] = await Promise.all([
      client.accounts.retrieve(LIVE_ACCOUNT_ID),
      client.prices.retrieve(AUDIT_PRICE_ID),
      client.prices.retrieve(MONITOR_PRICE_ID),
    ]);

    const auditOk =
      auditPrice.livemode === true &&
      auditPrice.active === true &&
      auditPrice.currency === "usd" &&
      auditPrice.unit_amount === 150000;

    const monitorOk =
      monitorPrice.livemode === true &&
      monitorPrice.active === true &&
      monitorPrice.currency === "usd" &&
      monitorPrice.unit_amount === 59900 &&
      monitorPrice.recurring?.interval === "month";

    const accountOk =
      account.id === LIVE_ACCOUNT_ID &&
      account.charges_enabled === true &&
      account.payouts_enabled === true;

    return NextResponse.json({
      ok: accountOk && auditOk && monitorOk,
      account: {
        id_match: account.id === LIVE_ACCOUNT_ID,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
      },
      prices: {
        audit_live_active_1500: auditOk,
        monitor_live_active_599_monthly: monitorOk,
      },
      writes_performed: 0,
    });
  } catch {
    return NextResponse.json({ error: "readiness_check_failed" }, { status: 500 });
  }
}
