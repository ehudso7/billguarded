import Link from "next/link";

export const metadata = {
  title: "Security — BillGuarded",
  description: "Security controls used by BillGuarded.",
};

export default function SecurityPage() {
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
        <span className="eyebrow">Security</span>
        <h1>How BillGuarded protects audit data</h1>
        <p>Last updated: August 25, 2026.</p>

        <h2>Private storage</h2>
        <p>
          Audit files are stored in a non-public Supabase Storage bucket.
          Uploads are performed through short-lived signed upload access rather
          than public object permissions.
        </p>

        <h2>Workspace isolation</h2>
        <p>
          New audit workspaces receive a high-entropy access token. The token
          itself is not stored in the database; BillGuarded stores a one-way
          hash and requires the matching token before allowing pre-payment
          uploads or checkout activity for that workspace.
        </p>

        <h2>Server-only data access</h2>
        <p>
          Customer audit, finding, Stripe-event, and billing tables have row
          level security enabled and do not grant direct table privileges to
          anonymous or authenticated browser roles. Sensitive database actions
          are performed by server-side code.
        </p>

        <h2>Payment integrity</h2>
        <p>
          Stripe handles card payment collection. BillGuarded provisions paid
          audit state from signed Stripe webhook events in production, and
          webhook event IDs are recorded so processing is idempotent.
        </p>

        <h2>Abuse and browser controls</h2>
        <p>
          Intake creation is rate-limited, supported file types are checked
          before signed upload access is created, production redirect origins
          are pinned to the BillGuarded domain, and the application sends
          restrictive browser security headers.
        </p>

        <h2>Report a security issue</h2>
        <p>
          Send suspected vulnerabilities to{" "}
          <a href="mailto:support@billguarded.com?subject=Security%20report">
            support@billguarded.com
          </a>
          . Please do not include customer documents or secrets in an initial
          report.
        </p>
      </article>
    </main>
  );
}
