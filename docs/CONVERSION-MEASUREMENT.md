# BillGuarded conversion measurement

## Scope

BillGuarded uses its existing Supabase project as a first-party funnel ledger.
There was no isolated BillGuarded PostHog project at implementation time, and
sharing another portfolio product's project would have mixed data. No new
analytics vendor, browser replay, advertising pixel, or tracking dependency is
used.

## Privacy contract

Allowed attribution is limited to these normalized channels:

- `direct`
- `organic`
- `referral`
- `relationship_outreach`
- `approved_campaign`
- `demo`
- `unknown`

Only the common `utm_source`, `utm_medium`, and `utm_campaign` parameters are
considered. Source and medium values are allowlisted. Campaign values must use
a `billguarded-` or `bg-` prefix. Everything else is discarded.

The ledger must never receive invoice or rate-card contents, filenames, CSV
rows, email addresses, company fields, Checkout Session IDs, Stripe customer
IDs, recovery credentials, full URLs, query strings, URL fragments, or browser
replay data. A random browser UUID is hashed before storage; its raw value is
never persisted by the server.

## Event ownership

| Event | Authority |
| --- | --- |
| `landing_view`, `demo_view`, `fit_check_click`, `intake_started` | Same-origin browser event |
| `intake_completed` | Successful audit-request insert |
| `rate_card_uploaded`, `invoice_upload_completed` | Verified private-storage confirmation |
| `checkout_started` | Persisted Stripe Checkout Session on the audit request |
| `paid_audit_confirmed`, `paid_audit_queued` | Signed live Stripe webhook plus durable paid-work insert |
| `audit_completed`, `audit_failed` | Durable audit worker result |
| `customer_notified`, `delivery_failed` | Durable delivery result after provider acceptance/failure |
| `report_recovery_opened` | Successful server-side recovery verification |

The browser never claims payment, audit completion, delivery, or report access.

## Failure visibility

The ledger records generic, non-sensitive failure stages for unsupported files,
upload failure, Checkout creation failure, audit failure, and delivery failure.
The `billguarded_funnel_daily` view derives intake abandonment when an
`intake_started` event is at least 30 minutes old and has no later
`intake_completed` event for the same hashed browser identifier.

Use the server-only view:

```sql
select *
from public.billguarded_funnel_daily
order by day desc, source_channel;
```

Do not expose this view or the underlying tables to browser roles.

## First genuine customer certification

The existing BillGuarded Revenue & Delivery lane owns observation. Do not add a
second monitor and do not manufacture a live payment or customer email.

For the first genuine $1,500 purchase, capture these provider-backed facts:

1. Stripe Checkout is live, complete, paid, USD, and exactly 150,000 cents.
2. The signed Stripe event is processed once and creates one durable work item.
3. Attempt and lease history is visible through the processing lifecycle.
4. The deterministic run completes with its source-document and finding counts.
5. One eligible delivery is atomically claimed for the completed run.
6. Resend returns one accepted provider message ID for the delivery fingerprint.
7. An authenticated Resend lifecycle event persists idempotently.
8. Customer report recovery is recorded only after verified private recovery,
   without inspecting or logging the bearer credential.

Revenue is not proven by a page view, Checkout start, test event, expired
session, provider acceptance alone, or synthetic audit.
