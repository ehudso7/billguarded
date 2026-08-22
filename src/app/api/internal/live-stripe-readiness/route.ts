import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const LIVE_ACCOUNT_ID = "acct_1U6prLB5mhEA8v5j";
const AUDIT_PRICE_ID = "price_1U76TJB5mhEA8v5jnP70HVCd";
const MONITOR_PRICE_ID = "price_1U76TRB5mhEA8v5jApmvnbDj";

async function recordResult(input: {
  ok: boolean;
  accountIdMatch: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  auditPriceOk: boolean;
  monitorPriceOk: boolean;
  errorCode?: string | null;
}) {
  const { error } = await supabaseAdmin()
    .from("_internal_live_readiness_results")
    .insert({
      ok: input.ok,
      account_id_match: input.accountIdMatch,
      charges_enabled: input.chargesEnabled,
      payouts_enabled: input.payoutsEnabled,
      audit_price_ok: input.auditPriceOk,
      monitor_price_ok: input.monitorPriceOk,
      writes_performed: 0,
      error_code: input.errorCode ?? null,
    });

  if (error) {
    throw new Error(`readiness_result_record_failed:${error.code}`);
  }
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: authorized, error: authorizationError } = await supabaseAdmin().rpc(
    "consume_live_readiness_slot",
  );

  if (authorizationError || authorized !== true) {
    return NextResponse.json({ error: "already_used_or_expired" }, { status: 410 });
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

    const accountIdMatch = account.id === LIVE_ACCOUNT_ID;
    const chargesEnabled = account.charges_enabled === true;
    const payoutsEnabled = account.payouts_enabled === true;
    const accountOk = accountIdMatch && chargesEnabled && payoutsEnabled;
    const ok = accountOk && auditOk && monitorOk;

    await recordResult({
      ok,
      accountIdMatch,
      chargesEnabled,
      payoutsEnabled,
      auditPriceOk: auditOk,
      monitorPriceOk: monitorOk,
    });

    return NextResponse.json({
      ok,
      account: {
        id_match: accountIdMatch,
        charges_enabled: chargesEnabled,
        payouts_enabled: payoutsEnabled,
      },
      prices: {
        audit_live_active_1500: auditOk,
        monitor_live_active_599_monthly: monitorOk,
      },
      writes_performed: 0,
    });
  } catch {
    await recordResult({
      ok: false,
      accountIdMatch: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      auditPriceOk: false,
      monitorPriceOk: false,
      errorCode: "stripe_or_result_write_exception",
    }).catch(() => undefined);

    return NextResponse.json({ error: "readiness_check_failed" }, { status: 500 });
  }
}
