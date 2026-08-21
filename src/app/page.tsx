import Link from "next/link";
import { OFFERS } from "@/lib/offers";

export default function HomePage() {
  const audit = OFFERS.audit_90_day;
  const monitor = OFFERS.continuous_monitor;

  return (
    <main>
      <div className="shell">
        <nav className="nav">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true" />
            Reqovr
          </Link>
          <Link className="nav-pill" href="/start">
            Run an audit
          </Link>
        </nav>

        <section className="hero">
          <span className="eyebrow">3PL invoice intelligence</span>
          <h1>Find the charges your warehouse should not have billed.</h1>
          <p>
            Reqovr reconciles fulfillment invoices against your contract and
            rate card, surfaces evidence-backed discrepancies, and gives your
            team a clean record to review before disputing anything.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/start">
              Start with your documents →
            </Link>
            <a className="button" href="#pricing">
              See pricing
            </a>
          </div>
        </section>

        <section className="proof-strip" aria-label="How Reqovr works">
          <div className="proof-item">
            <strong>1. Upload</strong>
            <span>Your contract or rate card plus recent 3PL invoices.</span>
          </div>
          <div className="proof-item">
            <strong>2. Reconcile</strong>
            <span>Terms and invoice lines are compared against each other.</span>
          </div>
          <div className="proof-item">
            <strong>3. Prove</strong>
            <span>Every finding stays tied to source evidence for review.</span>
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="section-heading">
            <span className="eyebrow">Validation pricing</span>
            <h2>Pay for a result you can inspect.</h2>
            <p>
              No percentage-of-recovery surprise. Start with a focused audit,
              then keep monitoring only if the economics make sense.
            </p>
          </div>

          <div className="pricing-grid">
            {[audit, monitor].map((offer) => (
              <article
                className={`card ${
                  offer.id === "continuous_monitor" ? "highlight" : ""
                }`}
                key={offer.id}
              >
                <span className="eyebrow">{offer.eyebrow}</span>
                <h3>{offer.name}</h3>
                <div className="price">
                  <strong>{offer.priceLabel}</strong>
                  <span>{offer.cadence}</span>
                </div>
                <p>{offer.description}</p>
                <ul>
                  {offer.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <Link
                  className="button primary"
                  href={`/start?offer=${offer.id}`}
                >
                  Choose {offer.name}
                </Link>
              </article>
            ))}
          </div>
        </section>

        <footer className="footer">
          Reqovr identifies potential billing discrepancies from the documents
          supplied. Findings require review and do not guarantee refunds,
          credits, or recoveries.
        </footer>
      </div>
    </main>
  );
}
