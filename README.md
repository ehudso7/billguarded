# Reqovr

Reqovr is a self-service 3PL invoice audit and monitoring product for ecommerce operators. It reconciles fulfillment invoices against contracts and rate cards, surfaces evidence-backed discrepancies, and supports a one-time Full 90-Day Audit plus recurring Continuous Monitor billing.

## Validation offers

- Full 90-Day Audit — **$1,500 one time**
- Continuous Monitor — **$599/month**

Stripe Checkout is hosted by Stripe. Payment state is synchronized through a signed webhook and stored separately from uploaded evidence.

## Stack

- Next.js 16 / React 19
- Stripe Checkout + Billing + Customer Portal
- Supabase Postgres + private Storage
- Vercel
- GitHub Actions

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add the server-only Stripe and Supabase secrets locally. Never commit them.
3. Apply `supabase/migrations/20260821070000_initial_reqovr.sql` to the Reqovr Supabase project.
4. Configure the Stripe webhook endpoint as `/api/stripe/webhook`.
5. Subscribe the webhook to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
6. Run `npm install`, then `npm run dev`.

## Required environment variables

See `.env.example`.

For Supabase, use a modern `sb_publishable_...` key in browser-safe configuration and a backend-only `sb_secret_...` key where available. Never expose the secret key with a `NEXT_PUBLIC_` prefix.

## Security model

The first validation build intentionally avoids a full application account system. Intake and document operations are server-authorized, uploads use short-lived signed upload URLs, document slots are enforced in Postgres, and uploaded files must be verified in the private bucket before they can satisfy the Checkout gate. Customer Portal access is granted only to the browser that successfully completed Checkout via an HMAC-signed HttpOnly cookie.

Delayed Stripe payment methods are not provisioned on `checkout.session.completed` until Stripe reports the Checkout Session paid; `checkout.session.async_payment_succeeded` completes provisioning when applicable.

Before broad production launch, add durable user authentication, organization-level authorization, and edge rate limiting / bot protection for public intake routes.
