import Link from "next/link";
import { cookies } from "next/headers";
import {
  portalCookieName,
  verifyPortalCookie,
} from "@/lib/security/portal-cookie";

type SuccessPageProps = {
  searchParams: Promise<{ pending?: string }>;
};

export default async function SuccessPage({ searchParams }: SuccessPageProps) {
  const params = await searchParams;
  const pending = params.pending === "1";
  const cookieStore = await cookies();
  const billingAccess = verifyPortalCookie(
    cookieStore.get(portalCookieName)?.value,
  );

  return (
    <main className="center-page">
      <section className="success-card">
        <div className="success-icon" aria-hidden="true">
          {pending ? "…" : "✓"}
        </div>
        <span className="eyebrow">
          {pending ? "Payment processing" : "Payment confirmed"}
        </span>
        <h1>
          {pending
            ? "Stripe is still finalizing your payment."
            : "Your Reqovr workspace is funded."}
        </h1>
        <p className="muted">
          {pending
            ? "Reqovr will not provision paid access until Stripe reports the payment successful. No refund or recovery outcome is assumed while payment is pending."
            : "Stripe confirmed the checkout. The signed webhook is the source of truth for provisioning the audit entitlement and updating the audit request."}
        </p>
        <div className="hero-actions">
          <Link className="button primary" href="/">
            Return home
          </Link>
          {billingAccess ? (
            <form action="/api/billing/portal" method="post">
              <button className="button" type="submit">
                Manage billing
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </main>
  );
}
