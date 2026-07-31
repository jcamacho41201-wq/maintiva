import { NextResponse } from "next/server";
import { z } from "zod";
import {
  cancelPublicAppointment,
  reschedulePublicAppointment,
  submitPublicBooking,
} from "@/lib/customer-booking";
import { customerBookingDisabledResponse, isCustomerBookingEnabled } from "@/lib/feature-flags";
import { SafeActionError } from "@/lib/server-diagnostics";

const bookingSchema = z.object({
  startsAt: z.string().min(8),
  intakeType: z.enum(["WAIT", "DROP_OFF"]),
  extraMaintenanceRecordIds: z.array(z.string().min(1)).optional(),
  customerNotes: z.string().max(1000).optional(),
  idempotencyKey: z.string().max(120).optional(),
});

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: z.string().max(1000).optional() }),
  z.object({
    action: z.literal("reschedule"),
    startsAt: z.string().min(8),
    intakeType: z.enum(["WAIT", "DROP_OFF"]),
    customerNotes: z.string().max(1000).optional(),
  }),
]);

function bookingError(error: unknown) {
  if (error instanceof SafeActionError) {
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { code: "BOOKING_PAYLOAD_INVALID", message: "The booking request is invalid." },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { code: "BOOKING_SAVE_FAILED", message: "The appointment could not be saved." },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    if (!isCustomerBookingEnabled()) {
      return NextResponse.json(customerBookingDisabledResponse(), { status: 404 });
    }
    const { token } = await params;
    const body = bookingSchema.parse(await request.json());
    return NextResponse.json({ appointment: await submitPublicBooking(token, body) });
  } catch (error) {
    return bookingError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    if (!isCustomerBookingEnabled()) {
      return NextResponse.json(customerBookingDisabledResponse(), { status: 404 });
    }
    const { token } = await params;
    const body = patchSchema.parse(await request.json());
    if (body.action === "cancel") {
      await cancelPublicAppointment(token, body.reason);
      return NextResponse.json({ ok: true });
    }
    await reschedulePublicAppointment(token, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return bookingError(error);
  }
}
