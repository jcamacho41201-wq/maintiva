import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/auth";
import { createPilotShopForUser } from "@/lib/pilot-state";

const onboardingRequestSchema = z.object({
  shopName: z.string().min(2),
  phone: z.string().optional(),
  email: z.email().optional().or(z.literal("")),
  address: z.string().optional(),
  timezone: z.string().min(3).default("America/New_York"),
  dailyBayHours: z.coerce.number().int().min(1).max(200).default(64),
});

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { code: "AUTH_NOT_CONFIGURED", message: "Supabase Auth is not configured." },
        { status: 503 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.email) {
      return NextResponse.json(
        { code: "AUTH_REQUIRED", message: "Authentication is required." },
        { status: 401 },
      );
    }

    const input = onboardingRequestSchema.parse(await request.json());
    const shop = await createPilotShopForUser({
      userId: data.user.id,
      email: data.user.email,
      input,
    });

    return NextResponse.json({ shopId: shop.id, redirectTo: "/" }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: "VALIDATION_FAILED", message: "Invalid onboarding details.", issues: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: "ONBOARDING_FAILED", message: "Unable to create shop workspace." },
      { status: 500 },
    );
  }
}
