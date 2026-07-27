import { describe, expect, it } from "vitest";
import {
  createAppointmentFromRecords,
  getDashboardMetrics,
  getRecordStatus,
  getRecommendedRecords,
  getVehicleOpportunities,
} from "@/lib/demo-calculations";
import { createInitialDemoState } from "@/lib/demo-data";

describe("pilot workflow flow", () => {
  it("shows Justin's Jeep with three open recommended services and clear due text", () => {
    const state = createInitialDemoState();
    const jeepRecords = getRecommendedRecords(state, "veh-jeep").filter(
      ({ record }) => record.outreachStatus !== "SCHEDULED",
    );

    expect(jeepRecords).toHaveLength(3);
    expect(jeepRecords.map(({ record }) => record.serviceName)).toEqual(expect.arrayContaining([
      "Brake Pads",
      "Cabin Air Filter",
      "Oil Change",
    ]));
    expect(jeepRecords.every(({ calculation }) => calculation.dueText !== "0%")).toBe(true);
    expect(jeepRecords.map(({ calculation }) => calculation.status)).toContain("OVERDUE");
  });

  it("updates dashboard metrics after booking selected maintenance", () => {
    const state = createInitialDemoState();
    const before = getDashboardMetrics(state);
    const selectedIds = [
      "item-veh-jeep-oil-change",
      "item-veh-jeep-brake-pads",
      "item-veh-jeep-cabin-air-filter",
    ];
    const appointment = createAppointmentFromRecords({
      state,
      customerId: "cust-justin",
      vehicleId: "veh-jeep",
      maintenanceRecordIds: selectedIds,
      date: "2026-07-27",
      time: "09:00",
      status: "CONFIRMED",
    });
    const nextState = {
      ...state,
      appointments: [...state.appointments, appointment],
      maintenanceRecords: state.maintenanceRecords.map((record) =>
        selectedIds.includes(record.id)
          ? { ...record, outreachStatus: "SCHEDULED" as const, appointmentId: appointment.id }
          : record,
      ),
    };
    const after = getDashboardMetrics(nextState);

    expect(after.appointmentsToday).toBe(before.appointmentsToday + 1);
    expect(after.scheduledRevenue).toBe(before.scheduledRevenue + appointment.totalPriceCents);
    expect(after.openBayCapacityHours).toBeLessThan(before.openBayCapacityHours);
  });

  it("marks scheduled services without leaving the vehicle ready for outreach", () => {
    const state = createInitialDemoState();
    const selectedIds = [
      "item-veh-jeep-oil-change",
      "item-veh-jeep-brake-pads",
      "item-veh-jeep-cabin-air-filter",
    ];
    const nextState = {
      ...state,
      maintenanceRecords: state.maintenanceRecords.map((record) =>
        selectedIds.includes(record.id)
          ? { ...record, outreachStatus: "SCHEDULED" as const }
          : record,
      ),
    };
    const jeep = getVehicleOpportunities(nextState).find(
      (opportunity) => opportunity.vehicle?.id === "veh-jeep",
    );

    expect(jeep?.opportunityStatus).toBe("SCHEDULED");
    expect(getDashboardMetrics(nextState).readyForOutreach).toBeLessThan(
      getDashboardMetrics(state).readyForOutreach,
    );
    expect(
      getRecordStatus(
        nextState,
        nextState.maintenanceRecords.find((record) => record.id === selectedIds[0])!,
      ).dueText,
    ).toMatch(/Due|Overdue/);
  });

  it("distinguishes manual outreach from scheduled appointments", () => {
    const state = createInitialDemoState();
    const selectedIds = [
      "item-veh-jeep-oil-change",
      "item-veh-jeep-brake-pads",
    ];
    const nextState = {
      ...state,
      maintenanceRecords: state.maintenanceRecords.map((record) =>
        selectedIds.includes(record.id)
          ? { ...record, outreachStatus: "MANUALLY_SENT" as const }
          : record,
      ),
    };
    const jeep = getVehicleOpportunities(nextState).find(
      (opportunity) => opportunity.vehicle?.id === "veh-jeep",
    );

    expect(jeep?.opportunityStatus).toBe("MANUALLY_SENT");
    expect(getDashboardMetrics(nextState).readyForOutreach).toBeLessThan(
      getDashboardMetrics(state).readyForOutreach,
    );
    expect(getDashboardMetrics(nextState).maintenanceOpportunities).toBe(
      getDashboardMetrics(state).maintenanceOpportunities,
    );
  });
});
