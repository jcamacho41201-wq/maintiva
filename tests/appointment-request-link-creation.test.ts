import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clientMutationError, safeDatabaseError } from "@/lib/server-diagnostics";

function source(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("appointment request link creation", () => {
  it("makes the Revenue Queue link button actionable and never silent", () => {
    const modal = source("src/components/contact-customer-modal.tsx");
    const dashboardPage = source("src/app/page.tsx");
    const automationPage = source("src/app/automation/page.tsx");

    expect(modal).toContain("async function createLink()");
    expect(modal).toContain('setCreatingLink(true)');
    expect(modal).toContain('Creating link...');
    expect(modal).toContain("try {");
    expect(modal).toContain("finally {");
    expect(modal).toContain('setLinkError("Could not create the appointment request link. Please try again.")');
    expect(modal).toContain("Appointment Request Link");
    expect(modal).toContain('aria-label="Appointment request link"');
    expect(modal).toContain("copyRequestLink");
    expect(modal).toContain("Copy failed. Select the request link and copy it manually.");
    expect(modal).toContain("Insert in draft");
    expect(dashboardPage).toContain("appointmentRequestsEnabled={state.appointmentRequestsEnabled}");
    expect(automationPage).toContain("appointmentRequestsEnabled={state.appointmentRequestsEnabled}");
  });

  it("returns the raw URL only at creation and displays existing metadata safely", () => {
    const workflow = source("src/lib/appointment-request-workflow.ts");
    const createStart = workflow.indexOf("export async function createPilotAppointmentRequestLink");
    const createEnd = workflow.indexOf("export async function revokePilotAppointmentRequestLink", createStart);
    const createLink = workflow.slice(createStart, createEnd);
    const modal = source("src/components/contact-customer-modal.tsx");

    expect(createLink).toContain("const token = createAppointmentRequestToken()");
    expect(createLink).toContain("const tokenHash = hashAppointmentRequestToken(token)");
    expect(createLink).toContain("const rawUrl = appointmentRequestUrl(input.appUrl, token)");
    expect(createLink).toContain("tokenHash,");
    expect(createLink).not.toContain("token,");
    expect(createLink).toContain("url: rawUrl");
    expect(workflow).toContain("stateAppointmentRequestLinks");
    expect(modal).toContain("Regenerate this active link to create a new secure URL.");
  });

  it("normalizes public route tokens and logs safe unavailable reasons", () => {
    const workflow = source("src/lib/appointment-request-workflow.ts");
    const page = source("src/app/request/[token]/page.tsx");

    expect(workflow).toContain("normalizeAppointmentRequestToken(token)");
    expect(workflow).toContain("isAppointmentRequestTokenFormat(normalizedToken)");
    expect(workflow).toContain("Maintiva appointment request public resolution");
    for (const reason of [
      "INVALID_TOKEN_FORMAT",
      "TOKEN_HASH_NOT_FOUND",
      "LINK_REVOKED",
      "LINK_EXPIRED",
      "LINK_USED",
      "SERVICE_SCOPE_MISSING",
      "OPPORTUNITY_INELIGIBLE",
      "NO_FUTURE_AVAILABILITY",
      "SERVER_ERROR",
    ]) {
      expect(workflow).toContain(reason);
    }
    expect(workflow).toContain("tokenHashPrefix");
    expect(workflow).toContain("tokenFormatValid");
    expect(workflow).not.toContain("rawToken");
    expect(page).toContain("encodeURIComponent(token.trim())");
  });

  it("keeps public request resolution off unapplied Appointment self-scheduling columns", () => {
    const workflow = source("src/lib/appointment-request-workflow.ts");
    const loadStart = workflow.indexOf("async function loadLinkByToken");
    const loadEnd = workflow.indexOf("async function loadOpportunityTarget", loadStart);
    const loadLinkByToken = workflow.slice(loadStart, loadEnd);
    const acceptStart = workflow.indexOf("export async function acceptPilotMaintenanceAppointmentRequest");
    const acceptEnd = workflow.indexOf("export async function declinePilotMaintenanceAppointmentRequest", acceptStart);
    const acceptRequest = workflow.slice(acceptStart, acceptEnd);

    expect(loadLinkByToken).toContain("finalAppointment: { select: { scheduledStart: true, scheduledEnd: true } }");
    expect(loadLinkByToken).not.toContain("finalAppointment: true");
    expect(loadLinkByToken).not.toContain("bookingLinkId");
    expect(acceptRequest).toContain("finalAppointment: { select: { id: true } }");
    expect(acceptRequest).toContain("select: { id: true }");
    expect(acceptRequest).not.toContain("finalAppointment: true");
  });

  it("matches opportunities to Smart Maintenance Blocks by canonical ServiceDefinition ID", () => {
    const workflow = source("src/lib/appointment-request-workflow.ts");

    expect(workflow).toContain("maintenanceRecord: {");
    expect(workflow).toContain("serviceDefinition: true");
    expect(workflow).toContain("declinedWorkRecord: true");
    expect(workflow).toContain("normalizedServiceName(declinedWorkRecord.serviceName)");
    expect(workflow).toContain("serviceDefinitionId: serviceDefinition.id");
    expect(workflow).toContain("serviceLaborMinutesById");
    expect(workflow).toContain("[service.serviceDefinitionId, service.laborMinutes]");
    expect(workflow).toContain("block.services.map((service) => service.serviceDefinitionId)");
    expect(workflow).toContain("serviceDefinitionIds.every((serviceDefinitionId) => blockServiceIds.has(serviceDefinitionId))");
    expect(workflow).not.toContain("serviceName ===");
    expect(workflow).not.toContain("serviceDefinitionId: record.id");
    expect(workflow).not.toContain("serviceDefinitionId: opportunity.id");
  });

  it("does not collapse declined-work target resolution into a fake capacity error", () => {
    const workflow = source("src/lib/appointment-request-workflow.ts");

    expect(workflow).toContain("No active service definition matches this opportunity.");
    expect(workflow).toContain("declinedWorkRecord?.laborMinutes");
    expect(workflow).toContain("declinedWorkRecord?.recommendedPriceCents");
    expect(workflow).toContain("declinedWorkRecord?.serviceName");
  });

  it("distinguishes no eligible block from no future availability", () => {
    const workflow = source("src/lib/appointment-request-workflow.ts");

    expect(workflow).toContain('code: "APPOINTMENT_REQUEST_NO_ELIGIBLE_BLOCK"');
    expect(workflow).toContain("No Smart Maintenance Block currently supports this service.");
    expect(workflow).toContain('code: "APPOINTMENT_REQUEST_NO_SERVICE_DURATION"');
    expect(workflow).toContain("This service needs a labor duration before appointment times can be offered.");
    expect(workflow).toContain('code: "APPOINTMENT_REQUEST_NO_CAPACITY"');
    expect(workflow).toContain("No request times are currently available for this service.");
  });

  it("uses shop-local date windows like the Smart Maintenance Block preview", () => {
    const workflow = source("src/lib/appointment-request-workflow.ts");
    const previewPage = source("src/app/settings/smart-maintenance-blocks/page.tsx");

    expect(previewPage).toContain("currentDateInTimeZone(state.shop.timezone)");
    expect(workflow).toContain("currentDateInTimeZone(timezone, now)");
    expect(workflow).toContain("dateWindow(input.now, maxHorizon, data.shop.timezone)");
  });

  it("keeps link creation side-effect-free for requests, appointments, opportunities, and outreach", () => {
    const workflow = source("src/lib/appointment-request-workflow.ts");
    const start = workflow.indexOf("export async function createPilotAppointmentRequestLink");
    const end = workflow.indexOf("export async function revokePilotAppointmentRequestLink", start);
    const createLink = workflow.slice(start, end);

    expect(createLink).toContain("appointmentRequestLink.create");
    expect(createLink).toContain("appointmentRequestLinkService.createMany");
    expect(createLink).not.toContain("appointmentRequest.create");
    expect(createLink).not.toContain("appointment.create");
    expect(createLink).not.toContain("maintenanceRevenueOpportunity.update");
    expect(createLink).not.toContain("outreachRecord.create");
  });

  it("uses unchecked createMany rows instead of nested relation creates for request workflow persistence", () => {
    const workflow = source("src/lib/appointment-request-workflow.ts");
    const createStart = workflow.indexOf("export async function createPilotAppointmentRequestLink");
    const createEnd = workflow.indexOf("export async function revokePilotAppointmentRequestLink", createStart);
    const createLink = workflow.slice(createStart, createEnd);
    const submitStart = workflow.indexOf("export async function submitPublicAppointmentRequest");
    const submitEnd = workflow.indexOf("export async function acceptPilotMaintenanceAppointmentRequest", submitStart);
    const submitRequest = workflow.slice(submitStart, submitEnd);
    const acceptStart = workflow.indexOf("export async function acceptPilotMaintenanceAppointmentRequest");
    const acceptEnd = workflow.indexOf("export async function declinePilotMaintenanceAppointmentRequest", acceptStart);
    const acceptRequest = workflow.slice(acceptStart, acceptEnd);

    expect(createLink).toContain("appointmentRequestLinkService.createMany");
    expect(createLink).not.toMatch(/services:\s*\{\s*create:/);
    expect(submitRequest).toContain("appointmentRequestService.createMany");
    expect(submitRequest).not.toMatch(/services:\s*\{\s*create:/);
    expect(acceptRequest).toContain("appointmentService.createMany");
    expect(acceptRequest).not.toMatch(/services:\s*\{\s*create:/);
  });

  it("logs the sanitized link persistence scope without raw tokens or customer text", () => {
    const workflow = source("src/lib/appointment-request-workflow.ts");

    expect(workflow).toContain("Maintiva appointment request link persistence failed");
    expect(workflow).toContain('operation: "AppointmentRequestLink.create"');
    expect(workflow).toContain("transactionRolledBackOnFailure: true");
    expect(workflow).toContain("tokenHashFormat");
    expect(workflow).toContain("lowercaseHexSha256");
    expect(workflow).toContain("serviceNameSnapshotPresent");
    expect(workflow).not.toContain("token: token");
    expect(workflow).not.toContain("tokenHash, token");
  });

  it("maps appointment request persistence failures to specific safe client errors", () => {
    expect(clientMutationError(
      {
        code: "P2003",
        message: "Foreign key constraint violated",
        meta: {
          modelName: "AppointmentRequestLinkService",
          field_name: "AppointmentRequestLinkService_block_service_fkey",
        },
      },
      { action: "createAppointmentRequestLink", table: "AppointmentRequestLink", operation: "INSERT" },
    )).toMatchObject({
      code: "APPOINTMENT_REQUEST_SCOPE_MISMATCH",
      message: "Appointment request links are temporarily unavailable for this opportunity.",
    });

    expect(clientMutationError(
      { code: "23514", message: "check constraint failed" },
      { action: "createAppointmentRequestLink", table: "AppointmentRequestLink", operation: "INSERT" },
    )).toMatchObject({
      code: "APPOINTMENT_REQUEST_INVALID_LINK_PAYLOAD",
      message: "Appointment request links are temporarily unavailable.",
    });
  });

  it("preserves safe Prisma metadata for server-side diagnostics", () => {
    expect(safeDatabaseError({
      code: "P2003",
      message: "Foreign key constraint violated",
      meta: {
        modelName: "AppointmentRequestLinkService",
        field_name: "AppointmentRequestLinkService_block_service_fkey",
      },
    })).toMatchObject({
      code: "P2003",
      modelName: "AppointmentRequestLinkService",
      fieldName: "AppointmentRequestLinkService_block_service_fkey",
    });
  });
});
