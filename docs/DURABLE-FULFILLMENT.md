# BillGuarded durable fulfillment runbook

## Scope

This runbook covers the paid Full 90-Day Audit only. Continuous Monitor remains
early access and is ineligible for the worker. The database is the durable
source of truth; Stripe, audit execution, and customer delivery are separate
lifecycle stages.

## Canonical state

### Audit request

The existing request states remain unchanged:

- `intake`
- `checkout_started`
- `paid`
- `processing`
- `complete`
- `cancelled`

A request does not use a separate `failed` state. Retry and terminal failure
live on the work item and the immutable attempt history in `audit_runs`.

### Paid work

`audit_work_items.status` is one of:

- `queued`: a signed live Stripe event durably created the work.
- `claimed`: one worker owns a time-bounded lease and an `audit_runs` attempt.
- `retryable`: a transient attempt failed and is waiting for its database backoff.
- `complete`: the deterministic run and request completed transactionally.
- `permanently_failed`: input review is required or five attempts were exhausted.

Claims use `FOR UPDATE ... SKIP LOCKED`, a unique row per audit request, a
unique claim token, and a lease. Attempts back off at 1, 5, 15, 60, and 240
minutes. A stale claim removes its partial findings, closes its run, restores
the request to `paid`, and becomes retryable or terminal.

### Customer delivery

No delivery row exists until a paid live 90-Day Audit has completed and its
request, work item, run, customer, entitlement, recipient, and Checkout
identifiers agree.

`audit_deliveries.status` is one of:

- `pending`
- `claimed` (pre-send and safely recoverable)
- `sending` (provider request has begun)
- `retryable` (provider definitively rejected a transient request)
- `acceptance_uncertain` (never automatically retried)
- `accepted`
- `sent`
- `delivered`
- `bounced`
- `failed`
- `suppressed`
- `complained`

A deterministic SHA-256 fingerprint binds the BillGuarded project, audit
request, completed run, normalized recipient, delivery type, live Checkout
Session, and template version. It is both database-unique and the basis of the
Resend idempotency key.

## Transaction boundaries

1. The signed Stripe handler first registers the Stripe event.
2. `billguarded_record_paid_audit` verifies that registered event, locks the
   request, validates the exact live audit/session/files/terms, records paid
   state, and inserts one work item in one transaction.
3. Only after that succeeds may the Stripe event be marked processed.
4. `billguarded_claim_audit_work` atomically recovers stale work, claims one
   eligible row, creates its numbered run, and marks the request processing.
5. The engine inserts only findings for that claimed run.
6. Completion atomically closes the run, request, and work item. Failure
   atomically removes partial findings, closes the run, and schedules or
   terminalizes the work.
7. Delivery is independently materialized and claimed by Postgres.
8. `billguarded_begin_delivery_send` changes a pre-send claim to `sending`
   immediately before the Resend call.
9. A Resend message ID is persisted as accepted before the delivery can become
   sent/delivered through signed lifecycle events.

## Operator query

Use the service role only:

```sql
select *
from public.billguarded_fulfillment_operations
where incident is not null
order by coalesce(processing_updated_at, delivery_updated_at, audit_updated_at);
```

The view contains internal IDs and lifecycle metadata, but no customer email,
company name, invoice data, rate-card data, findings, access token, or recovery
credential.

Investigate these incidents immediately:

- `paid_without_work_item`
- `processing_terminal_failure`
- `complete_without_delivery`
- `delivery_acceptance_uncertain`
- `delivery_attention_required`

The cron endpoint also returns HTTP 503 and emits one structured server error
when terminal/manual attention exists.

## Provider acceptance uncertainty

Never resend “to make sure.”

If a delivery is `acceptance_uncertain`:

1. Stop delivery writes for that row.
2. Use its delivery fingerprint to inspect the Resend request log and its
   deterministic `Idempotency-Key`.
3. If a provider message ID exists, retrieve that message in Resend and verify
   the exact sender, recipient, subject, and timestamp.
4. After that read-only reconciliation, bind the known message ID with
   `billguarded_reconcile_delivery_accepted`.
5. Replay the signed Resend lifecycle event if its original event arrived
   before the provider message ID was persisted.
6. If provider evidence proves no request was accepted, an operator may move
   the row to `retryable` only after documenting that evidence.

Resend idempotency lasts 24 hours. BillGuarded does not use that window as a
reason to retry an uncertain request; uncertainty remains quarantined until a
provider read resolves it.

## Safe rollout and rollback

1. Apply the additive database migration.
2. Verify RLS, grants, function execution grants, advisor results, and zero
   unintended eligible rows.
3. Configure the server-only `CRON_SECRET`, restricted
   `RESEND_API_KEY`, and BillGuarded webhook signing secret.
4. Create the BillGuarded Resend webhook for the six required lifecycle events.
5. Deploy the application through protected main.
6. Verify unauthenticated worker and unsigned webhooks fail closed.
7. Invoke one authenticated sweep only after confirming no unexpected live
   audit is eligible.

The old application ignores the additive tables and columns. The new
application fails closed if secrets or RPCs are unavailable. Rolling back the
application leaves durable rows intact; do not drop the migration during an
incident.
