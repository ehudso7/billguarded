begin;

alter table public.audit_requests
  drop constraint if exists audit_requests_selected_offer_check;
alter table public.audit_requests
  add constraint audit_requests_selected_offer_check
  check (
    selected_offer is null
    or selected_offer in ('evidence_check', 'audit_90_day', 'continuous_monitor')
  );

alter table public.billing_entitlements
  drop constraint if exists billing_entitlements_offer_check;
alter table public.billing_entitlements
  add constraint billing_entitlements_offer_check
  check (offer in ('evidence_check', 'audit_90_day', 'continuous_monitor'));

alter table public.audit_deliveries
  alter column subject set default 'Your BillGuarded audit is complete';

create or replace function public.billguarded_record_paid_audit(
  p_event_id text,
  p_request_id uuid,
  p_checkout_session_id text,
  p_customer_id text,
  p_offer text,
  p_livemode boolean,
  p_paid_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.audit_requests%rowtype;
  v_existing public.audit_work_items%rowtype;
begin
  if not p_livemode
    or p_offer not in ('evidence_check', 'audit_90_day')
    or p_checkout_session_id not like 'cs_live\_%' escape '\'
    or p_customer_id not like 'cus\_%' escape '\'
    or p_paid_at is null
  then
    raise exception using errcode = '22023', message = 'live audit payment evidence invalid';
  end if;

  if not exists (
    select 1
      from public.stripe_events se
     where se.event_id = p_event_id
       and se.event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
       and se.livemode is true
       and se.stripe_object_id = p_checkout_session_id
  ) then
    raise exception using errcode = '23503', message = 'signed Stripe event evidence missing';
  end if;

  select ar.* into v_request
    from public.audit_requests ar
   where ar.id = p_request_id
   for update;

  if not found
    or v_request.status not in ('checkout_started', 'paid', 'processing', 'complete')
    or v_request.selected_offer is distinct from p_offer
    or v_request.stripe_checkout_session_id is distinct from p_checkout_session_id
    or v_request.terms_accepted_at is null
  then
    raise exception using errcode = '23514', message = 'audit request does not match paid Checkout';
  end if;

  if not exists (
    select 1 from public.audit_documents d
     where d.audit_request_id = p_request_id
       and d.upload_status = 'uploaded'
       and d.content_type = 'text/csv'
       and pg_catalog.lower(d.original_filename) like '%.csv'
       and d.kind in ('contract', 'rate_card')
  ) or not exists (
    select 1 from public.audit_documents d
     where d.audit_request_id = p_request_id
       and d.upload_status = 'uploaded'
       and d.content_type = 'text/csv'
       and pg_catalog.lower(d.original_filename) like '%.csv'
       and d.kind = 'invoice'
  ) then
    raise exception using errcode = '23514', message = 'supported uploaded audit files missing';
  end if;

  update public.audit_requests ar
     set status = case when ar.status in ('processing', 'complete') then ar.status else 'paid' end,
         stripe_customer_id = p_customer_id,
         paid_at = coalesce(ar.paid_at, p_paid_at),
         updated_at = pg_catalog.now()
   where ar.id = p_request_id;

  insert into public.audit_work_items (
    audit_request_id,
    payment_event_id,
    payment_checkout_session_id,
    status,
    retry_after
  ) values (
    p_request_id,
    p_event_id,
    p_checkout_session_id,
    case when v_request.status = 'complete' then 'complete' else 'queued' end,
    pg_catalog.now()
  )
  on conflict (audit_request_id) do nothing;

  select wi.* into v_existing
    from public.audit_work_items wi
   where wi.audit_request_id = p_request_id;

  if v_existing.payment_checkout_session_id is distinct from p_checkout_session_id then
    raise exception using errcode = '23514', message = 'paid work is already bound to another Checkout';
  end if;

  return true;
end;
$$;

create or replace function public.billguarded_claim_audit_work(
  p_worker_id text,
  p_lease_seconds integer default 360
)
returns table (
  audit_request_id uuid,
  run_id uuid,
  claim_token uuid,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stale record;
  v_work public.audit_work_items%rowtype;
  v_run_id uuid;
  v_claim_token uuid;
begin
  if p_worker_id is null or char_length(p_worker_id) not between 8 and 120
    or p_lease_seconds not between 60 and 900
  then
    raise exception using errcode = '22023', message = 'worker claim parameters invalid';
  end if;

  for v_stale in
    select wi.*
      from public.audit_work_items wi
     where wi.status = 'claimed'
       and wi.lease_expires_at <= pg_catalog.now()
     order by wi.lease_expires_at
     for update skip locked
     limit 20
  loop
    if exists (
      select 1 from public.audit_runs r
       where r.id = v_stale.active_run_id and r.status = 'complete'
    ) or exists (
      select 1 from public.audit_requests ar
       where ar.id = v_stale.audit_request_id and ar.status = 'complete'
    ) then
      update public.audit_work_items
         set status = 'complete', claim_token = null, claimed_by = null,
             claimed_at = null, lease_expires_at = null,
             completed_at = coalesce(completed_at, pg_catalog.now()),
             last_error_code = null, last_error_message = null,
             updated_at = pg_catalog.now()
       where audit_request_id = v_stale.audit_request_id and status = 'claimed';
    else
      delete from public.audit_findings f
       where f.audit_run_id = v_stale.active_run_id;

      update public.audit_runs r
         set status = 'failed', error_code = 'stale_worker_claim',
             error_message = 'Audit worker lease expired before a terminal state was recorded.',
             completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
       where r.id = v_stale.active_run_id and r.status in ('queued', 'processing');

      update public.audit_requests ar
         set status = 'paid', updated_at = pg_catalog.now()
       where ar.id = v_stale.audit_request_id and ar.status = 'processing';

      update public.audit_work_items wi
         set status = case when wi.attempt_count >= wi.max_attempts then 'permanently_failed' else 'retryable' end,
             claim_token = null, claimed_by = null, claimed_at = null,
             lease_expires_at = null, active_run_id = null,
             retry_after = pg_catalog.now(),
             last_error_code = 'stale_worker_claim',
             last_error_message = 'Audit worker lease expired before completion.',
             updated_at = pg_catalog.now()
       where wi.audit_request_id = v_stale.audit_request_id and wi.status = 'claimed';
    end if;
  end loop;

  select wi.* into v_work
    from public.audit_work_items wi
    join public.audit_requests ar on ar.id = wi.audit_request_id
   where wi.status in ('queued', 'retryable')
     and wi.retry_after <= pg_catalog.now()
     and wi.attempt_count < wi.max_attempts
     and ar.status = 'paid'
     and ar.selected_offer in ('evidence_check', 'audit_90_day')
     and ar.paid_at is not null
     and ar.terms_accepted_at is not null
     and ar.stripe_checkout_session_id = wi.payment_checkout_session_id
     and ar.stripe_checkout_session_id like 'cs_live\_%' escape '\'
     and ar.stripe_customer_id like 'cus\_%' escape '\'
     and exists (
       select 1 from public.stripe_events se
       where se.event_id = wi.payment_event_id
          and se.event_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded')
          and se.livemode is true
          and se.stripe_object_id = wi.payment_checkout_session_id
     )
     and exists (
       select 1 from public.audit_documents d
        where d.audit_request_id = ar.id and d.upload_status = 'uploaded'
          and d.content_type = 'text/csv'
          and pg_catalog.lower(d.original_filename) like '%.csv'
          and d.kind in ('contract', 'rate_card')
     )
     and exists (
       select 1 from public.audit_documents d
        where d.audit_request_id = ar.id and d.upload_status = 'uploaded'
          and d.content_type = 'text/csv'
          and pg_catalog.lower(d.original_filename) like '%.csv'
          and d.kind = 'invoice'
     )
     and not exists (
       select 1 from public.audit_runs r
        where r.audit_request_id = ar.id and r.status in ('queued', 'processing', 'complete', 'needs_review')
     )
   order by wi.retry_after, wi.created_at
   for update of wi skip locked
   limit 1;

  if not found then
    return;
  end if;

  v_claim_token := gen_random_uuid();

  update public.audit_work_items wi
     set status = 'claimed', attempt_count = wi.attempt_count + 1,
         claim_token = v_claim_token, claimed_by = p_worker_id,
         claimed_at = pg_catalog.now(),
         lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
         active_run_id = null, last_error_code = null, last_error_message = null,
         updated_at = pg_catalog.now()
   where wi.audit_request_id = v_work.audit_request_id;

  insert into public.audit_runs (
    audit_request_id, status, started_at, attempt_number, work_claim_token
  ) values (
    v_work.audit_request_id, 'processing', pg_catalog.now(),
    v_work.attempt_count + 1, v_claim_token
  ) returning id into v_run_id;

  update public.audit_work_items wi
     set active_run_id = v_run_id, updated_at = pg_catalog.now()
   where wi.audit_request_id = v_work.audit_request_id
     and wi.claim_token = v_claim_token;

  update public.audit_requests ar
     set status = 'processing', updated_at = pg_catalog.now()
   where ar.id = v_work.audit_request_id and ar.status = 'paid';

  return query select v_work.audit_request_id, v_run_id, v_claim_token, v_work.attempt_count + 1;
end;
$$;

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
     and be.offer = ar.selected_offer
     and be.stripe_checkout_session_id = ar.stripe_checkout_session_id
   where wi.status = 'complete'
     and ar.status = 'complete'
     and ar.selected_offer in ('evidence_check', 'audit_90_day')
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
     and ar.status = 'complete' and ar.selected_offer in ('evidence_check', 'audit_90_day')
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

create or replace view public.billguarded_fulfillment_operations
with (security_invoker = true)
as
select ar.id as audit_request_id,
       wi.status as processing_status,
       wi.attempt_count as processing_attempts,
       wi.retry_after as processing_retry_after,
       wi.lease_expires_at as processing_lease_expires_at,
       r.status as latest_run_status,
       r.error_code as latest_run_error_code,
       d.status as delivery_status,
       d.attempt_count as delivery_attempts,
       d.next_attempt_at as delivery_retry_after,
       d.lease_expires_at as delivery_lease_expires_at,
       d.last_error_code as delivery_error_code,
       case
         when ar.selected_offer in ('evidence_check', 'audit_90_day') and ar.paid_at is not null
           and ar.stripe_checkout_session_id like 'cs_live\_%' escape '\'
           and wi.audit_request_id is null then 'paid_without_work_item'
         when wi.status = 'claimed' and wi.lease_expires_at <= pg_catalog.now() then 'processing_claim_stale'
         when wi.status = 'retryable' then 'processing_retryable'
         when wi.status = 'permanently_failed' then 'processing_terminal_failure'
         when wi.status = 'complete' and d.id is null then 'complete_without_delivery'
         when d.status = 'claimed' and d.lease_expires_at <= pg_catalog.now() then 'delivery_presend_claim_stale'
         when d.status = 'sending' and d.lease_expires_at <= pg_catalog.now() then 'delivery_acceptance_uncertain'
         when d.status = 'retryable' then 'delivery_retryable'
         when d.status in ('acceptance_uncertain', 'bounced', 'failed', 'suppressed', 'complained') then 'delivery_attention_required'
         else null
       end as incident,
       ar.updated_at as audit_updated_at,
       wi.updated_at as processing_updated_at,
       d.updated_at as delivery_updated_at
  from public.audit_requests ar
  left join public.audit_work_items wi on wi.audit_request_id = ar.id
  left join lateral (
    select rr.status, rr.error_code
      from public.audit_runs rr
     where rr.audit_request_id = ar.id
     order by rr.created_at desc
     limit 1
  ) r on true
  left join public.audit_deliveries d on d.audit_request_id = ar.id
 where ar.selected_offer in ('evidence_check', 'audit_90_day')
   and ar.paid_at is not null
   and ar.stripe_checkout_session_id like 'cs_live\_%' escape '\';

revoke all on function public.billguarded_record_paid_audit(
  text, uuid, text, text, text, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.billguarded_record_paid_audit(
  text, uuid, text, text, text, boolean, timestamptz
) to service_role;

revoke all on function public.billguarded_claim_audit_work(text, integer)
  from public, anon, authenticated;
grant execute on function public.billguarded_claim_audit_work(text, integer)
  to service_role;

revoke all on function public.billguarded_claim_delivery(text, integer)
  from public, anon, authenticated;
grant execute on function public.billguarded_claim_delivery(text, integer)
  to service_role;

commit;
