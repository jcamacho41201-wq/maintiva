# Maintiva

**Recover Maintenance Revenue.**

Maintiva is a maintenance revenue recovery add-on for auto repair shops. It helps a shop owner import customer, vehicle, service history, declined work, and appointment data from existing systems, identify recoverable maintenance revenue, generate manual advisor outreach, schedule bundled appointments, and attribute recovered revenue.

## Current Architecture

- Next.js App Router, TypeScript, React, Tailwind CSS
- Supabase Auth for signup, signin, signout, and password reset
- Supabase PostgreSQL accessed through Prisma as the single database layer
- Multi-tenant tables scoped by `shopId` with `ShopMembership` verification before server-side reads and mutations
- Existing dashboard, customer, vehicle, revenue queue, import, capacity, appointment, and service-library workflows preserved
- Production mode hydrates and mutates through `/api/pilot/state` and `/api/pilot/mutate`
- Local demo persistence and reset are available only when Supabase is not configured.

## Revenue Recovery MVP Features

- Account creation and login through Supabase Auth
- First-login onboarding for shop name, contact details, timezone, and bay capacity
- Database-backed entities for `User`, `Shop`, `ShopMembership`, `Customer`, `Vehicle`, `ServiceDefinition`, `VehicleMaintenanceRecord`, `ServiceHistoryRecord`, `DeclinedWorkRecord`, `MaintenanceRevenueOpportunity`, `OutreachRecord`, `Appointment`, `AppointmentService`, `ImportHistoryRecord`, and `ImportRowRecord`
- Customer and vehicle CRUD paths with validation and archive-ready fields
- Shop-scoped services library seeded with common preventative services
- CSV import workflow with template download, column mapping, validation, duplicate detection, preview, server-side accepted-row import, and import history
- Revenue Recovery Queue ranked by due maintenance, overdue maintenance, declined work, priority, value, and labor time
- Manual outreach workflow with channel, response, copied, manually sent, follow-up, booked, snoozed, declined, and stopped states
- No live SMS/email sending in the pilot MVP; Maintiva generates editable copy and records manual advisor status only
- Appointment creation with bundled services, duplicate prevention on vehicle/start time, cancellation/completion-ready statuses
- Capacity calendar for day/week scheduling, Ready to Schedule opportunities, drag rescheduling, duration resizing, capacity warnings, and Maintiva revenue attribution
- Capacity planning for 7, 14, and 30 day labor windows
- ROI report for identified, contacted, responded, booked, completed, and recovered revenue
- Dashboard metrics computed from the active shop state and Maintiva-attributed appointments
- Public privacy and terms pages

## Tenant Security

All production API routes derive `shopId` from the authenticated Supabase user’s active `ShopMembership`. Browser payloads that include `shopId` are rejected before validation. Server mutations re-check that fetched customers, vehicles, maintenance records, outreach records, and appointments belong to the active shop.

Do not expose Supabase service-role keys in the browser or Vercel public variables. This app uses the Supabase anon key for Auth and Prisma for database access.

If you later add Supabase Data API calls, add Row Level Security policies equivalent to membership checks before shipping.

## Local Setup

```bash
pnpm install
cp .env.example .env
pnpm prisma generate
pnpm prisma migrate dev
pnpm run db:seed
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Pilot operating instructions are in [docs/PILOT-GUIDE.md](docs/PILOT-GUIDE.md).

## Supabase Setup

1. Create a Supabase project.
2. Copy the Supabase project URL and anon key into `.env`.
3. Use the Supabase PostgreSQL connection string for `DATABASE_URL`.
4. In Supabase Auth, set the site URL to `APP_URL`.
5. Add redirect URLs for `/onboarding` and `/password-reset`.
6. Link the local Supabase CLI project and push the version-controlled migrations:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

The Supabase migration in `supabase/migrations/` creates the Prisma-backed application tables, timestamp triggers, Supabase Auth user trigger, and membership-based Row Level Security policies. Do not mark production ready until the migration has been pushed to the remote Supabase project.

Calendar schema changes are versioned in `supabase/migrations/20260728202000_capacity_calendar.sql`. Apply migrations before testing calendar writes:

```bash
npx supabase db push --dry-run
npx supabase db push
```

For local-only development against a local database, Prisma migrations remain useful:

```bash
pnpm prisma migrate dev
```

Required environment variables:

- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `APP_URL`

When using the Vercel Supabase integration, `POSTGRES_PRISMA_URL` may be provided instead of `DATABASE_URL`; Maintiva will use it for Prisma server-side database writes and normalize Supabase `sslmode=require` URLs to libpq-compatible TLS semantics.

Optional:

- `SUPPORT_EMAIL`
- `NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `EMAIL_API_KEY`
- `EMAIL_FROM`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `VIN_API_BASE_URL`

