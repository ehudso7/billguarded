import Link from "next/link";
import { OFFERS } from "@/lib/offers";

export default function HomePage() {
  const audit = OFFERS.audit_90_day;

  return (
    <main>
      <div className="shell">
        <nav className="nav">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true" />
            BillGuarded
          </Link>
          <Link className="nav-pill" href="/start">
            Run an audit
          </Link>
        </nav>

        <section className="hero">
          <span className="eyebrow">3PL contract reconciliation</span>
          <h1>Check whether your 3PL billed what you agreed to.</h1>
          <p>
            BillGuarded reconciles structured 3PL invoices against the rate
            card or commercial terms you supply, surfaces evidence-backed
            discrepancies, and gives your team a clean record to review before
            disputing anything.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/start">
              Start a 90-day audit →
            </Link>
            <Link className="button" href="/demo">
              See a synthetic audit demo
            </Link>
            <a
              className="button"
              href="mailto:hello@billguarded.com?subject=Free%20one-invoice%20fit%20check"
            >
              Ask for a free fit check
            </a>
          </div>
        </section>

        <section className="proof-strip" aria-label="How BillGuarded works">
          <div className="proof-item">
            <strong>1. Upload</strong>
            <span>One USD-denominated CSV rate card plus up to 10 USD CSV invoices.</span>
          </div>
          <div className="proof-item">
            <strong>2. Reconcile</strong>
            <span>
              Duplicate charges, unsupported fees, line math, and billed rates
              are checked deterministically.
            </span>
          </div>
          <div className="proof-item">
            <strong>3. Review</strong>
            <span>
              Findings stay tied to source rows and recovery totals are kept
              conservative to avoid double counting.
            </span>
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="section-heading">
            <span className="eyebrow">Production offer</span>
            <h2>Pay for an audit you can inspect.</h2>
            <p>
              No percentage-of-recovery fee and no recovery guarantee. The
              production flow charges only after supported USD CSV files have
              uploaded and validated.
            </p>
          </div>

          <div className="pricing-grid">
            <article className="card">
              <span className="eyebrow">{audit.eyebrow}</span>
              <h3>{audit.name}</h3>
              <div className="price">
                <strong>{audit.priceLabel}</strong>
                <span>{audit.cadence}</span>
              </div>
              <p>{audit.description}</p>
              <ul>
                {audit.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link className="button primary" href="/start">
                Start {audit.name}
              </Link>
            </article>

            <article className="card highlight">
              <span className="eyebrow">Early access</span>
              <h3>Continuous Monitor</h3>
              <div className="price">
                <strong>Not for sale yet</strong>
              </div>
              <p>
                Ongoing automated monitoring remains in controlled early
                access while the recurring ingestion and retention workflow is
                hardened. BillGuarded will not take a paid monitoring
                subscription before that workflow is production-ready.
              </p>
              <ul>
                <li>Recurring invoice reconciliation</li>
                <li>Evidence-linked exception history</li>
                <li>Subscription self-service before general availability</li>
              </ul>
              <a
                className="button"
                href="mailto:hello@billguarded.com?subject=Continuous%20Monitor%20early%20access"
              >
                Request early access
              </a>
            </article>
          </div>
        </section>

        <section className="section trust-grid" aria-label="BillGuarded trust controls">
          <article className="card compact-card">
            <span className="eyebrow">Private by default</span>
            <h3>Documents are not public.</h3>
            <p>
              Uploads use short-lived signed storage access and customer data
              stays behind server-only database access controls.
            </p>
          </article>
          <article className="card compact-card">
            <span className="eyebrow">Fail closed</span>
            <h3>Unsupported inputs are stopped before payment.</h3>
            <p>
              The live audit accepts USD CSV inputs only. A checkout is not
              opened unless the required structured files pass validation.
            </p>
          </article>
          <article className="card compact-card">
            <span className="eyebrow">Human review</span>
            <h3>A finding is evidence, not an accusation.</h3>
            <p>
              Operational context still matters. Review findings before asking
              a 3PL for a credit or adjustment.
            </p>
          </article>
        </section>

        <footer className="footer">
          <div>
            BillGuarded identifies potential billing discrepancies from the
            documents supplied. Findings require review and do not guarantee
            refunds, credits, or recoveries.
          </div>
          <div className="footer-links">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/security">Security</Link>
            <a href="mailto:support@billguarded.com">Support</a>
          </div>
        </footer>
      </div>
    </main>
  );
}
