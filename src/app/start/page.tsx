import Link from "next/link";
import { Suspense } from "react";
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
          <h1>Show us what you were billed.</h1>
          <p>
            Add your commercial terms and recent invoices. Files are stored in
            a private bucket and the checkout does not begin until the upload
            completes.
          </p>
          <Suspense fallback={<p className="status">Loading intake…</p>}>
            <IntakeForm />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
