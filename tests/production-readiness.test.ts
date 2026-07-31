import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("production readiness safeguards", () => {
  it("does not run the unreconciled migration queue automatically during Vercel production builds", () => {
    const buildScript = source("scripts/vercel-build.mjs");

    expect(buildScript).toContain('process.env.MAINTIVA_RUN_MIGRATIONS_ON_BUILD === "true"');
    expect(buildScript).not.toContain('process.env.VERCEL_ENV === "production"');
    expect(buildScript).toContain('run("prisma", ["generate"])');
    expect(buildScript).toContain('run("next", ["build"])');
  });

  it("keeps customer self-scheduling disabled by default until its migration is deliberately installed", () => {
    const envExample = source(".env.example");
    const flags = source("src/lib/feature-flags.ts");
    const pilotState = source("src/lib/pilot-state.ts");
    const bookingPage = source("src/app/book/[token]/page.tsx");
    const bookingRoute = source("src/app/api/book/[token]/context/route.ts");

    expect(envExample).toContain('NEXT_PUBLIC_MAINTIVA_CUSTOMER_BOOKING_ENABLED="false"');
    expect(flags).toContain('NEXT_PUBLIC_MAINTIVA_CUSTOMER_BOOKING_ENABLED === "true"');
    expect(pilotState).toContain("assertCustomerBookingFeatureEnabled");
    expect(pilotState).toContain("if (!isCustomerBookingEnabled())");
    expect(bookingPage).toContain("Customer booking is not available.");
    expect(bookingRoute).toContain("customerBookingDisabledResponse");
  });

  it("exposes a safe health endpoint without leaking environment values", () => {
    const healthRoute = source("src/app/api/health/route.ts");
    const proxy = source("src/proxy.ts");

    expect(healthRoute).toContain('export const dynamic = "force-dynamic"');
    expect(healthRoute).toContain("databaseConfigured");
    expect(proxy).toContain('pathname === "/api/health"');
    expect(proxy).toContain('pathname.startsWith("/api/book/")');
    expect(proxy).toContain('pathname.startsWith("/book/")');
    expect(healthRoute).not.toContain("DATABASE_URL:");
    expect(healthRoute).not.toContain("POSTGRES_PRISMA_URL:");
    expect(healthRoute).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY:");
  });
});
