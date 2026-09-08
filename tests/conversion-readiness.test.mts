import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyTouch,
  sanitizeUtm,
} from "../src/lib/funnel-attribution.ts";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("attribution classifies only the approved acquisition channels", () => {
  assert.equal(
    classifyTouch({ pathname: "/", siteHost: "billguarded.com" }).channel,
    "direct",
  );
  assert.equal(
    classifyTouch({
      pathname: "/",
      siteHost: "billguarded.com",
      referrerHost: "www.google.com",
    }).channel,
    "organic",
  );
  assert.equal(
    classifyTouch({
      pathname: "/",
      siteHost: "billguarded.com",
      referrerHost: "example.com",
    }).channel,
    "referral",
  );
  assert.equal(
    classifyTouch({
      pathname: "/",
      siteHost: "billguarded.com",
      utmSource: "relationship",
      utmCampaign: "billguarded-relationship-september",
    }).channel,
    "relationship_outreach",
  );
  assert.equal(
    classifyTouch({
      pathname: "/",
      siteHost: "billguarded.com",
      utmSource: "approved_campaign",
      utmCampaign: "bg-audit-launch",
    }).channel,
    "approved_campaign",
  );
});

test("unsafe or identifying UTM values are discarded", () => {
  assert.equal(sanitizeUtm("person@example.com"), undefined);
  assert.equal(sanitizeUtm("invoice 123"), undefined);
  const touch = classifyTouch({
    pathname: "/",
    siteHost: "billguarded.com",
    utmSource: "CustomerName",
    utmCampaign: "private-account-name",
  });
  assert.equal(touch.channel, "unknown");
  assert.equal(touch.utmSource, undefined);
  assert.equal(touch.utmCampaign, undefined);
});

test("server validation independently rejects crafted identifying attribution", async () => {
  const server = await source("src/lib/funnel-analytics.ts");
  assert.match(server, /z\.enum\(SAFE_UTM_SOURCES\)/);
  assert.match(server, /z\.enum\(SAFE_UTM_MEDIA\)/);
  assert.match(server, /billguarded-\|bg-/);
});

test("client analytics never reads or transmits URL fragments", async () => {
  const client = await source("src/lib/funnel-client.ts");
  assert.doesNotMatch(
    client,
    /location\.hash|session_id|stripe_customer|email|filename/i,
  );
  assert.match(client, /utm_source/);
  assert.match(client, /credentials: "same-origin"/);
  assert.match(client, /keepalive: true/);
  assert.match(client, /UUID_PATTERN\.test\(existing\)/);
  assert.match(client, /CHANNELS\.has\(parsed\.channel\)/);
});

test("analytics endpoint is same-origin, rate-limited, strict, and no-store", async () => {
  const route = await source("src/app/api/analytics/events/route.ts");
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /analytics_origin_rejected/);
  assert.match(route, /p_limit: 120/);
  assert.match(route, /Cache-Control": "private, no-store/);
  const server = await source("src/lib/funnel-analytics.ts");
  assert.match(server, /\.strict\(\)/);
  assert.match(server, /digest\(\["anonymous"/);
});

test("analytics storage is server-only and excludes sensitive columns", async () => {
  const migration = await source(
    "supabase/migrations/20260908111947_privacy_safe_funnel_analytics.sql",
  );
  const schemaColumns = migration
    .split("\n")
    .filter((line) => /^\s{2}[a-z_]+\s+(text|uuid|timestamptz|bigint)/.test(line))
    .join("\n");
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on table .* anon, authenticated/);
  assert.match(migration, /grant select, insert .* service_role/);
  assert.doesNotMatch(
    schemaColumns,
    /invoice_content|rate_card_content|filename|email_address|checkout_session_id|stripe_customer_id|recovery_token|url_fragment/i,
  );
});

test("trusted lifecycle stages own paid, completion, notification, and recovery events", async () => {
  const stripe = await source("src/app/api/stripe/webhook/route.ts");
  const engine = await source("src/lib/audit-engine.ts");
  const delivery = await source("src/lib/audit-delivery.ts");
  const recovery = await source("src/app/api/recover/route.ts");
  assert.match(stripe, /paid_audit_confirmed/);
  assert.match(stripe, /paid_audit_queued/);
  assert.match(engine, /audit_completed/);
  assert.match(engine, /audit_failed/);
  assert.match(delivery, /customer_notified/);
  assert.match(delivery, /delivery_failed/);
  assert.match(recovery, /report_recovery_opened/);
});

test("legal pages use self canonicals instead of the homepage", async () => {
  for (const path of ["privacy", "terms", "security"] as const) {
    const page = await source(`src/app/${path}/page.tsx`);
    assert.match(page, new RegExp(`canonical: "\\/${path}"`));
  }
});

test("private customer routes are explicitly noindex and self-canonical", async () => {
  for (const path of ["start", "success", "recover"] as const) {
    const page = await source(`src/app/${path}/page.tsx`);
    assert.match(page, /robots: \{ index: false, follow: false \}/);
    assert.match(page, new RegExp(`canonical: "\\/${path}"`));
  }
});

test("robots and sitemap keep private routes out of public discovery", async () => {
  const robots = await source("src/app/robots.ts");
  const sitemap = await source("src/app/sitemap.ts");
  assert.match(robots, /"\/success", "\/start", "\/recover"/);
  assert.doesNotMatch(sitemap, /\$\{baseUrl\}\/start/);
  assert.doesNotMatch(sitemap, /\$\{baseUrl\}\/success/);
  assert.doesNotMatch(sitemap, /\$\{baseUrl\}\/recover/);
  for (const path of [
    "3pl-invoice-audit",
    "demo",
    "privacy",
    "terms",
    "security",
  ]) {
    assert.match(sitemap, new RegExp(`\\$\\{baseUrl\\}\\/${path}`));
  }
});

test("structured data remains factual and fixed-price", async () => {
  const page = await source("src/app/3pl-invoice-audit/page.tsx");
  assert.match(page, /"@type": "Service"/);
  assert.match(page, /price: "1500\.00"/);
  assert.match(page, /priceCurrency: "USD"/);
  assert.match(page, /duplicate charges/);
  assert.match(page, /unsupported service or fee codes/);
  assert.match(page, /line arithmetic mismatches/);
  assert.match(page, /billed unit-rate mismatches/);
});

test("intake errors are announced and material controls have explicit labels", async () => {
  const form = await source("src/app/start/intake-form.tsx");
  assert.match(form, /role=\{error \? "alert" : "status"\}/);
  assert.match(form, /statusRef\.current\?\.focus/);
  for (const id of [
    "company",
    "email",
    "monthly3plSpend",
    "invoiceCount",
    "contract",
    "invoices",
    "termsAccepted",
  ]) {
    assert.match(form, new RegExp(`htmlFor="${id}"`));
    assert.match(form, new RegExp(`id="${id}"`));
  }
});

test("touch targets, focus visibility, and reduced motion remain enforced", async () => {
  const globals = await source("src/app/globals.css");
  const hardening = await source("src/app/hardening.css");
  assert.match(globals, /\.nav-pill[\s\S]*min-height: 44px/);
  assert.match(hardening, /focus-visible/);
  assert.match(hardening, /prefers-reduced-motion: reduce/);
  assert.match(hardening, /\.footer-links a[\s\S]*min-height: 44px/);
});
