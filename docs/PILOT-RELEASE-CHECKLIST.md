# Maintiva Pilot Release Checklist

Maintiva is not yet ready for a controlled pilot with one shop until this checklist passes against a real non-demo Supabase tenant.

## Scope

The pilot value loop is:

1. Import shop data.
2. Identify recoverable maintenance or declined work.
3. Contact the customer manually.
4. Book the appointment.
5. Complete the work.
6. Attribute ROI back to Maintiva.

The pilot must preserve existing Maintiva branding and architecture. It must not rely on localStorage, demo-only state, permissive RLS, service-role credentials in the browser, or simulated successful saves.

## Current Audit

Already working:

- Supabase Auth sign up, email/password sign in, password reset, and sign out screens exist.
- Server routes derive the active shop from Supabase user plus active `ShopMembership`.
- Browser payloads containing `shopId` are rejected before mutation validation.
- Customer add/edit writes wait for server confirmation before showing success.
- Vehicle add/edit, outreach marking, and recommendation appointment booking now wait for server confirmation before showing success.
- Customer, vehicle, outreach, appointment, import, and calendar mutations are implemented through `/api/pilot/mutate`.
- CSV import supports upload, mapping, ignored columns, preview, validation, duplicate detection, row-level hold/skip/update/import actions, partial import, error CSV, and import history.
- Revenue queue groups due maintenance and declined work, shows value/labor/urgency context, and exposes manual outreach and scheduling flows.
- Capacity calendar supports day/week views, manual appointment creation, opportunity scheduling, drag rescheduling, resizing, capacity warnings, and completion tracking.
- Dashboard, capacity, and analytics pages calculate shop KPIs from the hydrated shop state.
- Service definitions are seeded per shop.
- Supabase migrations define app tables, triggers, auth user sync, membership RLS, calendar statuses, and pilot policy tightening.

Partially working:

- Roles are represented as `OWNER`, `MANAGER`, `SERVICE_ADVISOR`, and `TECHNICIAN`; pilot language should present these as Owner and Staff until finer UI exists.
- Onboarding collects shop contact, timezone, and daily bay hours, but not full weekly business hours, closed days, or default labor rate.
- Settings displays account/shop data, but employee invite/revoke and editable shop settings are still admin/manual procedures.
- CSV rows can be held or skipped, but inline cell editing inside the preview grid is not yet implemented.
- Service library is visible and seeded, but editing/deactivation UI is deferred.
- Revenue opportunity records are partly derived from current state rather than fully materialized as the source of truth.
- Manual outreach records channel, copied/sent, response, booking, snooze, and stop states in the data model, but not every queue icon has a complete user-facing action flow yet.

Missing:

- In-app employee invite and revoke screens.
- In-app shop disable/re-enable admin screens.
- Archive/restore controls for customers and vehicles.
- Live SMS, email, calls, customer self-booking, calendar sync, work orders, payments, and shop-management-system integrations.
- Automated production smoke test that creates a Supabase user, shop, import, appointment, completion, and second-shop isolation proof.

Broken or blocking until verified:

- Production readiness remains blocked until a real non-demo tenant completes the end-to-end acceptance test below after all Supabase migrations are pushed.

## Required Environment

- `DATABASE_URL` or Vercel `POSTGRES_PRISMA_URL` for Prisma runtime writes.
- `POSTGRES_URL_NON_POOLING` for Vercel production migration deployment when provided by the integration.
- `NEXT_PUBLIC_SUPABASE_URL`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `APP_URL`.
- `SUPPORT_EMAIL`.
- `NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET=false` or unset for production.

Never expose Supabase service-role keys through browser or `NEXT_PUBLIC_` variables.

## Database Checklist

- Apply every file in `supabase/migrations`.
- Confirm `20260728211500_pilot_readiness_security.sql` is present in Supabase migration history.
- Confirm RLS remains enabled on all application tables.
- Confirm customer insert/update policies use active shop membership checks.
- Confirm shop and membership management policies are owner-scoped.
- Confirm no app policy uses `USING (true)` or `WITH CHECK (true)` after the policy-tightening migration.

## Acceptance Test

Run this in the deployed app using a real Supabase Auth user and a real, non-demo shop:

1. Sign in with the pilot owner email/password.
2. Complete onboarding if prompted.
3. Confirm the active shop name and timezone are correct.
4. Add a customer manually.
5. Verify the customer row exists in Supabase `Customer`.
6. Refresh Maintiva and confirm the customer remains.
7. Edit the customer and confirm the edit remains after refresh.
8. Log out and back in and confirm the customer remains.
9. Add a vehicle to that customer.
10. Verify the vehicle row exists in Supabase `Vehicle`.
11. Import a CSV containing one new customer, one vehicle, and one service.
12. Confirm valid rows import even if another row is held or invalid.
13. Verify imported rows appear in Supabase `Customer`, `Vehicle`, and related service/import tables.
14. Open the Revenue Recovery Queue and confirm imported recoverable work appears or is reflected in opportunity totals.
15. Generate outreach copy.
16. Copy the message.
17. Mark it manually sent with a channel and response status.
18. Verify the outreach row exists in Supabase `OutreachRecord`.
19. Book the appointment from the workflow.
20. Verify the appointment row exists in Supabase `Appointment`.
21. Refresh Maintiva and confirm the appointment remains.
22. Open the capacity calendar and confirm the appointment consumes capacity in the shop timezone.
23. Edit or move the appointment and confirm the change remains after refresh.
24. Complete the appointment with final revenue and labor.
25. Confirm dashboard and analytics recovered revenue update.
26. Log out and back in and confirm the completed appointment and revenue remain.
27. Create a second Supabase user and second shop.
28. Confirm the second shop cannot select, view, edit, or import into the first shop's customers, vehicles, outreach, appointments, or import history.
29. Confirm the first shop cannot access the second shop's records.
30. Run `pnpm run lint`, `pnpm test`, and `pnpm run build` from the exact deployed branch.

Only after this passes should the release be described as ready for one controlled pilot shop.

## Admin Procedures

Pilot owner creation:

1. Create the owner in Supabase Auth.
2. Have the owner sign in to Maintiva.
3. Complete onboarding to create the shop and owner membership.
4. Confirm an active `ShopMembership` row exists for the owner and shop.

Employee invite/revoke until UI exists:

1. Create the staff user in Supabase Auth.
2. Insert a `ShopMembership` row for the target shop using role `SERVICE_ADVISOR` or `TECHNICIAN`.
3. To revoke, set `isActive=false` on that membership.
4. Confirm the revoked staff user can no longer load shop data.

Shop disable/re-enable until UI exists:

1. Set `Shop.status='SUSPENDED'` to disable app access for that shop.
2. Set `Shop.status='ACTIVE'` to re-enable access.
3. Confirm affected users are redirected to onboarding or blocked from state loading as expected.

Demo tenant reset:

1. Use only a non-production demo database.
2. Keep `NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET=true` only for local/demo environments.
3. Run `pnpm run db:seed` against the demo database.

## Verification Commands

```bash
pnpm run lint
pnpm test
pnpm run build
```
