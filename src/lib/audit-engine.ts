import { parseCsv } from "@/lib/audit-csv";
import { conservativePotentialRecoveryCents } from "@/lib/audit-math";
import {
  analyzeInvoiceRows,
  buildRateMap,
  type AuditFindingInsert,
  type DocumentRow,
  type DuplicateOrigin,
} from "@/lib/audit-reconcile";
import { shouldRecoverProcessingRun } from "@/lib/audit-recovery";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type { AuditFindingInsert, DocumentRow } from "@/lib/audit-reconcile";

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
