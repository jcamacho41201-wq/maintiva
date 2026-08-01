import { NextResponse } from "next/server";
import { z } from "zod";
import {
  type AuthenticatedShopContext,
  AuthRequiredError,
  OnboardingRequiredError,
  TenantAccessError,
  requireActiveShopMembership,
} from "@/lib/auth";
import {
  addPilotCustomer,
  addPilotMaintenanceItem,
  addPilotServiceDefinition,
  addPilotVehicle,
  approvePilotAppointmentRequest,
  bookPilotAppointment,
  buildPilotState,
  completePilotAppointment,
  createPilotBookingLink,
  declinePilotAppointmentRequest,
  deactivatePilotMaintenanceItem,
  endPilotOpportunitySnooze,
  importPilotCsvRows,
  markPilotMaintenanceServiceComplete,
  markPilotOutreachManuallySent,
  recordPilotInspection,
  recordPilotOpportunityContact,
  resetPilotManualMileageOverride,
  reviewPilotMileageReading,
  setPilotCustomerReportedMileage,
  setPilotManualMileageOverride,
  savePilotBookingSettings,
  savePilotServiceBookingRule,
  snoozePilotOpportunity,
  updatePilotMaintenanceItem,
  updatePilotCustomer,
  updatePilotServiceDefinition,
  updatePilotVehicle,
  updatePilotVehicleMileage,
} from "@/lib/pilot-state";
import {
  clientMutationError,
  logPilotMutationFailure,
  safeMutationOperation,
} from "@/lib/server-diagnostics";
import { BrowserShopIdError, rejectBrowserShopId } from "@/lib/tenant-security";

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("addCustomer"), payload: z.unknown() }),
  z.object({
    action: z.literal("updateCustomer"),
    id: z.string().min(1),
    payload: z.unknown(),
  }),
  z.object({ action: z.literal("addVehicle"), payload: z.unknown() }),
  z.object({
    action: z.literal("updateVehicle"),
    id: z.string().min(1),
    payload: z.unknown(),
  }),
  z.object({ action: z.literal("addServiceDefinition"), payload: z.unknown() }),
  z.object({
    action: z.literal("updateServiceDefinition"),
    id: z.string().min(1),
    payload: z.unknown(),
  }),
  z.object({ action: z.literal("saveBookingSettings"), payload: z.unknown() }),
  z.object({
    action: z.literal("saveServiceBookingRule"),
    id: z.string().min(1),
    payload: z.unknown(),
  }),
  z.object({ action: z.literal("addMaintenanceItem"), payload: z.unknown() }),
  z.object({
    action: z.literal("updateMaintenanceItem"),
    id: z.string().min(1),
    payload: z.unknown(),
  }),
  z.object({
    action: z.literal("deactivateMaintenanceItem"),
    id: z.string().min(1),
  }),
  z.object({ action: z.literal("markMaintenanceServiceComplete"), payload: z.unknown() }),
  z.object({ action: z.literal("recordInspection"), payload: z.unknown() }),
  z.object({ action: z.literal("updateVehicleMileage"), payload: z.unknown() }),
  z.object({ action: z.literal("setCustomerReportedMileage"), payload: z.unknown() }),
  z.object({ action: z.literal("setManualMileageOverride"), payload: z.unknown() }),
  z.object({ action: z.literal("resetManualMileageOverride"), payload: z.unknown() }),
  z.object({ action: z.literal("reviewMileageReading"), payload: z.unknown() }),
  z.object({
    action: z.literal("markOutreachManuallySent"),
    payload: z.object({
      customerId: z.string().min(1),
      vehicleId: z.string().min(1),
      maintenanceRecordIds: z.array(z.string().min(1)).min(1),
      message: z.string().min(20),
      channel: z.enum(["PHONE", "TEXT", "EMAIL", "CALL", "IN_PERSON", "OTHER"]).optional(),
      responseStatus: z.enum([
        "NO_RESPONSE",
        "INTERESTED",
        "WANTS_CALLBACK",
        "BOOKED",
        "DECLINED",
        "NOT_NOW",
        "WRONG_CONTACT",
        "DO_NOT_CONTACT",
      ]).optional(),
    }),
  }),
  z.object({
    action: z.literal("recordOpportunityContact"),
    payload: z.object({
      customerId: z.string().min(1),
      vehicleId: z.string().min(1),
      opportunityIds: z.array(z.string().min(1)).min(1),
      message: z.string().min(3),
      channel: z.enum(["PHONE", "TEXT", "EMAIL", "CALL", "IN_PERSON", "OTHER"]),
      responseStatus: z.enum([
        "NO_RESPONSE",
        "INTERESTED",
        "WANTS_CALLBACK",
        "BOOKED",
        "DECLINED",
        "NOT_NOW",
        "WRONG_CONTACT",
        "DO_NOT_CONTACT",
      ]),
      followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
      bookingLinkId: z.string().min(1).optional(),
      idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,120}$/).optional(),
    }),
  }),
  z.object({
    action: z.literal("createBookingLink"),
    payload: z.object({
      customerId: z.string().min(1),
      vehicleId: z.string().min(1),
      opportunityIds: z.array(z.string().min(1)).min(1),
    }),
  }),
  z.object({
    action: z.literal("bookAppointment"),
    payload: z.object({
      customerId: z.string().min(1),
      vehicleId: z.string().min(1),
      maintenanceRecordIds: z.array(z.string().min(1)),
      opportunityIds: z.array(z.string().min(1)).optional(),
      date: z.string().min(8),
      time: z.string().min(4),
      status: z.enum([
        "REQUESTED",
        "CONFIRMED",
        "IN_PROGRESS",
        "COMPLETED",
        "CANCELLED",
        "NO_SHOW",
      ]),
      notes: z.string().optional(),
    }),
  }),
  z.object({
    action: z.literal("snoozeOpportunity"),
    payload: z.object({
      customerId: z.string().min(1),
      vehicleId: z.string().min(1),
      opportunityIds: z.array(z.string().min(1)).min(1),
      snoozedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason: z.string().min(1),
      notes: z.string().optional(),
    }),
  }),
  z.object({
    action: z.literal("endOpportunitySnooze"),
    payload: z.object({
      customerId: z.string().min(1),
      vehicleId: z.string().min(1),
      opportunityIds: z.array(z.string().min(1)).min(1),
    }),
  }),
  z.object({
    action: z.literal("completeAppointment"),
    payload: z.object({
      appointmentId: z.string().min(1),
      completedRevenueCents: z.number().int().nonnegative(),
      completedLaborHours: z.number().positive(),
      completedAt: z.string().min(8),
      notes: z.string().optional(),
    }),
  }),
  z.object({
    action: z.literal("approveAppointmentRequest"),
    id: z.string().min(1),
  }),
  z.object({
    action: z.literal("declineAppointmentRequest"),
    id: z.string().min(1),
    payload: z.object({ reason: z.string().optional() }).optional(),
  }),
  z.object({
    action: z.literal("importCsvRows"),
    payload: z.object({
      fileName: z.string().min(1),
      importType: z.enum([
        "CUSTOMERS",
        "VEHICLES",
        "SERVICE_HISTORY",
        "DECLINED_WORK",
        "APPOINTMENTS",
        "COMBINED",
      ]),
      duplicateMode: z.enum(["SKIP", "UPDATE", "IMPORT_AS_NEW"]),
      rowActions: z.record(z.string(), z.enum(["IMPORT", "HOLD", "SKIP", "UPDATE", "IMPORT_AS_NEW"])).optional(),
      rows: z.array(z.record(z.string(), z.string())).max(1000),
      mapping: z.record(z.string(), z.enum([
        "ignore",
        "customerExternalId",
        "customerFirstName",
        "customerLastName",
        "customerFullName",
        "customerEmail",
        "customerPhone",
        "vehicleExternalId",
        "vehicleCustomerExternalId",
        "vin",
        "vehicleYear",
        "vehicleMake",
        "vehicleModel",
        "licensePlate",
        "currentMileage",
        "serviceName",
        "serviceDate",
        "serviceMileage",
        "price",
        "laborHours",
        "status",
        "declinedDate",
        "advisorNotes",
        "appointmentDate",
        "appointmentTime",
        "services",
      ])),
    }),
  }),
]);

