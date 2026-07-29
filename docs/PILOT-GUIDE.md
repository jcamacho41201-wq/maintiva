# Maintiva Pilot Guide

Maintiva is positioned as a maintenance revenue recovery add-on. It should not replace the shop management system during the pilot. Shops keep using their current POS/calendar workflow, export data to CSV, work the Maintiva queue, and manually record outreach and appointment outcomes.

The complete release gate is maintained in [PILOT-RELEASE-CHECKLIST.md](PILOT-RELEASE-CHECKLIST.md). Do not describe a deployment as ready for one controlled pilot shop until that checklist passes against a real non-demo tenant.

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

The migrations create the Prisma-backed application tables, timestamp triggers, Supabase Auth user trigger, active-membership RLS policies, calendar schema, and pilot policy tightening. The database is not ready until every migration, including `20260728211500_pilot_readiness_security.sql`, has been pushed to the remote Supabase project.

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

After a successful import, use the post-import links to inspect imported customers, revenue opportunities, and import history before contacting customers.

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

## Capacity Calendar Workflow

Use `/appointments` to schedule Maintiva-recovered work onto a visual day or week calendar. Maintiva opportunities are possible work; appointments are calendar commitments. Opportunities do not consume capacity until a user schedules and saves an appointment.

1. Use Today, Previous, Next, Day, and Week controls to review the shop schedule in the configured shop time zone.
2. Click an empty slot or New Appointment to create manual shop work with customer, vehicle, services, status, estimated labor, estimated price, notes, and attribution.
3. Open Ready to Schedule to review opportunities with customer interest, contacted/high-priority work, due maintenance, and declined work.
4. Drag an opportunity onto a slot or use Schedule. Confirm the prefilled form before saving. The opportunity stays in the panel until the save succeeds.
5. Drag active appointment blocks to reschedule. Drag the lower resize handle to change duration and labor hours. Completed, canceled, and no-show appointments are protected from drag changes.
6. Review warnings for over-capacity days, outside-hours work, duplicate vehicle appointments, and customer overlap. Save anyway only after confirming the overbooking is intentional.
7. Use Find Work to Fill This Day for days with open capacity. Maintiva ranks matching opportunities by interest, priority, declined work, labor fit, and revenue.
8. Open an appointment to mark it confirmed, start it, cancel it with history preserved, view customer/vehicle, or mark the job complete.
9. Complete appointments with final revenue and labor. Maintiva-attributed work counts as recovered revenue only after completion.

Run these migration commands before testing calendar writes against a Supabase project:

```bash
npx supabase db push --dry-run
npx supabase db push
```

Calendar features deferred until after the pilot include technician-specific calendars, bay scheduling, external calendar sync, customer self-booking, recurring appointments, parts scheduling, live reminders, work orders, invoicing, and payments.

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
- Active user has an active `ShopMembership`; customer and vehicle writes reject missing or cross-shop membership.
- Dashboard renders revenue recovery KPIs.
- Import page parses a CSV, detects mapping, validates rows, detects duplicates, writes accepted rows, records import history, and downloads template/error reports.
- Revenue Recovery Queue explains due, overdue, and declined-work opportunities.
- Manual outreach copy can be generated, copied, marked manually sent, and assigned a response status.
- Appointment booking from outreach updates dashboard revenue, appointments, and capacity in demo/local mode.
- Capacity calendar creates manual appointments, schedules ready opportunities, warns before overbooking, preserves shop-time selections after refresh, and keeps each shop tenant-isolated.
- Capacity and ROI pages render without console or page errors.
- `pnpm run lint`, `pnpm test`, and `pnpm run build` pass.

Use [PILOT-RELEASE-CHECKLIST.md](PILOT-RELEASE-CHECKLIST.md) for the full real-tenant acceptance test.

## Deferred

- Live messaging providers.
- Calendar sync and customer self-booking.
- Direct integrations with shop management systems.
- Direct write integrations with shop management systems.
- Fine-grained role permission UI.
- VIN decoding and recall enrichment.
