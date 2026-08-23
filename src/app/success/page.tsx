import Link from "next/link";
import { cookies } from "next/headers";
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
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
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
        .select("id,status,finding_count,potential_recovery_cents,error_code,error_message")
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
            .select("id,finding_type,severity,source_row,service_code,description,billed_amount_cents,expected_amount_cents,potential_recovery_cents")
            .eq("audit_run_id", run.id)
            .order("potential_recovery_cents", { ascending: false })
            .limit(100);
          findings = (data ?? []) as FindingRow[];
        }
      }
    }
  }

  const processing = !pending && (auditStatus === "paid" || auditStatus === "processing" || runStatus === "queued" || runStatus === "processing");
  const complete = runStatus === "complete";
  const needsReview = runStatus === "needs_review";

  return (
    <main className="center-page">
      <section className="success-card">
        <div className="success-icon" aria-hidden="true">
          {pending || processing ? "…" : "✓"}
        </div>
        <span className="eyebrow">
          {pending
            ? "Payment processing"
            : processing
              ? "Audit processing"
              : complete
                ? "Audit complete"
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
                : needsReview
                  ? "Your files need a structured-data pass."
                  : "Your BillGuarded workspace is funded."}
        </h1>
        <p className="muted">
          {pending
            ? "BillGuarded will not provision paid access until Stripe reports the payment successful."
            : processing
              ? "The deterministic engine is checking duplicate charges, unsupported fee codes, line arithmetic, and billed rates against the supplied rate card. Refresh this page in a moment."
              : complete
                ? `${findingCount} evidence-backed finding${findingCount === 1 ? "" : "s"} were generated from the structured files you supplied. Review each item against operational context before disputing a charge.`
                : needsReview
                  ? "Deterministic v1 requires a CSV rate card and at least one CSV invoice. Your uploaded files remain private and intact; no unsupported conclusion was generated."
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
                    Billed {dollars(finding.billed_amount_cents)} · Expected {dollars(finding.expected_amount_cents)} · Potential recovery {dollars(finding.potential_recovery_cents)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="hero-actions">
          {processing ? (
            <Link className="button primary" href={`/success?request=${encodeURIComponent(params.request ?? "")}`}>
              Refresh audit status
            </Link>
          ) : (
            <Link className="button primary" href="/">
              Return home
            </Link>
          )}
          {billingAccess ? (
            <form action="/api/billing/portal" method="post">
              <button className="button" type="submit">
                Manage billing
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </main>
  );
}
