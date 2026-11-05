import { describe, expect, it } from "vitest";
import { createInitialDemoState } from "@/lib/demo-data";
import { serviceCompletionBaselineUpdate } from "@/lib/service-history";
import { calculateMaintenanceStatus, getVehicleMaintenanceCondition, resolveVehicleForecastMileage } from "@/lib/demo-calculations";
import { buildRevenueOpportunities } from "@/lib/revenue-recovery";
import { canSendSmsToCustomer } from "@/lib/contact-workflow";
import { readyForOutreach } from "@/lib/retention";

// Anonymized numeric snapshot from the read-only production audit on 2026-11-04.
function oilHistoryState() {
  const state = createInitialDemoState();
  state.shop.isDemo = false;
  state.forecastAsOfDate = "2026-11-04";
  const vehicle = state.vehicles[0];
  const service = state.services.find((item) => item.name === "Oil Change")!;
  const record = state.maintenanceRecords.find((item) => item.vehicleId === vehicle.id && item.serviceId === service.id)!;
  service.defaultMileageInterval = 3000;
  service.defaultTimeIntervalValue = 6;
  service.defaultTimeIntervalUnit = "MONTHS";
  vehicle.currentMileage = 0;
  state.maintenanceRecords = [record];
  state.drivingProfiles = [];
  state.outreachRecords = [];
  state.appointments = [];
  state.serviceRecords = [
    { day: "2026-01-10", mileage: 57000 },
    { day: "2025-01-10", mileage: 42000 },
    { day: "2025-07-10", mileage: 49500 },
  ].map(({ day, mileage }, index) => ({ id: `qa-history-${index}`, shopId: state.shop.id, customerId: vehicle.customerId, vehicleId: vehicle.id, serviceName: "Oil Change", completedAt: day, mileage, priceCents: 8500, notes: "Synthetic audit fixture" }));
  let baseline: { lastCompletedDate: Date | null; lastCompletedMileage: number | null } = { lastCompletedDate: null, lastCompletedMileage: null };
  for (const history of state.serviceRecords) {
    const update = serviceCompletionBaselineUpdate(baseline, new Date(`${history.completedAt}T12:00:00Z`), history.mileage);
    if (update) baseline = update;
  }
  Object.assign(record, {
    lastCompletedDate: baseline.lastCompletedDate!.toISOString().slice(0, 10),
    lastCompletedMileage: baseline.lastCompletedMileage,
    mileageIntervalOverride: null, timeIntervalValueOverride: null,
    outreachStatus: "NEEDS_OUTREACH", appointmentId: undefined, isActive: true,
  });
  state.mileageReadings = state.serviceRecords.map((history) => ({ id: `reading-${history.id}`, shopId: state.shop.id, vehicleId: vehicle.id, readingMileage: history.mileage!, readingDate: history.completedAt, source: "SERVICE_HISTORY_IMPORT", verificationStatus: "IMPORTED", anomalyStatus: "NONE", includedInForecast: true, createdAt: history.completedAt, updatedAt: history.completedAt }));
  state.revenueOpportunities = [{ id: "qa-oil-opportunity", shopId: state.shop.id, customerId: vehicle.customerId, vehicleId: vehicle.id, maintenanceRecordId: record.id, source: "OVERDUE_MAINTENANCE", stage: "IDENTIFIED", priority: "HIGH", explanation: "Oil change", priorityReason: "Interval", estimatedRevenueCents: 6000, estimatedLaborHours: 0.5, dueMileage: 60000, dueDate: "2026-07-10", daysOverdue: 31, milesOverdue: 5712, createdAt: "2026-01-10" }];
  return { state, vehicle, record, service };
}

