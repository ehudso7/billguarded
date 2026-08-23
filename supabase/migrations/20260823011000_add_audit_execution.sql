begin;

create table if not exists public.audit_runs (
  id uuid primary key default gen_random_uuid(),
  audit_request_id uuid not null references public.audit_requests(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'complete', 'failed', 'needs_review')),
  engine_version text not null default 'deterministic-v1',
  source_document_count integer not null default 0 check (source_document_count >= 0),
  finding_count integer not null default 0 check (finding_count >= 0),
  potential_recovery_cents bigint not null default 0 check (potential_recovery_cents >= 0),
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists audit_runs_active_request_idx
  on public.audit_runs (audit_request_id)
  where status in ('queued', 'processing');

create index if not exists audit_runs_request_created_idx
  on public.audit_runs (audit_request_id, created_at desc);

create table if not exists public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_run_id uuid not null references public.audit_runs(id) on delete cascade,
  audit_request_id uuid not null references public.audit_requests(id) on delete cascade,
  finding_type text not null
    check (finding_type in ('duplicate_charge', 'unsupported_fee', 'arithmetic_mismatch', 'rate_mismatch')),
  severity text not null
    check (severity in ('low', 'medium', 'high')),
  source_document_id uuid references public.audit_documents(id) on delete set null,
  source_row integer,
  service_code text,
  description text not null,
  billed_amount_cents bigint,
  expected_amount_cents bigint,
  potential_recovery_cents bigint not null default 0 check (potential_recovery_cents >= 0),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_findings_request_idx
  on public.audit_findings (audit_request_id, created_at);

create index if not exists audit_findings_run_idx
  on public.audit_findings (audit_run_id, created_at);

alter table public.audit_runs enable row level security;
alter table public.audit_findings enable row level security;

revoke all on table public.audit_runs from anon, authenticated;
revoke all on table public.audit_findings from anon, authenticated;

commit;
