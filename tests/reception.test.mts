import assert from "node:assert/strict";
import test from "node:test";
import { fallbackReceptionAnswer, receptionistPolicy } from "../src/lib/reception/guide.ts";

test("covers product, pricing, onboarding, demo, privacy, and billing routes", () => {
  assert.match(fallbackReceptionAnswer("What does BillGuarded do?"), /rate card/);
  assert.match(fallbackReceptionAnswer("What does it cost?"), /\$299/);
  assert.match(fallbackReceptionAnswer("How do I upload and start?"), /\/start/);
  assert.match(fallbackReceptionAnswer("Show me a demo"), /\/demo/);
  assert.match(fallbackReceptionAnswer("How is my data handled?"), /\/privacy/);
  assert.match(fallbackReceptionAnswer("Can chat refund my payment?"), /cannot take payment/);
});

test("keeps consequential work and sensitive data outside chat", () => {
  const policy = receptionistPolicy();
  assert.match(policy, /Never collect payment-card data/);
  assert.match(policy, /Never reveal secrets/);
  assert.match(policy, /other customers' data/);
  assert.match(policy, /claim that an upload, audit, payment/);
  assert.match(fallbackReceptionAnswer("Guarantee you will recover this fee"), /does not establish/);
});
