# Retention platform

Maintiva turns existing customer and vehicle history into future appointments and measured repeat revenue. Shop management software runs today's work. Maintiva creates tomorrow's.

## Audit and reuse map

| Area | Existing implementation | Decision |
| --- | --- | --- |
| Application | Next.js App Router, React client store, authenticated pilot API | Preserve routes and mutation boundary; add retention views |
| Tenancy | Supabase session cookies, active ShopMembership, server-derived shopId, RLS | Preserve; scope every aggregate and new mutation |
| Intake | Manual customer/vehicle entry and validated CSV pipeline | Same Customer, Vehicle, ServiceHistoryRecord and DeclinedWorkRecord; no parallel customer system |
| Prediction | service-intervals, adaptive-mileage, forecast-dates, persisted opportunity synchronization | Reuse calculations; estimates remain labeled |
| Opportunities | MaintenanceRevenueOpportunity, persisted source/stage, grouped by vehicle | Retention Opportunities; do not generate duplicate opportunities for campaign views |
| Outreach | ContactCustomerModal, canonical SMS consent, OutreachRecord, manual email/call | Human approval; no production provider is connected |
| Capacity | SmartMaintenanceBlock, services, blackouts, capacity calculator | Reuse controlled windows and pending commitments |
| Requests | Hashed secure tokens, public request page, advisor approval, exactly-one appointment | Preserve; primary calendar remains authoritative |
| Attribution | Appointment.attributionSource, completedRevenueCents, completedAt | Actual revenue requires recorded completion amount; never fall back to a quote |
| Profiles | Customer/vehicle, history, declined work, messages, requests | Add one chronological retention timeline |
| Marketing | No standalone marketing website in this repository | Add public /about; retain authenticated dashboard at / |

## Implementation order

1. Shared retention selectors: tenant-scoped worklist, honest contact metrics, actual revenue, upcoming 30/60/90-day estimates.
2. Dashboard, opportunities, daily outreach, performance and responsive navigation.
3. Profiles and communication timeline, campaign views using existing data and configuration.
4. Fast manual service visit entry using existing service, history, mileage and declined-work records.
5. Intake/integration boundary documentation and public positioning matched to shipped capabilities.
6. Regression tests, production build, desktop/mobile visual checks, draft PR.

## Schema and lifecycle decisions

No replacement schema is necessary for the initial repositioning. IDENTIFIED, CONTACTED, RESPONDED, BOOKED, COMPLETED and LOST remain stored in MaintenanceRevenueOpportunity. Snooze comes from OutreachRecord; pending requests come from AppointmentRequest. Ready/awaiting-review labels are eligibility projections of these records, not separately saved lifecycle states. Approval to send occurs at the explicit send action; it is not claimed as durable approval for later unattended delivery.

The existing database does not store campaign definitions, execution schedules, subscription charges, provider credentials, or external repair-order identifiers. Persistent campaign scheduling and subscription ROI need additive models, migrations and separate deployment verification. Do not overload notes, localStorage, or unrelated tables to pretend these exist.

Campaigns in this increment are human-reviewed worklists, configured through service thresholds and Smart Maintenance Blocks. Reactivation uses existing overdue evidence; it is not a statistical churn prediction. Service visits reset interval forecasts without rewriting closed opportunity history. The existing engine does not reopen completed/lost opportunities; durable recurring opportunity cycles need a separate lifecycle design before unattended post-service campaigns can be released. No autonomous sends or active Shopmonkey/Tekmetric connection is claimed.

## Future connector contract

Manual entry, CSV and future providers must normalize into the existing models, validate customer/vehicle/service ownership on the server, and invoke the same mileage/profile/opportunity synchronization. A provider adapter must supply a provider name, external event ID, source occurrence date, service/mileage/value fields and explicit completed/deferred semantics. Reject ambiguous outcomes. Persist provider identity and external IDs with tenant-scoped uniqueness before accepting live webhooks. Never infer consent from an imported phone number.

For connected shops, closed repair orders and operational customer details are authoritative in the configured provider; Maintiva owns forecasts, opportunities, outreach, requests and attribution. Do not implement live provider ingestion until durable deduplication, retries, conflict policy and provider authorization are available.

## Release boundaries

No production migrations, merge, real SMS, or legacy /book enablement are part of this PR. Existing records and historical mileage are preserved. Estimated opportunity and scheduled values are distinct from recorded recovered revenue. Missing revenue and subscription-cost data remain explicitly unknown.

## Verification and authenticated QA

Local verification: lint, full Vitest suite, production build with migrations disabled, desktop (1440px) and mobile (390px) route checks, mobile drawer and canonical contact modal. New tests cover actual revenue, report periods, tenant filters, draft review invalidation, SMS segment sizing, failed send retries, and service visit validation/authorization/idempotency. Database mutation tests use mocked transactions, not a production database.

Before merge, use the authenticated preview with QA records to verify a completed/deferred service visit, refresh persistence, expected upcoming dates, call/email logging, request-link and appointment regressions, and cross-shop isolation. Confirm failed provider attempts never update real-contact metrics. No local demo service visit is represented as a successful database save. Live SMS remains unavailable pending provider configuration.
