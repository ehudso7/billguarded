import Link from "next/link";
import { cookies } from "next/headers";
import AutoRefresh from "./auto-refresh";
import {
  portalCookieName,
  verifyPortalCookie,
} from "@/lib/security/portal-cookie";
import { supabaseAdmin } from "@/lib/supabase-admin";

type SuccessPageProps = {
  searchParams: Promise<{ pending?: string; request?: string }>;
};

type FindingRow = {
  id: string;
  finding_type: string;
  severity: string;
  source_row: number | null;
  service_code: string | null;
  description: string;
  billed_amount_cents: number | null;
  expected_amount_cents: number | null;
  potential_recovery_cents: number;
};

function dollars(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function label(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default async function SuccessPage({ searchParams }: SuccessPageProps) {
  const params = await searchParams;
  const pending = params.pending === "1";
  const cookieStore = await cookies();
  const billingAccess = verifyPortalCookie(
    cookieStore.get(portalCookieName)?.value,
  );

  let auditStatus: string | null = null;
  let runStatus: string | null = null;
  let findingCount = 0;
  let potentialRecoveryCents = 0;
  let findings: FindingRow[] = [];

  if (billingAccess && params.request) {
    const supabase = supabaseAdmin();
    const { data: audit } = await supabase
      .from("audit_requests")
      .select("id,status,stripe_customer_id")
      .eq("id", params.request)
      .eq("stripe_customer_id", billingAccess.customerId)
      .maybeSingle();

    if (audit) {
      auditStatus = audit.status;
      const { data: run } = await supabase
        .from("audit_runs")
        .select(
          "id,status,finding_count,potential_recovery_cents,error_code,error_message",
        )
        .eq("audit_request_id", audit.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (run) {
        runStatus = run.status;
        findingCount = run.finding_count ?? 0;
        potentialRecoveryCents = run.potential_recovery_cents ?? 0;

        if (run.status === "complete") {
          const { data } = await supabase
            .from("audit_findings")
            .select(
              "id,finding_type,severity,source_row,service_code,description,billed_amount_cents,expected_amount_cents,potential_recovery_cents",
            )
            .eq("audit_run_id", run.id)
            .order("potential_recovery_cents", { ascending: false })
            .limit(100);
          findings = (data ?? []) as FindingRow[];
        }
      }
    }
  }

  const processing =
    !pending &&
    (auditStatus === "paid" ||
      auditStatus === "processing" ||
      runStatus === "queued" ||
      runStatus === "processing");
  const complete = runStatus === "complete";
  const needsReview = runStatus === "needs_review";
  const failed = runStatus === "failed";
  const icon = pending || processing ? "…" : failed || needsReview ? "!" : "✓";
  const reportUrl = params.request
    ? `/api/audit-report?request=${encodeURIComponent(params.request)}`
    : null;

  return (
    <main className="center-page">
      <AutoRefresh active={processing} />
      <section className="success-card">
        <div className="success-icon" aria-hidden="true">
          {icon}
        </div>
        <span className="eyebrow">
          {pending
            ? "Payment processing"
            : processing
              ? "Audit processing"
              : complete
                ? "Audit complete"
                : failed
                  ? "Audit needs attention"
                  : needsReview
                    ? "Structured review needed"
                    : "Payment confirmed"}
        </span>
        <h1>
          {pending
            ? "Stripe is still finalizing your payment."
            : processing
              ? "BillGuarded is reconciling your files."
              : complete
                ? `${dollars(potentialRecoveryCents)} in potential recovery surfaced.`
                : failed
                  ? "We could not complete this audit automatically."
                  : needsReview
                    ? "Your files need a structured-data pass."
                    : "Your BillGuarded workspace is funded."}
        </h1>
        <p className="muted">
          {pending
            ? "BillGuarded will not provision paid access until Stripe reports the payment successful."
            : processing
              ? "The deterministic engine is checking duplicate charges, unsupported fee codes, line arithmetic, and billed rates against the supplied rate card. This page updates automatically for about two minutes; you can also refresh it manually."
              : complete
                ? `${findingCount} evidence-backed finding${findingCount === 1 ? "" : "s"} were generated from the structured files you supplied. The recovery total is conservatively de-duplicated by source row. Review each item against operational context before disputing a charge.`
                : failed
                  ? "Your payment and uploaded files remain recorded. Do not pay again. Contact support@billguarded.com and include your company name so the audit can be reviewed without creating a duplicate checkout."
                  : needsReview
                    ? "The current deterministic engine requires a CSV rate card and at least one CSV invoice. Your uploaded files remain private and intact; no unsupported conclusion was generated."
                    : "Stripe confirmed the checkout. Your audit request is recorded and ready for processing."}
        </p>

        {complete && findings.length > 0 ? (
          <div className="offer-picker" aria-label="Audit findings">
            {findings.map((finding) => (
              <div className="offer-option selected" key={finding.id}>
                <div>
                  <strong>{label(finding.finding_type)}</strong>
                  <div className="muted">
                    {finding.service_code ? `${finding.service_code} · ` : ""}
                    {finding.source_row ? `row ${finding.source_row} · ` : ""}
                    {label(finding.severity)} severity
                  </div>
                  <div>{finding.description}</div>
                  <div className="muted">
                    Billed {dollars(finding.billed_amount_cents)} · Expected{" "}
                    {dollars(finding.expected_amount_cents)} · Potential recovery{" "}
                    {dollars(finding.potential_recovery_cents)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {complete && findings.length === 0 ? (
          <p className="muted">
            No supported discrepancy pattern was detected in the submitted CSV
            rows. That is not a guarantee that the underlying 3PL billing is
            error-free; it means the deterministic checks did not surface a
            supported finding from this data set.
          </p>
        ) : null}

        <div className="hero-actions">
          {processing ? (
            <Link
              className="button primary"
              href={`/success?request=${encodeURIComponent(params.request ?? "")}`}
            >
              Refresh audit status
            </Link>
          ) : failed || needsReview ? (
            <a
              className="button primary"
              href="mailto:support@billguarded.com?subject=BillGuarded%20audit%20review"
            >
              Contact support
            </a>
          ) : complete && reportUrl ? (
            <a className="button primary" href={reportUrl}>
              Download findings CSV
            </a>
          ) : (
            <Link className="button primary" href="/">
              Return home
            </Link>
          )}
          <Link className="button" href="/">
            Return home
          </Link>
        </div>
      </section>
    </main>
  );
}
