import { NextResponse } from "next/server";
import { publicAppointmentRequestState } from "@/lib/appointment-request-workflow";
import { SafeActionError } from "@/lib/server-diagnostics";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  try {
    return NextResponse.json(await publicAppointmentRequestState(token, request));
  } catch (error) {
    if (error instanceof SafeActionError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }
    console.error("Maintiva appointment request context failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ code: "APPOINTMENT_REQUEST_CONTEXT_FAILED", message: "Appointment request link is not available." }, { status: 500 });
  }
}
