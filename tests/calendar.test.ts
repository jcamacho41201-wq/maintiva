import { describe, expect, it } from "vitest";
import {
  addMinutesToIso,
  calendarDays,
  dateKeyInTimeZone,
  findWorkForDay,
  getCalendarWarnings,
  getDayCapacity,
  getReadyToScheduleGroups,
  nextDateKey,
  zonedDateTimeToIso,
} from "@/lib/calendar";
import { createInitialDemoState } from "@/lib/demo-data";

describe("capacity calendar engine", () => {
  it("builds week and day ranges from shop date keys", () => {
    expect(calendarDays("2026-07-28", "week")).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
    expect(calendarDays("2026-07-28", "day")).toEqual(["2026-07-28"]);
    expect(nextDateKey("2026-07-28", 1, "week")).toBe("2026-08-04");
  });

  it("keeps selected shop wall time stable when converting to timestamps", () => {
    const iso = zonedDateTimeToIso("2026-11-01", "09:30", "America/New_York");

    expect(dateKeyInTimeZone(iso, "America/New_York")).toBe("2026-11-01");
  });

  it("calculates active daily capacity and excludes canceled future work", () => {
    const state = createInitialDemoState();
    const nextState = {
      ...state,
      appointments: [
        ...state.appointments,
        {
          ...state.appointments[0],
          id: "appt-cancelled",
          scheduledStart: "2026-07-28T09:00:00-04:00",
          scheduledEnd: "2026-07-28T11:00:00-04:00",
          status: "CANCELLED" as const,
        },
      ],
    };
    const capacity = getDayCapacity(nextState, "2026-07-28");

    expect(capacity.scheduledLaborHours).toBe(2);
    expect(capacity.openLaborHours).toBe(62);
    expect(capacity.bookedMaintivaRevenue).toBe(40_000);
  });

  it("warns for over-capacity, after-hours, and duplicate vehicle appointments", () => {
    const state = createInitialDemoState();
    const scheduledStart = zonedDateTimeToIso("2026-07-28", "13:30", state.shop.timezone);
    const warnings = getCalendarWarnings(state, {
      customerId: "cust-victor",
      vehicleId: "veh-telluride",
      scheduledStart,
      scheduledEnd: addMinutesToIso(scheduledStart, 65 * 60),
      totalLaborHours: 65,
      totalPriceCents: 10_000,
    });

    expect(warnings.some((warning) => warning.includes("exceeds"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("closing"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("Same vehicle"))).toBe(true);
  });

  it("finds ready opportunities without treating all opportunities as appointments", () => {
    const state = createInitialDemoState();
    const ready = getReadyToScheduleGroups(state);
    const fillWork = findWorkForDay(state, "2026-07-29");

    expect(ready.every((group) => group.appointmentStatus !== "Booked")).toBe(true);
    expect(fillWork.length).toBeGreaterThan(0);
    expect(state.appointments).toHaveLength(2);
  });
});
