import { NextResponse } from "next/server";
import {
  AuthRequiredError,
  OnboardingRequiredError,
  TenantAccessError,
  getAuthenticatedShopContext,
} from "@/lib/auth";
import { buildPilotState } from "@/lib/pilot-state";

export async function GET() {
  try {
    const context = await getAuthenticatedShopContext();
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
    return NextResponse.json(
      { code: "STATE_FAILED", message: "Unable to load pilot state." },
      { status: 500 },
    );
  }
}
