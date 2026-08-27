# Security

BillGuarded handles commercially sensitive contracts, rate cards, invoices, audit findings, and billing metadata.

## Core controls

- Never commit Stripe secret keys, Supabase secret/service-role keys, webhook secrets, or signing secrets.
- Store all audit documents in the private `audit-documents` bucket.
- Browser code may receive only the Supabase publishable key, a per-workspace high-entropy access token, and short-lived signed upload tokens.
- Store only the SHA-256 hash of each intake workspace access token in Postgres.
- Require the matching workspace token before pre-payment upload reservation, upload confirmation, or Checkout creation.
- Stripe webhook events must pass signature verification before production payment state is provisioned.
- Record Stripe event IDs for idempotent webhook processing.
- Tables in the exposed `public` schema have RLS enabled and no direct `anon` or `authenticated` table grants in the server-only model.
- Intake creation is database-rate-limited.
- Production Checkout, completion, and future billing return origins are pinned to `https://billguarded.com`.
- Rotate any secret immediately if it is pasted into chat, an issue, a commit, a build log, or another non-secret channel.

## Reporting vulnerabilities

Report suspected security issues privately to `support@billguarded.com` with the subject `Security report`. Do not include customer documents, API keys, webhook secrets, or other sensitive payloads in the initial report.
