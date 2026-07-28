# Maintiva Pilot Guide

Maintiva is positioned as a maintenance revenue recovery add-on. It should not replace the shop management system during the pilot. Shops keep using their current POS/calendar workflow, export data to CSV, work the Maintiva queue, and manually record outreach and appointment outcomes.

## Pilot Setup

1. Create or select a Supabase project.
2. Set `DATABASE_URL` to the Supabase PostgreSQL connection string.
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `APP_URL`.
4. Run `pnpm prisma migrate deploy` against the pilot database.
5. Run `pnpm run db:seed` only for a demo database, not a production pilot shop.
6. In Supabase Auth, set the site URL to `APP_URL` and add redirects for `/onboarding` and `/password-reset`.
7. Create the pilot owner user in Supabase Auth and let first login complete shop onboarding.

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

Do not expose service-role keys in browser or Vercel public variables. Keep `NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET` unset or `false` for real pilot shops.

## Acceptance Checklist

- Authenticated owner can onboard a shop.
- Dashboard renders revenue recovery KPIs.
- Import page parses a CSV, detects mapping, validates rows, detects duplicates, writes accepted rows, records import history, and downloads template/error reports.
- Revenue Recovery Queue explains due, overdue, and declined-work opportunities.
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
