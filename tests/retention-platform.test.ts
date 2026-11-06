import { describe, expect, it } from "vitest";
import { createInitialDemoState, type Appointment, type OutreachRecord } from "@/lib/demo-data";
import { customerRetentionTimeline, isRecordedContact, readyForOutreach, retentionReport, upcomingRetention } from "@/lib/retention";
import { serviceVisitSchema } from "@/lib/service-visit";
import { smsLength } from "@/lib/sms-length";
import { outreachApprovalKey } from "@/lib/outreach-approval";

function fixture() {
  const state = createInitialDemoState();
  state.forecastAsOfDate = "2026-08-15";
  state.shop.isDemo = false;
  state.appointments = [];
  state.appointmentRequests = [];
  state.outreachRecords = [];
  state.revenueOpportunities = [];
  return state;
}

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return { id: "a", shopId: fixture().shop.id, customerId: "c", vehicleId: "v", maintenanceRecordIds: [], serviceNames: ["Oil"], scheduledStart: "2026-08-10T12:00:00Z", scheduledEnd: "2026-08-10T13:00:00Z", status: "COMPLETED", totalPriceCents: 50000, totalLaborHours: 1, source: "AUTOMATION", attributionSource: "MAINTIVA_OUTREACH", completedAt: "2026-08-10T13:00:00Z", notes: "", ...overrides };
}

function contact(overrides: Partial<OutreachRecord> = {}): OutreachRecord {
  return { id: "o", shopId: fixture().shop.id, customerId: "c", vehicleId: "v", maintenanceRecordIds: [], serviceNames: [], message: "Test", channel: "TEXT", sentAt: "2026-08-01T12:00:00Z", responseStatus: "NO_RESPONSE", status: "MANUALLY_SENT", ...overrides };
}

describe("conservative retention attribution", () => {
  it("never substitutes an estimate for missing completed revenue", () => {
    const state = fixture();
    state.appointments = [appointment(), appointment({ id: "b", completedRevenueCents: 12300 }), appointment({ id: "other", shopId: "other", completedRevenueCents: 999999 }), appointment({ id: "manual", attributionSource: "MANUAL_SHOP_ENTRY", completedRevenueCents: 999999 })];
    expect(retentionReport(state)).toMatchObject({ recoveredRevenueCents: 12300, missingRevenueCount: 1, customersReturned: 1, roi: null });
  });

  it("counts zero as recorded revenue and excludes cancelled, future and invalid completions", () => {
    const state = fixture();
    state.appointments = [appointment({ completedRevenueCents: 0 }), appointment({ id: "b", status: "CANCELLED", completedRevenueCents: 100 }), appointment({ id: "future", completedAt: "2026-08-20", completedRevenueCents: 100 }), appointment({ id: "invalid", completedAt: "invalid", completedRevenueCents: 100 })];
    expect(retentionReport(state)).toMatchObject({ recoveredRevenueCents: 0, missingRevenueCount: 0, completedCount: 1 });
  });

  it("applies the selected period in shop-local calendar dates", () => {
    const state = fixture();
    state.shop.timezone = "America/New_York";
    state.appointments = [appointment({ completedAt: "2026-08-01T02:00:00Z", completedRevenueCents: 1000 }), appointment({ id: "b", completedRevenueCents: 2000 })];
    expect(retentionReport(state, "MONTH").recoveredRevenueCents).toBe(2000);
    expect(retentionReport(state, "30_DAYS").recoveredRevenueCents).toBe(3000);
  });

  it("counts distinct customers, not drafts, failures, simulated or queued SMS", () => {
    const state = fixture();
    state.outreachRecords = [contact({ smsDeliveryStatus: "SENT" }), contact({ id: "b", smsDeliveryStatus: "DELIVERED" }), ...(["FAILED", "SIMULATED", "QUEUED"] as const).map((status) => contact({ id: status, customerId: status, smsDeliveryStatus: status })), contact({ id: "other", shopId: "other" })];
    expect(retentionReport(state).customersContacted).toBe(1);
    expect(isRecordedContact(contact({ status: "DRAFTED" }))).toBe(false);
    expect(isRecordedContact(contact({ channel: "CALL" }))).toBe(true);
  });
});

function outreachFixture() {
  const state = fixture();
  const customer = state.customers[0];
  const vehicle = state.vehicles.find((item) => item.customerId === customer.id)!;
  customer.status = "ACTIVE";
  customer.callConsent = true;
  const declined = { id: "deferred", shopId: state.shop.id, customerId: customer.id, vehicleId: vehicle.id, serviceName: "Brake Pads", declinedAt: "2026-08-01", recommendedPriceCents: 20000, laborHours: 1, advisorNotes: "Known recommendation", status: "OPEN" as const, outreachStatus: "NEEDS_OUTREACH" as const };
  state.declinedWorkRecords = [declined];
  state.revenueOpportunities = [{ id: "opp", shopId: state.shop.id, customerId: customer.id, vehicleId: vehicle.id, declinedWorkRecordId: declined.id, source: "DECLINED_WORK", stage: "IDENTIFIED", priority: "HIGH", explanation: "Known recommendation", priorityReason: "Deferred", estimatedRevenueCents: 20000, estimatedLaborHours: 1, daysOverdue: 0, milesOverdue: 0, createdAt: "2026-08-01" }];
  return { state, customer, vehicle };
}

