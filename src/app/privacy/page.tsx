import Link from "next/link";

export const metadata = {
  title: "Privacy — BillGuarded",
  description: "How BillGuarded handles audit, billing, and contact data.",
};

export default function PrivacyPage() {
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
        <span className="eyebrow">Privacy</span>
        <h1>Privacy at BillGuarded</h1>
        <p>Last updated: August 25, 2026.</p>

        <h2>Information we process</h2>
        <p>
          BillGuarded processes the company and work-email information you
          submit, the billing documents you upload, audit results generated
          from those documents, and billing records needed to provide the
          service. We also receive standard operational data needed to protect
          and run the service, such as request metadata and delivery events.
        </p>

        <h2>How we use information</h2>
        <p>
          We use submitted information to create your audit workspace, validate
          uploads, reconcile supported billing data, present findings, process
          payments, provide support, prevent abuse, and operate and improve the
          service. We do not use a customer&apos;s uploaded invoices or rate
          cards to make unsupported accusations or guarantee a recovery.
        </p>

        <h2>Service providers</h2>
        <p>
          BillGuarded relies on infrastructure and service providers including
          Vercel for application hosting, Supabase for database and private file
          storage, Stripe for payments and billing, and Resend for business
          email. Each provider processes information as needed to perform its
          role.
        </p>

        <h2>Document access and retention</h2>
        <p>
          Audit documents are stored in a private storage bucket and are
          accessed through server-side controls or short-lived signed upload
          access. We retain information for as long as reasonably necessary to
          provide the service, maintain billing and audit records, resolve
          disputes, protect the service, and meet applicable legal obligations.
        </p>

        <h2>Your choices</h2>
        <p>
          You may contact us to ask about access, correction, or deletion of
          information associated with your audit, subject to records we must
          retain for legitimate business or legal reasons.
        </p>

        <h2>Contact</h2>
        <p>
          Privacy questions can be sent to{" "}
          <a href="mailto:support@billguarded.com">support@billguarded.com</a>.
        </p>
      </article>
    </main>
  );
}
