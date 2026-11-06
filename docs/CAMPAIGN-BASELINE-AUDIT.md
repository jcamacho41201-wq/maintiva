# Campaign baseline audit

Audit dates: November 4-5, 2026 (America/New_York). Existing branch:
`codex/retention-platform`, draft PR #31. Production main at audit start:
`cd538e1`; existing branch work at `17a649a`. No new visual redesign in this audit.

## Verified baseline

| Area | Evidence and reuse decision |
| --- | --- |
| Connection | Initially INACTIVE with health 503 / Prisma P2010, PostgreSQL XX000, tenant/user not found. After the owner resumed the same project, `eztwyngcbksdbiccxoyx` reports ACTIVE_HEALTHY; production `/api/health` is 200 with `database: ok`. No credential changes were needed. |
| Authentication | Supabase `getUser()` and active membership determine server shop scope. Five active memberships join real auth users and active/onboarding shops. Unauthenticated pilot state redirects to login. After owner sign-in, production dashboard, QA contact draft, and appointment calendar loaded. A full logout/login mutation-persistence test was not performed. |
| Records | Read-only counts: 422 customers, 427 vehicles, 337 history rows, 608 maintenance assignments, 109 opportunities, 37 outreach records, 285 appointments, 8 requests, 4 blocks. Reuse these tables; do not create another customer/service system. |
| History / prediction | Reuse dated ServiceHistoryRecord, VehicleMileageReading, VehicleMaintenanceRecord and shop/vehicle intervals. Adaptive-mileage and interval calculations run locally against an anonymized numeric snapshot from the linked database. |
| Messaging | Existing draft review, phone normalization, explicit SMS consent and attempt history are reusable. 419 UNKNOWN and 3 OPTED_IN customers; legacy boolean is not permission. UNKNOWN/OPTED_OUT are server-blocked. No real SMS provider is implemented; production rejects sending. Mock is development-only. No sends or contact records were created. |
| Booking | Existing hashed, expiring `/request` tokens, Smart Maintenance Blocks, blackouts, pending holds, advisor acceptance and deterministic appointment IDs are reusable. Eight request rows exist. Unit/source tests pass; no live request or booking was created in this audit. |
| Legacy booking | Production `/api/book/audit-invalid-token/context` returns 404 / CUSTOMER_BOOKING_DISABLED. Invalid `/request` token returns a safe unavailable state without exposing data. |

## Release-blocking database security drift

Read-only catalog queries found RLS disabled and no policies on `Customer`,
`Vehicle`, `Appointment`, `Shop`, `ShopMembership`, `User`, `AuditLog`,
`DeclinedWorkRecord`, `ImportHistoryRecord`, and `ImportRowRecord`.
These tables also grant broad privileges to anon/authenticated.
`_prisma_migrations` has inappropriate browser-role grants too.
A read-only transaction using `SET LOCAL ROLE anon` confirmed access to
Customer, Vehicle, and ShopMembership (only booleans returned, no PII).

OutreachRecord has RLS, member-scoped policies and authenticated CRUD-only grants;
anon/PUBLIC have no listed table grants. Smart Maintenance Block tables have RLS
and restricted grants. Request tables have member-scoped RLS but still grant
authenticated TRUNCATE/REFERENCES/TRIGGER. Several older RLS-enabled service tables
retain these broad grants too. RLS does not make TRUNCATE a tenant-scoped operation.

Do not release a campaign against this access-control baseline. Prepare a reviewed,
additive security migration, revoke unnecessary browser-role privileges, enable
RLS on the exposed tables, and reuse the existing `maintiva_is_shop_member` helper
with appropriate policies. Membership creation and role changes must remain
backend-controlled, not self-assignable. Test auth, onboarding, Prisma writes and
cross-shop denial before applying an approved exact file. No policy, grant,
migration history, or production record was changed during this audit.

Prepared for review only: `supabase/migrations/20261105120000_restore_tenant_rls_and_grants.sql`.
**Not applied.** Restores missing tenant policies; leaves existing service/request
policies intact; removes anon/PUBLIC table grants and authenticated non-DML grants.
User, Shop, ShopMembership and AuditLog are authenticated SELECT-only; their writes
remain backend-controlled. The migration fails transactionally on unexpected core
policies or unsafe membership-helper ownership. The existing helper is SECURITY
DEFINER, owned by postgres with BYPASSRLS (verified read-only), avoiding recursion.
Existing owner access is unchanged and service_role DML is retained explicitly.

Static guard tests do not prove PostgreSQL execution or isolation. Before applying:
review this exact file, verify the deployment's database role is the intended
backend role, test on a restored isolated database, and obtain owner approval.
After approval/application, compare counts, table and column ACLs, effective role
privileges and policies; prove anonymous denial, same-shop access, other-shop
denial, and inability to self-assign membership. Smoke-test auth/onboarding and
server writes. Do not run the queued migration set or repair migration history.

