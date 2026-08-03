import { describe, expect, it } from "vitest";
import type {
  Appointment,
  MaintenanceService,
  SmartMaintenanceBlock,
  SmartMaintenanceBlockBlackout,
} from "@/lib/demo-data";
import {
  blockEligibleServices,
  calculateSmartMaintenanceBlockAvailability,
} from "@/lib/smart-maintenance-blocks";

const services: Pick<MaintenanceService, "id" | "isActive" | "estimatedLaborMinutes">[] = [
  { id: "svc-oil", isActive: true, estimatedLaborMinutes: 45 },
  { id: "svc-tire", isActive: true, estimatedLaborMinutes: 30 },
  { id: "svc-archived", isActive: false, estimatedLaborMinutes: 30 },
];

const block: SmartMaintenanceBlock = {
  id: "block-a",
  shopId: "shop-a",
  name: "Quick Maintenance",
  description: "",
  isActive: true,
  timezone: "America/New_York",
  daysOfWeek: [1],
  startMinute: 8 * 60,
  endMinute: 12 * 60,
  serviceDefinitionIds: ["svc-oil", "svc-tire", "svc-archived"],
  maxVehicles: 2,
  maxLaborMinutes: 120,
  minimumNoticeMinutes: 60,
  maximumHorizonDays: 14,
  slotIntervalMinutes: 30,
  approvalRequired: true,
  internalNotes: "",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
};

function availability(overrides: Partial<Parameters<typeof calculateSmartMaintenanceBlockAvailability>[0]> = {}) {
  return calculateSmartMaintenanceBlockAvailability({
    shop: { id: "shop-a", timezone: "America/New_York" },
    blocks: [block],
    services,
    selectedServiceIds: ["svc-oil"],
    appointments: [],
    blackouts: [],
    dateFrom: "2026-08-03",
    dateTo: "2026-08-03",
    now: new Date("2026-08-01T12:00:00.000Z"),
    ...overrides,
  });
}

describe("smart maintenance blocks", () => {
  it("offers recurring request slots in the shop timezone", () => {
    const slots = availability();

    expect(slots.map((slot) => slot.label)).toEqual([
      "8:00 AM",
      "8:30 AM",
      "9:00 AM",
      "9:30 AM",
      "10:00 AM",
      "10:30 AM",
      "11:00 AM",
    ]);
    expect(slots[0].startsAt).toBe("2026-08-03T12:00:00.000Z");
  });

  it("filters inactive services from block eligibility", () => {
    expect(blockEligibleServices(block, services)).toEqual(["svc-oil", "svc-tire"]);
    expect(availability({ selectedServiceIds: ["svc-archived"] })).toEqual([]);
  });

  it("enforces both vehicle count and labor-minute capacity", () => {
    const appointments: Pick<Appointment, "shopId" | "scheduledStart" | "scheduledEnd" | "status" | "totalLaborHours">[] = [
      {
        shopId: "shop-a",
        scheduledStart: "2026-08-03T12:00:00.000Z",
        scheduledEnd: "2026-08-03T13:00:00.000Z",
        status: "CONFIRMED",
        totalLaborHours: 1,
      },
      {
        shopId: "shop-a",
        scheduledStart: "2026-08-03T12:15:00.000Z",
        scheduledEnd: "2026-08-03T13:15:00.000Z",
        status: "REQUESTED",
        totalLaborHours: 1,
      },
    ];

    expect(availability({ appointments }).map((slot) => slot.label)).toEqual(["9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"]);

    const laborLimited = availability({
      blocks: [{ ...block, maxVehicles: 4, maxLaborMinutes: 90 }],
      appointments: appointments.slice(0, 1),
    });
    expect(laborLimited.map((slot) => slot.label)).toEqual(["9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"]);
  });

  it("excludes cancelled appointments and released future commitments", () => {
    const slots = availability({
      appointments: [{
        shopId: "shop-a",
        scheduledStart: "2026-08-03T12:00:00.000Z",
        scheduledEnd: "2026-08-03T14:00:00.000Z",
        status: "CANCELLED",
        totalLaborHours: 2,
      }],
      commitments: [{
        id: "request-1",
        shopId: "shop-a",
        blockId: "block-a",
        startsAt: "2026-08-03T12:00:00.000Z",
        endsAt: "2026-08-03T14:00:00.000Z",
        status: "DECLINED",
        vehicleCount: 2,
        laborMinutes: 120,
      }],
    });

    expect(slots[0].label).toBe("8:00 AM");
  });

  it("honors notice, horizon, block activation, and blackouts", () => {
    expect(availability({
      now: new Date("2026-08-03T11:30:00.000Z"),
    }).map((slot) => slot.label)).toEqual(["8:30 AM", "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"]);

    expect(availability({
      now: new Date("2026-08-01T12:00:00.000Z"),
      blocks: [{ ...block, maximumHorizonDays: 1 }],
    })).toEqual([]);

    expect(availability({ blocks: [{ ...block, isActive: false }] })).toEqual([]);

    const blackouts: SmartMaintenanceBlockBlackout[] = [{
      id: "blackout-1",
      shopId: "shop-a",
      blockId: "block-a",
      startsAt: "2026-08-03T12:00:00.000Z",
      endsAt: "2026-08-03T13:15:00.000Z",
      reason: "Team meeting",
      isFullDay: false,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
    }];
    expect(availability({ blackouts }).map((slot) => slot.label)).toEqual(["9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"]);
  });
});
