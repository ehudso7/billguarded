import {
  firstValue,
  normalizeCode,
  parseCsv,
  parseMoneyToCents,
  parseNumber,
  type CsvRow,
} from "@/lib/audit-csv";
import { supabaseAdmin } from "@/lib/supabase-admin";

const SERVICE_ALIASES = [
  "service_code",
  "charge_code",
  "fee_code",
  "service",
  "charge_type",
  "fee_type",
  "description",
];
const RATE_ALIASES = [
  "rate",
  "unit_rate",
  "contract_rate",
  "agreed_rate",
  "price",
  "unit_price",
];
const QUANTITY_ALIASES = ["quantity", "qty", "units", "count", "volume"];
const AMOUNT_ALIASES = [
  "amount",
  "line_total",
  "total",
  "extended_amount",
  "charge_amount",
  "billed_amount",
];

const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export type PreflightDocument = {
  id: string;
  kind: "contract" | "rate_card" | "invoice";
  original_filename: string;
  storage_path: string;
  content_type: string;
  byte_size: number | string;
};

export type AuditPreflightResult =
  | { ok: true }
  | { ok: false; message: string };

function serviceCode(row: CsvRow) {
  return normalizeCode(firstValue(row, SERVICE_ALIASES));
}

function unitRate(row: CsvRow) {
  return parseMoneyToCents(firstValue(row, RATE_ALIASES));
}

function amount(row: CsvRow) {
  return parseMoneyToCents(firstValue(row, AMOUNT_ALIASES));
}

function quantity(row: CsvRow) {
  return parseNumber(firstValue(row, QUANTITY_ALIASES));
}

async function parsedRows(document: PreflightDocument) {
  const { data, error } = await supabaseAdmin().storage
    .from("audit-documents")
    .download(document.storage_path);
  if (error) throw error;
  return parseCsv(await data.text());
}

export async function preflightAuditDocuments(
  documents: PreflightDocument[],
): Promise<AuditPreflightResult> {
  const totalBytes = documents.reduce(
    (sum, document) => sum + Number(document.byte_size || 0),
    0,
  );
  if (totalBytes > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      message:
        "The combined uploaded file set is larger than the 50 MB production limit. No charge was created.",
    };
  }

  const termsDocument = documents.find(
    (document) => document.kind === "contract" || document.kind === "rate_card",
  );
  const invoiceDocuments = documents.filter(
    (document) => document.kind === "invoice",
  );

  if (!termsDocument || invoiceDocuments.length === 0) {
    return {
      ok: false,
      message:
        "BillGuarded requires one CSV contract/rate card and at least one CSV invoice before payment. No charge was created.",
    };
  }

  try {
    const termsRows = await parsedRows(termsDocument);
    const hasRecognizedRate = termsRows.some((row) => {
      const code = serviceCode(row);
      const rate = unitRate(row);
      return Boolean(code) && rate !== null && rate >= 0;
    });

    if (!hasRecognizedRate) {
      return {
        ok: false,
        message:
          "The rate-card CSV does not contain a recognizable service/fee code plus unit-rate pair. No charge was created. Use columns such as service_code and unit_rate, or contact support@billguarded.com.",
      };
    }

    for (const invoice of invoiceDocuments) {
      const rows = await parsedRows(invoice);
      const hasUsableBillingRow = rows.some((row) => {
        if (!serviceCode(row)) return false;
        return amount(row) !== null || unitRate(row) !== null || quantity(row) !== null;
      });

      if (!hasUsableBillingRow) {
        return {
          ok: false,
          message: `${invoice.original_filename} does not contain a recognizable billing row. No charge was created. Include a service/fee code and billing amounts or rates, or contact support@billguarded.com.`,
        };
      }
    }
  } catch (error) {
    console.error(
      "audit_preflight_parse_failed",
      error instanceof Error ? error.message.slice(0, 160) : "unknown_error",
    );
    return {
      ok: false,
      message:
        "One of the uploaded CSV files could not be parsed safely. No charge was created. Re-export the file as a standard UTF-8 CSV or contact support@billguarded.com.",
    };
  }

  return { ok: true };
}
