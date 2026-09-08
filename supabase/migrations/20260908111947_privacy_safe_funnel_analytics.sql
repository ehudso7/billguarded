-- Privacy-safe first-party funnel analytics; this ledger intentionally stores
-- no email, company name, filenames, document contents, Stripe/customer IDs,
-- checkout-session IDs, recovery credentials, URL queries, or URL fragments.

create table if not exists public.audit_attribution (
  audit_request_id uuid primary key
    references public.audit_requests(id) on delete cascade,
  anonymous_id_hash text check (
    anonymous_id_hash is null or char_length(anonymous_id_hash) = 64
  ),
  first_channel text not null check (first_channel in (
    'direct', 'organic', 'referral', 'relationship_outreach',
    'approved_campaign', 'demo', 'unknown'
  )),
  first_utm_source text check (first_utm_source is null or char_length(first_utm_source) <= 64),
  first_utm_medium text check (first_utm_medium is null or char_length(first_utm_medium) <= 64),
  first_utm_campaign text check (first_utm_campaign is null or char_length(first_utm_campaign) <= 96),
  last_channel text not null check (last_channel in (
    'direct', 'organic', 'referral', 'relationship_outreach',
    'approved_campaign', 'demo', 'unknown'
  )),
  last_utm_source text check (last_utm_source is null or char_length(last_utm_source) <= 64),
  last_utm_medium text check (last_utm_medium is null or char_length(last_utm_medium) <= 64),
  last_utm_campaign text check (last_utm_campaign is null or char_length(last_utm_campaign) <= 96),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (char_length(event_key) = 64),
  event_name text not null check (event_name in (
    'landing_view', 'demo_view', 'fit_check_click', 'intake_started',
    'intake_completed', 'rate_card_uploaded', 'invoice_upload_completed',
    'unsupported_file_rejected', 'upload_failed', 'checkout_started',
    'checkout_creation_failed', 'checkout_abandoned',
    'paid_audit_confirmed', 'paid_audit_queued', 'audit_completed',
    'audit_failed', 'customer_notified', 'delivery_failed',
    'report_recovery_opened'
  )),
  audit_request_id uuid references public.audit_requests(id) on delete set null,
  anonymous_id_hash text check (
    anonymous_id_hash is null or char_length(anonymous_id_hash) = 64
  ),
  source_channel text not null default 'unknown' check (source_channel in (
    'direct', 'organic', 'referral', 'relationship_outreach',
    'approved_campaign', 'demo', 'unknown'
  )),
  utm_source text check (utm_source is null or char_length(utm_source) <= 64),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 64),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 96),
  path text check (path is null or path in (
    '/', '/3pl-invoice-audit', '/demo', '/start', '/recover', '/success'
  )),
  outcome text check (outcome is null or outcome in (
    'retryable', 'terminal', 'preflight', 'upload', 'checkout', 'provider'
  )),
  occurred_at timestamptz not null default now()
);

create index if not exists funnel_events_name_time_idx
  on public.funnel_events (event_name, occurred_at desc);
create index if not exists funnel_events_channel_time_idx
  on public.funnel_events (source_channel, occurred_at desc);
create index if not exists funnel_events_audit_request_idx
  on public.funnel_events (audit_request_id, occurred_at)
  where audit_request_id is not null;
create index if not exists funnel_events_anonymous_idx
  on public.funnel_events (anonymous_id_hash, occurred_at)
  where anonymous_id_hash is not null;

alter table public.audit_attribution enable row level security;
alter table public.funnel_events enable row level security;

revoke all on table public.audit_attribution from public, anon, authenticated;
revoke all on table public.funnel_events from public, anon, authenticated;
grant select, insert, update, delete on table public.audit_attribution to service_role;
grant select, insert on table public.funnel_events to service_role;

create policy deny_client_access on public.audit_attribution
  for all to anon, authenticated using (false) with check (false);
create policy deny_client_access on public.funnel_events
  for all to anon, authenticated using (false) with check (false);

create or replace view public.billguarded_funnel_daily
with (security_invoker = true)
as
with daily as (
  select
    date_trunc('day', occurred_at) as day,
    source_channel,
    count(*) filter (where event_name = 'landing_view') as landing_views,
    count(*) filter (where event_name = 'demo_view') as demo_views,
    count(*) filter (where event_name = 'fit_check_click') as fit_check_clicks,
    count(*) filter (where event_name = 'intake_started') as intake_starts,
    count(*) filter (where event_name = 'intake_completed') as intake_completions,
    count(*) filter (where event_name = 'rate_card_uploaded') as rate_cards_uploaded,
    count(*) filter (where event_name = 'invoice_upload_completed') as invoice_uploads,
    count(*) filter (where event_name = 'checkout_started') as checkouts_started,
    count(*) filter (where event_name = 'paid_audit_confirmed') as paid_audits,
    count(*) filter (where event_name = 'audit_completed') as audits_completed,
    count(*) filter (where event_name = 'customer_notified') as customers_notified,
    count(*) filter (where event_name = 'report_recovery_opened') as reports_recovered,
    count(*) filter (where event_name in (
      'unsupported_file_rejected', 'upload_failed',
      'checkout_creation_failed', 'audit_failed', 'delivery_failed'
    )) as actionable_failures
  from public.funnel_events
  group by 1, 2
), abandoned as (
  select
    date_trunc('day', started.occurred_at) as day,
    started.source_channel,
    count(*) as intake_abandoned
  from public.funnel_events started
  where started.event_name = 'intake_started'
    and started.occurred_at < now() - interval '30 minutes'
    and not exists (
      select 1
      from public.funnel_events completed
      where completed.event_name = 'intake_completed'
        and completed.anonymous_id_hash = started.anonymous_id_hash
        and completed.occurred_at >= started.occurred_at
    )
  group by 1, 2
)
select daily.*, coalesce(abandoned.intake_abandoned, 0) as intake_abandoned
from daily
left join abandoned using (day, source_channel);

revoke all on table public.billguarded_funnel_daily from public, anon, authenticated;
grant select on table public.billguarded_funnel_daily to service_role;
