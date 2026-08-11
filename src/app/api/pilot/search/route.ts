import { NextResponse } from "next/server";
import {
  type AuthenticatedShopContext,
  AuthRequiredError,
  OnboardingRequiredError,
  TenantAccessError,
  requireActiveShopMembership,
} from "@/lib/auth";
import { SearchServiceError, searchPilotGlobal } from "@/lib/global-search-server";
import { safeDatabaseError } from "@/lib/server-diagnostics";

function safeId(value: string | undefined) {
  if (!value) return undefined;
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function logSearchRouteFailure(input: {
  code: string;
  error: unknown;
  context?: AuthenticatedShopContext;
}) {
  console.error("Maintiva global search route failed", {
    code: input.code,
    auth: input.context
      ? {
          shopId: safeId(input.context.shopId),
          role: input.context.role,
          activeShopResolved: true,
        }
      : { activeShopResolved: false },
    database: safeDatabaseError(input.error),
  });
}

export async function GET(request: Request) {
  let context: AuthenticatedShopContext | undefined;
  try {
    context = await requireActiveShopMembership();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json(await searchPilotGlobal(context, query));
  } catch (error) {
    if (error instanceof OnboardingRequiredError) {
      logSearchRouteFailure({ code: "SEARCH_NO_ACTIVE_SHOP", error });
      return NextResponse.json(
        { code: "ONBOARDING_REQUIRED", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof AuthRequiredError) {
      logSearchRouteFailure({ code: "SEARCH_UNAUTHENTICATED", error });
      return NextResponse.json(
        { code: "AUTH_REQUIRED", message: error.message },
        { status: 401 },
      );
    }
    if (error instanceof TenantAccessError) {
      logSearchRouteFailure({ code: "SEARCH_NO_ACTIVE_SHOP", error, context });
      return NextResponse.json(
        { code: "TENANT_FORBIDDEN", message: error.message },
        { status: 403 },
      );
    }
    if (error instanceof SearchServiceError) {
      logSearchRouteFailure({ code: error.code, error, context });
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status },
      );
    }
    logSearchRouteFailure({ code: "SEARCH_SERVER_ERROR", error, context });
    return NextResponse.json(
      { code: "SEARCH_FAILED", message: "Search is unavailable right now." },
      { status: 500 },
    );
  }
}
