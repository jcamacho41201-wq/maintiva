import { describe, expect, it, vi } from "vitest";
import type {
  BookingWindow,
  ServiceBookingRule,
  ShopBookingBlackout,
  ShopBookingSettings,
} from "@/lib/demo-data";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { calculateBookingAvailability, getAllowedIntakeTypes, getBookingMode } = await import("@/lib/customer-booking");

const settings: ShopBookingSettings = {
  id: "settings-shop-a",
  shopId: "shop-a",
  onlineBookingEnabled: true,
  minimumNoticeMinutes: 60,
  maximumAdvanceDays: 14,
  defaultBufferBeforeMinutes: 0,
  defaultBufferAfterMinutes: 15,
  maximumSimultaneousAppointments: 2,
  cancellationCutoffMinutes: 1440,
  reschedulingCutoffMinutes: 1440,
};

const shopWindows: BookingWindow[] = [{
  id: "shop-window-1",
  shopId: "shop-a",
  dayOfWeek: 1,
  startMinute: 8 * 60,
  endMinute: 12 * 60,
  isActive: true,
}];

function rule(overrides: Partial<ServiceBookingRule> = {}): ServiceBookingRule {
  return {
    id: "rule-oil",
    shopId: "shop-a",
    serviceDefinitionId: "svc-oil",
    bookingEnabled: true,
    bookingMode: "INSTANT",
    estimatedDurationMinutes: 60,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 15,
    allowedIntakeType: "EITHER",
    minimumNoticeMinutes: 60,
    maximumAdvanceDays: 14,
    maximumSimultaneousBookings: 2,
    windows: [{
      id: "service-window-1",
      shopId: "shop-a",
      dayOfWeek: 1,
      startMinute: 9 * 60,
      endMinute: 11 * 60,
      isActive: true,
    }],
    ...overrides,
  };
}

function availability(overrides: Partial<Parameters<typeof calculateBookingAvailability>[0]> = {}) {
  return calculateBookingAvailability({
    shop: { id: "shop-a", timezone: "America/New_York" },
    settings,
    shopWindows,
    blackouts: [],
    serviceRules: [rule()],
    services: [{ id: "svc-oil", laborMinutes: 60 }],
    appointments: [],
    dateFrom: "2026-08-03",
    dateTo: "2026-08-03",
    intakeType: "WAIT",
    now: new Date("2026-08-01T12:00:00.000Z"),
    ...overrides,
  });
}

describe("customer booking availability", () => {
  it("intersects shop hours with service-specific windows", () => {
    const slots = availability();

    expect(slots.map((slot) => slot.label)).toEqual(["9:00 AM", "9:30 AM", "10:00 AM"]);
  });

  it("filters blackouts and buffered conflicting appointments", () => {
    const blackouts: ShopBookingBlackout[] = [{
      id: "blackout-1",
      shopId: "shop-a",
      startsAt: "2026-08-03T13:30:00.000Z",
      endsAt: "2026-08-03T14:15:00.000Z",
      reason: "Staff meeting",
      isFullDay: false,
    }];

    const slots = availability({
      blackouts,
      appointments: [{
        scheduledStart: "2026-08-03T14:30:00.000Z",
        scheduledEnd: "2026-08-03T15:30:00.000Z",
        status: "CONFIRMED",
      }],
    });

    expect(slots.map((slot) => slot.startsAt)).toEqual([]);
  });

  it("honors service capacity independently of shop capacity", () => {
    const slots = availability({
      serviceRules: [rule({ maximumSimultaneousBookings: 1 })],
      appointments: [{
        scheduledStart: "2026-08-03T13:00:00.000Z",
        scheduledEnd: "2026-08-03T14:00:00.000Z",
        status: "CONFIRMED",
      }],
    });

    expect(slots.map((slot) => slot.label)).toEqual(["10:00 AM"]);
  });

  it("applies intake restrictions and request mode labels from all selected services", () => {
    expect(getAllowedIntakeTypes([rule({ allowedIntakeType: "WAIT_ONLY" })])).toEqual(["WAIT"]);
    expect(getAllowedIntakeTypes([rule({ allowedIntakeType: "WAIT_ONLY" }), rule({ allowedIntakeType: "DROP_OFF_ONLY" })])).toEqual([]);
    expect(getBookingMode([rule(), rule({ id: "rule-diagnostic", bookingMode: "REQUEST" })])).toBe("REQUEST");
  });
});
