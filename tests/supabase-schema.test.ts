import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260728173000_initial_maintiva_schema.sql",
);
const migrationSql = fs.readFileSync(migrationPath, "utf8");
const intervalMigrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260728223000_vehicle_service_intervals.sql",
);
const intervalMigrationSql = fs.readFileSync(intervalMigrationPath, "utf8");

describe("Supabase production schema migration", () => {
  it("creates the app tables used for shop creation, membership, customers, vehicles, imports, and customer queries", () => {
    [
      "User",
      "Shop",
      "ShopMembership",
      "Customer",
      "Vehicle",
      "ServiceDefinition",
      "VehicleMaintenanceRecord",
      "ServiceHistoryRecord",
      "DeclinedWorkRecord",
      "MaintenanceRevenueOpportunity",
      "OutreachRecord",
      "Appointment",
      "AppointmentService",
      "ImportHistoryRecord",
      "ImportRowRecord",
      "AuditLog",
    ].forEach((table) => {
      expect(migrationSql).toContain(`CREATE TABLE "${table}"`);
    });
  });

  it("creates foreign keys and indexes required for vehicle and import persistence", () => {
    [
      "ShopMembership_shopId_fkey",
      "ShopMembership_userId_fkey",
      "Customer_shopId_fkey",
      "Vehicle_customerId_fkey",
      "ServiceHistoryRecord_vehicleId_fkey",
      "ImportHistoryRecord_shopId_fkey",
      "ImportRowRecord_importHistoryRecordId_fkey",
      "Vehicle_shopId_customerId_idx",
      "ImportHistoryRecord_shopId_importedAt_idx",
      "ImportRowRecord_shopId_importHistoryRecordId_idx",
    ].forEach((identifier) => {
      expect(migrationSql).toContain(identifier);
    });
  });

  it("enables membership-based RLS on every public application table for cross-tenant denial", () => {
    [
      "User",
      "Shop",
      "ShopMembership",
      "Customer",
      "Vehicle",
      "ServiceDefinition",
      "VehicleMaintenanceRecord",
      "ServiceHistoryRecord",
      "DeclinedWorkRecord",
      "MaintenanceRevenueOpportunity",
      "OutreachRecord",
      "Appointment",
      "AppointmentService",
      "ImportHistoryRecord",
      "ImportRowRecord",
      "AuditLog",
    ].forEach((table) => {
      expect(migrationSql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    });

    expect(migrationSql).toContain("public.maintiva_is_shop_member");
    expect(migrationSql).toContain("auth.uid()::text");
    expect(migrationSql).toContain('membership."isActive" = true');
  });

  it("adds onboarding and updatedAt triggers needed by Supabase-auth-backed users", () => {
    expect(migrationSql).toContain("maintiva_handle_new_auth_user");
    expect(migrationSql).toContain("AFTER INSERT ON auth.users");
    expect(migrationSql).toContain("maintiva_set_updated_at");
  });

  it("adds editable service defaults and vehicle-specific interval overrides without loosening RLS", () => {
    [
      'CREATE TYPE "TimeIntervalUnit"',
      'CREATE TYPE "OutreachThresholdType"',
      'ALTER COLUMN "serviceDefinitionId" DROP NOT NULL',
      'ADD COLUMN "customServiceName" TEXT',
      'ADD COLUMN "mileageIntervalOverride" INTEGER',
      'ADD COLUMN "timeIntervalValueOverride" INTEGER',
      'ADD COLUMN "outreachThresholdType" "OutreachThresholdType" NOT NULL DEFAULT \'MILES_BEFORE_DUE\'',
      'ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true',
      'VehicleMaintenanceRecord_active_service_definition_key',
      'ON DELETE SET NULL',
    ].forEach((identifier) => {
      expect(intervalMigrationSql).toContain(identifier);
    });

    expect(intervalMigrationSql).not.toContain("DISABLE ROW LEVEL SECURITY");
    expect(intervalMigrationSql).not.toContain("WITH CHECK (true)");
    expect(intervalMigrationSql).not.toContain("USING (true)");
  });
});
