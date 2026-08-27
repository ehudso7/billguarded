-- BillGuarded server-only tables are accessed exclusively with the Supabase service role.
-- These explicit deny policies document and enforce that browser/client roles must never
-- receive direct table access, while also keeping the Supabase security advisor clean.

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'audit_documents',
    'audit_findings',
    'audit_requests',
    'audit_runs',
    'billing_customers',
    'billing_entitlements',
    'stripe_events'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS deny_client_access ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY deny_client_access ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      table_name
    );
  END LOOP;
END
$$;
