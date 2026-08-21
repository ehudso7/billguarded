import Link from "next/link";
import { cookies } from "next/headers";
import {
  portalCookieName,
  verifyPortalCookie,
} from "@/lib/security/portal-cookie";

export default async function SuccessPage() {
  const cookieStore = await cookies();
  const billingAccess = verifyPortalCookie(
    cookieStore.get(portalCookieName)?.value,
  );

  return (
    <main className="center-page">
      <section className="success-card">
        <div className="success-icon" aria-hidden="true">
          ✓
        </div>
        <span className="eyebrow">Payment confirmed</span>
        <h1>Your Reqovr workspace is funded.</h1>
        <p className="muted">
          Stripe confirmed the checkout. The signed webhook is the source of
          truth for provisioning the audit entitlement and updating the audit
          request.
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