## Demo and Admin Procedure

The seeded demo shop is `Cedar Bay Auto Works` with demo-compatible users:

```text
owner@maintiva.dev
advisor@maintiva.dev
```

These are Supabase Auth user IDs in seed data, not local passwords. For a live demo account, create matching users in Supabase Auth, then run `pnpm run db:seed` against a non-production demo database.

Reset is intentionally local-demo-only and requires `NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET=true`. Real pilot shops should keep that variable unset or `false`.

When Supabase URL and anon key are configured, the demo reset flag does not switch data storage to localStorage. Production writes must go through the API and Supabase PostgreSQL.

## Commands

```bash
pnpm run dev
pnpm run build
pnpm run start
pnpm run lint
pnpm test
pnpm prisma generate
pnpm prisma migrate dev
pnpm run db:seed
```

## Capacity Calendar

The `/appointments` page is a Maintiva-specific capacity calendar, not a replacement for the shop-management calendar. Revenue opportunities remain unscheduled work until a user intentionally creates an appointment. Only saved appointments consume labor capacity.

- Day and week views render appointments by shop time zone, start time, and duration.
- Empty slots open a manual appointment form with customer, vehicle, services, date, start time, status, notes, and attribution source.
- Ready to Schedule keeps interested, contacted, high-priority, due, and declined-work opportunities in a side panel until the database confirms booking.
- Dragging a Ready to Schedule card onto the calendar opens a confirmation form; saving links the appointment to maintenance/declined work and Maintiva attribution.
- Dragging appointment blocks reschedules active appointments; dragging the lower resize handle updates duration and labor hours. Completed, canceled, and no-show appointments are not draggable.
- Capacity warnings appear for over-capacity days, after-hours appointments, duplicate vehicle appointments, and overlapping customer appointments. Users must explicitly choose to save anyway.
- Completing a Maintiva-attributed appointment moves it from booked revenue to recovered revenue in dashboard and ROI calculations.

Manual calendar test path:

1. Sign in and complete onboarding for a real pilot shop.
2. Open `/appointments`, confirm the shop time zone shown in the calendar header, and switch between Day and Week.
3. Create a manual appointment from an empty slot, refresh, and confirm it persists.
4. Drag the appointment to another slot, refresh, and confirm the new time persists.
5. Drag the resize handle to change duration, then confirm capacity updates.
6. Drag a Ready to Schedule opportunity onto the calendar, save it, and confirm booked Maintiva revenue increases.
7. Move or edit an appointment into an over-capacity day and confirm the warning appears before saving.
8. Open Find Work to Fill This Day and schedule one listed opportunity.
9. Mark an appointment confirmed, in progress, and complete with final revenue/labor, then confirm recovered revenue updates in `/analytics`.
10. Log out and back in, then confirm appointment and revenue changes remain scoped to the same shop.

Deferred calendar features: technician calendars, bay-specific scheduling, Google/Outlook sync, parts availability, customer self-booking, recurring appointments, multi-location scheduling, work orders, invoicing, payments, live reminders, SMS, email automation, and AI calling.

## Vercel Deployment

Set the required Supabase and database environment variables in Vercel, push the Supabase migrations to Supabase PostgreSQL, and deploy from GitHub. Do not set service-role secrets as public variables.

Production Vercel builds run `prisma migrate deploy` before `prisma generate` and `next build` so the Prisma-backed tables exist in the database used by the deployment. The migration command prefers `POSTGRES_URL_NON_POOLING` when Vercel provides it, while runtime writes continue to use the normal Prisma database URL priority. Local and preview builds skip automatic migration deployment.

Required Supabase dashboard settings:

- Auth Site URL: `APP_URL`
- Auth Redirect URLs: `APP_URL/onboarding` and `APP_URL/password-reset`
- Database connection string copied into `DATABASE_URL`

Migration commands:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

## Deferred Until After First Pilot

- Live SMS, email, and call providers
- Calendar sync and customer self-booking
- Direct shop-management integrations
- Fine-grained role permission UI
- VIN decoding, recall checks, and vehicle-history enrichment
- Source-specific import adapters for each shop management export format
