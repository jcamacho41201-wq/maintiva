export const dynamic = "force-dynamic";

function hasValue(value: string | undefined) {
  return Boolean(value && value.trim());
}

function databaseConfigured() {
  return [
    process.env.DATABASE_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NON_POOLING,
    process.env.POSTGRES_URL,
  ].some(hasValue);
}

export async function GET() {
  const checks = {
    app: "ok",
    publicSupabaseUrl: hasValue(process.env.NEXT_PUBLIC_SUPABASE_URL),
    publicSupabaseAnonKey: hasValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    databaseConfigured: databaseConfigured(),
    database: "not_checked" as "ok" | "not_configured" | "not_checked" | "error",
  };

  if (!checks.databaseConfigured) {
    checks.database = "not_configured";
    return Response.json({ ok: false, checks }, { status: 503 });
  }

  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (error) {
    checks.database = "error";
    console.error("Maintiva health check failed", {
      database: error && typeof error === "object"
        ? {
            code: "code" in error ? String(error.code) : undefined,
            message: "message" in error ? String(error.message) : undefined,
          }
        : undefined,
    });
  }

  return Response.json({ ok: checks.database === "ok", checks }, { status: checks.database === "ok" ? 200 : 503 });
}
