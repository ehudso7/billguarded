import {
  firstValue,
  normalizeCode,
  parseCsv,
  parseMoneyToCents,
  parseNumber,
  type CsvRow,
} from "@/lib/audit-csv";
import { conservativePotentialRecoveryCents } from "@/lib/audit-math";
import { shouldRecoverProcessingRun } from "@/lib/audit-recovery";
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
const REFERENCE_ALIASES = [
  "line_id",
  "reference",
  "order_id",
  "shipment_id",
  "transaction_id",
  "invoice_line_id",
  "tracking_number",
];

export type AuditFindingInsert = {
  audit_run_id: string;
  audit_request_id: string;
  finding_type:
    | "duplicate_charge"
    | "unsupported_fee"
    | "arithmetic_mismatch"
    | "rate_mismatch";
  severity: "low" | "medium" | "high";
  source_document_id: string;
  source_row: number;
  service_code: string | null;
  description: string;
  billed_amount_cents: number | null;
  expected_amount_cents: number | null;
  potential_recovery_cents: number;
  evidence: Record<string, unknown>;
};

type DocumentRow = {
  id: string;
  kind: "contract" | "rate_card" | "invoice";
  original_filename: string;
  storage_path: string;
  content_type: string;
  upload_status: string;
};

type Rate = {
  serviceCode: string;
  rateCents: number;
  sourceDocumentId: string;
  sourceRow: number;
};

type DuplicateOrigin = {
  documentId: string;
  filename: string;
  row: number;
};

function isCsvDocument(document: DocumentRow) {
  return (
    document.content_type === "text/csv" ||
    document.original_filename.toLowerCase().endsWith(".csv")
  );
}

async function documentText(document: DocumentRow) {
  const { data, error } = await supabaseAdmin().storage
    .from("audit-documents")
    .download(document.storage_path);
  if (error) throw error;
  return data.text();
}

function serviceCode(row: CsvRow) {
  return normalizeCode(firstValue(row, SERVICE_ALIASES));
}

function billedAmount(row: CsvRow) {
  return parseMoneyToCents(firstValue(row, AMOUNT_ALIASES));
}

function unitRate(row: CsvRow) {
  return parseMoneyToCents(firstValue(row, RATE_ALIASES));
}

function quantity(row: CsvRow) {
  return parseNumber(firstValue(row, QUANTITY_ALIASES));
}

function reference(row: CsvRow) {
  const value = firstValue(row, REFERENCE_ALIASES);
  return value?.trim() || null;
}

function potentialRecovery(billed: number | null, expected: number | null) {
  if (billed === null || expected === null) return 0;
  return Math.max(0, billed - expected);
}

function buildRateMap(rows: CsvRow[], document: DocumentRow) {
  const rates = new Map<string, Rate>();
  rows.forEach((row, index) => {
    const code = serviceCode(row);
    const rateCents = unitRate(row);
    if (!code || rateCents === null || rateCents < 0) return;
    if (!rates.has(code)) {
      rates.set(code, {
        serviceCode: code,
        rateCents,
        sourceDocumentId: document.id,
        sourceRow: index + 2,
      });
    }
  });
  return rates;
}

