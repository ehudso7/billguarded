# BillGuarded

BillGuarded is a self-service 3PL invoice reconciliation product for ecommerce operators. It compares structured fulfillment invoices against customer-supplied commercial terms and produces evidence-linked potential discrepancies for review.

## Production offer

- Full 90-Day Audit — **$1,500 one time**
- Continuous Monitor — **controlled early access; paid subscriptions are disabled until recurring ingestion is production-ready**

The current deterministic engine accepts one CSV contract/rate card plus up to 10 CSV invoices. Checkout fails closed before payment if the supported structured files are not present. The combined upload is capped at 50 MB, with a 20 MB per-file limit.

## Current deterministic checks

- Duplicate charges, including duplicates repeated across separate invoice CSVs
- Unsupported service/fee codes
- Line arithmetic mismatches
- Billed unit-rate mismatches against the supplied rate card
- Conservative potential-recovery aggregation that avoids double counting multiple findings on the same source row

Findings require operational review and do not guarantee refunds, credits, or recoveries.

## Stack

- Next.js 16 / React 19 / Node 22
- Stripe Checkout + Billing
- Supabase Postgres + private Storage + Vault
- Vercel
- Resend
- GitHub Actions

## Production binding

- Canonical site: `https://billguarded.com`
- GitHub: `ehudso7/billguarded`
- Vercel project: `everton-hudsons-projects/billguarded`
- Vercel project ID: `prj_uFLTZhEoI8rkgGtYPKn3K5wRrzuI`
- Supabase project: `rduryyyprvwqzopsvzvr`
- Stripe live account: `acct_1U6prLB5mhEA8v5j`
- Stripe sandbox account: `acct_1U6prVBOw52KUyWD`

Some legacy infrastructure identifiers still contain `reqovr` because BillGuarded was renamed after the initial infrastructure was created. They are compatibility identifiers only and are not customer-facing branding. The runtime webhook-secret RPC is named `billguarded_stripe_webhook_secret()` while reading the existing Vault secret without exposing or rotating it unnecessarily.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add a server-only Stripe sandbox key locally. Never commit it.
3. Ensure the BillGuarded Supabase variables are available locally.
4. Apply the migrations in `supabase/migrations/` in version order.
5. Store the Stripe webhook signing secret in Supabase Vault under the existing compatibility secret name used by production; never commit or log it.
6. Configure the Stripe webhook endpoint as `https://billguarded.com/api/stripe/webhook` and subscribe it to the required Checkout, subscription, and invoice events documented in the webhook handler.
7. Run `npm ci`, then `npm run check` before deployment.

## Security model

### Intake and uploads

- Intake creation is database-rate-limited by a one-way network fingerprint.
- Each new audit workspace receives a random 256-bit access token.
- Only the SHA-256 hash of the workspace token is stored in Postgres.
- Upload reservation, upload confirmation, and Checkout creation require the matching token.
- Uploads use short-lived signed URLs into the private `audit-documents` bucket.
- File count and storage-size limits are enforced server-side and in Postgres.
- Production intake accepts CSV files only so the UI and engine have the same capability boundary.
- Customers must accept the Terms and Privacy Notice and confirm they are authorized to upload the business records.

### Billing

- Production payment state is synchronized from signature-verified Stripe webhook events.
- Webhook event IDs are stored for idempotency.
- Production Checkout and post-payment redirects are pinned to `https://billguarded.com`.
- Continuous Monitor Checkout is rejected until the recurring product is production-ready.
- Only the Full 90-Day Audit product and its canonical $1,500 Price remain active in the live Stripe catalog.

### Data access

- Audit, finding, billing, and Stripe-event tables have RLS enabled.
- `anon` and `authenticated` do not have direct table privileges in the server-only model.
- Customer documents remain in a non-public Storage bucket.

## Reliability and CI

CI runs on pull requests and pushes to `main` and includes:

- locked dependency install
- production dependency vulnerability audit
- TypeScript typecheck
- ESLint
- Node 22 unit tests for CSV parsing, conservative recovery math, retry scheduling, and stale-worker recovery
- production Next.js build

Paid audit execution uses bounded retries and verifies that the request reaches a safe terminal state. A stale processing worker is recovered with a compare-and-update guard so a concurrently completed run cannot be overwritten. Partial findings from a failed attempt are removed before a fresh attempt begins.

The `/api/health` endpoint verifies that the production application can reach the database and returns `503` when that dependency is unavailable.

The `Production Smoke` workflow runs after each `main` deployment and daily. It verifies:

- application and database health
- public pages, legal pages, robots, and sitemap
- security headers
- fail-closed behavior for unsigned webhooks and malformed intake/Checkout requests

## Customer-facing trust pages

- `/privacy`
- `/terms`
- `/security`

Security reports and customer support: `support@billguarded.com`.
