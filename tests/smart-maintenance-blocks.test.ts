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

const services: Pick<MaintenanceService, "id" | "shopId" | "isActive" | "estimatedLaborMinutes">[] = [
  { id: "svc-oil", shopId: "shop-a", isActive: true, estimatedLaborMinutes: 45 },
  { id: "svc-tire", shopId: "shop-a", isActive: true, estimatedLaborMinutes: 30 },
  { id: "svc-archived", shopId: "shop-a", isActive: false, estimatedLaborMinutes: 30 },
  { id: "svc-shop-b", shopId: "shop-b", isActive: true, estimatedLaborMinutes: 30 },
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
  it("offers one-day recurring request slots in the shop timezone", () => {
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

  it("offers multiple recurring days", () => {
    const slots = availability({
      blocks: [{ ...block, daysOfWeek: [1, 2] }],
      dateFrom: "2026-08-03",
      dateTo: "2026-08-04",
    });

    expect(slots.filter((slot) => slot.dateLabel.includes("Mon")).length).toBeGreaterThan(0);
    expect(slots.filter((slot) => slot.dateLabel.includes("Tue")).length).toBeGreaterThan(0);
  });

  it("filters inactive and cross-shop services from block eligibility", () => {
    expect(blockEligibleServices(block, services)).toEqual(["svc-oil", "svc-tire"]);
    expect(availability({ selectedServiceIds: ["svc-archived"] })).toEqual([]);
    expect(availability({
      blocks: [{ ...block, serviceDefinitionIds: ["svc-shop-b"] }],
      selectedServiceIds: ["svc-shop-b"],
    })).toEqual([]);
  });

  it("keeps start and end boundaries stable", () => {
    const exactFit = availability({
      blocks: [{ ...block, endMinute: 8 * 60 + 45, slotIntervalMinutes: 15 }],
    });
    expect(exactFit.map((slot) => slot.label)).toEqual(["8:00 AM"]);

    const tooLong = availability({
      blocks: [{ ...block, endMinute: 8 * 60 + 44, slotIntervalMinutes: 15 }],
    });
    expect(tooLong).toEqual([]);
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

  it("distinguishes labor capacity and vehicle capacity limits", () => {
    const appointment = {
      shopId: "shop-a",
      scheduledStart: "2026-08-03T12:00:00.000Z",
      scheduledEnd: "2026-08-03T13:00:00.000Z",
      status: "CONFIRMED" as const,
      totalLaborHours: 1,
    };

    expect(availability({
      blocks: [{ ...block, maxVehicles: 4, maxLaborMinutes: 90 }],
      appointments: [appointment],
    })[0].label).toBe("9:00 AM");

    expect(availability({
      blocks: [{ ...block, maxVehicles: 1, maxLaborMinutes: 240 }],
      appointments: [appointment],
    })[0].label).toBe("9:00 AM");
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

  it("honors notice and horizon boundaries", () => {
    expect(availability({
      now: new Date("2026-08-03T11:30:00.000Z"),
    }).map((slot) => slot.label)).toEqual(["8:30 AM", "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"]);

    expect(availability({
      now: new Date("2026-08-01T12:00:00.000Z"),
      blocks: [{ ...block, maximumHorizonDays: 1 }],
    })).toEqual([]);
  });

  it("honors inactive, archived, shop blackout, and block blackout filters", () => {
    expect(availability({ blocks: [{ ...block, isActive: false }] })).toEqual([]);
    expect(availability({ blocks: [{ ...block, archivedAt: "2026-08-01T12:00:00.000Z" }] })).toEqual([]);

    const blockBlackouts: SmartMaintenanceBlockBlackout[] = [{
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
    expect(availability({ blackouts: blockBlackouts }).map((slot) => slot.label)).toEqual(["9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"]);

    const shopBlackouts: SmartMaintenanceBlockBlackout[] = [{ ...blockBlackouts[0], id: "blackout-shop", blockId: null }];
    expect(availability({ blackouts: shopBlackouts }).map((slot) => slot.label)).toEqual(["9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"]);
  });

  it("interprets shop-local midnight by recurrence day", () => {
    const slots = availability({
      blocks: [{ ...block, daysOfWeek: [2], startMinute: 0, endMinute: 90, slotIntervalMinutes: 30 }],
      dateFrom: "2026-08-04",
      dateTo: "2026-08-04",
    });

    expect(slots.map((slot) => slot.label)).toEqual(["12:00 AM", "12:30 AM"]);
    expect(slots[0].startsAt).toBe("2026-08-04T04:00:00.000Z");
  });

  it("keeps wall-clock times stable across daylight-saving start and end", () => {
    const spring = availability({
      blocks: [{ ...block, daysOfWeek: [0], startMinute: 8 * 60, endMinute: 9 * 60 }],
      dateFrom: "2026-03-08",
      dateTo: "2026-03-08",
      now: new Date("2026-03-01T12:00:00.000Z"),
    });
    expect(spring[0].label).toBe("8:00 AM");
    expect(spring[0].startsAt).toBe("2026-03-08T12:00:00.000Z");

    const fall = availability({
      blocks: [{ ...block, daysOfWeek: [0], startMinute: 8 * 60, endMinute: 9 * 60 }],
      dateFrom: "2026-11-01",
      dateTo: "2026-11-01",
      now: new Date("2026-10-25T12:00:00.000Z"),
    });
    expect(fall[0].label).toBe("8:00 AM");
    expect(fall[0].startsAt).toBe("2026-11-01T13:00:00.000Z");
  });
});
