# Supabase security-advisor certification — 2026-08-27

BillGuarded's operational tables are server-only. Direct `anon` and `authenticated` table grants are intentionally absent, RLS is enabled, and application access is performed through the server-side Supabase service role.

This certification adds an explicit `deny_client_access` RLS policy for `anon` and `authenticated` on:

- `audit_documents`
- `audit_findings`
- `audit_requests`
- `audit_runs`
- `billing_customers`
- `billing_entitlements`
- `stripe_events`

The policies are defense in depth and make the intended access boundary explicit to both operators and the Supabase security advisor. Service-role behavior is unchanged.