describe("oil history to recommendation baseline", () => {
  it("traces the latest completed oil service through forecast, profile and persisted opportunity", () => {
    const { state, vehicle, record } = oilHistoryState();
    expect(record.lastCompletedDate).toBe("2026-01-10");
    expect(record.lastCompletedMileage).toBe(57000);
    const forecast = resolveVehicleForecastMileage(state, vehicle);
    expect(forecast).toMatchObject({ latestKnownMileage: 57000, latestKnownDate: "2026-01-10", mileage: 69247, kind: "ESTIMATED", source: "IMPORTED_READINGS", annualMileage: 15000, daysSinceLatestKnownReading: 298 });
    const calculation = calculateMaintenanceStatus(record, vehicle, undefined, state);
    expect(calculation).toMatchObject({ nextDueMileage: 60000, nextDueDate: "2026-07-10", milesUntilDue: -9247, daysUntilDue: -117, displayStatus: "OVERDUE" });
    expect(getVehicleMaintenanceCondition(state, vehicle.id).condition).toBe("OVERDUE");
    const opportunities = buildRevenueOpportunities(state);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({ id: "qa-oil-opportunity", milesOverdue: 9247, daysOverdue: 117, forecastMileageKind: "ESTIMATED" });
    expect(opportunities[0].explanation).toContain("estimated");
    expect(vehicle.currentMileage).toBe(0);
    state.revenueOpportunities[0].stage = "CONTACTED";
    expect(buildRevenueOpportunities(state)[0].stage).toBe("CONTACTED");
  });

  it("uses the date interval, not invented miles, when no usable odometer exists", () => {
    const { state, vehicle, record } = oilHistoryState();
    state.mileageReadings = [];
    expect(resolveVehicleForecastMileage(state, vehicle)).toMatchObject({ mileage: null, kind: "UNAVAILABLE" });
    const calculation = calculateMaintenanceStatus(record, vehicle, undefined, state);
    expect(calculation.forecastMileage).toBeNull();
    expect(calculation.nextDueMileage).toBeNull();
    expect(calculation.dueText).toBe("Overdue by 117 days");
    expect(calculation.displayStatus).toBe("OVERDUE");
    expect(buildRevenueOpportunities(state)[0]).toMatchObject({ milesOverdue: 0, dueMileage: undefined, daysOverdue: 117 });
  });

  it("does not borrow a prior visit's odometer when the latest oil service has none", () => {
    const { state, vehicle, record } = oilHistoryState();
    record.lastCompletedMileage = null;
    const calculation = calculateMaintenanceStatus(record, vehicle, undefined, state);
    expect(calculation.nextDueMileage).toBeNull();
    expect(calculation.dueText).toBe("Overdue by 117 days");
    expect(buildRevenueOpportunities(state)[0].dueMileage).toBeUndefined();
  });

  it("reports limited data when both completion anchors are absent", () => {
    const { state, vehicle, record } = oilHistoryState();
    record.lastCompletedDate = null;
    record.lastCompletedMileage = null;
    expect(calculateMaintenanceStatus(record, vehicle, undefined, state).displayStatus).toBe("NOT_ENOUGH_HISTORY");
    expect(getVehicleMaintenanceCondition(state, vehicle.id).condition).toBe("LIMITED_DATA");
    expect(readyForOutreach(state)).toEqual([]);
    expect(state.revenueOpportunities).toHaveLength(1);
  });

  it("labels a stale single-reading mileage estimate as low confidence", () => {
    const { state, vehicle } = oilHistoryState();
    state.mileageReadings = [state.mileageReadings[0]];
    expect(resolveVehicleForecastMileage(state, vehicle)).toMatchObject({ kind: "ESTIMATED", confidence: "LOW", latestKnownDate: "2026-01-10", daysSinceLatestKnownReading: 298 });
  });

  it("does not treat an overdue recommendation or legacy consent as SMS permission", () => {
    const { state, vehicle } = oilHistoryState();
    const customer = state.customers.find((item) => item.id === vehicle.customerId)!;
    customer.smsConsent = true;
    customer.smsConsentStatus = "UNKNOWN";
    expect(canSendSmsToCustomer(customer).allowed).toBe(false);
    customer.smsConsentStatus = "OPTED_OUT";
    expect(canSendSmsToCustomer(customer).allowed).toBe(false);
  });
});
