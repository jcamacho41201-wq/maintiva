import { describe, expect, it } from "vitest";
import { createInitialDemoState, type DemoState } from "@/lib/demo-data";
import {
  buildRevenueOpportunities,
  getCapacitySummary,
  getRevenueFunnel,
  getRevenueRecoveryMetrics,
  getRoiReport,
  groupRevenueOpportunities,
  opportunityTimingLabel,
} from "@/lib/revenue-recovery";
import { findCompletedDeclinedServiceConflicts } from "@/lib/service-event-conflicts";
import { formatHours, formatLaborHours } from "@/lib/utils";

function focusedState(): DemoState {
  const base = createInitialDemoState();
  const shopId = "shop-focused";
  const customer = {
    ...base.customers[0],
    id: "cust-heather",
    shopId,
    firstName: "Heather",
    lastName: "Reed",
  };
  const vehicle = {
    ...base.vehicles[0],
    id: "veh-audi",
    shopId,
    customerId: customer.id,
    year: 2020,
    make: "Audi",
    model: "Q5",
    currentMileage: 51_000,
    estimatedAnnualMileage: 12_000,
  };
  const diagnostic = {
    ...base.services[0],
    id: "svc-diagnostic",
    shopId,
    name: "Check Engine Diagnostic",
    defaultMileageInterval: 50_000,
    defaultTimeIntervalMonths: 48,
    defaultTimeIntervalValue: 48,
    defaultTimeIntervalUnit: "MONTHS" as const,
    defaultPriceCents: 16_000,
    estimatedLaborMinutes: 61,
  };

  return {
    ...base,
    shop: { ...base.shop, id: shopId, isDemo: true },
    customers: [customer],
    vehicles: [vehicle],
    services: [diagnostic],
    maintenanceRecords: [],
    revenueOpportunities: [],
    mileageReadings: [],
    serviceRecords: [],
    declinedWorkRecords: [],
    outreachRecords: [],
    appointments: [],
    importHistory: [],
  };
}

function healthyDiagnosticRecord(state: DemoState) {
  return {
    id: "maint-diagnostic",
    shopId: state.shop.id,
    vehicleId: "veh-audi",
    serviceId: "svc-diagnostic",
    serviceName: "Check Engine Diagnostic",
    lastCompletedDate: "2026-05-26",
    lastCompletedMileage: 50_000,
    recommendedMileageInterval: null,
    recommendedTimeIntervalMonths: null,
    priceCents: 16_000,
    laborHours: 61 / 60,
    notificationThreshold: 10,
    outreachStatus: "NEEDS_OUTREACH" as const,
    isActive: true,
  };
}

