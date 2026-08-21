begin;

create or replace function public.reqovr_stripe_webhook_secret()
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

revoke all on function public.reqovr_stripe_webhook_secret() from public, anon, authenticated;
grant execute on function public.reqovr_stripe_webhook_secret() to service_role;

commit;
