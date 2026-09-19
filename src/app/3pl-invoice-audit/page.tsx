import type { Metadata } from "next";
import Link from "next/link";
import { FunnelPageView, TrackedAnchor } from "@/app/funnel-tracker";
import { OFFERS } from "@/lib/offers";

export const metadata: Metadata = {
  title: "3PL Invoice Audit for Ecommerce | BillGuarded",
  description:
    "Reconcile structured 3PL invoice CSVs against your supplied rate card. Find duplicate charges, unsupported fees, line-math errors, and billed-rate mismatches with evidence linked to source rows.",
  alternates: { canonical: "/3pl-invoice-audit" },
  openGraph: {
    type: "website",
    url: "/3pl-invoice-audit",
    title: "3PL Invoice Audit for Ecommerce | BillGuarded",
    description:
      "A fixed-fee, evidence-backed 3PL billing audit. No percentage-of-recovery fee and no inflated recovery promise.",
  },
  twitter: {
    card: "summary",
    title: "3PL Invoice Audit for Ecommerce | BillGuarded",
    description:
      "Check structured 3PL invoices against your rate card before disputing anything.",
  },
};

const serviceSchema = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "BillGuarded 3PL Invoice Audit",
  description:
    "Deterministic reconciliation of supported structured 3PL invoice CSVs against a customer-supplied rate card, with evidence-linked potential discrepancies for operational review.",
  provider: {
    "@type": "Organization",
    name: "BillGuarded",
    url: "https://billguarded.com",
  },
  areaServed: "US",
  offers: [
    {
      "@type": "Offer",
      name: "Evidence Check",
      price: "299.00",
      priceCurrency: "USD",
      url: "https://billguarded.com/start?offer=evidence_check",
      availability: "https://schema.org/InStock",
    },
    {
      "@type": "Offer",
      name: "Full 90-Day Audit",
      price: "1500.00",
      priceCurrency: "USD",
      url: "https://billguarded.com/start?offer=audit_90_day",
      availability: "https://schema.org/InStock",
    },
  ],
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What does BillGuarded check in a 3PL invoice audit?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "BillGuarded checks supported structured invoice data for duplicate charges, unsupported service or fee codes, line arithmetic mismatches, and billed unit-rate mismatches against the supplied commercial rate card.",
      },
    },
    {
      "@type": "Question",
      name: "Does BillGuarded take a percentage of recovered money?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. The $299 Evidence Check and the $1,500 Full 90-Day Audit are fixed one-time purchases. The $299 Evidence Check is credited toward a Full 90-Day Audit purchased within 14 days. Findings require review and BillGuarded does not guarantee refunds, credits, or recoveries.",
      },
    },
    {
      "@type": "Question",
      name: "What files are supported?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The $299 Evidence Check accepts one USD-denominated CSV rate card plus exactly one USD-denominated CSV invoice. The Full 90-Day Audit accepts one rate card plus up to 10 invoice CSVs, subject to file-count and size limits.",
      },
    },
  ],
};

