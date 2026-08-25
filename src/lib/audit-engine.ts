import {
  analyzeInvoiceRows,
  buildRateCard,
  type CoreFinding,
} from "@/lib/audit-core";
import { parseCsv } from "@/lib/audit-csv";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type AuditFindingInsert = {
  audit_run_id: string;
  audit_request_id: string;
  finding_type:
    | "duplicate_charge"
    | "unsupported_fee"
    | "arithmetic_mismatch"
    | "rate_mismatch"
    | "ambiguous_rate";
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

type AnalyzeOptions = {
  maxInvoices?: number;
  maxRowsPerInvoice?: number;
};

export type AuditAnalysis = {
  findings: Omit<AuditFindingInsert, "audit_run_id">[];
  sourceDocumentCount: number;
  invoiceRowCount: number;
  evaluatedRowCount: number;
  skippedRowCount: number;
  coveragePercent: number;
  potentialRecoveryCents: number;
  requiresReview: boolean;
};

function isCsvDocument(document: DocumentRow) {
  return (
    document.content_type === "text/csv" ||
    document.original_filename.toLowerCase().endsWith(".csv")
  );
}

async function documentText(document: DocumentRow) {
  const { data, error } = await supabaseAdmin()
    .storage.from("audit-documents")
    .download(document.storage_path);
  if (error) throw error;
  return data.text();
}

function findingForDocument(
  finding: CoreFinding,
  document: DocumentRow,
  requestId: string,
): Omit<AuditFindingInsert, "audit_run_id"> {
  return {
    audit_request_id: requestId,
    finding_type: finding.findingType,
    severity: finding.severity,
    source_document_id: document.id,
    source_row: finding.sourceRow,
    service_code: finding.serviceCode,
    description: finding.description,
    billed_amount_cents: finding.billedAmountCents,
    expected_amount_cents: finding.expectedAmountCents,
    potential_recovery_cents: finding.potentialRecoveryCents,
    evidence: finding.evidence,
  };
}

export async function analyzeAuditRequest(
  requestId: string,
  options: AnalyzeOptions = {},
): Promise<AuditAnalysis> {
  const supabase = supabaseAdmin();
  const { data: documents, error: documentsError } = await supabase
    .from("audit_documents")
    .select(
      "id,kind,original_filename,storage_path,content_type,upload_status",
    )
    .eq("audit_request_id", requestId)
    .eq("upload_status", "uploaded");
  if (documentsError) throw documentsError;

  const typedDocuments = (documents ?? []) as DocumentRow[];
  const csvDocuments = typedDocuments.filter(isCsvDocument);
  const termsDocument = csvDocuments.find(
    (document) => document.kind === "contract" || document.kind === "rate_card",
  );
  const invoiceDocuments = csvDocuments
    .filter((document) => document.kind === "invoice")
    .slice(0, Math.max(1, options.maxInvoices ?? 10));

  if (!termsDocument || invoiceDocuments.length === 0) {
    throw new Error("structured_csv_required");
  }

  const rateRows = parseCsv(await documentText(termsDocument));
  const rateCard = buildRateCard(rateRows);
  if (rateCard.recognizedRateRows === 0) {
    throw new Error("rate_card_has_no_recognized_rates");
  }

  const findings: Omit<AuditFindingInsert, "audit_run_id">[] = [];
  let invoiceRowCount = 0;
  let evaluatedRowCount = 0;
  let skippedRowCount = 0;
  let potentialRecoveryCents = 0;
  let requiresReview = rateCard.ambiguousCodes.size > 0;

  for (const document of invoiceDocuments) {
    const rows = parseCsv(await documentText(document));
    const analysis = analyzeInvoiceRows({
      rows,
      rateCard,
      maxRows: options.maxRowsPerInvoice ?? 25_000,
    });

    invoiceRowCount += analysis.rowCount;
    evaluatedRowCount += analysis.evaluatedRowCount;
    skippedRowCount += analysis.skippedRowCount;
    potentialRecoveryCents += analysis.potentialRecoveryCents;
    requiresReview ||= analysis.requiresReview;
    findings.push(
      ...analysis.findings.map((finding) =>
        findingForDocument(finding, document, requestId),
      ),
    );
  }

  const coveragePercent =
    invoiceRowCount === 0
      ? 0
      : Math.round((evaluatedRowCount / invoiceRowCount) * 100);

  return {
    findings,
    sourceDocumentCount: 1 + invoiceDocuments.length,
    invoiceRowCount,
    evaluatedRowCount,
    skippedRowCount,
    coveragePercent,
    potentialRecoveryCents,
    requiresReview:
      requiresReview || invoiceRowCount === 0 || coveragePercent < 80,
  };
}

function reviewableInputError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.message === "structured_csv_required" ||
    error.message === "rate_card_has_no_recognized_rates" ||
    error.message.startsWith("csv_")
  );
}

