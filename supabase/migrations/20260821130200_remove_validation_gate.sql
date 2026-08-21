begin;

drop function if exists public.consume_reqovr_validation_token(text);

delete from vault.secrets
where name = 'reqovr_validation_token';

commit;
