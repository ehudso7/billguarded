begin;

create extension if not exists pgcrypto;

create table if not exists public.audit_requests (
  id uuid primary key default gen_random_uuid(),
  company text not null check (char_length(company) between 2 and 120),
  email text not null check (char_length(email) <= 254),
  monthly_3pl_spend_cents bigint not null default 0 check (monthly_3pl_spend_cents >= 0),
  invoice_count_monthly integer not null check (invoice_count_monthly between 1 and 10000),
  status text not null default 'intake'
    check (status in ('intake', 'checkout_started', 'paid', 'processing', 'complete', 'cancelled')),
  selected_offer text
    check (selected_offer is null or selected_offer in ('audit_90_day', 'continuous_monitor')),
  stripe_checkout_session_id text unique,
  stripe_customer_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists audit_requests_email_idx
  on public.audit_requests (lower(email));

create index if not exists audit_requests_status_idx
  on public.audit_requests (status, created_at desc);

create table if not exists public.audit_documents (
  id uuid primary key default gen_random_uuid(),
  audit_request_id uuid not null references public.audit_requests(id) on delete cascade,
  kind text not null check (kind in ('contract', 'rate_card', 'invoice')),
  original_filename text not null check (char_length(original_filename) between 1 and 180),
  storage_path text not null unique,
  content_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  created_at timestamptz not null default now()
);

create index if not exists audit_documents_request_idx
  on public.audit_documents (audit_request_id, created_at);

create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  stripe_customer_id text not null unique,
  email text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_entitlements (
  id uuid primary key default gen_random_uuid(),
  stripe_customer_id text not null,
  offer text not null check (offer in ('audit_90_day', 'continuous_monitor')),
  status text not null,
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stripe_customer_id, offer)
);

create unique index if not exists billing_entitlements_subscription_idx
  on public.billing_entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;

create table if not exists public.stripe_events (
  event_id text primary key,
  event_type text not null,
  stripe_created_at timestamptz not null,
  processed boolean not null default false,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.audit_requests enable row level security;
alter table public.audit_documents enable row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_entitlements enable row level security;
alter table public.stripe_events enable row level security;

revoke all on table public.audit_requests from anon, authenticated;
revoke all on table public.audit_documents from anon, authenticated;
revoke all on table public.billing_customers from anon, authenticated;
revoke all on table public.billing_entitlements from anon, authenticated;
revoke all on table public.stripe_events from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audit-documents',
  'audit-documents',
  false,
  20971520,
  array[
    'application/pdf',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
