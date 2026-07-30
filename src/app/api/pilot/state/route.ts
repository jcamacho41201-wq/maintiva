import { NextResponse } from "next/server";
import {
  type AuthenticatedShopContext,
  AuthRequiredError,
  OnboardingRequiredError,
  TenantAccessError,
  getAuthenticatedShopContext,
} from "@/lib/auth";
import { buildPilotState } from "@/lib/pilot-state";
import { logPilotMutationFailure } from "@/lib/server-diagnostics";

export async function GET() {
  let context: AuthenticatedShopContext | undefined;
  try {
    context = await getAuthenticatedShopContext();
    return NextResponse.json({ state: await buildPilotState(context) });
  } catch (error) {
    logPilotMutationFailure({
      error,
      context,
      payload: { action: "loadPilotState" },
      operation: { action: "loadPilotState", table: "Shop", operation: "SELECT" },
    });
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
