begin;

create or replace function public.consume_reqovr_validation_token(provided_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  secret_id uuid;
  expected_token text;
begin
  if provided_token is null or length(provided_token) < 32 then
    return false;
  end if;

  select id, decrypted_secret
    into secret_id, expected_token
    from vault.decrypted_secrets
   where name = 'reqovr_validation_token'
   order by created_at desc
   limit 1;

  if secret_id is null or expected_token is null or expected_token <> provided_token then
    return false;
  end if;

  delete from vault.secrets where id = secret_id;
  return true;
end;
$$;

revoke all on function public.consume_reqovr_validation_token(text) from public, anon, authenticated;
grant execute on function public.consume_reqovr_validation_token(text) to service_role;

commit;