function analyzeInvoiceRows(input: {
  rows: CsvRow[];
  document: DocumentRow;
  rateMap: Map<string, Rate>;
  runId: string;
  requestId: string;
  seenDuplicates: Map<string, DuplicateOrigin>;
}) {
  const findings: AuditFindingInsert[] = [];

  input.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const code = serviceCode(row);
    const qty = quantity(row);
    const invoiceUnitRate = unitRate(row);
    const amount = billedAmount(row);
    const ref = reference(row);
    const contractRate = code ? input.rateMap.get(code) ?? null : null;

    if (ref) {
      const duplicateKey = [
        ref,
        code ?? "",
        qty ?? "",
        invoiceUnitRate ?? "",
        amount ?? "",
      ].join("|");
      const first = input.seenDuplicates.get(duplicateKey);
      if (first) {
        findings.push({
          audit_run_id: input.runId,
          audit_request_id: input.requestId,
          finding_type: "duplicate_charge",
          severity: amount && amount >= 50000 ? "high" : "medium",
          source_document_id: input.document.id,
          source_row: rowNumber,
          service_code: code,
          description: `Possible duplicate charge matching ${first.filename} row ${first.row}.`,
          billed_amount_cents: amount,
          expected_amount_cents: 0,
          potential_recovery_cents: Math.max(0, amount ?? 0),
          evidence: {
            reference: ref,
            matching_document_id: first.documentId,
            matching_filename: first.filename,
            matching_row: first.row,
          },
        });
      } else {
        input.seenDuplicates.set(duplicateKey, {
          documentId: input.document.id,
          filename: input.document.original_filename,
          row: rowNumber,
        });
      }
    }

    if (code && !contractRate) {
      findings.push({
        audit_run_id: input.runId,
        audit_request_id: input.requestId,
        finding_type: "unsupported_fee",
        severity: "medium",
        source_document_id: input.document.id,
        source_row: rowNumber,
        service_code: code,
        description: "Invoice service code was not found in the supplied rate card.",
        billed_amount_cents: amount,
        expected_amount_cents: null,
        potential_recovery_cents: 0,
        evidence: { service_code: code, reference: ref },
      });
    }

    if (qty !== null && invoiceUnitRate !== null && amount !== null) {
      const calculated = Math.round(qty * invoiceUnitRate);
      if (Math.abs(calculated - amount) > 1) {
        findings.push({
          audit_run_id: input.runId,
          audit_request_id: input.requestId,
          finding_type: "arithmetic_mismatch",
          severity:
            Math.abs(amount - calculated) >= 50000 ? "high" : "medium",
          source_document_id: input.document.id,
          source_row: rowNumber,
          service_code: code,
          description:
            "Billed line total does not equal quantity × billed unit rate.",
          billed_amount_cents: amount,
          expected_amount_cents: calculated,
          potential_recovery_cents: potentialRecovery(amount, calculated),
          evidence: { quantity: qty, billed_unit_rate_cents: invoiceUnitRate },
        });
      }
    }

    if (
      contractRate &&
      invoiceUnitRate !== null &&
      Math.abs(invoiceUnitRate - contractRate.rateCents) > 1
    ) {
      const expected =
        qty !== null ? Math.round(qty * contractRate.rateCents) : null;
      findings.push({
        audit_run_id: input.runId,
        audit_request_id: input.requestId,
        finding_type: "rate_mismatch",
        severity:
          amount !== null && expected !== null && amount - expected >= 50000
            ? "high"
            : "medium",
        source_document_id: input.document.id,
        source_row: rowNumber,
        service_code: code,
        description:
          "Billed unit rate differs from the supplied contract/rate-card rate.",
        billed_amount_cents: amount,
        expected_amount_cents: expected,
        potential_recovery_cents: potentialRecovery(amount, expected),
        evidence: {
          billed_unit_rate_cents: invoiceUnitRate,
          contract_unit_rate_cents: contractRate.rateCents,
          rate_card_document_id: contractRate.sourceDocumentId,
          rate_card_row: contractRate.sourceRow,
          quantity: qty,
          reference: ref,
        },
      });
    }
  });

  return findings;
}

function deterministicInputError(message: string) {
  return (
    message === "rate_card_has_no_recognized_rates" ||
    message === "csv_unclosed_quote" ||
    message === "csv_headers_invalid" ||
    message.startsWith("invoice_has_no_data_rows:")
  );
}

async function updateAuditRequest(
  requestId: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabaseAdmin()
    .from("audit_requests")
    .update(values)
    .eq("id", requestId);
  if (error) throw error;
}

async function updateAuditRun(runId: string, values: Record<string, unknown>) {
  const { error } = await supabaseAdmin()
    .from("audit_runs")
    .update(values)
    .eq("id", runId);
  if (error) throw error;
}

