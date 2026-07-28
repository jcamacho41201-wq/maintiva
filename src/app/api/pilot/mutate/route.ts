import { NextResponse } from "next/server";
import { z } from "zod";
import {
  type AuthenticatedShopContext,
  AuthRequiredError,
  OnboardingRequiredError,
  TenantAccessError,
  getAuthenticatedShopContext,
} from "@/lib/auth";
import {
  addPilotCustomer,
  addPilotVehicle,
  bookPilotAppointment,
  buildPilotState,
  completePilotAppointment,
  importPilotCsvRows,
  markPilotOutreachManuallySent,
  updatePilotCustomer,
  updatePilotVehicle,
} from "@/lib/pilot-state";
import { logPilotMutationFailure } from "@/lib/server-diagnostics";
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
    action: z.literal("bookAppointment"),
    payload: z.object({
      customerId: z.string().min(1),
      vehicleId: z.string().min(1),
      maintenanceRecordIds: z.array(z.string().min(1)).min(1),
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
  try {
    json = await request.json();
    rejectBrowserShopId(json);
    context = await getAuthenticatedShopContext();
    const body = mutationSchema.parse(json);

    switch (body.action) {
      case "addCustomer":
        await addPilotCustomer(context, body.payload);
        break;
      case "updateCustomer":
        await updatePilotCustomer(context, body.id, body.payload);
        break;
      case "addVehicle":
        await addPilotVehicle(context, body.payload);
        break;
      case "updateVehicle":
        await updatePilotVehicle(context, body.id, body.payload);
        break;
      case "markOutreachManuallySent":
        await markPilotOutreachManuallySent(context, body.payload);
        break;
      case "bookAppointment":
        await bookPilotAppointment(context, body.payload);
        break;
      case "completeAppointment":
        await completePilotAppointment(context, body.payload);
        break;
      case "importCsvRows":
        await importPilotCsvRows(context, body.payload);
        break;
    }

    return NextResponse.json({ state: await buildPilotState(context) });
  } catch (error) {
    logPilotMutationFailure({ error, context, payload: json });
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: "VALIDATION_FAILED", message: "Invalid request payload.", issues: error.issues },
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
