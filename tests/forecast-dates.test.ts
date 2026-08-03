import { describe, expect, it } from "vitest";
import {
  calendarDaysBetween,
  resolveForecastAsOfDate,
} from "@/lib/forecast-dates";

describe("shop-local forecast dates", () => {
  it("resolves the as-of date in the shop timezone", () => {
    expect(resolveForecastAsOfDate({
      shopTimezone: "America/New_York",
      now: new Date("2026-08-03T03:30:00.000Z"),
    })).toBe("2026-08-02");

    expect(resolveForecastAsOfDate({
      shopTimezone: "America/New_York",
      now: new Date("2026-08-03T13:00:00.000Z"),
    })).toBe("2026-08-03");
  });

  it("uses calendar-day arithmetic for due-date boundaries", () => {
    expect(calendarDaysBetween("2026-07-09", "2026-07-10")).toBe(1);
    expect(calendarDaysBetween("2026-07-10", "2026-07-10")).toBe(0);
    expect(calendarDaysBetween("2026-07-11", "2026-07-10")).toBe(-1);
    expect(calendarDaysBetween("2026-08-03", "2026-07-10")).toBe(-24);
  });

  it("does not drift across daylight-saving transitions", () => {
    expect(calendarDaysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(calendarDaysBetween("2026-11-01", "2026-11-03")).toBe(2);
  });
});
