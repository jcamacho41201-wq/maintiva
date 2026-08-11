import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const appointmentsPage = readFileSync("src/app/appointments/page.tsx", "utf8");
const dashboardPage = readFileSync("src/app/page.tsx", "utf8");

describe("appointment calendar release UI", () => {
  it("renders the calendar as a time grid with explicit request and region labels", () => {
    expect(appointmentsPage).toContain("layoutTimedEvents");
    expect(appointmentsPage).toContain("gridTemplateColumns");
    expect(appointmentsPage).toContain("overlapCount");
    expect(appointmentsPage).toContain("PENDING REQUEST");
    expect(appointmentsPage).toContain("CONFIRMED");
    expect(appointmentsPage).toContain("Maintenance capacity");
    expect(appointmentsPage).toContain("UNAVAILABLE");
    expect(appointmentsPage).toContain("Times shown in shop local time");
  });

  it("keeps appointment requests visible from the main dashboard", () => {
    expect(dashboardPage).toContain("Pending Appointment Requests");
    expect(dashboardPage).toContain("No appointment requests need review.");
    expect(dashboardPage).toContain("Review Request");
    expect(dashboardPage).toContain('href="/appointments"');
  });
});