async function safelyRecordFailure(input: {
  runId: string;
  requestId: string;
  status: "failed" | "needs_review";
  errorCode: string;
  message: string;
}) {
  const now = new Date().toISOString();

  const { error: cleanupError } = await supabaseAdmin()
    .from("audit_findings")
    .delete()
    .eq("audit_run_id", input.runId);
  if (cleanupError) {
    console.error(
      "audit_failure_findings_cleanup_failed",
      input.runId,
      cleanupError.code,
    );
  }

  const { error: runError } = await supabaseAdmin()
    .from("audit_runs")
    .update({
      status: input.status,
      error_code: input.errorCode,
      error_message: input.message,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", input.runId);
  if (runError) {
    console.error("audit_failure_run_update_failed", input.runId, runError.code);
  }

  const { error: requestError } = await supabaseAdmin()
    .from("audit_requests")
    .update({ status: "paid", updated_at: now })
    .eq("id", input.requestId);
  if (requestError) {
    console.error(
      "audit_failure_request_update_failed",
      input.requestId,
      requestError.code,
    );
  }
}

async function recoverStaleRun(input: {
  id: string;
  started_at: string | null;
  created_at: string;
  requestId: string;
  requestStatus: string;
}) {
  if (
    !shouldRecoverProcessingRun({
      startedAt: input.started_at,
      createdAt: input.created_at,
      requestStatus: input.requestStatus,
    })
  ) {
    return false;
  }

  const now = new Date().toISOString();
  const { data: recovered, error } = await supabaseAdmin()
    .from("audit_runs")
    .update({
      status: "failed",
      error_code: "stale_processing_run",
      error_message: "Previous audit worker did not reach a terminal state.",
      completed_at: now,
      updated_at: now,
    })
    .eq("id", input.id)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!recovered) return false;

  await updateAuditRequest(input.requestId, {
    status: "paid",
    updated_at: now,
  });
  return true;
}

export async function processAuditRequest(requestId: string) {
  const supabase = supabaseAdmin();

  const { data: request, error: requestError } = await supabase
    .from("audit_requests")
    .select("id,status")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!request || !["paid", "processing"].includes(request.status)) return;

  const { data: existing, error: existingError } = await supabase
    .from("audit_runs")
    .select("id,status,started_at,created_at")
    .eq("audit_request_id", requestId)
    .in("status", ["queued", "processing", "complete", "needs_review"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    if (existing.status !== "processing") return;
    const recovered = await recoverStaleRun({
      id: existing.id,
      started_at: existing.started_at,
      created_at: existing.created_at,
      requestId,
      requestStatus: request.status,
    });
    if (!recovered) return;
  }

  const { data: run, error: runError } = await supabase
    .from("audit_runs")
    .insert({
      audit_request_id: requestId,
      status: "processing",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (runError) throw runError;

  await updateAuditRequest(requestId, {
    status: "processing",
    updated_at: new Date().toISOString(),
  });

  try {
    const { data: documents, error: documentsError } = await supabase
      .from("audit_documents")
      .select("id,kind,original_filename,storage_path,content_type,upload_status")
      .eq("audit_request_id", requestId)
      .eq("upload_status", "uploaded");
    if (documentsError) throw documentsError;

    const typedDocuments = (documents ?? []) as DocumentRow[];
    const csvDocuments = typedDocuments.filter(isCsvDocument);
    const termsDocument = csvDocuments.find(
      (document) =>
        document.kind === "contract" || document.kind === "rate_card",
    );
    const invoiceDocuments = csvDocuments.filter(
      (document) => document.kind === "invoice",
    );

    if (!termsDocument || invoiceDocuments.length === 0) {
      const now = new Date().toISOString();
      await updateAuditRun(run.id, {
        status: "needs_review",
        source_document_count: typedDocuments.length,
        error_code: "structured_csv_required",
        error_message:
          "Deterministic v1 requires a CSV contract/rate card and at least one CSV invoice.",
        completed_at: now,
        updated_at: now,
      });
      await updateAuditRequest(requestId, {
        status: "paid",
        updated_at: now,
      });
      return;
    }

    const rateRows = parseCsv(await documentText(termsDocument));
    const rateMap = buildRateMap(rateRows, termsDocument);
    if (rateMap.size === 0) {
      throw new Error("rate_card_has_no_recognized_rates");
    }

    const findings: AuditFindingInsert[] = [];
    const seenDuplicates = new Map<string, DuplicateOrigin>();
    for (const document of invoiceDocuments) {
      const rows = parseCsv(await documentText(document));
      if (rows.length === 0) {
        throw new Error(`invoice_has_no_data_rows:${document.original_filename}`);
      }
      findings.push(
        ...analyzeInvoiceRows({
          rows,
          document,
          rateMap,
          runId: run.id,
          requestId,
          seenDuplicates,
        }),
      );
    }

    if (findings.length > 0) {
      const { error: findingsError } = await supabase
        .from("audit_findings")
        .insert(findings);
      if (findingsError) throw findingsError;
    }

    const potentialRecoveryCents = conservativePotentialRecoveryCents(findings);
    const now = new Date().toISOString();
    await updateAuditRun(run.id, {
      status: "complete",
      source_document_count: csvDocuments.length,
      finding_count: findings.length,
      potential_recovery_cents: potentialRecoveryCents,
      completed_at: now,
      updated_at: now,
    });
    await updateAuditRequest(requestId, {
      status: "complete",
      updated_at: now,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "unknown_error";
    const inputFailure = deterministicInputError(message);

    await safelyRecordFailure({
      runId: run.id,
      requestId,
      status: inputFailure ? "needs_review" : "failed",
      errorCode: inputFailure
        ? "structured_data_invalid"
        : "audit_engine_failed",
      message,
    });

    if (!inputFailure) throw error;
  }
}
