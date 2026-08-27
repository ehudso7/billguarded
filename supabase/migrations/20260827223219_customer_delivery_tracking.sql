begin;

alter table public.audit_requests
  add column if not exists customer_delivery_notified_at timestamptz,
  add column if not exists customer_delivery_last_error text;

create index if not exists audit_requests_delivery_pending_idx
  on public.audit_requests (created_at)
  where status = 'complete'
    and paid_at is not null
    and customer_delivery_notified_at is null;

commit;
