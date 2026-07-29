# Maintiva Pilot Guide

Maintiva is positioned as a maintenance revenue recovery add-on. It should not replace the shop management system during the pilot. Shops keep using their current POS/calendar workflow, export data to CSV, work the Maintiva queue, and manually record outreach and appointment outcomes.

## Pilot Setup

1. Create or select a Supabase project.
2. Set `DATABASE_URL` to the Supabase PostgreSQL connection string.
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `APP_URL`.
4. Push the version-controlled Supabase migrations against the pilot database:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

The migration creates the Prisma-backed application tables, timestamp triggers, Supabase Auth user trigger, and active-membership RLS policies. The database is not ready until the migration has been pushed to the remote Supabase project.

5. Run `pnpm run db:seed` only for a demo database, not a production pilot shop.
6. In Supabase Auth, set the site URL to `APP_URL` and add redirects for `/onboarding` and `/password-reset`.
7. Create the pilot owner user in Supabase Auth and let first login complete shop onboarding.

For adaptive mileage forecasting, confirm the catch-up migration exists before deployment review:

```text
supabase/migrations/20260729170000_adaptive_mileage_foundation.sql
```

Before applying it to the linked Supabase project, verify local schema and data backups, run `npx supabase migration list`, run `npx supabase db push --dry-run`, review the planned SQL, and get explicit approval.

## Data Import Workflow

Use `/import` for pilot imports.

1. Download the CSV template.
2. Export customers, vehicles, service history, declined work, and appointments from the current shop system.
3. Upload the CSV.
4. Select the import type.
5. Review detected column mappings and adjust fields.
6. Review row status:
   - `VALID`: ready to import.
   - `DUPLICATE`: matched by customer email, phone, exact name, or vehicle VIN.
   - `INVALID`: missing required data or invalid service economics.
7. Download the error report if invalid rows exist.
8. Confirm import to record import history.

Authenticated pilot imports are written server-side through the current shop context. Duplicate rows can be skipped, updated, or imported as new after review. Direct integrations with shop management systems remain deferred until real pilot exports are verified.

## Revenue Recovery Workflow

1. Open `/` to review recovered revenue, booked Maintiva revenue, open opportunity value, capacity, booking count, and outreach conversion.
2. Open `/automation` to work the Revenue Recovery Queue.
3. Prioritize high-value declined work, overdue maintenance, and items that fit near-term capacity.
4. Generate an editable message for due maintenance records.
5. Copy the message and send it manually from the shop's phone, email, or existing system.
6. Confirm manual send in Maintiva and record channel and customer response.
7. Book the appointment when the customer accepts.
8. Complete the appointment in the shop's existing system, then reconcile recovered revenue in Maintiva reporting.

Maintiva does not send live SMS, email, or calls in this MVP.

## Mileage Workflow

Use a vehicle page to review and update mileage.

1. Confirm Current mileage is sourced from the latest valid included mileage reading when readings exist.
2. Open Driving Profile and review annual, monthly, daily, source, and confidence values.
3. Save customer-reported annual mileage when the customer gives a representative estimate.
4. Use a manual override only with a reason, then reset it when enough mileage history exists.
5. Review Mileage History rows and exclude readings that are corrections, duplicates, or unresolved anomalies.
6. Use each maintenance item forecast preview to compare mileage-based and time-based due dates.

The mileage workflow does not automatically create, close, suppress, or modify revenue opportunities.

## Capacity Planning

Use `/capacity` to review open labor capacity for 7, 14, and 30 day windows. Capacity uses `Shop.dailyBayHours` and active appointments to estimate:

- available labor hours
- booked labor hours
- open labor hours
- scheduled revenue
- opportunity labor that can fill the window

## ROI Reporting

Use `/analytics` for the pilot ROI report. Export CSV or print the report for pilot check-ins. The report tracks:

- opportunities identified
- value identified
- customers contacted
- customer responses
- appointments booked through Maintiva
- booked Maintiva revenue
- completed Maintiva revenue
- average recovered repair order
- outreach, response, and booking conversion

## Tenant Security

Production API routes derive `shopId` from the authenticated Supabase user and active `ShopMembership`. Browser payloads that include `shopId` are rejected before validation. Server mutations re-check fetched entity ownership before writes.

Do not expose service-role keys in browser or Vercel public variables. Keep `NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET` unset or `false` for real pilot shops. When Supabase is configured, the reset flag does not switch production writes to localStorage.

## Acceptance Checklist

- Authenticated owner can onboard a shop.
- Dashboard renders revenue recovery KPIs.
- Import page parses a CSV, detects mapping, validates rows, detects duplicates, writes accepted rows, records import history, and downloads template/error reports.
- Revenue Recovery Queue explains due, overdue, and declined-work opportunities.
- Vehicle page shows Driving Profile, Mileage History, latest valid mileage, confidence, source, manual override/reset, and service forecast preview.
- Updating vehicle mileage creates a mileage reading and keeps it visible after refresh once the adaptive mileage migration is applied.
- Manual outreach copy can be generated, copied, marked manually sent, and assigned a response status.
- Appointment booking from outreach updates dashboard revenue, appointments, and capacity in demo/local mode.
- Capacity and ROI pages render without console or page errors.
- `pnpm run lint`, `pnpm test`, and `pnpm run build` pass.

## Deferred

- Live messaging providers.
- Calendar sync and customer self-booking.
- Direct integrations with shop management systems.
- Direct write integrations with shop management systems.
- Fine-grained role permission UI.
- VIN decoding and recall enrichment.
