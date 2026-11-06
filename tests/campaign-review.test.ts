import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createInitialDemoState } from "@/lib/demo-data";
import { campaignReviewUrl, matchesCampaign, needsReviewOpportunities } from "@/lib/campaign-review";
import { readyForOutreach } from "@/lib/retention";

function fixture() {
  const state = createInitialDemoState();
  state.forecastAsOfDate = "2026-11-05";
  state.appointments = [];
  state.appointmentRequests = [];
  return state;
}

describe("single opportunity review queue", () => {
  it("reuses eligibility without merging distinct services for the same customer", () => {
    const state = fixture();
    const rows = needsReviewOpportunities(state);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((row) => row.id)).toEqual(readyForOutreach(state).flatMap((group) => group.opportunities.map((row) => row.id)));
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows.filter((row) => row.customerId === rows[0].customerId).length).toBeGreaterThan(1);
  });

  it("removes only the snoozed maintenance opportunity", () => {
    const state = fixture();
    const rows = needsReviewOpportunities(state);
    const selected = rows.find((row) => row.maintenanceRecordId)!;
    state.maintenanceRecords.find((row) => row.id === selected.maintenanceRecordId)!.outreachStatus = "SNOOZED";
    const remaining = needsReviewOpportunities(state);
    expect(remaining.map((row) => row.id)).not.toContain(selected.id);
    expect(remaining.map((row) => row.id)).toEqual(rows.filter((row) => row.id !== selected.id).map((row) => row.id));
  });

  it("keeps consent-missing manual review but excludes paused customers and booked vehicles", () => {
    const state = fixture();
    const first = needsReviewOpportunities(state)[0];
    const customer = state.customers.find((row) => row.id === first.customerId)!;
    customer.smsConsentStatus = "UNKNOWN";
    customer.callConsent = true;
    expect(needsReviewOpportunities(state).some((row) => row.id === first.id)).toBe(true);
    customer.status = "PAUSED";
    expect(needsReviewOpportunities(state).some((row) => row.customerId === customer.id)).toBe(false);
    customer.status = "ACTIVE";
    state.appointments = [{ ...createInitialDemoState().appointments[0], shopId: state.shop.id, customerId: first.customerId, vehicleId: first.vehicleId, status: "CONFIRMED" }];
    expect(needsReviewOpportunities(state).some((row) => row.vehicleId === first.vehicleId)).toBe(false);
  });

  it("preserves exact record and category in legacy URLs without allowing external redirects", () => {
    expect(campaignReviewUrl({ opportunity: "oil/1", campaign: "maintenance", vehicle: "vehicle", view: "all", redirect: "https://example.com" })).toBe("/campaigns?campaign=maintenance&vehicle=vehicle&opportunity=oil%2F1&view=all");
    expect(campaignReviewUrl({})).toBe("/campaigns");
  });

  it("filters categories without replacing opportunity identity", () => {
    const rows = needsReviewOpportunities(fixture());
    const deferred = rows.find((row) => row.source === "DECLINED_WORK")!;
    expect(matchesCampaign(deferred, "deferred", new Set())).toBe(true);
    expect(matchesCampaign(deferred, "maintenance", new Set())).toBe(false);
    expect(matchesCampaign(deferred, "capacity", new Set([deferred.id]))).toBe(true);
  });

  it("shares the Overview count and keeps live sends blocked in embedded review", () => {
    const overview = readFileSync("src/app/page.tsx", "utf8");
    const queue = readFileSync("src/app/campaigns/page.tsx", "utf8");
    const editor = readFileSync("src/components/contact-customer-modal.tsx", "utf8");
    expect(overview).toContain("needsReviewOpportunities(state)");
    expect(queue).toContain("needsReviewOpportunities(state)");
    expect(overview).toContain('href="/campaigns"');
    expect(queue).toContain("opportunityIds: [selected.id]");
    expect(queue).toContain('smsDisabledReason="SMS provider is not connected yet. Live sending is disabled."');
    expect(editor).toContain("if (smsDisabledReason) { setError(smsDisabledReason); return; }");
    expect(queue).toContain("item.opportunityId === selected.id");
  });
});
