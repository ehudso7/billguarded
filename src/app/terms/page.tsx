import Link from "next/link";

export const metadata = {
  title: "Terms — BillGuarded",
  description: "Terms for using BillGuarded invoice reconciliation services.",
};

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <nav className="nav">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          BillGuarded
        </Link>
        <Link className="nav-pill" href="/">
          Back home
        </Link>
      </nav>
      <article className="legal-card">
        <span className="eyebrow">Terms</span>
        <h1>BillGuarded Terms of Service</h1>
        <p>Last updated: August 27, 2026.</p>

        <h2>The service</h2>
        <p>
          BillGuarded analyzes supported billing data against commercial terms
          supplied by the customer and produces evidence-linked potential
          discrepancies for review. The service is an analytical aid, not a
          legal, accounting, tax, or collections service.
        </p>

        <h2>No recovery guarantee</h2>
        <p>
          A BillGuarded finding does not establish that a charge is unlawful,
          improper, or recoverable. Operational context, amendments, minimums,
          credits, service exceptions, and other facts may change the result.
          Customers are responsible for reviewing findings before disputing a
          charge or acting on them.
        </p>

        <h2>Your documents</h2>
        <p>
          You represent that you are authorized to submit the documents and
          information you upload. You remain responsible for the accuracy and
          completeness of the materials provided and for complying with any
          confidentiality obligations that apply to them.
        </p>

        <h2>Supported production inputs</h2>
        <p>
          The current production audit requires structured CSV inputs and all
          monetary amounts submitted for analysis must be denominated in U.S.
          dollars (USD). If an uploaded file contains a currency field, a
          declared non-USD currency is rejected before payment. When a file
          contains no currency field, your acceptance at intake confirms that
          the submitted monetary amounts are USD. Other formats or currencies
          are not represented as automatically supported unless BillGuarded
          explicitly says otherwise.
        </p>

        <h2>Payments</h2>
        <p>
          One-time audit fees are shown before Stripe Checkout. Paid recurring
          monitoring is not offered until the recurring workflow is explicitly
          made generally available. Billing is processed by Stripe and may be
          subject to Stripe&apos;s applicable terms.
        </p>

        <h2>Availability and changes</h2>
        <p>
          We may improve, secure, or modify the service as necessary. We may
          suspend abusive activity or activity that threatens the security or
          reliability of the service.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms can be sent to{" "}
          <a href="mailto:support@billguarded.com">support@billguarded.com</a>.
        </p>
      </article>
    </main>
  );
}
