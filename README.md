# Reqovr

Reqovr is a self-service 3PL invoice audit and monitoring product for ecommerce operators. It reconciles fulfillment invoices against contracts and rate cards, surfaces evidence-backed discrepancies, and supports a one-time Full 90-Day Audit plus recurring Continuous Monitor billing.

## Validation offers

- Full 90-Day Audit — **$1,500 one time**
- Continuous Monitor — **$599/month**

Stripe Checkout is hosted by Stripe. Payment state is synchronized through a signed webhook and stored separately from uploaded evidence.

## Stack

- Next.js 16 / React 19
- Stripe Checkout + Billing + Customer Portal
- Supabase Postgres + private Storage + Vault
- Vercel
- GitHub Actions

## Deployment binding

- GitHub: `ehudso7/reqovr`
- Vercel project: `everton-hudsons-projects/reqovr`
- Vercel project ID: `prj_uFLTZhEoI8rkgGtYPKn3K5wRrzuI`
- Supabase project: `rduryyyprvwqzopsvzvr` (`reqovr-db`)
- Production alias: `reqovr.vercel.app`

The initial Vercel production deployment was created from the bootstrap `main` commit before the Next.js application existed. Feature-branch preview deployments are used to validate the real application before merging to `main`.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add a server-only Stripe sandbox key locally. Never commit it.
3. Ensure the Reqovr Supabase Marketplace variables are available locally (or fill the three Supabase entries in `.env.local`).
4. Apply the migrations in `supabase/migrations/` in version order.
5. Store the Stripe webhook signing secret in Supabase Vault under the unique name `reqovr_stripe_webhook_secret`; do not commit or log it.
6. Configure the Stripe webhook endpoint as `/api/stripe/webhook` and subscribe it to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
7. Run `npm ci`, then `npm run dev`.

## Runtime configuration

See `.env.example`.

Vercel Marketplace automatically synchronizes the Reqovr Supabase URL, publishable key, and backend secret into the connected project. The native Vercel Stripe integration is preferred for `STRIPE_SECRET_KEY` so the API key does not need to be copied through source code or chat.

The sandbox Price IDs are locked in source for this validation environment. If Reqovr is switched to a live Stripe secret key, the code fails closed unless `STRIPE_PRICE_AUDIT_90_DAY` and `STRIPE_PRICE_CONTINUOUS_MONITOR` are explicitly configured with live Price IDs.

The Stripe webhook signing secret is encrypted in Supabase Vault and exposed only through `public.reqovr_stripe_webhook_secret()`, whose EXECUTE privilege is limited to `service_role`. `anon` and `authenticated` cannot call it.

## Security model

The first validation build intentionally avoids a full application account system. Intake and document operations are server-authorized, uploads use short-lived signed upload URLs, document slots are enforced in Postgres, and uploaded files must be verified in the private bucket before they can satisfy the Checkout gate. Customer Portal access is granted only to the browser that successfully completed Checkout via an HMAC-signed HttpOnly cookie.

The billing cookie key is derived with domain separation from the backend-only Supabase secret, eliminating a second manually managed signing secret. Checkout and Portal return origins come from the actual request origin rather than a manually configured application URL.

Delayed Stripe payment methods are not provisioned on `checkout.session.completed` until Stripe reports the Checkout Session paid; `checkout.session.async_payment_succeeded` completes provisioning when applicable.

Before broad production launch, add durable user authentication, organization-level authorization, and edge rate limiting / bot protection for public intake routes.
