import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pilotStateSource = readFileSync(join(process.cwd(), "src/lib/pilot-state.ts"), "utf8");
const diagnosticsSource = readFileSync(join(process.cwd(), "src/lib/server-diagnostics.ts"), "utf8");

function bodyOf(functionName: string) {
  const match = pilotStateSource.match(new RegExp(`export async function ${functionName}[\\s\\S]+?\\n}\\n(?=\\nexport async function|$)`));
  expect(match, `${functionName} should exist`).not.toBeNull();
  return match?.[0] ?? "";
}

function constantBlock(name: string) {
  const match = pilotStateSource.match(new RegExp(`const ${name} = \\{[\\s\\S]+?\\n\\} satisfies Prisma\\.[A-Za-z]+Select;`));
  expect(match, `${name} should exist`).not.toBeNull();
  return match?.[0] ?? "";
}

describe("import production schema compatibility", () => {
  it("defines a baseline appointment select without unapplied booking columns", () => {
    const baseline = constantBlock("baselineAppointmentSelect");

    expect(baseline).toContain("scheduledStart: true");
    expect(baseline).toContain("totalLaborMinutes: true");
    expect(baseline).not.toContain("bookingLinkId");
    expect(baseline).not.toContain("intakeType");
    expect(baseline).not.toContain("customerNotes");
    expect(baseline).not.toContain("internalNotes");
    expect(baseline).not.toContain("requestedAt");
  });

  it("keeps core active-shop appointment and outreach state on explicit legacy-safe selects", () => {
    expect(pilotStateSource).toContain("appointments: {\n        select: baselineAppointmentWithServicesSelect");
    expect(pilotStateSource).toMatch(/outreachRecords:\s*\{\s*orderBy:[\s\S]+select:\s*\{/);
    expect(pilotStateSource).toContain("appointmentId: true");
    expect(pilotStateSource).toContain("performedByUserId: true");
    expect(pilotStateSource).toContain("responseStatus: true");
    expect(pilotStateSource).toContain("loadStateAppointmentBookingMetadata");
    expect(pilotStateSource).toContain("loadStateOutreachBookingLinkIds");
  });

  it("makes CSV appointment duplicate detection select only baseline id", () => {
    const importBody = bodyOf("importPilotCsvRows");

    expect(importBody).toContain("const duplicateAppointment = await tx.appointment.findFirst");
    expect(importBody).toContain("select: duplicateAppointmentSelect");
    expect(importBody).not.toContain("bookingLinkId");
    expect(importBody).not.toContain("include: { services: true }");
  });

  it("keeps core appointment booking and completion queries off full-model selections", () => {
    const bookBody = bodyOf("bookPilotAppointment");
    const completeBody = bodyOf("completePilotAppointment");

    expect(bookBody).toContain("select: duplicateAppointmentSelect");
    expect(bookBody).toContain("select: baselineAppointmentSelect");
    expect(bookBody).toContain("appointmentIdFromIdempotencyKey");
    expect(bookBody).toContain("APPOINTMENT_SLOT_UNAVAILABLE");
    expect(bookBody).not.toContain("bookingLinkId");
    expect(completeBody).toContain("select: baselineAppointmentWithServicesSelect");
    expect(completeBody).toContain("select: baselineAppointmentSelect");
    expect(completeBody).not.toContain("include: { services: true }");
    expect(completeBody).not.toContain("bookingLinkId");
  });

  it("keeps optional booking metadata behind the disabled self-scheduling feature path", () => {
    expect(pilotStateSource).toMatch(/async function loadStateAppointmentBookingMetadata[\s\S]+if \(!isCustomerBookingEnabled\(\)\) \{[\s\S]+return \[\];/);
    expect(pilotStateSource).toMatch(/async function loadStateOutreachBookingLinkIds[\s\S]+if \(!isCustomerBookingEnabled\(\)\) \{[\s\S]+return \[\];/);
    expect(pilotStateSource).toContain("if (!isCustomerBookingEnabled())");
  });

  it("returns a safe import-specific schema compatibility error", () => {
    expect(diagnosticsSource).toContain("importCsvRows");
    expect(diagnosticsSource).toContain("IMPORT_SCHEMA_COMPATIBILITY_ERROR");
    expect(diagnosticsSource).toContain("The import could not be completed because a required application update is missing.");
    expect(diagnosticsSource).not.toContain("Appointment.bookingLinkId");
  });

  it("returns a safe appointment-specific schema compatibility error", () => {
    expect(diagnosticsSource).toContain("bookAppointment");
    expect(diagnosticsSource).toContain("APPOINTMENT_SCHEMA_COMPATIBILITY_ERROR");
    expect(diagnosticsSource).toContain("The appointment could not be created because a required application update is missing.");
    expect(diagnosticsSource).not.toContain("Appointment.bookingLinkId");
  });
});
