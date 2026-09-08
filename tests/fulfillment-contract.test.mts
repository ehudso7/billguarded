import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AUDIT_COMPLETION_SUBJECT,
  BILLGUARDED_SUPPORT_SENDER,
  auditRecoveryUrl,
  buildAuditCompletionEmail,
} from "../src/lib/audit-delivery-email.ts";
import {
  deliveryIdempotencyKey,
  providerErrorDetails,
  resendFailureIsRetryable,
} from "../src/lib/delivery-policy.ts";
import { workerAuthorizationValid } from "../src/lib/security/worker-auth.ts";

const LIVE_SESSION = "cs_live_" + "A".repeat(32);
const OTHER_LIVE_SESSION = "cs_live_" + "B".repeat(32);
const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);

test("completion recovery credentials remain in a browser fragment", () => {
  const url = auditRecoveryUrl(LIVE_SESSION);
  assert.equal(
    url,
    `https://billguarded.com/recover#session_id=${LIVE_SESSION}`,
  );
  assert.equal(new URL(url).search, "");
  assert.equal(new URL(url).pathname, "/recover");
});

test("test Checkout sessions cannot become live customer delivery links", () => {
  assert.throws(
    () => auditRecoveryUrl("cs_test_" + "A".repeat(32)),
    /live_recovery_session_required/,
  );
});

test("completion email uses only the approved transactional sender and support reply path", () => {
  const email = buildAuditCompletionEmail({
    recipientEmail: "buyer@example.com",
    checkoutSessionId: LIVE_SESSION,
  });

  assert.equal(email.from, BILLGUARDED_SUPPORT_SENDER);
  assert.equal(email.replyTo, "support@billguarded.com");
  assert.equal(email.subject, AUDIT_COMPLETION_SUBJECT);
  assert.deepEqual(email.to, ["buyer@example.com"]);
});

test("completion email contains no findings, documents, amounts, or database identifiers", () => {
  const email = buildAuditCompletionEmail({
    recipientEmail: "buyer@example.com",
    checkoutSessionId: LIVE_SESSION,
  });
  const content = `${email.subject}\n${email.text}\n${email.html}`.toLowerCase();

  for (const prohibited of [
    "invoice contents",
    "rate-card contents",
    "finding count",
    "potential recovery",
    "audit_request_id",
    "database",
    "api key",
    "stripe secret",
  ]) {
    assert.equal(content.includes(prohibited), false, prohibited);
  }
  assert.equal(content.includes("$"), false);
});

test("completion email warns against forwarding and makes no recovery guarantee", () => {
  const email = buildAuditCompletionEmail({
    recipientEmail: "buyer@example.com",
    checkoutSessionId: LIVE_SESSION,
  });

  assert.match(email.text, /Do not forward this private link/);
  assert.match(email.text, /does not guarantee a refund, credit, reimbursement, or recovery/);
});

test("separate paid audits produce separate recovery links for one recipient", () => {
  const first = buildAuditCompletionEmail({
    recipientEmail: "buyer@example.com",
    checkoutSessionId: LIVE_SESSION,
  });
  const second = buildAuditCompletionEmail({
    recipientEmail: "buyer@example.com",
    checkoutSessionId: OTHER_LIVE_SESSION,
  });

  assert.notEqual(first.text, second.text);
  assert.deepEqual(first.to, second.to);
});

test("delivery idempotency is stable for one exact delivery fingerprint", () => {
  assert.equal(
    deliveryIdempotencyKey(FINGERPRINT_A),
    deliveryIdempotencyKey(FINGERPRINT_A),
  );
});

test("separate legitimate audit fingerprints get separate provider idempotency keys", () => {
  assert.notEqual(
    deliveryIdempotencyKey(FINGERPRINT_A),
    deliveryIdempotencyKey(FINGERPRINT_B),
  );
});

test("malformed delivery fingerprints fail closed before provider contact", () => {
  assert.throws(
    () => deliveryIdempotencyKey("recipient@example.com"),
    /delivery_fingerprint_invalid/,
  );
});

test("transient Resend failures are retryable only after a definite provider response", () => {
  for (const statusCode of [408, 409, 429, 500, 503]) {
    assert.equal(resendFailureIsRetryable({ statusCode }), true);
  }
});

test("permanent Resend request failures are terminal", () => {
  for (const statusCode of [400, 401, 403, 404, 422]) {
    assert.equal(resendFailureIsRetryable({ statusCode }), false);
  }
});

test("provider error persistence is bounded and excludes arbitrary objects", () => {
  const details = providerErrorDetails({
    name: "x".repeat(200),
    message: "y".repeat(800),
    secret: "must-not-persist",
  });
  assert.equal(details.code.length, 120);
  assert.equal(details.message.length, 500);
  assert.equal("secret" in details, false);
});

test("worker authorization accepts only the exact bearer secret", () => {
  const secret = "s".repeat(48);
  assert.equal(workerAuthorizationValid(`Bearer ${secret}`, secret), true);
  assert.equal(workerAuthorizationValid(`bearer ${secret}`, secret), false);
  assert.equal(workerAuthorizationValid(secret, secret), false);
  assert.equal(workerAuthorizationValid(null, secret), false);
});

test("browser Checkout completion cannot invoke paid-audit processing", () => {
  const source = readFileSync(
    new URL("../src/app/checkout/complete/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /processAuditRequest|sweepOneAuditWork|\bafter\s*\(/);
});

test("signed Stripe handling durably records paid work before event completion", () => {
  const source = readFileSync(
    new URL("../src/app/api/stripe/webhook/route.ts", import.meta.url),
    "utf8",
  );
  const paidWork = source.indexOf("billguarded_record_paid_audit");
  const eventFinish = source.indexOf("await finishEvent(event.id)");

  assert.ok(paidWork >= 0);
  assert.ok(eventFinish > paidWork);
  assert.doesNotMatch(source, /processAuditRequestWithRetry|\bafter\s*\(/);
});

test("the protected worker is scheduled independently of Stripe and browser requests", () => {
  const config = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(config.crons, [
    {
      path: "/api/internal/fulfillment-sweep",
      schedule: "* * * * *",
    },
  ]);
});

test("database claims use row locking and skip concurrent owners", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260908033005_durable_paid_audit_fulfillment.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /for update of wi skip locked/);
  assert.match(migration, /for update of d skip locked/);
  assert.match(migration, /unique \(audit_request_id, delivery_type\)/);
  assert.match(migration, /payment_event_id text not null/);
});

test("stale processing cleanup removes partial findings before retry", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260908033005_durable_paid_audit_fulfillment.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const cleanup = migration.indexOf("delete from public.audit_findings f");
  const retry = migration.indexOf("last_error_code = 'stale_worker_claim'");
  assert.ok(cleanup >= 0);
  assert.ok(retry > cleanup);
});

test("stale post-send delivery is quarantined and cannot auto-retry", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260908033005_durable_paid_audit_fulfillment.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    migration,
    /when d\.status = 'sending' then 'acceptance_uncertain'/,
  );
  assert.doesNotMatch(
    migration,
    /when d\.status = 'sending' then 'retryable'/,
  );
});

test("Resend lifecycle persistence is service-role-only and idempotent", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260908033005_durable_paid_audit_fulfillment.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /event_id text primary key/);
  assert.match(
    migration,
    /revoke all on table public\.resend_delivery_events from public, anon, authenticated/,
  );
  assert.match(migration, /on conflict \(event_id\) do nothing/);
});
