begin;

create or replace function private.enforce_audit_document_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  invoice_total integer;
  terms_total integer;
  byte_total bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.audit_request_id::text, 0)
  );

  select coalesce(sum(byte_size), 0)
    into byte_total
    from public.audit_documents
   where audit_request_id = new.audit_request_id;

  if byte_total + new.byte_size > 52428800 then
    raise exception using
      errcode = '23514',
      message = 'audit document byte limit reached';
  end if;

  if new.kind = 'invoice' then
    select count(*)
      into invoice_total
      from public.audit_documents
     where audit_request_id = new.audit_request_id
       and kind = 'invoice';

    if invoice_total >= 10 then
      raise exception using
        errcode = '23514',
        message = 'invoice document limit reached';
    end if;
  else
    select count(*)
      into terms_total
      from public.audit_documents
     where audit_request_id = new.audit_request_id
       and kind in ('contract', 'rate_card');

    if terms_total >= 1 then
      raise exception using
        errcode = '23514',
        message = 'terms document limit reached';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_audit_document_limits() from public, anon, authenticated;

commit;
