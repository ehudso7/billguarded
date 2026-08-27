import test from "node:test";
import assert from "node:assert/strict";
import {
  isSupportedDeclaredCurrency,
  normalizeDeclaredCurrency,
} from "../src/lib/audit-currency.ts";

test("USD declarations normalize to USD", () => {
  for (const value of [
    "USD",
    "usd",
    "$",
    "US$",
    "US Dollar",
    "U.S. Dollar",
    "United States dollars",
  ]) {
    assert.equal(normalizeDeclaredCurrency(value), "USD");
    assert.equal(isSupportedDeclaredCurrency(value), true);
  }
});

test("blank currency declarations are treated as undeclared", () => {
  assert.equal(normalizeDeclaredCurrency(null), null);
  assert.equal(normalizeDeclaredCurrency("  "), null);
  assert.equal(isSupportedDeclaredCurrency(undefined), true);
});

test("declared non-USD currencies are rejected", () => {
  for (const value of ["CAD", "EUR", "GBP", "Canadian Dollar", "JPY"]) {
    assert.notEqual(normalizeDeclaredCurrency(value), "USD");
    assert.equal(isSupportedDeclaredCurrency(value), false);
  }
});
