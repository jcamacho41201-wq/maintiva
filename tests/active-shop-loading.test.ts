import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pilotStateSource = readFileSync(join(process.cwd(), "src/lib/pilot-state.ts"), "utf8");
const dashboardSource = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");

describe("active shop loading", () => {
  it("keeps core shop state loading independent from unapplied customer scheduling columns", () => {
    expect(pilotStateSource).toContain("loadStateAppointmentBookingMetadata");
    expect(pilotStateSource).toContain("loadStateOutreachBookingLinkIds");
    expect(pilotStateSource).toContain("isMissingCustomerBookingSchema(error)");
    expect(pilotStateSource).toContain("select: baselineAppointmentWithServicesSelect");
    expect(pilotStateSource).toMatch(/outreachRecords:\s*\{\s*orderBy:[\s\S]+select:/);
  });

  it("does not render zero dashboard metrics while authenticated shop state is unresolved", () => {
    expect(dashboardSource).toContain("Loading shop…");
    expect(dashboardSource).toContain("We could not load your shop.");
    expect(dashboardSource).toContain("const { state, ready, loadError } = store");
  });
});