export default function ThreePlInvoiceAuditPage() {
  const evidenceCheck = OFFERS.evidence_check;
  const audit = OFFERS.audit_90_day;

  return (
    <main>
      <FunnelPageView eventName="landing_view" path="/3pl-invoice-audit" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(serviceSchema).replace(/</g, "\\u003c"),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqSchema).replace(/</g, "\\u003c"),
        }}
      />

      <div className="shell">
        <nav className="nav">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true" />
            BillGuarded
          </Link>
          <Link className="nav-pill" href="/start?offer=evidence_check">
            Start with one invoice
          </Link>
        </nav>

        <section className="hero">
          <span className="eyebrow">3PL invoice audit · Ecommerce operations</span>
          <h1>Check what your 3PL billed against what your rate card actually says.</h1>
          <p>
            BillGuarded reconciles supported structured fulfillment invoices
            against the commercial terms you supply, then returns
            evidence-linked discrepancies your team can inspect before asking a
            warehouse for a credit or adjustment.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/start?offer=evidence_check">
              Start the {evidenceCheck.priceLabel} Evidence Check →
            </Link>
            <Link className="button" href="/start?offer=audit_90_day">
              Run the {audit.priceLabel} Full Audit
            </Link>
            <Link className="button" href="/demo">
              Inspect a synthetic audit
            </Link>
            <TrackedAnchor
              className="button"
              href="mailto:everton@billguarded.com?subject=BillGuarded%20audit%20question"
              eventName="fit_check_click"
              path="/3pl-invoice-audit"
            >
              Ask a question
            </TrackedAnchor>
          </div>
        </section>

        <section className="proof-strip" aria-label="BillGuarded audit scope">
          <div className="proof-item">
            <strong>$299 entry audit</strong>
            <span>One rate card plus one invoice, with the $299 credited toward the Full Audit within 14 days.</span>
          </div>
          <div className="proof-item">
            <strong>No recovery percentage</strong>
            <span>BillGuarded does not take a percentage of any credit you later recover.</span>
          </div>
          <div className="proof-item">
            <strong>Evidence before claims</strong>
            <span>Every potential discrepancy stays tied to the supplied source data for review.</span>
          </div>
        </section>

        <section className="section">
          <div className="section-heading">
            <span className="eyebrow">What the audit checks</span>
            <h2>Start with the contract. Then test the invoice line by line.</h2>
            <p>
              The current production engine is deliberately bounded. It checks
              what it can prove from the structured rate card and invoice data
              you supply instead of inventing recovery amounts from missing
              operational context.
            </p>
          </div>

          <div className="pricing-grid">
            <article className="card compact-card">
              <span className="eyebrow">01</span>
              <h3>Duplicate charges</h3>
              <p>
                Detect repeated charges, including duplicates repeated across
                separate invoice CSVs in the audit set.
              </p>
            </article>
            <article className="card compact-card">
              <span className="eyebrow">02</span>
              <h3>Unsupported fees</h3>
              <p>
                Flag service or fee codes that are not supported by the
                supplied commercial rate card.
              </p>
            </article>
            <article className="card compact-card">
              <span className="eyebrow">03</span>
              <h3>Line math</h3>
              <p>
                Recalculate supported line arithmetic instead of trusting the
                billed extension at face value.
              </p>
            </article>
            <article className="card compact-card">
              <span className="eyebrow">04</span>
              <h3>Billed rates</h3>
              <p>
                Compare billed unit rates with the rates supplied for the same
                supported service or fee code.
              </p>
            </article>
          </div>
        </section>

        <section className="section" id="fit">
          <div className="section-heading">
            <span className="eyebrow">Production fit</span>
            <h2>Know the boundary before you pay.</h2>
            <p>
              BillGuarded fails closed before checkout when the current audit
              format is not supported. That keeps the production promise aligned
              with what the engine can actually process today.
            </p>
          </div>

          <div className="pricing-grid">
            <article className="card">
              <span className="eyebrow">Supported now</span>
              <h3>Structured USD CSV audit</h3>
              <ul>
                <li>One USD-denominated CSV rate card</li>
                <li>Exactly one invoice for the Evidence Check</li>
                <li>Up to 10 invoice CSVs for the Full 90-Day Audit</li>
                <li>Up to 90 days of supported billing data</li>
                <li>50 MB combined upload cap</li>
                <li>20 MB maximum per file</li>
              </ul>
              <Link className="button primary" href="/start?offer=evidence_check">
                Start with one invoice
              </Link>
            </article>

            <article className="card highlight">
              <span className="eyebrow">What you receive</span>
              <h3>An inspectable discrepancy record</h3>
              <ul>
                <li>Evidence-linked potential discrepancies</li>
                <li>Conservative potential-recovery aggregation</li>
                <li>No double counting of multiple findings on one source row</li>
                <li>Downloadable findings report</li>
                <li>Private customer report access</li>
              </ul>
              <Link className="button" href="/demo">
                See the synthetic demo
              </Link>
            </article>
          </div>
        </section>

        <section className="section">
          <div className="section-heading">
            <span className="eyebrow">Why this pricing model</span>
            <h2>Pay for the audit. Keep the recovery decision in your hands.</h2>
            <p>
              BillGuarded charges fixed one-time prices for the Evidence Check
              and Full 90-Day Audit. It does not turn every unusual charge into
              an accusation, does not promise a refund, and does not take a share
              of a later recovery.
            </p>
          </div>

          <div className="proof-strip" aria-label="BillGuarded pricing principles">
            <div className="proof-item">
              <strong>{evidenceCheck.priceLabel} to start</strong>
              <span>Credited toward the {audit.priceLabel} Full Audit if purchased within 14 days.</span>
            </div>
            <div className="proof-item">
              <strong>Review required</strong>
              <span>Operational context can explain a flagged line.</span>
            </div>
            <div className="proof-item">
              <strong>No recovery guarantee</strong>
              <span>Evidence supports a decision; it does not manufacture one.</span>
            </div>
          </div>
        </section>

        <section className="section" id="faq">
          <div className="section-heading">
            <span className="eyebrow">Before you start</span>
            <h2>Three questions that determine whether BillGuarded fits.</h2>
          </div>

          <div className="pricing-grid">
            <article className="card compact-card">
              <h3>What kinds of billing errors does it find?</h3>
              <p>
                The production checks cover duplicate charges, unsupported fee
                codes, line arithmetic mismatches, and billed unit-rate
                mismatches against the supplied rate card.
              </p>
            </article>
            <article className="card compact-card">
              <h3>Does BillGuarded handle the dispute?</h3>
              <p>
                No. BillGuarded produces evidence-linked review findings. Your
                team decides what to dispute and how to handle the 3PL
                relationship.
              </p>
            </article>
            <article className="card compact-card">
              <h3>Can I pay for continuous monitoring?</h3>
              <p>
                Not yet. Paid monitoring remains disabled until recurring
                ingestion and retention are production-ready. The $299 Evidence
                Check and $1,500 Full 90-Day Audit are the current live offers.
              </p>
            </article>
          </div>
        </section>

        <section className="section">
          <div className="card highlight">
            <span className="eyebrow">Start with one invoice</span>
            <h2>Buy a bounded check before committing to the full 90-day scope.</h2>
            <p>
              The $299 Evidence Check uses the same deterministic billing checks
              on one supported invoice. Upgrade within 14 days and the $299 is
              credited automatically toward the Full 90-Day Audit.
            </p>
            <div className="hero-actions">
              <Link className="button primary" href="/start?offer=evidence_check">
                Start the {evidenceCheck.priceLabel} Evidence Check →
              </Link>
              <Link className="button" href="/start?offer=audit_90_day">
                Go straight to the Full Audit
              </Link>
            </div>
          </div>
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
