import { NextResponse } from "next/server";
import { z } from "zod";
import {
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
  markPilotOutreachManuallySent,
  updatePilotCustomer,
  updatePilotVehicle,
} from "@/lib/pilot-state";
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
      channel: z.enum(["SMS", "EMAIL", "CALL"]).optional(),
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
]);

export async function POST(request: Request) {
  try {
    const context = await getAuthenticatedShopContext();
    const json = await request.json();
    rejectBrowserShopId(json);
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
    }

    return NextResponse.json({ state: await buildPilotState(context) });
  } catch (error) {
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
