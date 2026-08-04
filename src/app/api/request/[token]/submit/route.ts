import { NextResponse } from "next/server";
import { z } from "zod";
import { appointmentRequestSubmittedMessage } from "@/lib/appointment-requests";
import {
  appointmentRequestsDisabledResponse,
  isAppointmentRequestsEnabled,
} from "@/lib/feature-flags";

const submitSchema = z.object({
  startsAt: z.iso.datetime(),
  idempotencyKey: z.string().min(8).max(120),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  await params;
  const body = await request.json().catch(() => ({}));
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "APPOINTMENT_REQUEST_INVALID", message: "Choose a valid request time." },
      { status: 400 },
    );
  }

  if (!isAppointmentRequestsEnabled()) {
    return NextResponse.json(appointmentRequestsDisabledResponse(), { status: 404 });
  }

  return NextResponse.json(
    {
      code: "APPOINTMENT_REQUESTS_NOT_RELEASED",
      message: appointmentRequestSubmittedMessage("the shop"),
    },
    { status: 404 },
  );
}
