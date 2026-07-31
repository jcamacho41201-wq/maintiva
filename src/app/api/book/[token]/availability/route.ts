import { NextResponse } from "next/server";
import { z } from "zod";
import { getPublicAvailability } from "@/lib/customer-booking";
import { SafeActionError } from "@/lib/server-diagnostics";

const querySchema = z.object({
  intakeType: z.enum(["WAIT", "DROP_OFF"]).default("DROP_OFF"),
  extraMaintenanceRecordIds: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const extraMaintenanceRecordIds = query.extraMaintenanceRecordIds
      ?.split(",")
      .map((id) => id.trim())
      .filter(Boolean) ?? [];
    return NextResponse.json({
      slots: await getPublicAvailability(token, query.intakeType, extraMaintenanceRecordIds),
    });
  } catch (error) {
    if (error instanceof SafeActionError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: "BOOKING_QUERY_INVALID", message: "The booking request is invalid." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: "BOOKING_AVAILABILITY_FAILED", message: "Available times could not be loaded." },
      { status: 500 },
    );
  }
}
