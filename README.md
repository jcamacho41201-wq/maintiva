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
- Local demo mode is available only when Supabase is not configured or `NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET=true`

## Revenue Recovery MVP Features

- Account creation and login through Supabase Auth
- First-login onboarding for shop name, contact details, timezone, and bay capacity
- Database-backed entities for `User`, `Shop`, `ShopMembership`, `Customer`, `Vehicle`, `ServiceDefinition`, `VehicleMaintenanceRecord`, `ServiceHistoryRecord`, `DeclinedWorkRecord`, `OutreachRecord`, `Appointment`, `AppointmentService`, and `ImportHistoryRecord`
- Customer and vehicle CRUD paths with validation and archive-ready fields
- Shop-scoped services library seeded with common preventative services
- CSV import workflow with template download, column mapping, validation, duplicate detection, preview, and import history
- Revenue Recovery Queue ranked by due maintenance, overdue maintenance, declined work, priority, value, and labor time
- Manual outreach workflow with channel, response, copied, manually sent, follow-up, booked, snoozed, declined, and stopped states
- No live SMS/email sending in the pilot MVP; Maintiva generates editable copy and records manual advisor status only
- Appointment creation with bundled services, duplicate prevention on vehicle/start time, cancellation/completion-ready statuses
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
6. Run Prisma migrations against the database.

Required environment variables:

- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `APP_URL`

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

Reset is intentionally not shown in production unless `NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET=true`. Real pilot shops should keep that variable unset or `false`.

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

## Vercel Deployment

Set the required Supabase and database environment variables in Vercel, run migrations against Supabase PostgreSQL, and deploy from GitHub. Do not set service-role secrets as public variables.

## Deferred Until After First Pilot

- Live SMS, email, and call providers
- Calendar sync and customer self-booking
- Direct shop-management integrations
- Fine-grained role permission UI
- VIN decoding, recall checks, and vehicle-history enrichment
- Write-through server import mutations for production CSV ingestion