describe("daily outreach selection", () => {
  it("excludes a different shop and a paused customer", () => {
    const { state, customer } = outreachFixture();
    expect(readyForOutreach(state)).toHaveLength(1);
    state.revenueOpportunities[0].shopId = "other";
    expect(readyForOutreach(state)).toHaveLength(0);
    state.revenueOpportunities[0].shopId = state.shop.id;
    customer.status = "PAUSED";
    expect(readyForOutreach(state)).toHaveLength(0);
  });
  it("excludes booked vehicles and snoozed recommendations", () => {
    const { state, customer, vehicle } = outreachFixture();
    state.appointments = [appointment({ customerId: customer.id, vehicleId: vehicle.id, status: "CONFIRMED" })];
    expect(readyForOutreach(state)).toHaveLength(0);
    state.appointments = [];
    state.declinedWorkRecords[0].outreachStatus = "SNOOZED";
    expect(readyForOutreach(state)).toHaveLength(0);
  });
  it("waits for either a future deferred date or mileage target", () => {
    const { state } = outreachFixture();
    state.revenueOpportunities[0].dueDate = "2026-09-01";
    expect(readyForOutreach(state)).toHaveLength(0);
    state.revenueOpportunities[0].dueDate = undefined;
    state.revenueOpportunities[0].dueMileage = 2900000;
    expect(readyForOutreach(state)).toHaveLength(0);
    state.revenueOpportunities[0].dueDate = "2026-08-14";
    expect(readyForOutreach(state)).toHaveLength(1);
  });
  it("scopes the customer timeline and upcoming forecasts to this shop", () => {
    const { state, customer } = outreachFixture();
    state.outreachRecords = [contact({ customerId: customer.id, shopId: "other" })];
    expect(customerRetentionTimeline(state, customer.id).some((item) => item.id === "outreach-o")).toBe(false);
    state.maintenanceRecords = state.maintenanceRecords.map((item) => ({ ...item, shopId: "other" }));
    expect(upcomingRetention(state).every((window) => window.items.length === 0)).toBe(true);
  });
});

describe("manual service visit validation", () => {
  const visit = { customerId: "c", vehicleId: "v", date: "2026-08-01", mileage: 50000, idempotencyKey: "00000000-0000-4000-8000-000000000001", services: [{ serviceDefinitionId: "oil", outcome: "COMPLETED", priceCents: 5000 }] };
  it("accepts completed and separately deferred services", () => {
    expect(serviceVisitSchema.safeParse({ ...visit, services: [...visit.services, { serviceDefinitionId: "brakes", outcome: "DEFERRED", priceCents: 20000, dueMileage: 55000 }] }).success).toBe(true);
  });
  it("rejects contradictory outcomes, invalid dates, missing mileage and backdated targets", () => {
    expect(serviceVisitSchema.safeParse({ ...visit, services: [...visit.services, { ...visit.services[0], outcome: "DEFERRED" }] }).success).toBe(false);
    expect(serviceVisitSchema.safeParse({ ...visit, date: "2026-02-30" }).success).toBe(false);
    expect(serviceVisitSchema.safeParse({ ...visit, mileage: NaN }).success).toBe(false);
    expect(serviceVisitSchema.safeParse({ ...visit, services: [{ ...visit.services[0], outcome: "DEFERRED", dueMileage: 49999 }] }).success).toBe(false);
    expect(serviceVisitSchema.safeParse({ ...visit, services: [{ ...visit.services[0], outcome: "DEFERRED", dueDate: "2026-07-31" }] }).success).toBe(false);
  });
});

describe("SMS review safety", () => {
  it("invalidates review when draft, recipient, consent or opportunity scope changes", () => {
    const input = { shopId: "s", customerId: "c", vehicleId: "v", phone: "2025550100", consent: "OPTED_IN", body: "Review this draft", opportunityIds: ["b", "a"] };
    const key = outreachApprovalKey(input);
    expect(outreachApprovalKey({ ...input, opportunityIds: ["a", "b"] })).toBe(key);
    for (const change of [{ body: "Different draft" }, { phone: "2025550101" }, { consent: "OPTED_OUT" }, { opportunityIds: ["a"] }, { shopId: "other" }]) expect(outreachApprovalKey({ ...input, ...change })).not.toBe(key);
  });
  it("uses GSM extension and Unicode segment sizes", () => {
    expect(smsLength("a".repeat(160)).segments).toBe(1);
    expect(smsLength("a".repeat(161)).segments).toBe(2);
    expect(smsLength("^".repeat(81)).segments).toBe(2);
    expect(smsLength("\u4e2d".repeat(71))).toMatchObject({ segments: 2, encoding: "UCS-2" });
  });
});
