import type { Metadata } from "next";
import Link from "next/link";
import {
  DEMO_FINDINGS,
  DEMO_INVOICE,
  DEMO_QUANTIFIED_POTENTIAL_CENTS,
  DEMO_RATE_CARD,
  DEMO_TOTAL_BILLED_CENTS,
  DEMO_UNPRICED_FINDINGS,
  formatDemoMoney,
} from "@/lib/demo-audit";
import styles from "./demo.module.css";

export const metadata: Metadata = {
  title: "Synthetic 3PL invoice audit demo | BillGuarded",
  description:
    "See a synthetic BillGuarded walkthrough of rate-card matching, duplicate charges, unsupported fees, arithmetic mismatches, and rate mismatches.",
};

const findingTone = {
  duplicate_charge: styles.duplicate,
  unsupported_fee: styles.unsupported,
  arithmetic_mismatch: styles.arithmetic,
  rate_mismatch: styles.rate,
} as const;

const findingRows = new Set(DEMO_FINDINGS.map((finding) => finding.sourceRow));

export default function DemoPage() {
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

        <section className={styles.hero}>
          <div>
            <span className="eyebrow">Synthetic walkthrough · no customer data</span>
            <h1>See exactly what BillGuarded flags — and what it leaves alone.</h1>
            <p>
              This example uses a fictional rate card and invoice to show the
              same four discrepancy classes the production audit engine checks:
              duplicate charges, unsupported fees, line math, and billed rates.
            </p>
          </div>

          <aside className={styles.summaryCard} aria-label="Synthetic audit summary">
            <span className={styles.summaryLabel}>Illustrative invoice</span>
            <strong>{formatDemoMoney(DEMO_TOTAL_BILLED_CENTS)}</strong>
            <div className={styles.summaryDivider} />
            <span className={styles.summaryLabel}>Quantified discrepancy</span>
            <strong className={styles.recovery}>
              {formatDemoMoney(DEMO_QUANTIFIED_POTENTIAL_CENTS)}
            </strong>
            <small>
              Plus {DEMO_UNPRICED_FINDINGS} unsupported fee held for human review,
              not counted as recovery.
            </small>
          </aside>
        </section>

        <section className={styles.notice}>
          <strong>What this demo is — and is not.</strong>
          <p>
            Every company, reference, rate, and charge below is synthetic. This is
            not a finding about SMLXL, ShipBob, or any real merchant or 3PL. A
            BillGuarded finding is evidence for review, not an accusation, and a
            potential discrepancy is not a guaranteed refund or credit.
          </p>
        </section>

        <section className={styles.flow} aria-label="Audit workflow">
          <article>
            <span>01</span>
            <h2>Rate card</h2>
            <p>Normalize the agreed service codes and rates supplied by the customer.</p>
          </article>
          <article>
            <span>02</span>
            <h2>Invoice</h2>
            <p>Read each structured line without hiding the source row behind a score.</p>
          </article>
          <article>
            <span>03</span>
            <h2>Evidence</h2>
            <p>Explain the mismatch, expected amount, and exact row that needs review.</p>
          </article>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <span className="eyebrow">Input A</span>
            <h2>Sample contractual rate card</h2>
            <p>
              Only the supplied commercial terms are treated as the comparison baseline.
            </p>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>CSV row</th>
                  <th>Service</th>
                  <th>Description</th>
                  <th>Agreed rate</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_RATE_CARD.map((row) => (
                  <tr key={row.serviceCode}>
                    <td>{row.row}</td>
                    <td><code>{row.serviceCode}</code></td>
                    <td>{row.label}</td>
                    <td>{formatDemoMoney(row.rateCents)}</td>
                    <td>{row.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <span className="eyebrow">Input B</span>
            <h2>Sample fulfillment invoice</h2>
            <p>
              Rows with a detected exception are highlighted. Clean lines remain clean.
            </p>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>CSV row</th>
                  <th>Reference</th>
                  <th>Service</th>
                  <th>Qty</th>
                  <th>Unit rate</th>
                  <th>Line total</th>
                  <th>Audit</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_INVOICE.map((row) => {
                  const flagged = findingRows.has(row.row);
                  return (
                    <tr className={flagged ? styles.flaggedRow : undefined} key={row.row}>
                      <td>{row.row}</td>
                      <td>{row.reference}</td>
                      <td><code>{row.serviceCode}</code></td>
                      <td>{row.quantity}</td>
                      <td>{formatDemoMoney(row.unitRateCents)}</td>
                      <td>{formatDemoMoney(row.amountCents)}</td>
                      <td>
                        <span className={flagged ? styles.reviewPill : styles.passPill}>
                          {flagged ? "Review" : "Matched"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <span className="eyebrow">Output</span>
            <h2>Four findings, each tied to source evidence</h2>
            <p>
              BillGuarded does not collapse everything into one opaque risk score. The
              reviewer can see what happened, where it happened, and what is actually
              quantifiable.
            </p>
          </div>

          <div className={styles.findingGrid}>
            {DEMO_FINDINGS.map((finding) => (
              <article className={styles.findingCard} key={finding.findingType}>
                <div className={styles.findingTopline}>
                  <span className={`${styles.findingBadge} ${findingTone[finding.findingType]}`}>
                    {finding.label}
                  </span>
                  <span>Invoice row {finding.sourceRow}</span>
                </div>
                <h3><code>{finding.serviceCode}</code></h3>
                <p>{finding.description}</p>
                <dl>
                  <div>
                    <dt>Billed</dt>
                    <dd>{formatDemoMoney(finding.billedAmountCents)}</dd>
                  </div>
                  <div>
                    <dt>Expected</dt>
                    <dd>
                      {finding.expectedAmountCents === null
                        ? "Needs contract review"
                        : formatDemoMoney(finding.expectedAmountCents)}
                    </dd>
                  </div>
                  <div>
                    <dt>Quantified</dt>
                    <dd>
                      {finding.potentialRecoveryCents > 0
                        ? formatDemoMoney(finding.potentialRecoveryCents)
                        : "Not counted"}
                    </dd>
                  </div>
                </dl>
                <div className={styles.evidence}>
                  <span>Evidence</span>
                  {finding.evidence}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.controlSection}>
          <div>
            <span className="eyebrow">Why the total stays conservative</span>
            <h2>Unknown is not the same as overbilled.</h2>
          </div>
          <div className={styles.controlList}>
            <p>
              <strong>Unsupported fee:</strong> visible for review, but excluded from the
              quantified total because this sample rate card does not establish an expected amount.
            </p>
            <p>
              <strong>Duplicate protection:</strong> recovery aggregation is source-row aware so
              multiple findings on the same line do not silently inflate the total.
            </p>
            <p>
              <strong>Human decision:</strong> operational context can explain a legitimate charge.
              The evidence package makes that review easier; it does not replace it.
            </p>
          </div>
        </section>

        <section className={styles.cta}>
          <div>
            <span className="eyebrow">Next step</span>
            <h2>Test it on one anonymized invoice.</h2>
            <p>
              One recent USD CSV invoice plus the matching USD CSV rate card is enough for
              a no-cost fit check. No integration is required for the first test.
            </p>
          </div>
          <div className={styles.ctaActions}>
            <a
              className="button primary"
              href="mailto:hello@billguarded.com?subject=Free%20one-invoice%20fit%20check"
            >
              Ask for the free fit check →
            </a>
            <Link className="button" href="/start">
              See the production audit flow
            </Link>
          </div>
        </section>

        <footer className="footer">
          <div>
            Synthetic demonstration only. BillGuarded identifies potential billing
            discrepancies from supplied documents; findings require review and do not
            guarantee refunds, credits, or recoveries.
          </div>
          <div className="footer-links">
            <Link href="/">Home</Link>
            <Link href="/security">Security</Link>
            <a href="mailto:support@billguarded.com">Support</a>
          </div>
        </footer>
      </div>
    </main>
  );
}
