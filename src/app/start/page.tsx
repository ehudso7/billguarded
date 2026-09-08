import type { Metadata } from "next";
import Link from "next/link";
import IntakeForm from "./intake-form";

export const metadata: Metadata = {
  title: "Start a 90-Day 3PL Invoice Audit | BillGuarded",
  description:
    "Upload one supported CSV rate card and up to 10 CSV invoices before opening secure checkout for the $1,500 BillGuarded audit.",
  alternates: { canonical: "/start" },
  robots: { index: false, follow: false },
};

type StartPageProps = {
  searchParams: Promise<{ cancelled?: string; error?: string }>;
};

function startMessage(params: { cancelled?: string; error?: string }) {
  if (params.cancelled === "1") {
    return "Checkout was closed and no payment was confirmed. Your existing workspace was not charged; contact support before starting over if you are unsure.";
  }
  if (params.error) {
    return "BillGuarded could not verify that Checkout return. Do not pay again. Contact support if you expected a completed payment.";
  }
  return undefined;
}

export default async function StartPage({ searchParams }: StartPageProps) {
  const params = await searchParams;
  return (
    <main>
      <div className="form-shell">
        <nav className="nav">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true" />
            BillGuarded
          </Link>
          <Link className="nav-pill" href="/">
            Back
          </Link>
        </nav>

        <section className="form-card">
          <span className="eyebrow">Start the reconciliation</span>
          <h1>Upload your rate card and invoices. Check four deterministic billing discrepancies.</h1>
          <p>
            Production audits currently use structured CSV files so every
            finding can be reproduced deterministically. Upload one CSV
            contract or rate card plus up to 10 CSV invoices. Files remain in
            private storage and Stripe Checkout does not open until the upload
            is complete and validated.
          </p>
          <div className="audit-scope" aria-label="Deterministic audit checks">
            <strong>The $1,500 one-time audit checks:</strong>
            <ul>
              <li>Duplicate charges</li>
              <li>Unsupported service or fee codes</li>
              <li>Line arithmetic mismatches</li>
              <li>Billed unit-rate mismatches</li>
            </ul>
          </div>
          <IntakeForm
            initialMessage={startMessage(params)}
            checkoutCancelled={params.cancelled === "1"}
          />
          <section className="after-payment" aria-labelledby="after-payment-title">
            <h2 id="after-payment-title">What happens after payment</h2>
            <ol>
              <li>Stripe’s signed payment event queues your audit.</li>
              <li>The deterministic engine processes the supported files.</li>
              <li>BillGuarded emails a private recovery link when the report is complete.</li>
            </ol>
            <p>
              Findings require review and do not guarantee a refund, credit,
              reimbursement, or recovery. Continuous Monitor is not currently
              for sale.
            </p>
          </section>
          <p className="status">
            Need help preparing CSVs? Email{" "}
            <a href="mailto:support@billguarded.com">support@billguarded.com</a>{" "}
            before paying. We will not charge for an unsupported file set.
          </p>
        </section>
      </div>
    </main>
  );
}
