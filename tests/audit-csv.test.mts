import test from "node:test";
import assert from "node:assert/strict";
import {
  firstValue,
  normalizeCode,
  parseCsv,
  parseMoneyToCents,
  parseNumber,
} from "../src/lib/audit-csv.ts";

test("parseCsv handles quoted commas, escaped quotes, CRLF, and multiline cells", () => {
  const rows = parseCsv(
    '\uFEFFreference,service_code,description,amount\r\n' +
      'A-1,pick_pack,"Pick, pack",12.50\r\n' +
      'A-2,storage,"Line one\nLine ""two""",(18.00)\r\n',
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].reference, "A-1");
  assert.equal(rows[0].description, "Pick, pack");
  assert.equal(rows[1].description, 'Line one\nLine "two"');
  assert.equal(parseMoneyToCents(rows[1].amount), -1800);
});

test("parseCsv rejects ambiguous duplicate normalized headers", () => {
  assert.throws(
    () => parseCsv("Service Code,service-code\npick_pack,pick_pack\n"),
    /csv_headers_invalid/,
  );
});

test("normalization and numeric helpers accept common billing formats", () => {
  const row = { charge_code: " Pick & Pack ", qty: "1,250" };
  assert.equal(firstValue(row, ["service_code", "charge_code"]), " Pick & Pack ");
  assert.equal(normalizeCode(" Pick & Pack "), "pick_pack");
  assert.equal(parseNumber(row.qty), 1250);
  assert.equal(parseMoneyToCents("$1,234.56"), 123456);
  assert.equal(parseMoneyToCents("(42.10)"), -4210);
});
