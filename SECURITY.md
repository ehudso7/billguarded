# Security

Reqovr handles commercially sensitive contracts, rate cards, invoices, and billing metadata.

- Never commit Stripe secret keys, Supabase secret/service-role keys, webhook secrets, or signing secrets.
- Store all audit documents in the private `audit-documents` bucket.
- Browser code may only receive the Supabase publishable key and short-lived signed upload tokens.
- Stripe webhook events must pass signature verification before any database mutation.
- Tables in the exposed `public` schema have RLS enabled and no `anon` or `authenticated` grants in the initial server-only model.
- Rotate any secret immediately if it is pasted into chat, an issue, a commit, a build log, or another non-secret channel.
