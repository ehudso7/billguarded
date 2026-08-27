# BillGuarded paid-audit reliability certification

This document records the final reliability gate added after the August 2026 production audit.

## Required behavior

- Both the signed Stripe webhook and the post-Checkout return path may request audit execution without creating duplicate active workers.
- A transient audit-engine failure is retried on a bounded schedule.
- A retry does not count a still-running worker as a successful terminal outcome.
- A paid request with an orphaned processing run can be recovered after a short grace period.
- A normally processing request is not reclaimed until the longer stale-worker threshold is reached.
- Stale-worker recovery uses a compare-and-update guard so a concurrently completed run is never overwritten.
- Findings attached to a failed attempt are removed before a fresh attempt is created.
- Complete and needs-review runs remain terminal and are never rerun automatically.

## Automated gates

The CI workflow must pass:

1. Locked dependency installation.
2. Production dependency audit.
3. TypeScript checking.
4. ESLint.
5. Unit tests, including retry scheduling and stale-worker thresholds.
6. Optimized Next.js production build.

## Production certification

After merge, verify:

1. GitHub Actions succeeds on the merge commit.
2. Vercel reports the production deployment ready.
3. `/api/health` reports the application and database ready.
4. Vercel shows no new production runtime error cluster.
5. Supabase has no errored Stripe event and no paid audit stranded in processing.
6. A controlled sandbox payment still reaches the expected audit result without a second charge.
