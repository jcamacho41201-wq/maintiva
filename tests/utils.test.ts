import { describe, expect, it } from "vitest";
import { formatDate, formatHours, formatLaborHours, formatLaborMinutes } from "@/lib/utils";

describe("formatDate", () => {
  it("formats date-only values without shifting to the previous local day", () => {
    expect(formatDate("2026-07-29")).toBe("Jul 29, 2026");
  });
});

describe("formatLaborHours", () => {
  it("formats decimal labor hours for queue display", () => {
    expect(formatLaborHours(2)).toBe("2 hr");
    expect(formatLaborHours(2.033333333333333)).toBe("2 hr 2 min");
    expect(formatLaborHours(1.9333333333333333)).toBe("1 hr 56 min");
  });

  it("uses the same readable format for minute and hour inputs", () => {
    expect(formatLaborMinutes(61)).toBe("1 hr 1 min");
    expect(formatHours(61)).toBe("1 hr 1 min");
    expect(formatLaborHours(61 / 60)).toBe("1 hr 1 min");
  });
});
