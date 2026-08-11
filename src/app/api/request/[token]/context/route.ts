import { NextResponse } from "next/server";
import { publicAppointmentRequestState } from "@/lib/appointment-request-workflow";
import {
  hashAppointmentRequestToken,
  isAppointmentRequestTokenFormat,
  normalizeAppointmentRequestToken,
} from "@/lib/appointment-request-tokens";
import { SafeActionError } from "@/lib/server-diagnostics";

function safeRequestDiagnostics(token: string) {
  const normalizedToken = normalizeAppointmentRequestToken(token);
  const tokenHash = normalizedToken ? hashAppointmentRequestToken(normalizedToken) : "";
  return {
    reason: "SERVER_ERROR",
    route: "/api/request/[token]/context",
    tokenLength: normalizedToken.length,
    tokenFormatValid: isAppointmentRequestTokenFormat(normalizedToken),
    tokenHashPrefix: tokenHash.slice(0, 8),
  };
}

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
    console.error("Maintiva appointment request context failed", {
      ...safeRequestDiagnostics(token),
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ code: "APPOINTMENT_REQUEST_CONTEXT_FAILED", message: "Appointment request link is not available." }, { status: 500 });
  }
}
