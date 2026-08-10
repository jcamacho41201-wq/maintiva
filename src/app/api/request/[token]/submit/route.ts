import { NextResponse } from "next/server";
import { submitPublicAppointmentRequest } from "@/lib/appointment-request-workflow";
import { SafeActionError } from "@/lib/server-diagnostics";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(await submitPublicAppointmentRequest(token, body, request));
  } catch (error) {
    if (error instanceof SafeActionError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }
    console.error("Maintiva appointment request submission failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ code: "APPOINTMENT_REQUEST_SUBMIT_FAILED", message: "This time is no longer available. Choose another time." }, { status: 500 });
  }
}
