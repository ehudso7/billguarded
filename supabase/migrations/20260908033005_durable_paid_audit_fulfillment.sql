begin;

-- Durable work is separate from Stripe event ingestion, deterministic audit
-- runs, and customer delivery. Every state transition below is owned by
-- Postgres so a terminated serverless invocation cannot lose or double-claim
-- paid work.

alter table public.audit_runs
  add column if not exists attempt_number integer,
  add column if not exists work_claim_token uuid;

alter table public.stripe_events
  add column if not exists livemode boolean,
  add column if not exists stripe_object_id text;

alter table public.audit_runs
  drop constraint if exists audit_runs_attempt_number_check;
alter table public.audit_runs
  add constraint audit_runs_attempt_number_check
  check (attempt_number is null or attempt_number >= 1);

create unique index if not exists audit_runs_work_claim_token_idx
  on public.audit_runs (work_claim_token)
  where work_claim_token is not null;

create table if not exists public.audit_work_items (
  audit_request_id uuid primary key
    references public.audit_requests(id) on delete cascade,
  payment_event_id text not null
    references public.stripe_events(event_id) on delete restrict,
  payment_checkout_session_id text not null,
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'retryable', 'complete', 'permanently_failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  claim_token uuid,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  active_run_id uuid references public.audit_runs(id) on delete set null,
  retry_after timestamptz not null default now(),
  last_error_code text,
  last_error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint audit_work_items_claim_shape check (
    (status = 'claimed' and claim_token is not null and claimed_at is not null and lease_expires_at is not null)
    or
    (status <> 'claimed' and claim_token is null and claimed_at is null and lease_expires_at is null)
  )
);

create index if not exists audit_work_items_ready_idx
  on public.audit_work_items (retry_after, created_at)
  where status in ('queued', 'retryable');

create index if not exists audit_work_items_stale_idx
  on public.audit_work_items (lease_expires_at)
  where status = 'claimed';

create index if not exists audit_work_items_payment_event_idx
  on public.audit_work_items (payment_event_id);

create index if not exists audit_work_items_active_run_idx
  on public.audit_work_items (active_run_id)
  where active_run_id is not null;

create table if not exists public.audit_deliveries (
  id uuid primary key default gen_random_uuid(),
  audit_request_id uuid not null
    references public.audit_requests(id) on delete cascade,
  audit_run_id uuid not null
    references public.audit_runs(id) on delete cascade,
  delivery_type text not null default 'audit_complete'
    check (delivery_type = 'audit_complete'),
  template_version text not null default 'audit-complete-v1',
  subject text not null default 'Your BillGuarded 90-Day Audit is complete',
  recipient_email text not null check (char_length(recipient_email) between 3 and 254),
  recovery_session_hash text not null check (char_length(recovery_session_hash) = 64),
  delivery_fingerprint text not null unique check (char_length(delivery_fingerprint) = 64),
  status text not null default 'pending'
    check (status in (
      'pending', 'claimed', 'sending', 'retryable', 'acceptance_uncertain',
      'accepted', 'sent', 'delivered', 'bounced', 'failed', 'suppressed', 'complained'
    )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  send_attempt_count integer not null default 0 check (send_attempt_count >= 0),
  claim_token uuid,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  send_started_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  provider_message_id text unique,
  provider_accepted_at timestamptz,
  provider_last_event_at timestamptz,
  notified_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_request_id, delivery_type),
  constraint audit_deliveries_claim_shape check (
    (status in ('claimed', 'sending') and claim_token is not null and claimed_at is not null and lease_expires_at is not null)
    or
    (status not in ('claimed', 'sending') and claim_token is null and claimed_at is null and lease_expires_at is null)
  ),
  constraint audit_deliveries_acceptance_shape check (
    (provider_accepted_at is null and provider_message_id is null)
    or
    (provider_accepted_at is not null and provider_message_id is not null)
  )
);

create index if not exists audit_deliveries_ready_idx
  on public.audit_deliveries (next_attempt_at, created_at)
  where status in ('pending', 'retryable');

create index if not exists audit_deliveries_stale_idx
  on public.audit_deliveries (lease_expires_at)
  where status in ('claimed', 'sending');

create index if not exists audit_deliveries_run_idx
  on public.audit_deliveries (audit_run_id);

