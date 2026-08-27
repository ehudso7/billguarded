import type { Metadata } from "next";
import Link from "next/link";
import RecoveryClient from "./recovery-client";

export const metadata: Metadata = {
  title: "Recover audit access — BillGuarded",
  description: "Private BillGuarded audit access recovery.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function RecoverPage() {
  return (
    <main className="center-page">
      <section className="success-card">
        <span className="eyebrow">Private audit access</span>
        <h1>Recovering your BillGuarded report.</h1>
        <RecoveryClient />
        <div className="hero-actions">
          <Link className="button" href="/">
            Return home
          </Link>
        </div>
      </section>
    </main>
  );
}