export async function POST(request: Request) {
  let context: AuthenticatedShopContext | undefined;
  let json: unknown;
  let operation = safeMutationOperation(undefined);
  let mutationCommitted = false;
  try {
    json = await request.json();
    rejectBrowserShopId(json);
    operation = safeMutationOperation(json);
    context = await requireActiveShopMembership();
    const body = mutationSchema.parse(json);
    operation = safeMutationOperation(body);
    let bookingLink: Awaited<ReturnType<typeof createPilotBookingLink>> | undefined;

    switch (body.action) {
      case "addCustomer":
        await addPilotCustomer(context, body.payload);
        mutationCommitted = true;
        break;
      case "updateCustomer":
        await updatePilotCustomer(context, body.id, body.payload);
        mutationCommitted = true;
        break;
      case "addVehicle":
        await addPilotVehicle(context, body.payload);
        mutationCommitted = true;
        break;
      case "updateVehicle":
        await updatePilotVehicle(context, body.id, body.payload);
        mutationCommitted = true;
        break;
      case "addServiceDefinition":
        await addPilotServiceDefinition(context, body.payload);
        mutationCommitted = true;
        break;
      case "updateServiceDefinition":
        await updatePilotServiceDefinition(context, body.id, body.payload);
        mutationCommitted = true;
        break;
      case "saveBookingSettings":
        await savePilotBookingSettings(context, body.payload);
        mutationCommitted = true;
        break;
      case "saveServiceBookingRule":
        await savePilotServiceBookingRule(context, body.id, body.payload);
        mutationCommitted = true;
        break;
      case "addMaintenanceItem":
        await addPilotMaintenanceItem(context, body.payload);
        mutationCommitted = true;
        break;
      case "updateMaintenanceItem":
        await updatePilotMaintenanceItem(context, body.id, body.payload);
        mutationCommitted = true;
        break;
      case "deactivateMaintenanceItem":
        await deactivatePilotMaintenanceItem(context, body.id);
        mutationCommitted = true;
        break;
      case "markMaintenanceServiceComplete":
        await markPilotMaintenanceServiceComplete(context, body.payload);
        mutationCommitted = true;
        break;
      case "recordInspection":
        await recordPilotInspection(context, body.payload);
        mutationCommitted = true;
        break;
      case "updateVehicleMileage":
        await updatePilotVehicleMileage(context, body.payload);
        mutationCommitted = true;
        break;
      case "setCustomerReportedMileage":
        await setPilotCustomerReportedMileage(context, body.payload);
        mutationCommitted = true;
        break;
      case "setManualMileageOverride":
        await setPilotManualMileageOverride(context, body.payload);
        mutationCommitted = true;
        break;
      case "resetManualMileageOverride":
        await resetPilotManualMileageOverride(context, body.payload);
        mutationCommitted = true;
        break;
      case "reviewMileageReading":
        await reviewPilotMileageReading(context, body.payload);
        mutationCommitted = true;
        break;
      case "markOutreachManuallySent":
        await markPilotOutreachManuallySent(context, body.payload);
        mutationCommitted = true;
        break;
      case "recordOpportunityContact":
        await recordPilotOpportunityContact(context, body.payload);
        mutationCommitted = true;
        break;
      case "createBookingLink":
        bookingLink = await createPilotBookingLink(context, {
          ...body.payload,
          appUrl: request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        });
        mutationCommitted = true;
        break;
      case "bookAppointment":
        await bookPilotAppointment(context, body.payload);
        mutationCommitted = true;
        break;
      case "snoozeOpportunity":
        await snoozePilotOpportunity(context, body.payload);
        mutationCommitted = true;
        break;
      case "endOpportunitySnooze":
        await endPilotOpportunitySnooze(context, body.payload);
        mutationCommitted = true;
        break;
      case "completeAppointment":
        await completePilotAppointment(context, body.payload);
        mutationCommitted = true;
        break;
      case "approveAppointmentRequest":
        await approvePilotAppointmentRequest(context, body.id);
        mutationCommitted = true;
        break;
      case "declineAppointmentRequest":
        await declinePilotAppointmentRequest(context, body.id, body.payload);
        mutationCommitted = true;
        break;
      case "importCsvRows":
        await importPilotCsvRows(context, body.payload);
        mutationCommitted = true;
        break;
    }

    try {
      return NextResponse.json({ state: await buildPilotState(context), bookingLink });
    } catch (refreshError) {
      if (mutationCommitted) {
        console.error("Maintiva pilot mutation committed but state refresh failed", {
          auth: {
            userId: context.userId.length > 14 ? `${context.userId.slice(0, 8)}...${context.userId.slice(-4)}` : context.userId,
            shopId: context.shopId.length > 14 ? `${context.shopId.slice(0, 8)}...${context.shopId.slice(-4)}` : context.shopId,
            membershipActive: true,
            role: context.role,
          },
          operation,
        });
        return NextResponse.json(
          { code: "STATE_REFRESH_FAILED_AFTER_MUTATION", committed: true, message: "The customer was contacted, but the opportunity could not be refreshed." },
          { status: 202 },
        );
      }
      throw refreshError;
    }
  } catch (error) {
    logPilotMutationFailure({ error, context, payload: json, operation });
    if (error instanceof OnboardingRequiredError) {
      return NextResponse.json(
        { code: "ONBOARDING_REQUIRED", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof AuthRequiredError) {
      return NextResponse.json(
        { code: "AUTH_REQUIRED", message: error.message },
        { status: 401 },
      );
    }
    if (error instanceof TenantAccessError) {
      return NextResponse.json(
        { code: "TENANT_FORBIDDEN", message: error.message },
        { status: 403 },
      );
    }
    const clientError = clientMutationError(error, operation);
    if (clientError) {
      return NextResponse.json(
        { code: clientError.code, message: clientError.message },
        { status: clientError.status },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: "VALIDATION_FAILED", message: "A required service field is missing or invalid.", issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof BrowserShopIdError) {
      return NextResponse.json(
        { code: "SHOP_ID_FORBIDDEN", message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: "MUTATION_FAILED", message: "Unable to save changes." },
      { status: 500 },
    );
  }
}