create table if not exists public.resend_delivery_events (
  event_id text primary key,
  provider_message_id text not null,
  delivery_id uuid not null references public.audit_deliveries(id) on delete cascade,
  event_type text not null check (event_type in (
    'email.sent', 'email.delivered', 'email.bounced', 'email.failed',
    'email.suppressed', 'email.complained'
  )),
  provider_created_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists resend_delivery_events_delivery_idx
  on public.resend_delivery_events (delivery_id, provider_created_at);

alter table public.audit_work_items enable row level security;
alter table public.audit_deliveries enable row level security;
alter table public.resend_delivery_events enable row level security;

revoke all on table public.audit_work_items from public, anon, authenticated;
revoke all on table public.audit_deliveries from public, anon, authenticated;
revoke all on table public.resend_delivery_events from public, anon, authenticated;

grant select, insert, update, delete on table public.audit_work_items to service_role;
grant select, insert, update, delete on table public.audit_deliveries to service_role;
grant select, insert, update, delete on table public.resend_delivery_events to service_role;

create policy deny_client_access on public.audit_work_items
  for all to anon, authenticated using (false) with check (false);
create policy deny_client_access on public.audit_deliveries
  for all to anon, authenticated using (false) with check (false);
create policy deny_client_access on public.resend_delivery_events
  for all to anon, authenticated using (false) with check (false);

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
    or p_offer <> 'audit_90_day'
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
    or v_request.selected_offer <> 'audit_90_day'
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
     and ar.selected_offer = 'audit_90_day'
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

create or replace function public.billguarded_complete_audit_work(
  p_request_id uuid,
  p_run_id uuid,
  p_claim_token uuid,
  p_source_document_count integer,
  p_finding_count integer,
  p_potential_recovery_cents bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_work public.audit_work_items%rowtype;
begin
  if p_source_document_count < 0 or p_finding_count < 0 or p_potential_recovery_cents < 0 then
    raise exception using errcode = '22023', message = 'audit completion totals invalid';
  end if;

  select wi.* into v_work from public.audit_work_items wi
   where wi.audit_request_id = p_request_id for update;

  if not found or v_work.status <> 'claimed'
    or v_work.claim_token is distinct from p_claim_token
    or v_work.active_run_id is distinct from p_run_id
  then
    return false;
  end if;

  update public.audit_runs r
     set status = 'complete', source_document_count = p_source_document_count,
         finding_count = p_finding_count,
         potential_recovery_cents = p_potential_recovery_cents,
         error_code = null, error_message = null,
         completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
   where r.id = p_run_id and r.audit_request_id = p_request_id and r.status = 'processing';

  if not found then
    return false;
  end if;

  update public.audit_requests ar
     set status = 'complete', updated_at = pg_catalog.now()
   where ar.id = p_request_id and ar.status = 'processing';

  update public.audit_work_items wi
     set status = 'complete', claim_token = null, claimed_by = null,
         claimed_at = null, lease_expires_at = null,
         completed_at = pg_catalog.now(), last_error_code = null,
         last_error_message = null, updated_at = pg_catalog.now()
   where wi.audit_request_id = p_request_id and wi.claim_token = p_claim_token;

  return true;
end;
$$;

create or replace function public.billguarded_fail_audit_work(
  p_request_id uuid,
  p_run_id uuid,
  p_claim_token uuid,
  p_retryable boolean,
  p_error_code text,
  p_error_message text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_work public.audit_work_items%rowtype;
  v_status text;
  v_delay_seconds integer;
begin
  select wi.* into v_work from public.audit_work_items wi
   where wi.audit_request_id = p_request_id for update;

  if not found or v_work.status <> 'claimed'
    or v_work.claim_token is distinct from p_claim_token
    or v_work.active_run_id is distinct from p_run_id
  then
    return 'claim_lost';
  end if;

  delete from public.audit_findings f where f.audit_run_id = p_run_id;

  update public.audit_runs r
     set status = case when p_retryable then 'failed' else 'needs_review' end,
         error_code = pg_catalog.left(coalesce(p_error_code, 'audit_failed'), 120),
         error_message = pg_catalog.left(coalesce(p_error_message, 'Audit processing failed.'), 500),
         completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
   where r.id = p_run_id and r.audit_request_id = p_request_id and r.status = 'processing';

  update public.audit_requests ar
     set status = 'paid', updated_at = pg_catalog.now()
   where ar.id = p_request_id and ar.status = 'processing';

  v_status := case
    when not p_retryable or v_work.attempt_count >= v_work.max_attempts then 'permanently_failed'
    else 'retryable'
  end;
  v_delay_seconds := case v_work.attempt_count
    when 1 then 60 when 2 then 300 when 3 then 900 when 4 then 3600 else 14400
  end;

  update public.audit_work_items wi
     set status = v_status, claim_token = null, claimed_by = null,
         claimed_at = null, lease_expires_at = null, active_run_id = null,
         retry_after = case when v_status = 'retryable'
           then pg_catalog.now() + pg_catalog.make_interval(secs => v_delay_seconds)
           else wi.retry_after end,
         last_error_code = pg_catalog.left(coalesce(p_error_code, 'audit_failed'), 120),
         last_error_message = pg_catalog.left(coalesce(p_error_message, 'Audit processing failed.'), 500),
         updated_at = pg_catalog.now()
   where wi.audit_request_id = p_request_id and wi.claim_token = p_claim_token;

  return v_status;
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

  -- A claimed row is known to be pre-send and can safely recover. A sending
  -- row has an unknown provider outcome and is quarantined instead of retried.
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

create or replace function public.billguarded_begin_delivery_send(
  p_delivery_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.audit_deliveries d
     set status = 'sending', send_attempt_count = d.send_attempt_count + 1,
         send_started_at = pg_catalog.now(), updated_at = pg_catalog.now()
   where d.id = p_delivery_id and d.status = 'claimed'
     and d.claim_token = p_claim_token and d.lease_expires_at > pg_catalog.now();
  return found;
end;
$$;

create or replace function public.billguarded_record_delivery_accepted(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if p_provider_message_id is null or char_length(p_provider_message_id) not between 6 and 200 then
    return false;
  end if;

  update public.audit_deliveries d
     set status = 'accepted', provider_message_id = p_provider_message_id,
         provider_accepted_at = pg_catalog.now(), notified_at = pg_catalog.now(),
         claim_token = null, claimed_by = null, claimed_at = null,
         lease_expires_at = null, last_error_code = null,
         last_error_message = null, updated_at = pg_catalog.now()
   where d.id = p_delivery_id and d.status = 'sending'
     and d.claim_token = p_claim_token
  returning d.audit_request_id into v_request_id;

  if not found then
    return false;
  end if;

  update public.audit_requests ar
     set customer_delivery_notified_at = coalesce(ar.customer_delivery_notified_at, pg_catalog.now()),
         customer_delivery_last_error = null,
         updated_at = pg_catalog.now()
   where ar.id = v_request_id;

  return true;
end;
$$;

create or replace function public.billguarded_record_delivery_failure(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_retryable boolean,
  p_error_code text,
  p_error_message text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.audit_deliveries%rowtype;
  v_status text;
  v_delay_seconds integer;
begin
  select d.* into v_delivery from public.audit_deliveries d
   where d.id = p_delivery_id for update;

  if not found or v_delivery.status not in ('claimed', 'sending')
    or v_delivery.claim_token is distinct from p_claim_token then
    return 'claim_lost';
  end if;

  v_status := case
    when p_retryable and v_delivery.attempt_count < v_delivery.max_attempts then 'retryable'
    else 'failed'
  end;
  v_delay_seconds := case v_delivery.attempt_count
    when 1 then 60 when 2 then 300 when 3 then 900 when 4 then 3600 else 14400
  end;

  update public.audit_deliveries d
     set status = v_status, claim_token = null, claimed_by = null,
         claimed_at = null, lease_expires_at = null,
         next_attempt_at = case when v_status = 'retryable'
           then pg_catalog.now() + pg_catalog.make_interval(secs => v_delay_seconds)
           else d.next_attempt_at end,
         last_error_code = pg_catalog.left(coalesce(p_error_code, 'delivery_failed'), 120),
         last_error_message = pg_catalog.left(coalesce(p_error_message, 'Customer delivery failed.'), 500),
         updated_at = pg_catalog.now()
   where d.id = p_delivery_id and d.claim_token = p_claim_token;

  update public.audit_requests ar
     set customer_delivery_last_error = pg_catalog.left(coalesce(p_error_code, 'delivery_failed'), 120),
         updated_at = pg_catalog.now()
   where ar.id = v_delivery.audit_request_id;

  return v_status;
end;
$$;

create or replace function public.billguarded_record_delivery_uncertain(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  update public.audit_deliveries d
     set status = 'acceptance_uncertain', claim_token = null,
         claimed_by = null, claimed_at = null, lease_expires_at = null,
         last_error_code = 'provider_acceptance_uncertain',
         last_error_message = pg_catalog.left(coalesce(p_error_message,
           'Provider acceptance could not be determined; manual reconciliation is required.'), 500),
         updated_at = pg_catalog.now()
   where d.id = p_delivery_id and d.status = 'sending' and d.claim_token = p_claim_token
  returning d.audit_request_id into v_request_id;

  if not found then return false; end if;

  update public.audit_requests ar
     set customer_delivery_last_error = 'provider_acceptance_uncertain',
         updated_at = pg_catalog.now()
   where ar.id = v_request_id;
  return true;
end;
$$;

create or replace function public.billguarded_record_resend_event(
  p_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_provider_created_at timestamptz,
  p_from_address text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.audit_deliveries%rowtype;
  v_inserted boolean;
  v_new_status text;
begin
  if p_event_id is null or p_provider_message_id is null or p_provider_created_at is null
    or p_event_type not in ('email.sent', 'email.delivered', 'email.bounced', 'email.failed', 'email.suppressed', 'email.complained')
    or pg_catalog.lower(pg_catalog.btrim(p_from_address)) not in (
      'support@billguarded.com', 'billguarded <support@billguarded.com>'
    )
  then
    return false;
  end if;

  select d.* into v_delivery from public.audit_deliveries d
   where d.provider_message_id = p_provider_message_id for update;
  if not found then return false; end if;

  insert into public.resend_delivery_events (
    event_id, provider_message_id, delivery_id, event_type, provider_created_at
  ) values (
    p_event_id, p_provider_message_id, v_delivery.id, p_event_type, p_provider_created_at
  ) on conflict (event_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then return true; end if;

  v_new_status := case p_event_type
    when 'email.sent' then 'sent'
    when 'email.delivered' then 'delivered'
    when 'email.bounced' then 'bounced'
    when 'email.failed' then 'failed'
    when 'email.suppressed' then 'suppressed'
    when 'email.complained' then 'complained'
  end;

  update public.audit_deliveries d
     set status = case
           when p_event_type = 'email.sent' and d.status in ('accepted', 'sent') then 'sent'
           when p_event_type = 'email.delivered' and d.status in ('accepted', 'sent', 'delivered') then 'delivered'
           when p_event_type in ('email.bounced', 'email.failed', 'email.suppressed', 'email.complained') then v_new_status
           else d.status
         end,
         provider_last_event_at = pg_catalog.greatest(
           coalesce(d.provider_last_event_at, p_provider_created_at), p_provider_created_at
         ),
         notified_at = case when p_event_type = 'email.delivered'
           then coalesce(d.notified_at, pg_catalog.now()) else d.notified_at end,
         last_error_code = case when p_event_type in ('email.bounced', 'email.failed', 'email.suppressed', 'email.complained')
           then p_event_type else d.last_error_code end,
         last_error_message = case when p_event_type in ('email.bounced', 'email.failed', 'email.suppressed', 'email.complained')
           then 'Resend reported a terminal customer-delivery event.' else d.last_error_message end,
         updated_at = pg_catalog.now()
   where d.id = v_delivery.id;

  if p_event_type in ('email.bounced', 'email.failed', 'email.suppressed', 'email.complained') then
    update public.audit_requests ar
       set customer_delivery_last_error = p_event_type, updated_at = pg_catalog.now()
     where ar.id = v_delivery.audit_request_id;
  end if;

  return true;
end;
$$;

create or replace function public.billguarded_reconcile_delivery_accepted(
  p_delivery_id uuid,
  p_delivery_fingerprint text,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if p_provider_message_id is null or char_length(p_provider_message_id) not between 6 and 200 then
    return false;
  end if;

  update public.audit_deliveries d
     set status = 'accepted', provider_message_id = p_provider_message_id,
         provider_accepted_at = pg_catalog.now(), notified_at = pg_catalog.now(),
         last_error_code = null, last_error_message = null,
         updated_at = pg_catalog.now()
   where d.id = p_delivery_id
     and d.delivery_fingerprint = p_delivery_fingerprint
     and d.status = 'acceptance_uncertain'
  returning d.audit_request_id into v_request_id;

  if not found then return false; end if;

  update public.audit_requests ar
     set customer_delivery_notified_at = coalesce(ar.customer_delivery_notified_at, pg_catalog.now()),
         customer_delivery_last_error = null,
         updated_at = pg_catalog.now()
   where ar.id = v_request_id;
  return true;
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
         when ar.selected_offer = 'audit_90_day' and ar.paid_at is not null
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
 where ar.selected_offer = 'audit_90_day'
   and ar.paid_at is not null
   and ar.stripe_checkout_session_id like 'cs_live\_%' escape '\';

revoke all on table public.billguarded_fulfillment_operations from public, anon, authenticated;
grant select on table public.billguarded_fulfillment_operations to service_role;

do $$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'public.billguarded_record_paid_audit(text,uuid,text,text,text,boolean,timestamptz)',
    'public.billguarded_claim_audit_work(text,integer)',
    'public.billguarded_complete_audit_work(uuid,uuid,uuid,integer,integer,bigint)',
    'public.billguarded_fail_audit_work(uuid,uuid,uuid,boolean,text,text)',
    'public.billguarded_claim_delivery(text,integer)',
    'public.billguarded_begin_delivery_send(uuid,uuid)',
    'public.billguarded_record_delivery_accepted(uuid,uuid,text)',
    'public.billguarded_record_delivery_failure(uuid,uuid,boolean,text,text)',
    'public.billguarded_record_delivery_uncertain(uuid,uuid,text)',
    'public.billguarded_record_resend_event(text,text,text,timestamptz,text)',
    'public.billguarded_reconcile_delivery_accepted(uuid,text,text)'
  ]
  loop
    execute 'revoke all on function ' || function_signature || ' from public, anon, authenticated';
    execute 'grant execute on function ' || function_signature || ' to service_role';
  end loop;
end
$$;

commit;
