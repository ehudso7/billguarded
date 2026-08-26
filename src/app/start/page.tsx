import Link from "next/link";
import IntakeForm from "./intake-form";

export default function StartPage() {
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
          <h1>Upload clean billing data. Get evidence you can inspect.</h1>
          <p>
            Production audits currently use structured CSV files so every
            finding can be reproduced deterministically. Upload one CSV
            contract or rate card plus up to 10 CSV invoices. Files remain in
            private storage and Stripe Checkout does not open until the upload
            is complete and validated.
          </p>
          <IntakeForm />
          <p className="status">
            Need help preparing CSVs? Email support@billguarded.com before
            paying. We will not charge for an unsupported file set.
          </p>
        </section>
      </div>
    </main>
  );
}
