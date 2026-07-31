import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";
import { safeDatabaseError } from "@/lib/server-diagnostics";

export type AuthenticatedShopContext = {
  userId: string;
  email: string;
  shopId: string;
  shopName: string;
  shopTimezone: string;
  role: "OWNER" | "MANAGER" | "SERVICE_ADVISOR" | "TECHNICIAN";
  isDemo: boolean;
};

export class AuthRequiredError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export class OnboardingRequiredError extends Error {
  constructor(public readonly userId: string, public readonly email: string) {
    super("Shop onboarding is required.");
    this.name = "OnboardingRequiredError";
  }
}

export class TenantAccessError extends Error {
  constructor(message = "Authenticated user is not a member of this shop.") {
    super(message);
    this.name = "TenantAccessError";
  }
}

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server components cannot always write cookies; route handlers can.
          }
        },
      },
    },
  );
}

export async function getAuthenticatedShopContext(): Promise<AuthenticatedShopContext> {
  if (!isSupabaseConfigured()) {
    throw new AuthRequiredError("Supabase Auth is not configured.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const authUser = data.user;

  if (error || !authUser?.email) {
    if (error) {
      console.error("Maintiva Supabase auth lookup failed", {
        supabase: safeDatabaseError(error),
        hasUserId: Boolean(authUser?.id),
        hasEmail: Boolean(authUser?.email),
      });
    }
    throw new AuthRequiredError();
  }

  let memberships;
  try {
    memberships = await prisma.shopMembership.findMany({
      where: {
        userId: authUser.id,
        isActive: true,
        shop: {
          status: {
            in: ["ONBOARDING", "ACTIVE"],
          },
        },
      },
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            timezone: true,
            isDemo: true,
          },
        },
        user: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
  } catch (error) {
    console.error("Maintiva shop membership lookup failed", {
      auth: {
        userId: authUser.id,
        hasEmail: Boolean(authUser.email),
      },
      database: safeDatabaseError(error),
    });
    throw error;
  }

  const membership = memberships[0];
  if (!membership) {
    console.error("Maintiva active shop membership missing", {
      operation: "resolveActiveShop",
      userId: authUser.id,
      membershipCount: memberships.length,
    });
    throw new OnboardingRequiredError(authUser.id, authUser.email);
  }

  return {
    userId: authUser.id,
    email: authUser.email,
    shopId: membership.shopId,
    shopName: membership.shop.name,
    shopTimezone: membership.shop.timezone,
    role: membership.role,
    isDemo: membership.shop.isDemo,
  };
}

export async function requireActiveShopMembership() {
  return getAuthenticatedShopContext();
}

export async function requirePageShopContext() {
  try {
    return await getAuthenticatedShopContext();
  } catch (error) {
    if (error instanceof OnboardingRequiredError) redirect("/onboarding");
    redirect("/login");
  }
}

export async function assertShopMembership(userId: string, shopId: string) {
  const membership = await prisma.shopMembership.findFirst({
    where: {
      userId,
      shopId,
      isActive: true,
    },
  });

  if (!membership) {
    throw new TenantAccessError();
  }

  return membership;
}

export function assertSameShop(
  context: Pick<AuthenticatedShopContext, "shopId">,
  entityShopId: string | null | undefined,
) {
  if (!entityShopId || entityShopId !== context.shopId) {
    throw new TenantAccessError();
  }
}
