begin;

alter table public.audit_requests
  add column if not exists access_token_hash text;

create index if not exists audit_requests_access_token_hash_idx
  on public.audit_requests (access_token_hash)
  where access_token_hash is not null;

create index if not exists audit_findings_source_document_idx
  on public.audit_findings (source_document_id)
  where source_document_id is not null;

create table if not exists private.intake_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null default now(),
  hit_count integer not null default 0 check (hit_count >= 0),
  updated_at timestamptz not null default now()
);

revoke all on table private.intake_rate_limits from public, anon, authenticated;

create or replace function public.billguarded_consume_intake_rate_limit(
  p_key text,
  p_limit integer default 10,
  p_window_seconds integer default 3600
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
  current_window timestamptz;
begin
  if p_key is null or char_length(p_key) < 8 or p_limit < 1 or p_window_seconds < 60 then
    return false;
  end if;

  delete from private.intake_rate_limits
   where updated_at < pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds * 2);

  insert into private.intake_rate_limits(rate_key, window_started_at, hit_count, updated_at)
  values (p_key, pg_catalog.now(), 1, pg_catalog.now())
  on conflict (rate_key) do update
    set hit_count = case
          when private.intake_rate_limits.window_started_at <= pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds)
            then 1
          else private.intake_rate_limits.hit_count + 1
        end,
        window_started_at = case
          when private.intake_rate_limits.window_started_at <= pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds)
            then pg_catalog.now()
          else private.intake_rate_limits.window_started_at
        end,
        updated_at = pg_catalog.now()
  returning hit_count, window_started_at into current_count, current_window;

  return current_count <= p_limit;
end;
$$;

revoke all on function public.billguarded_consume_intake_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.billguarded_consume_intake_rate_limit(text, integer, integer)
  to service_role;

create or replace function public.billguarded_stripe_webhook_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'reqovr_stripe_webhook_secret'
  order by created_at desc
  limit 1;
$$;

revoke all on function public.billguarded_stripe_webhook_secret()
  from public, anon, authenticated;
grant execute on function public.billguarded_stripe_webhook_secret()
  to service_role;

commit;
