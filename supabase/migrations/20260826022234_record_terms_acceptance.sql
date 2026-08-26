begin;

alter table public.audit_requests
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

commit;