describe("revenue recovery engine", () => {
  it("creates explainable due, overdue, and declined work opportunities", () => {
    const opportunities = buildRevenueOpportunities(createInitialDemoState());

    expect(opportunities.some((item) => item.sourceLabel === "Overdue maintenance")).toBe(true);
    expect(opportunities.some((item) => item.sourceLabel === "Due maintenance")).toBe(true);
    expect(opportunities.some((item) => item.sourceLabel === "Declined work")).toBe(true);
    expect(opportunities.every((item) => item.explanation.length > 20)).toBe(true);
    expect(opportunities.every((item) => ["HIGH", "MEDIUM", "LOW"].includes(item.priority))).toBe(true);
  });

  it("groups revenue queue entries by vehicle", () => {
    const groups = groupRevenueOpportunities(buildRevenueOpportunities(createInitialDemoState()));
    const jeep = groups.find((item) => item.vehicleId === "veh-jeep");

    expect(jeep?.recommendedServices).toContain("Brake Pads");
    expect(jeep?.estimatedRevenueCents).toBeGreaterThan(40_000);
    expect(jeep?.nextAction).toBe("Contact customer");
  });

  it("calculates booked and recovered Maintiva revenue without counting open value as guaranteed", () => {
    const metrics = getRevenueRecoveryMetrics(createInitialDemoState());

    expect(metrics.bookedMaintivaRevenue).toBe(40_000);
    expect(metrics.recoveredRevenueThisMonth).toBe(18_200);
    expect(metrics.openOpportunityValue).toBeGreaterThan(metrics.bookedMaintivaRevenue);
  });

  it("builds capacity summaries for 7, 14, and 30 day windows", () => {
    const state = createInitialDemoState();
    const seven = getCapacitySummary(state, 7);
    const thirty = getCapacitySummary(state, 30);

    expect(seven.openLaborHours).toBeGreaterThan(0);
    expect(thirty.totalAvailableLaborHours).toBeGreaterThan(seven.totalAvailableLaborHours);
    expect(seven.matchingOpportunityCount).toBeGreaterThan(0);
  });

  it("reports ROI funnel and completed recovered revenue", () => {
    const state = createInitialDemoState();
    const report = getRoiReport(state);
    const funnel = getRevenueFunnel(state);

    expect(report.completedMaintivaRevenue).toBe(18_200);
    expect(report.averageRecoveredRepairOrder).toBe(18_200);
    expect(funnel.map((item) => item.label)).toEqual([
      "Identified",
      "Contacted",
      "Responded",
      "Booked",
      "Completed",
    ]);
  });

  it("keeps a completed service lifecycle out of declined-work recovery", () => {
    const state = focusedState();
    state.maintenanceRecords = [healthyDiagnosticRecord(state)];
    state.serviceRecords = [{
      id: "hist-diagnostic",
      shopId: state.shop.id,
      customerId: "cust-heather",
      vehicleId: "veh-audi",
      serviceName: "Check Engine Diagnostic",
      completedAt: "2026-05-26",
      mileage: 50_000,
      priceCents: 16_000,
      notes: "Imported from CSV.",
    }];

    expect(buildRevenueOpportunities(state).filter((item) => item.source === "DECLINED_WORK")).toEqual([]);
  });

  it("keeps a declined-only lifecycle from resetting maintenance completion", () => {
    const state = focusedState();
    state.declinedWorkRecords = [{
      id: "declined-diagnostic",
      shopId: state.shop.id,
      customerId: "cust-heather",
      vehicleId: "veh-audi",
      serviceName: "Check Engine Diagnostic",
      declinedAt: "2026-05-26T12:00:00.000Z",
      recommendedPriceCents: 16_000,
      laborHours: 61 / 60,
      advisorNotes: "Customer declined diagnostic.",
      status: "OPEN",
      outreachStatus: "NEEDS_OUTREACH",
    }];

    const [opportunity] = buildRevenueOpportunities(state);

    expect(opportunity.source).toBe("DECLINED_WORK");
    expect(opportunity.sourceType).toBe("DeclinedWorkRecord");
    expect(opportunity.declinedWorkRecordId).toBe("declined-diagnostic");
    expect(state.serviceRecords).toEqual([]);
    expect(state.maintenanceRecords).toEqual([]);
  });

  it("allows a diagnostic completion and a separate repair decline without contradiction", () => {
    const state = focusedState();
    state.maintenanceRecords = [healthyDiagnosticRecord(state)];
    state.serviceRecords = [{
      id: "hist-diagnostic",
      shopId: state.shop.id,
      customerId: "cust-heather",
      vehicleId: "veh-audi",
      serviceName: "Check Engine Diagnostic",
      completedAt: "2026-05-26",
      mileage: 50_000,
      priceCents: 16_000,
      notes: "Completed diagnostic visit.",
    }];
    state.declinedWorkRecords = [{
      id: "declined-repair",
      shopId: state.shop.id,
      customerId: "cust-heather",
      vehicleId: "veh-audi",
      serviceName: "Oxygen Sensor Replacement",
      declinedAt: "2026-05-26T12:00:00.000Z",
      recommendedPriceCents: 42_000,
      laborHours: 1.4,
      advisorNotes: "Recommended after diagnostic.",
      status: "OPEN",
      outreachStatus: "NEEDS_OUTREACH",
    }];

    const [opportunity] = buildRevenueOpportunities(state);

    expect(opportunity.source).toBe("DECLINED_WORK");
    expect(opportunity.serviceNames).toEqual(["Oxygen Sensor Replacement"]);
    expect(findCompletedDeclinedServiceConflicts(state)).toEqual([]);
  });

  it("labels declined-work age differently from maintenance overdue age", () => {
    expect(opportunityTimingLabel({
      source: "DECLINED_WORK",
      daysOverdue: 66,
      sourceLabel: "Declined work",
    })).toBe("Declined 66 days ago");
    expect(opportunityTimingLabel({
      source: "OVERDUE_MAINTENANCE",
      daysOverdue: 66,
      dueDate: "2026-05-23T12:00:00.000Z",
      sourceLabel: "Overdue maintenance",
    })).toBe("66 days overdue");
  });

  it("reports documented follow-up due dates for declined work", () => {
    expect(opportunityTimingLabel({
      source: "DECLINED_WORK",
      daysOverdue: 66,
      followUpDate: "2026-07-01T12:00:00.000Z",
      sourceLabel: "Declined work",
    })).toBe("Follow-up overdue by 27 days");
  });

  it("uses one labor formatter for minutes and decimal hours", () => {
    expect(formatHours(61)).toBe("1 hr 1 min");
    expect(formatLaborHours(61 / 60)).toBe("1 hr 1 min");
  });

  it("produces a read-only conflict audit for same-service completed and declined cycles", () => {
    const state = focusedState();
    state.maintenanceRecords = [healthyDiagnosticRecord(state)];
    state.serviceRecords = [{
      id: "hist-diagnostic",
      shopId: state.shop.id,
      customerId: "cust-heather",
      vehicleId: "veh-audi",
      serviceName: "Check Engine Diagnostic",
      completedAt: "2026-05-26",
      mileage: 50_000,
      priceCents: 16_000,
      notes: "Imported from CSV.",
    }];
    state.declinedWorkRecords = [
      {
        id: "declined-diagnostic",
        shopId: state.shop.id,
        customerId: "cust-heather",
        vehicleId: "veh-audi",
        serviceName: "Check Engine Diagnostic",
        declinedAt: "2026-05-26T12:00:00.000Z",
        recommendedPriceCents: 16_000,
        laborHours: 61 / 60,
        advisorNotes: "Imported declined work.",
        status: "OPEN",
        outreachStatus: "NEEDS_OUTREACH",
      },
      {
        id: "declined-other-shop",
        shopId: "shop-other",
        customerId: "cust-heather",
        vehicleId: "veh-audi",
        serviceName: "Check Engine Diagnostic",
        declinedAt: "2026-05-26T12:00:00.000Z",
        recommendedPriceCents: 16_000,
        laborHours: 61 / 60,
        advisorNotes: "Other shop.",
        status: "OPEN",
        outreachStatus: "NEEDS_OUTREACH",
      },
    ];
    state.revenueOpportunities = [{
      id: "opp-declined-diagnostic",
      shopId: state.shop.id,
      customerId: "cust-heather",
      vehicleId: "veh-audi",
      declinedWorkRecordId: "declined-diagnostic",
      source: "DECLINED_WORK",
      stage: "IDENTIFIED",
      priority: "HIGH",
      explanation: "Check Engine Diagnostic was declined.",
      priorityReason: "Previously declined work is recoverable.",
      estimatedRevenueCents: 16_000,
      estimatedLaborHours: 61 / 60,
      daysOverdue: 66,
      milesOverdue: 0,
      createdAt: "2026-07-29T12:00:00.000Z",
    }];

    expect(findCompletedDeclinedServiceConflicts(state)).toEqual([expect.objectContaining({
      serviceHistoryRecordId: "hist-diagnostic",
      maintenanceRecordId: "maint-diagnostic",
      declinedWorkRecordId: "declined-diagnostic",
      revenueOpportunityId: "opp-declined-diagnostic",
      category: "SERVICE_DECLINED_AND_MARKED_COMPLETED",
    })]);
  });
});