Authenticated production UI showed the QA oil recommendation at 9,247 estimated
miles / 117 days overdue (matching the November 4 snapshot), one QA queue entry,
an editable shop-identity email draft, missing SMS consent, and no pre-created
request link. Calendar loaded with its primary-calendar warning and an empty
current window. No send, link creation, request submission or booking was tested.
Navigating through partial-name global search to the QA customer loaded service
and communication history and exactly one open oil opportunity. On November 5,
the customer page showed 57,000 known miles (January 10), 69,288 estimated miles
(November 5), Maintenance overdue, and oil 9,288 miles / 118 days overdue.
Full display-name global search returned no match; the partial term `Mileage`
worked. This search limitation remains outside the core oil-flow fixes.

## One real vehicle trace

Read-only alias: `vehicle-c89d86f8`. Reproduce with
`supabase db query --linked --file scripts/audit-oil-baseline.sql --output json`.
This file contains only a READ ONLY transaction and SELECTs.

- Oil history: 42,000 miles on 2025-01-10; 49,500 on 2025-07-10; latest completion
  57,000 on 2026-01-10. The assignment matches that latest date and mileage.
- All three dated readings are imported, included and anomaly-free. Learned pace:
  15,000 miles/year, MEDIUM confidence. Legacy Vehicle.currentMileage is zero;
  canonical forecasts correctly use the dated readings instead.
- Current installed shop oil interval is **3,000 miles / 6 months**, not the older
  5,000-mile QA assumption. Due: 60,000 miles or 2026-07-10.
- Replaying these inputs through current functions as of **2026-11-04** produces
  69,247 **estimated** miles, 298 days after the latest reading; oil is 9,247
  estimated miles and 117 calendar days overdue. Vehicle status is OVERDUE.
- Exactly one stored oil opportunity is IDENTIFIED. Its stored overdue counters
  are older (5,712 miles / 31 days); the display recomputes them from the current
  as-of date without rewriting the row or workflow stage.
- No mileage: mileage calculation unavailable, time interval still identifies
  overdue oil. No completion date or mileage: Limited data, not outreach-ready.
  A stale single reading uses a low-confidence fallback pace. Multiple old readings
  can retain MEDIUM/HIGH confidence: freshness needs its own campaign review gate.

## Narrow fixes in this audit

- CSV history preserves the newest completion regardless of row order. A newer
  completion with missing mileage clears the old mileage rather than combining
  two visits. New history rows link to their maintenance assignment.
- Backdated manual completion preserves the current service cycle; intake mileage
  no longer falsely marks newly assigned services as completed.
- Missing forecast inputs no longer reuse stale stored overdue miles/dates in the
  queue. Not-enough-history/healthy/inactive assignments are not outreach-ready.
- Production records were not backfilled. Among 321 assignments with matching
  history, zero completion-date mismatches and two mileage mismatches need review.
  Sixty active vehicles have no usable mileage. Existing historical ambiguities
  and duplicate readings were not repaired speculatively.

## Smallest overdue-oil campaign

1. Resolve the security blocker and verify authenticated load/persistence and
   cross-shop denial. Approve the shop's oil service ID and actual interval.
2. Build one advisor-reviewed worklist, not a generic campaign builder. Recalculate
   eligibility at preview/action time from active customers/vehicles/assignments.
   Require date-based overdue evidence or reviewed mileage evidence; route stale,
   missing, anomalous or conflicting mileage to review. Exclude snoozed/stopped,
   booked, pending-request, inactive, recently contacted and closed-cycle targets.
3. Reuse editable shop-identity drafts and explicit per-recipient approval. Show
   estimated vs known evidence; invalidate approval on draft/recipient/consent
   changes. Require normalized phone plus explicit OPTED_IN for SMS. Keep provider
   disabled; use test-only simulation and never count it as delivered outreach.
4. Reuse AppointmentRequest links into oil-compatible Smart Maintenance Blocks,
   with notice, timezone, blackout and labor/vehicle capacity checks. Request means
   PENDING, not confirmed. Advisor Accept creates one appointment and marks the
   same opportunity BOOKED. Keep the primary-shop-calendar warning and old /book off.
5. Reuse OutreachRecord and opportunity/request/appointment attribution. First prove
   one QA cycle with refresh, retry, concurrent-capacity and tenant tests. Existing
   opportunity sync is mutation-driven, not a daily campaign scan, and closed
   opportunities are not automatically reopened for later service cycles. Add an
   explicit idempotent eligibility refresh/cycle design before unattended campaigns;
   do not fabricate client-only actionable IDs or rewrite completed history.

No broad rewrite, campaign scheduler, provider activation, migration application,
or production deployment is included. The existing PR remains draft.

## Checks

`pnpm run lint`, `pnpm test` (37 files, 296 tests), and `pnpm run build` passed.
Build ran with `MAINTIVA_RUN_MIGRATIONS_ON_BUILD=false`. Migration tests are static
guards only, not a claim that the prepared SQL has been executed in PostgreSQL.
