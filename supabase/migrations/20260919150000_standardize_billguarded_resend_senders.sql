begin;

-- Keep legacy support-address lifecycle events reconcilable during the bounded
-- sender transition. New outbound mail uses only notifications@billguarded.com.
create or replace function public.billguarded_record_resend_event(
  p_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_provider_created_at timestamptz,
  p_from_address text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.audit_deliveries%rowtype;
  v_inserted boolean;
  v_new_status text;
begin
  if p_event_id is null or p_provider_message_id is null or p_provider_created_at is null
    or p_event_type not in ('email.sent', 'email.delivered', 'email.bounced', 'email.failed', 'email.suppressed', 'email.complained')
    or pg_catalog.lower(pg_catalog.btrim(p_from_address)) not in (
      'notifications@billguarded.com',
      'billguarded <notifications@billguarded.com>',
      'support@billguarded.com',
      'billguarded <support@billguarded.com>'
    )
  then
    return false;
  end if;

  select d.* into v_delivery from public.audit_deliveries d
   where d.provider_message_id = p_provider_message_id for update;
  if not found then return false; end if;

  insert into public.resend_delivery_events (
    event_id, provider_message_id, delivery_id, event_type, provider_created_at
  ) values (
    p_event_id, p_provider_message_id, v_delivery.id, p_event_type, p_provider_created_at
  ) on conflict (event_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then return true; end if;

  v_new_status := case p_event_type
    when 'email.sent' then 'sent'
    when 'email.delivered' then 'delivered'
    when 'email.bounced' then 'bounced'
    when 'email.failed' then 'failed'
    when 'email.suppressed' then 'suppressed'
    when 'email.complained' then 'complained'
  end;

  update public.audit_deliveries d
     set status = case
           when p_event_type = 'email.sent' and d.status in ('accepted', 'sent') then 'sent'
           when p_event_type = 'email.delivered' and d.status in ('accepted', 'sent', 'delivered') then 'delivered'
           when p_event_type in ('email.bounced', 'email.failed', 'email.suppressed', 'email.complained') then v_new_status
           else d.status
         end,
         provider_last_event_at = pg_catalog.greatest(
           coalesce(d.provider_last_event_at, p_provider_created_at), p_provider_created_at
         ),
         notified_at = case when p_event_type = 'email.delivered'
           then coalesce(d.notified_at, pg_catalog.now()) else d.notified_at end,
         last_error_code = case when p_event_type in ('email.bounced', 'email.failed', 'email.suppressed', 'email.complained')
           then p_event_type else d.last_error_code end,
         last_error_message = case when p_event_type in ('email.bounced', 'email.failed', 'email.suppressed', 'email.complained')
           then 'Resend reported a terminal customer-delivery event.' else d.last_error_message end,
         updated_at = pg_catalog.now()
   where d.id = v_delivery.id;

  if p_event_type in ('email.bounced', 'email.failed', 'email.suppressed', 'email.complained') then
    update public.audit_requests ar
       set customer_delivery_last_error = p_event_type, updated_at = pg_catalog.now()
     where ar.id = v_delivery.audit_request_id;
  end if;

  return true;
end;
$$;

comment on function public.billguarded_record_resend_event(text, text, text, timestamptz, text)
  is 'Records verified Resend delivery events. Canonical notifications senders are required for new mail; legacy support senders remain accepted only for lifecycle reconciliation during the transition ending 2026-10-19.';

commit;
