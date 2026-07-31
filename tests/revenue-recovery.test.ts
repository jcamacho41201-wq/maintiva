import { describe, expect, it } from "vitest";
import { createInitialDemoState } from "@/lib/demo-data";
import {
  buildRevenueOpportunities,
  getCapacitySummary,
  getRevenueFunnel,
  getRevenueRecoveryMetrics,
  getRoiReport,
  groupRevenueOpportunities,
} from "@/lib/revenue-recovery";

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
});
