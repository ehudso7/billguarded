begin;

create index if not exists audit_work_items_payment_event_idx
  on public.audit_work_items (payment_event_id);

create index if not exists audit_work_items_active_run_idx
  on public.audit_work_items (active_run_id)
  where active_run_id is not null;

create index if not exists audit_deliveries_run_idx
  on public.audit_deliveries (audit_run_id);

create or replace function public.billguarded_claim_delivery(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns table (
  delivery_id uuid,
  audit_request_id uuid,
  audit_run_id uuid,
  claim_token uuid,
  recipient_email text,
  checkout_session_id text,
  delivery_fingerprint text,
  template_version text,
  subject text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.audit_deliveries%rowtype;
  v_claim_token uuid;
  v_session_id text;
begin
  if p_worker_id is null or char_length(p_worker_id) not between 8 and 120
    or p_lease_seconds not between 60 and 900
  then
    raise exception using errcode = '22023', message = 'delivery claim parameters invalid';
  end if;

  update public.audit_deliveries d
     set status = case when d.status = 'sending' then 'acceptance_uncertain' else 'retryable' end,
         claim_token = null, claimed_by = null, claimed_at = null,
         lease_expires_at = null,
         next_attempt_at = case when d.status = 'claimed' then pg_catalog.now() else d.next_attempt_at end,
         last_error_code = case when d.status = 'sending' then 'provider_acceptance_uncertain' else 'stale_presend_claim' end,
         last_error_message = case when d.status = 'sending'
           then 'Provider request began but its acceptance was not durably recorded; manual reconciliation is required.'
           else 'Delivery claim expired before any provider request began.' end,
         updated_at = pg_catalog.now()
   where d.status in ('claimed', 'sending') and d.lease_expires_at <= pg_catalog.now();

  insert into public.audit_deliveries (
    audit_request_id, audit_run_id, recipient_email,
    recovery_session_hash, delivery_fingerprint
  )
  select ar.id,
         r.id,
         pg_catalog.lower(pg_catalog.btrim(ar.email)),
         pg_catalog.encode(extensions.digest(ar.stripe_checkout_session_id, 'sha256'), 'hex'),
         pg_catalog.encode(extensions.digest(
           'billguarded|' || ar.id::text || '|' || r.id::text || '|audit_complete|' ||
           pg_catalog.lower(pg_catalog.btrim(ar.email)) || '|' || ar.stripe_checkout_session_id || '|audit-complete-v1',
           'sha256'
         ), 'hex')
    from public.audit_work_items wi
    join public.audit_requests ar on ar.id = wi.audit_request_id
    join public.audit_runs r on r.id = wi.active_run_id
    join public.billing_customers bc on bc.stripe_customer_id = ar.stripe_customer_id
    join public.billing_entitlements be
      on be.stripe_customer_id = ar.stripe_customer_id
     and be.offer = 'audit_90_day'
     and be.stripe_checkout_session_id = ar.stripe_checkout_session_id
   where wi.status = 'complete'
     and ar.status = 'complete'
     and ar.selected_offer = 'audit_90_day'
     and ar.paid_at is not null
     and ar.stripe_checkout_session_id = wi.payment_checkout_session_id
     and ar.stripe_checkout_session_id like 'cs_live\_%' escape '\'
     and ar.stripe_customer_id like 'cus\_%' escape '\'
     and r.status = 'complete'
     and bc.email is not null
     and pg_catalog.lower(pg_catalog.btrim(bc.email)) = pg_catalog.lower(pg_catalog.btrim(ar.email))
     and be.status = 'active'
  on conflict on constraint audit_deliveries_audit_request_id_delivery_type_key
  do nothing;

  select d.* into v_delivery
    from public.audit_deliveries d
    join public.audit_requests ar on ar.id = d.audit_request_id
    join public.audit_runs r on r.id = d.audit_run_id
    join public.audit_work_items wi on wi.audit_request_id = ar.id
   where d.status in ('pending', 'retryable')
     and d.next_attempt_at <= pg_catalog.now()
     and d.attempt_count < d.max_attempts
     and ar.status = 'complete' and ar.selected_offer = 'audit_90_day'
     and ar.paid_at is not null and ar.stripe_checkout_session_id like 'cs_live\_%' escape '\'
     and r.status = 'complete' and wi.status = 'complete'
     and wi.active_run_id = r.id
     and wi.payment_checkout_session_id = ar.stripe_checkout_session_id
   order by d.next_attempt_at, d.created_at
   for update of d skip locked
   limit 1;

  if not found then
    return;
  end if;

  v_claim_token := gen_random_uuid();
  select ar.stripe_checkout_session_id into v_session_id
    from public.audit_requests ar where ar.id = v_delivery.audit_request_id;

  update public.audit_deliveries d
     set status = 'claimed', attempt_count = d.attempt_count + 1,
         claim_token = v_claim_token, claimed_by = p_worker_id,
         claimed_at = pg_catalog.now(),
         lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
         last_error_code = null, last_error_message = null,
         updated_at = pg_catalog.now()
   where d.id = v_delivery.id;

  return query select v_delivery.id, v_delivery.audit_request_id,
    v_delivery.audit_run_id, v_claim_token, v_delivery.recipient_email,
    v_session_id, v_delivery.delivery_fingerprint,
    v_delivery.template_version, v_delivery.subject;
end;
$$;

revoke all on function public.billguarded_claim_delivery(text, integer)
  from public, anon, authenticated;
grant execute on function public.billguarded_claim_delivery(text, integer)
  to service_role;

commit;
