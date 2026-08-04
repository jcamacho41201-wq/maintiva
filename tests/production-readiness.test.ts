import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_REQUESTS_RELEASED,
  SMART_MAINTENANCE_BLOCKS_RELEASED,
  isAppointmentRequestsEnabled,
  isSmartMaintenanceBlocksEnabled,
} from "@/lib/feature-flags";

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

  it("releases Smart Maintenance Blocks from repository state without a public Vercel flag", () => {
    const envExample = source(".env.example");
    const flags = source("src/lib/feature-flags.ts");
    const pilotState = source("src/lib/pilot-state.ts");
    const settingsPage = source("src/app/settings/page.tsx");
    const smartBlocksPage = source("src/app/settings/smart-maintenance-blocks/page.tsx");

    expect(SMART_MAINTENANCE_BLOCKS_RELEASED).toBe(true);
    expect(isSmartMaintenanceBlocksEnabled({})).toBe(true);
    expect(isSmartMaintenanceBlocksEnabled({ MAINTIVA_SMART_MAINTENANCE_BLOCKS_DISABLED: "false" })).toBe(true);
    expect(isSmartMaintenanceBlocksEnabled({ SMART_MAINTENANCE_BLOCKS_ENABLED: "false" })).toBe(true);
    expect(isSmartMaintenanceBlocksEnabled({ MAINTIVA_SMART_MAINTENANCE_BLOCKS_DISABLED: "true" })).toBe(false);
    expect(envExample).toContain('MAINTIVA_SMART_MAINTENANCE_BLOCKS_DISABLED="false"');
    expect(envExample).not.toContain("NEXT_PUBLIC_SMART_MAINTENANCE_BLOCKS_ENABLED");
    expect(flags).toContain("SMART_MAINTENANCE_BLOCKS_RELEASED = true");
    expect(flags).toContain("isSmartMaintenanceBlocksEnabled");
    expect(flags).toContain("MAINTIVA_SMART_MAINTENANCE_BLOCKS_DISABLED");
    expect(flags).not.toContain("SMART_MAINTENANCE_BLOCKS_ENABLED");
    expect(flags).not.toContain("isSmartMaintenanceBlocksUiEnabled");
    expect(flags).not.toContain("NEXT_PUBLIC_SMART_MAINTENANCE_BLOCKS_ENABLED");
    expect(pilotState).toContain("assertSmartMaintenanceBlocksFeatureEnabled");
    expect(pilotState).toContain("if (!isSmartMaintenanceBlocksEnabled())");
    expect(pilotState).toContain("isMissingSmartMaintenanceBlocksSchema");
    expect(settingsPage).toContain("isSmartMaintenanceBlocksEnabled");
    expect(settingsPage).toContain("canManageShopSettings");
    expect(smartBlocksPage).toContain("isSmartMaintenanceBlocksEnabled");
    expect(smartBlocksPage).toContain("canManageShopSettings");
  });

  it("keeps controlled appointment request submission disabled until its migration is approved", () => {
    const envExample = source(".env.example");
    const flags = source("src/lib/feature-flags.ts");
    const proxy = source("src/proxy.ts");
    const requestPage = source("src/app/request/[token]/page.tsx");
    const contextRoute = source("src/app/api/request/[token]/context/route.ts");
    const submitRoute = source("src/app/api/request/[token]/submit/route.ts");

    expect(APPOINTMENT_REQUESTS_RELEASED).toBe(false);
    expect(isAppointmentRequestsEnabled({ MAINTIVA_APPOINTMENT_REQUESTS_ENABLED: "true" })).toBe(false);
    expect(envExample).toContain('MAINTIVA_APPOINTMENT_REQUESTS_ENABLED="false"');
    expect(envExample).toContain('MAINTIVA_APPOINTMENT_REQUESTS_DISABLED="true"');
    expect(flags).toContain("APPOINTMENT_REQUESTS_RELEASED = false");
    expect(flags).toContain("MAINTIVA_APPOINTMENT_REQUESTS_ENABLED");
    expect(proxy).toContain('pathname.startsWith("/request/")');
    expect(proxy).toContain('pathname.startsWith("/api/request/")');
    expect(requestPage).toContain("Request This Time");
    expect(requestPage).toContain("This is an appointment request. The shop will confirm the time after reviewing its schedule.");
    expect(requestPage).not.toContain("Book Appointment");
    expect(contextRoute).toContain("appointmentRequestsDisabledResponse");
    expect(submitRoute).toContain("appointmentRequestsDisabledResponse");
  });

  it("adds a tenant-scoped AppointmentRequest migration without enabling anonymous table access", () => {
    const migration = source("supabase/migrations/20260804120000_appointment_request_workflow.sql");
    const prismaSchema = source("prisma/schema.prisma");
    const appointmentsPage = source("src/app/appointments/page.tsx");

    expect(prismaSchema).toContain("model AppointmentRequest");
    expect(prismaSchema).toContain("model AppointmentRequestLink");
    expect(migration).toContain('CREATE TYPE public."AppointmentRequestStatus"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public."AppointmentRequest"');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public."AppointmentRequestLink"');
    expect(migration).toContain('FOREIGN KEY ("requestLinkId", "shopId") REFERENCES public."AppointmentRequestLink"("id", "shopId")');
    expect(migration).toContain('FOREIGN KEY ("appointmentRequestId", "shopId") REFERENCES public."AppointmentRequest"("id", "shopId")');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequest_shop_idempotency_key"');
    expect(migration).toContain('USING (public.maintiva_is_shop_member("shopId"))');
    expect(migration).toContain("REVOKE ALL ON TABLE");
    expect(migration).toContain("FROM anon, public");
    expect(migration).not.toContain("TO anon");
    expect(migration).not.toContain("WITH CHECK (true)");
    expect(migration).not.toContain("USING (true)");
    expect(appointmentsPage).toContain("Maintiva Maintenance Calendar");
    expect(appointmentsPage).toContain("Check your primary shop calendar before approving requests.");
    expect(appointmentsPage).toContain("Open maintenance capacity");
    expect(appointmentsPage).toContain("Pending request");
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
