begin;

create table if not exists private.live_readiness_tokens (
  token_hash text primary key,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.consume_live_readiness_token(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumed boolean := false;
begin
  update private.live_readiness_tokens
     set used_at = now()
   where token_hash = p_token_hash
     and used_at is null
  returning true into consumed;

  return coalesce(consumed, false);
end;
$$;

revoke all on function public.consume_live_readiness_token(text) from public, anon, authenticated;
grant execute on function public.consume_live_readiness_token(text) to service_role;

commit;
