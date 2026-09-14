import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRecoveryPacket } from "../src/lib/recovery-packet.ts";

test("builds a human-gated recovery draft with source citations", () => {
  const packet = buildRecoveryPacket({
    company: "Example Brand",
    generatedAt: "2026-09-13T05:00:00.000Z",
    potentialRecoveryCents: 2500,
    findings: [
      {
        findingType: "rate_mismatch",
        severity: "high",
        sourceFile: "invoice-july.csv",
        sourceRow: 12,
        serviceCode: "PICK-EACH",
        description: "Billed unit rate differs from the supplied rate card.",
        billedAmountCents: 12500,
        expectedAmountCents: 10000,
        potentialRecoveryCents: 2500,
      },
      {
        findingType: "unsupported_fee",
        severity: "medium",
        sourceFile: "invoice-july.csv",
        sourceRow: 18,
        serviceCode: "MISC",
        description: "No matching fee code was found in the supplied rate card.",
        billedAmountCents: 5000,
        expectedAmountCents: null,
        potentialRecoveryCents: 0,
      },
    ],
  });

  assert.match(packet, /HUMAN REVIEW REQUIRED/);
  assert.match(packet, /Conservative potential recovery: \$25\.00/);
  assert.match(packet, /invoice-july\.csv, row 12/);
  assert.match(packet, /Potential recovery is not a refund/);
  assert.match(packet, /It has not been submitted or sent/);
});

test("does not claim that an empty result proves billing is correct", () => {
  const packet = buildRecoveryPacket({
    company: "Example Brand",
    generatedAt: "2026-09-13T05:00:00.000Z",
    potentialRecoveryCents: 0,
    findings: [],
  });

  assert.match(packet, /does not prove the billing is error-free/);
  assert.doesNotMatch(packet, /billing is correct/i);
});

test("normalizes control characters and escapes markdown table separators", () => {
  const packet = buildRecoveryPacket({
    company: "Example\u0000 | Brand",
    generatedAt: "2026-09-13T05:00:00.000Z",
    potentialRecoveryCents: 50,
    findings: [
      {
        findingType: "rate_mismatch",
        severity: "high",
        sourceFile: "invoice|july.csv",
        sourceRow: 1,
        serviceCode: "PICK|EACH",
        description: "Mismatch\nacross rows | review",
        billedAmountCents: 100,
        expectedAmountCents: 50,
        potentialRecoveryCents: 50,
      },
    ],
  });

  assert.doesNotMatch(packet, /\u0000/);
  assert.match(packet, /Example \\| Brand/);
  assert.match(packet, /invoice\\\|july\.csv/);
  assert.match(packet, /PICK\\\|EACH/);
});

test("rejects an invalid generation timestamp", () => {
  assert.throws(
    () =>
      buildRecoveryPacket({
        company: "Example Brand",
        generatedAt: "not-a-date",
        potentialRecoveryCents: 0,
        findings: [],
      }),
    /valid timestamp/,
  );
});

test("uses the audit engine's de-duplicated recovery total", () => {
  const packet = buildRecoveryPacket({
    company: "Example Brand",
    generatedAt: "2026-09-13T05:00:00.000Z",
    potentialRecoveryCents: 2500,
    findings: [
      {
        findingType: "rate_mismatch",
        severity: "high",
        sourceFile: "invoice.csv",
        sourceRow: 12,
        serviceCode: "PICK",
        description: "Rate mismatch.",
        billedAmountCents: 12500,
        expectedAmountCents: 10000,
        potentialRecoveryCents: 2500,
      },
      {
        findingType: "arithmetic_mismatch",
        severity: "high",
        sourceFile: "invoice.csv",
        sourceRow: 12,
        serviceCode: "PICK",
        description: "Arithmetic mismatch on the same charge.",
        billedAmountCents: 12500,
        expectedAmountCents: 10000,
        potentialRecoveryCents: 2500,
      },
    ],
  });

  assert.match(packet, /Conservative potential recovery: \$25\.00/);
  assert.doesNotMatch(packet, /Conservative potential recovery: \$50\.00/);
});

test("the recovery packet route preserves the paid customer access boundary", () => {
  const source = readFileSync(
    new URL("../src/app/api/recovery-packet/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /verifyPortalCookie/);
  assert.match(source, /\.eq\("stripe_customer_id", billingAccess\.customerId\)/);
  assert.match(source, /\.eq\("status", "complete"\)/);
  assert.match(source, /"Cache-Control": "private, no-store"/);
  assert.match(source, /"X-Content-Type-Options": "nosniff"/);
  assert.doesNotMatch(source, /service_role_key|STRIPE_SECRET_KEY/);
});
