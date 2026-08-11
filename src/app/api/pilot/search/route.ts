import { NextResponse } from "next/server";
import {
  AuthRequiredError,
  OnboardingRequiredError,
  TenantAccessError,
  requireActiveShopMembership,
} from "@/lib/auth";
import { searchPilotGlobal } from "@/lib/global-search-server";
import { safeDatabaseError } from "@/lib/server-diagnostics";

export async function GET(request: Request) {
  try {
    const context = await requireActiveShopMembership();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json(await searchPilotGlobal(context, query));
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
    console.error("Maintiva global search failed", {
      database: safeDatabaseError(error),
    });
    return NextResponse.json(
      { code: "SEARCH_FAILED", message: "Search is unavailable right now." },
      { status: 500 },
    );
  }
}
