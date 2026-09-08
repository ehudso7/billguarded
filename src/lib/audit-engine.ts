import { parseCsv } from "@/lib/audit-csv";
import { conservativePotentialRecoveryCents } from "@/lib/audit-math";
import { recordAuditFunnelEvent } from "@/lib/funnel-analytics";
import {
  analyzeInvoiceRows,
  buildRateMap,
  type AuditFindingInsert,
  type DocumentRow,
  type DuplicateOrigin,
} from "@/lib/audit-reconcile";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type { AuditFindingInsert, DocumentRow } from "@/lib/audit-reconcile";

export type AuditWorkClaim = {
  auditRequestId: string;
  runId: string;
  claimToken: string;
  attemptNumber: number;
};

export type AuditWorkResult = {
  state: "complete" | "retryable" | "permanently_failed";
  errorCode?: string;
};

function isCsvDocument(document: DocumentRow) {
  return (
    document.content_type === "text/csv" &&
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
    message === "structured_csv_required" ||
    message === "rate_card_has_no_recognized_rates" ||
    message === "csv_unclosed_quote" ||
    message === "csv_headers_invalid" ||
    message.startsWith("invoice_has_no_data_rows:")
  );
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "unknown_error";
}

async function failClaimedWork(
  claim: AuditWorkClaim,
  error: unknown,
): Promise<AuditWorkResult> {
  const message = safeError(error);
  const inputFailure = deterministicInputError(message);
  const errorCode = inputFailure
    ? "structured_data_invalid"
    : "audit_engine_failed";

  const { data, error: recordError } = await supabaseAdmin().rpc(
    "billguarded_fail_audit_work",
    {
      p_request_id: claim.auditRequestId,
      p_run_id: claim.runId,
      p_claim_token: claim.claimToken,
      p_retryable: !inputFailure,
      p_error_code: errorCode,
      p_error_message: message,
    },
  );

  if (recordError) throw recordError;
  if (data === "claim_lost") {
    throw new Error("audit_work_claim_lost");
  }

  try {
    await recordAuditFunnelEvent({
      auditRequestId: claim.auditRequestId,
      eventName: "audit_failed",
      dedupePart: `${claim.runId}:${claim.attemptNumber}`,
      outcome: data === "retryable" ? "retryable" : "terminal",
    });
  } catch (analyticsError) {
    console.error(
      "audit_failure_funnel_event_failed",
      analyticsError &&
        typeof analyticsError === "object" &&
        "code" in analyticsError
        ? String(analyticsError.code).slice(0, 80)
        : "unknown_error",
    );
  }

  return {
    state: data === "retryable" ? "retryable" : "permanently_failed",
    errorCode,
  };
}

export async function processClaimedAuditWork(
  claim: AuditWorkClaim,
): Promise<AuditWorkResult> {
  const supabase = supabaseAdmin();

  try {
    const { data: request, error: requestError } = await supabase
      .from("audit_requests")
      .select("id,status,selected_offer")
      .eq("id", claim.auditRequestId)
      .maybeSingle();
    if (requestError) throw requestError;
    if (
      !request ||
      request.status !== "processing" ||
      request.selected_offer !== "audit_90_day"
    ) {
      throw new Error("audit_work_claim_invalid");
    }

    const { data: run, error: runError } = await supabase
      .from("audit_runs")
      .select("id,status,attempt_number,work_claim_token")
      .eq("id", claim.runId)
      .eq("audit_request_id", claim.auditRequestId)
      .maybeSingle();
    if (runError) throw runError;
    if (
      !run ||
      run.status !== "processing" ||
      run.attempt_number !== claim.attemptNumber ||
      run.work_claim_token !== claim.claimToken
    ) {
      throw new Error("audit_run_claim_invalid");
    }

    const { data: documents, error: documentsError } = await supabase
      .from("audit_documents")
      .select("id,kind,original_filename,storage_path,content_type,upload_status")
      .eq("audit_request_id", claim.auditRequestId)
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
      throw new Error("structured_csv_required");
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
        throw new Error(
          `invoice_has_no_data_rows:${document.original_filename}`,
        );
      }
      findings.push(
        ...analyzeInvoiceRows({
          rows,
          document,
          rateMap,
          runId: claim.runId,
          requestId: claim.auditRequestId,
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

    const potentialRecoveryCents =
      conservativePotentialRecoveryCents(findings);
    const { data: completed, error: completeError } = await supabase.rpc(
      "billguarded_complete_audit_work",
      {
        p_request_id: claim.auditRequestId,
        p_run_id: claim.runId,
        p_claim_token: claim.claimToken,
        p_source_document_count: csvDocuments.length,
        p_finding_count: findings.length,
        p_potential_recovery_cents: potentialRecoveryCents,
      },
    );
    if (completeError) throw completeError;
    if (!completed) throw new Error("audit_work_claim_lost");

    try {
      await recordAuditFunnelEvent({
        auditRequestId: claim.auditRequestId,
        eventName: "audit_completed",
        dedupePart: claim.runId,
      });
    } catch (analyticsError) {
      console.error(
        "audit_completion_funnel_event_failed",
        analyticsError &&
          typeof analyticsError === "object" &&
          "code" in analyticsError
          ? String(analyticsError.code).slice(0, 80)
          : "unknown_error",
      );
    }

    return { state: "complete" };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "audit_work_claim_lost"
    ) {
      throw error;
    }
    return failClaimedWork(claim, error);
  }
}
