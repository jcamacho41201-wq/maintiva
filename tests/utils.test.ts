import { describe, expect, it } from "vitest";
import { formatDate, formatLaborHours } from "@/lib/utils";

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
});
