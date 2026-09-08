# BillGuarded paid-audit reliability certification

This document records the final reliability gate added after the August 2026 production audit.

## Required behavior

- Only a signed live Stripe event can durably record paid audit work. The browser return path cannot schedule production processing.
- Vercel Cron invokes the protected sweeper independently of the original Stripe request.
- Postgres claims one eligible audit with `FOR UPDATE SKIP LOCKED`, a unique claim token, and a bounded lease.
- Five durable attempts use database backoff. Stale claims are recovered without another Stripe event or customer action.
- Findings attached to an interrupted or failed attempt are removed before a fresh attempt is created.
- Request, run, and work-item completion is one database transaction.
- Customer delivery has a separate atomic claim and deterministic fingerprint.
- A stale pre-send claim may retry; a provider request with an uncertain outcome is quarantined and can never auto-resend.
- Signed Resend sent, delivered, bounced, failed, suppressed, and complained events are stored idempotently.

## Automated gates

The CI workflow must pass:

1. Locked dependency installation.
2. Production dependency audit.
3. TypeScript checking.
4. ESLint.
5. Unit and governance tests for deterministic reconciliation, worker authorization, payment durability, atomic-claim SQL, delivery content, provider idempotency, and uncertainty quarantine.
6. Optimized Next.js production build.

## Production certification

After merge, verify:

1. GitHub Actions succeeds on the merge commit.
2. Vercel reports the production deployment ready.
3. `/api/health` reports the application and database ready.
4. Vercel shows no new production runtime error cluster.
5. Supabase has no errored Stripe event, no unexpected live work selection, and no fulfillment incident.
6. The protected worker rejects an unauthenticated request and the Resend endpoint rejects an unsigned request.
7. No production customer is used as a test fixture. The first genuine paid audit remains the first live-money end-to-end proof.

See [the durable fulfillment runbook](./DURABLE-FULFILLMENT.md) for the exact state machines, retry schedule, escalation query, provider-reconciliation procedure, and rollout order.
