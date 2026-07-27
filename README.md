# Maintiva

**Predict Maintenance. Drive Revenue.**

Maintiva is a predictive maintenance and customer management platform for auto repair shops. It helps shops manage customers and vehicles, estimate mileage between visits, track independent maintenance lifespans, bundle due services into recommended appointments, automate customer outreach, and forecast revenue and bay capacity.

## Features

- Multi-tenant shop architecture with every operational model scoped by `shopId`
- Credentials-based Auth.js/NextAuth foundation with role-ready users
- Responsive SaaS shell with sidebar navigation, global search, and user menu space
- Dashboard command center for customers, vehicles, maintenance opportunities, outreach, appointments, revenue, and capacity
- Browser-persistent demo workflow backed by localStorage with a Reset Demo Data action
- Customer list and customer detail views with consent, value, notes, vehicle history, and predicted service context
- Vehicle preventative maintenance dashboard with independent time/mileage life calculations
- Reusable services library with default intervals, thresholds, labor, and pricing
- Grouped automation queue that bundles services by customer and vehicle
- Simulated SMS, email, and call provider architecture
- Appointment data model for multi-service scheduling and capacity planning
- Prisma schema for PostgreSQL with seed data and audit-log groundwork
- Real Vitest coverage for mileage, lifespan, automation, outreach, appointment, and tenant-isolation behavior

## Technology Stack

- Next.js App Router
- TypeScript
- React
- Tailwind CSS
- shadcn/ui-inspired local components
- PostgreSQL
- Prisma ORM
- NextAuth
- Zod validation
- React Hook Form-ready dependencies
- Recharts
- Vercel deployment target

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

The demo seeds itself automatically on first visit. Use **Reset Demo Data** in the top bar to restore the original seeded shop, customers, vehicles, recommendations, outreach, and appointments.

## PostgreSQL Setup

Maintiva uses PostgreSQL in development and production. Do not switch to SQLite if deploying to Vercel.

Example local URL:

```bash
DATABASE_URL="postgresql://maintiva:maintiva@localhost:5432/maintiva?schema=public"
```

Run:

```bash
pnpm prisma migrate dev
pnpm run db:seed
```

## Environment Variables

Copy `.env.example` to `.env` and fill required values.

Required:

- `DATABASE_URL`
- `AUTH_SECRET`
- `NEXTAUTH_URL`
- `APP_URL`

Optional future integrations:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `EMAIL_API_KEY`
- `EMAIL_FROM`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `VIN_API_BASE_URL`

The app remains in demo mode when optional communication integrations are not configured.

## Demo Login

```text
Email: owner@maintiva.dev
Password: demo-password
```

These are development-only demo credentials.

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

## GitHub Setup

This repository is intended to be named `maintiva`.

```bash
git init
git add .
git commit -m "Initial Maintiva application setup"
git branch -M main
git remote add origin https://github.com/USERNAME/maintiva.git
git push -u origin main
```

Replace `USERNAME` with the GitHub owner. The username is intentionally not hardcoded.

Recommended feature branches:

```text
feature/customer-management
feature/maintenance-engine
feature/automation
feature/appointments
feature/integrations
```

Example commits:

```text
feat: add customer and vehicle management
feat: add preventative maintenance lifecycle engine
feat: add grouped automation queue
feat: add appointment scheduling workflow
fix: correct mileage prediction calculations
```

## Vercel Deployment

Maintiva is prepared for Vercel with a production-safe build script:

```json
{
  "build": "prisma generate && next build"
}
```

Deployment checklist:

- Provision a PostgreSQL-compatible database.
- Set `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`, and `APP_URL` in Vercel.
- Run migrations against the production database.
- Do not rely on local filesystem writes.
- Keep optional Twilio, email, Google Calendar, VIN, recall, and vehicle-history credentials unset until real providers are ready.

## Project Structure

```text
prisma/
  schema.prisma
  seed.ts
src/app/
  page.tsx
  customers/
  vehicles/
  services/
  automation/
  appointments/
  analytics/
  settings/
src/components/
  app-shell.tsx
  charts/
  ui/
src/lib/
  appointment.ts
  automation.ts
  auth.ts
  demo-data.ts
  maintenance-engine.ts
  providers.ts
  validation.ts
tests/
  maintenance-engine.test.ts
```

## Future Integration Roadmap

- Twilio SMS and Voice provider adapters
- Resend or SendGrid email provider
- Google Calendar availability and booking sync
- NHTSA VIN decoding and recall adapters
- CARFAX or approved vehicle-history enrichment
- Shop-management platform import adapters
- CSV import preview, duplicate detection, and rollback UI
- Customer booking portal and appointment confirmation flow
- Fine-grained role permissions for owners, managers, service advisors, and technicians

## Product Principle

Maintiva is not a generic CRM. It is built around this operating loop:

```text
Shop data establishes vehicle history
Maintiva predicts independent maintenance lifespans
Customers confirm mileage
Due services are bundled
Automated outreach is sent
Appointments are scheduled
Future bay utilization becomes visible
Preventative maintenance generates recurring revenue
```