export async function createAuditPreview(requestId: string) {
  const analysis = await analyzeAuditRequest(requestId, {
    maxInvoices: 1,
    maxRowsPerInvoice: 100,
  });

  const previewFindings = analysis.findings.slice(0, 5).map((finding) => ({
    finding_type: finding.finding_type,
    severity: finding.severity,
    source_row: finding.source_row,
    service_code: finding.service_code,
    description: finding.description,
    billed_amount_cents: finding.billed_amount_cents,
    expected_amount_cents: finding.expected_amount_cents,
    potential_recovery_cents: finding.potential_recovery_cents,
  }));

  const { error } = await supabaseAdmin().from("audit_previews").upsert(
    {
      audit_request_id: requestId,
      finding_count: analysis.findings.length,
      potential_recovery_cents: analysis.potentialRecoveryCents,
      evaluated_row_count: analysis.evaluatedRowCount,
      skipped_row_count: analysis.skippedRowCount,
      coverage_percent: analysis.coveragePercent,
      requires_review: analysis.requiresReview,
      findings: previewFindings,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "audit_request_id" },
  );
  if (error) throw error;

  return analysis;
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

  const { data: existing } = await supabase
    .from("audit_runs")
    .select("id,status")
    .eq("audit_request_id", requestId)
    .in("status", ["queued", "processing", "complete", "needs_review"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return;

  const { data: run, error: runError } = await supabase
    .from("audit_runs")
    .insert({
      audit_request_id: requestId,
      status: "processing",
      engine_version: "deterministic-v2",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (runError) throw runError;

  await supabase
    .from("audit_requests")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", requestId);

  try {
    const analysis = await analyzeAuditRequest(requestId);
    const findings: AuditFindingInsert[] = analysis.findings.map((finding) => ({
      ...finding,
      audit_run_id: run.id,
    }));

    if (findings.length > 0) {
      const { error: findingsError } = await supabase
        .from("audit_findings")
        .insert(findings);
      if (findingsError) throw findingsError;
    }

    const finalStatus = analysis.requiresReview ? "needs_review" : "complete";
    const { error: runUpdateError } = await supabase
      .from("audit_runs")
      .update({
        status: finalStatus,
        source_document_count: analysis.sourceDocumentCount,
        finding_count: findings.length,
        potential_recovery_cents: analysis.potentialRecoveryCents,
        evaluated_row_count: analysis.evaluatedRowCount,
        skipped_row_count: analysis.skippedRowCount,
        coverage_percent: analysis.coveragePercent,
        error_code: analysis.requiresReview ? "coverage_review_required" : null,
        error_message: analysis.requiresReview
          ? "Some invoice rows could not be evaluated safely or the supplied rate card contains ambiguous rates. BillGuarded withheld a full-clean conclusion."
          : null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    if (runUpdateError) throw runUpdateError;

    await supabase
      .from("audit_requests")
      .update({
        status: finalStatus === "complete" ? "complete" : "paid",
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "unknown_error";
    const needsReview = reviewableInputError(error);

    await supabase
      .from("audit_runs")
      .update({
        status: needsReview ? "needs_review" : "failed",
        error_code: needsReview ? message : "audit_engine_failed",
        error_message: needsReview
          ? "The uploaded CSV structure could not be evaluated safely. No clean bill or recovery conclusion was generated."
          : message,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    await supabase
      .from("audit_requests")
      .update({ status: "paid", updated_at: new Date().toISOString() })
      .eq("id", requestId);

    if (!needsReview) throw error;
  }
}
