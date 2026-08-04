import { NextResponse } from "next/server";
import { appointmentRequestNotice } from "@/lib/appointment-requests";
import { appointmentRequestsDisabledResponse, isAppointmentRequestsEnabled } from "@/lib/feature-flags";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  await params;
  if (!isAppointmentRequestsEnabled()) {
    return NextResponse.json(appointmentRequestsDisabledResponse(), { status: 404 });
  }

  return NextResponse.json(
    {
      code: "APPOINTMENT_REQUESTS_NOT_RELEASED",
      message: "Appointment requests are not available.",
      notice: appointmentRequestNotice,
    },
    { status: 404 },
  );
}
