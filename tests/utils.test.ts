import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/utils";

describe("formatDate", () => {
  it("formats date-only values without shifting to the previous local day", () => {
    expect(formatDate("2026-07-29")).toBe("Jul 29, 2026");
  });
});
