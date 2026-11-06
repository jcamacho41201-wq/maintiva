# Single opportunity review

Click path: Overview > Review opportunities > Review on a specific row.
Campaigns opens the same Needs review queue. Category is a filter, not a catalog.
The shared eligibility selector supplies both Overview and Campaigns. Each row
retains its opportunity ID, even when the customer, vehicle or service overlaps.

## Local demo verification

- Desktop 1440 x 1000 and mobile 390 x 844: two-click entry, exact service,
  reason, editable draft, and disabled Approve & send with consent/provider reason.
- Mobile detail replaces the list; no horizontal overflow. Desktop shows both.
- Manual email draft and confirmation controls remain inside the same detail.
  No send or manual-contact confirmation was performed.
- Snoozed only the Jeep oil opportunity for one week. Other Jeep services remained.
  Overview and Campaigns both changed from 11 to 10. Snooze persisted on refresh
  and remained visible in the Snoozed view with November 12, 2026 as its end date.
- Legacy /automation redirects preserve campaign and exact opportunity;
  /outreach redirects preserve vehicle filtering (HTTP 307 verified).
- 39 test files / 312 tests, lint, and production build passed. Build migration
  execution was explicitly disabled.

No production records, schema, sending configuration, or deployment were changed.
Live SMS remains blocked in review until provider activation is separately approved.
The review-only database permission repair from the baseline audit remains unapplied.

Screenshots supplied with the review: desktop draft, mobile draft, and snoozed
mobile detail. These contain local demo data, not production customer data.
