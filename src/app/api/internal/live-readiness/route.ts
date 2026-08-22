import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const EXPECTED_ACCOUNT = "acct_1U6prLB5mhEA8v5j";
const EXPECTED_AUDIT_PRICE = "price_1U76TJB5mhEA8v5jnP70HVCd";
const EXPECTED_MONITOR_PRICE = "price_1U76TRB5mhEA8v5jApmvnbDj";

function bearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

async function runReadinessProbe(token: string | null) {
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "token_missing_or_short" }, { status: 404 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const supabase = supabaseAdmin();
  const { data: consumed, error: consumeError } = await supabase.rpc(
    "consume_live_readiness_token",
    { p_token_hash: tokenHash },
  );

  if (consumeError) {
    console.error("live_readiness_token_consume_failed", consumeError.code);
    return NextResponse.json({ error: "token_consume_failed" }, { status: 500 });
  }

  if (consumed !== true) {
    return NextResponse.json({ error: "token_invalid_or_consumed" }, { status: 404 });
  }

  try {
    const client = stripe();
    const [account, auditPrice, monitorPrice] = await Promise.all([
      client.accounts.retrieve(EXPECTED_ACCOUNT),
      client.prices.retrieve(EXPECTED_AUDIT_PRICE),
      client.prices.retrieve(EXPECTED_MONITOR_PRICE),
    ]);

    const accountMatches = account.id === EXPECTED_ACCOUNT;
    const auditMatches =
      auditPrice.id === EXPECTED_AUDIT_PRICE &&
      auditPrice.livemode === true &&
      auditPrice.active === true &&
      auditPrice.currency === "usd" &&
      auditPrice.unit_amount === 150000 &&
      auditPrice.type === "one_time";
    const monitorMatches =
      monitorPrice.id === EXPECTED_MONITOR_PRICE &&
      monitorPrice.livemode === true &&
      monitorPrice.active === true &&
      monitorPrice.currency === "usd" &&
      monitorPrice.unit_amount === 59900 &&
      monitorPrice.type === "recurring" &&
      monitorPrice.recurring?.interval === "month" &&
      monitorPrice.recurring.interval_count === 1;

    return NextResponse.json({
      ok: accountMatches && auditMatches && monitorMatches,
      account: {
        id: account.id,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
      },
      audit_price: {
        id: auditPrice.id,
        livemode: auditPrice.livemode,
        active: auditPrice.active,
        unit_amount: auditPrice.unit_amount,
        currency: auditPrice.currency,
        type: auditPrice.type,
      },
      monitor_price: {
        id: monitorPrice.id,
        livemode: monitorPrice.livemode,
        active: monitorPrice.active,
        unit_amount: monitorPrice.unit_amount,
        currency: monitorPrice.currency,
        type: monitorPrice.type,
        interval: monitorPrice.recurring?.interval ?? null,
        interval_count: monitorPrice.recurring?.interval_count ?? null,
      },
    });
  } catch (error) {
    console.error("live_readiness_stripe_read_failed", error);
    return NextResponse.json({ error: "stripe_read_failed" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  return runReadinessProbe(bearerToken(request));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return runReadinessProbe(url.searchParams.get("token"));
}
