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

  it("keeps Smart Maintenance Blocks disabled by default and optional in state loading", () => {
    const envExample = source(".env.example");
    const flags = source("src/lib/feature-flags.ts");
    const pilotState = source("src/lib/pilot-state.ts");
    const settingsPage = source("src/app/settings/page.tsx");

    expect(envExample).toContain('SMART_MAINTENANCE_BLOCKS_ENABLED="false"');
    expect(envExample).toContain('NEXT_PUBLIC_SMART_MAINTENANCE_BLOCKS_ENABLED="false"');
    expect(flags).toContain("isSmartMaintenanceBlocksServerEnabled");
    expect(flags).toContain("isSmartMaintenanceBlocksUiEnabled");
    expect(flags).toContain('process.env.SMART_MAINTENANCE_BLOCKS_ENABLED === "true"');
    expect(flags).toContain('process.env.NEXT_PUBLIC_SMART_MAINTENANCE_BLOCKS_ENABLED === "true"');
    expect(pilotState).toContain("assertSmartMaintenanceBlocksFeatureEnabled");
    expect(pilotState).toContain("if (!isSmartMaintenanceBlocksServerEnabled())");
    expect(pilotState).toContain("isMissingSmartMaintenanceBlocksSchema");
    expect(settingsPage).toContain("isSmartMaintenanceBlocksUiEnabled");
  });

  it("keeps the Smart Maintenance Blocks migration tenant-scoped and non-destructive", () => {
    const migration = source("supabase/migrations/20260803190000_smart_maintenance_blocks.sql");

    expect(migration).toContain('CHECK (length(btrim("name")) > 0)');
    expect(migration).toContain('("maximumHorizonDays" * 1440) > "minimumNoticeMinutes"');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "SmartMaintenanceBlockService_block_service_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "SmartMaintenanceBlockBlackout_block_time_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "SmartMaintenanceBlockBlackout_shop_time_key"');
    expect(migration).toContain('ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD COLUMN IF NOT EXISTS "localDate" DATE');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "SmartMaintenanceBlockBlackout_block_local_time_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "SmartMaintenanceBlockBlackout_shop_local_time_key"');
    expect(migration).toContain('FOREIGN KEY ("blockId", "shopId") REFERENCES public."SmartMaintenanceBlock"("id", "shopId")');
    expect(migration).toContain('FOREIGN KEY ("serviceDefinitionId", "shopId") REFERENCES public."ServiceDefinition"("id", "shopId")');
    expect(migration).toContain('DROP POLICY IF EXISTS "Members can delete smart maintenance blocks"');
    expect(migration).toContain('REVOKE DELETE ON TABLE');
    expect(migration).not.toContain('CREATE POLICY "Members can delete smart maintenance blocks"');
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
