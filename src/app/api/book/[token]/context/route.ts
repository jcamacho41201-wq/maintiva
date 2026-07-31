import { NextResponse } from "next/server";
import { getPublicBookingContext } from "@/lib/customer-booking";
import { SafeActionError } from "@/lib/server-diagnostics";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    return NextResponse.json({ context: await getPublicBookingContext(token) });
  } catch (error) {
    if (error instanceof SafeActionError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { code: "BOOKING_CONTEXT_FAILED", message: "This booking link could not be loaded." },
      { status: 500 },
    );
  }
}
