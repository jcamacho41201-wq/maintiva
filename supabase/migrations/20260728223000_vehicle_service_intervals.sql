-- Add editable shop defaults and vehicle-specific maintenance interval overrides.
-- Existing RLS policies remain active because this migration extends existing shop-scoped tables only.

CREATE TYPE "TimeIntervalUnit" AS ENUM ('DAYS', 'MONTHS', 'YEARS');
CREATE TYPE "OutreachThresholdType" AS ENUM ('MILES_BEFORE_DUE', 'DAYS_BEFORE_DUE', 'PERCENT_REMAINING');

ALTER TABLE "ServiceDefinition"
  ALTER COLUMN "defaultMileageInterval" DROP NOT NULL,
  ALTER COLUMN "defaultTimeIntervalMonths" DROP NOT NULL,
  ADD COLUMN "defaultTimeIntervalValue" INTEGER,
  ADD COLUMN "defaultTimeIntervalUnit" "TimeIntervalUnit" NOT NULL DEFAULT 'MONTHS';

UPDATE "ServiceDefinition"
SET "defaultTimeIntervalValue" = "defaultTimeIntervalMonths"
WHERE "defaultTimeIntervalValue" IS NULL;

ALTER TABLE "VehicleMaintenanceRecord" DROP CONSTRAINT IF EXISTS "VehicleMaintenanceRecord_serviceDefinitionId_fkey";
DROP INDEX IF EXISTS "VehicleMaintenanceRecord_shopId_vehicleId_serviceDefinition_key";

ALTER TABLE "VehicleMaintenanceRecord"
  ALTER COLUMN "serviceDefinitionId" DROP NOT NULL,
  ALTER COLUMN "recommendedMileageInterval" DROP NOT NULL,
  ALTER COLUMN "recommendedTimeIntervalMonths" DROP NOT NULL,
  ADD COLUMN "customServiceName" TEXT,
  ADD COLUMN "customCategory" TEXT,
  ADD COLUMN "mileageIntervalOverride" INTEGER,
  ADD COLUMN "timeIntervalValueOverride" INTEGER,
  ADD COLUMN "timeIntervalUnitOverride" "TimeIntervalUnit",
  ADD COLUMN "outreachThresholdType" "OutreachThresholdType" NOT NULL DEFAULT 'MILES_BEFORE_DUE',
  ADD COLUMN "outreachThresholdValue" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN "priceOverrideCents" INTEGER,
  ADD COLUMN "laborMinutesOverride" INTEGER,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "createdByUserId" TEXT,
  ADD COLUMN "updatedByUserId" TEXT;

CREATE UNIQUE INDEX "VehicleMaintenanceRecord_active_service_definition_key"
ON "VehicleMaintenanceRecord"("shopId", "vehicleId", "serviceDefinitionId")
WHERE "serviceDefinitionId" IS NOT NULL AND "isActive" = true AND "archivedAt" IS NULL;

CREATE INDEX "VehicleMaintenanceRecord_shopId_vehicleId_isActive_idx"
ON "VehicleMaintenanceRecord"("shopId", "vehicleId", "isActive");

CREATE INDEX "VehicleMaintenanceRecord_shopId_vehicleId_serviceDefinitionId_idx"
ON "VehicleMaintenanceRecord"("shopId", "vehicleId", "serviceDefinitionId");

ALTER TABLE "VehicleMaintenanceRecord"
  ADD CONSTRAINT "VehicleMaintenanceRecord_serviceDefinitionId_fkey"
  FOREIGN KEY ("serviceDefinitionId") REFERENCES "ServiceDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VehicleMaintenanceRecord"
  ADD CONSTRAINT "VehicleMaintenanceRecord_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VehicleMaintenanceRecord"
  ADD CONSTRAINT "VehicleMaintenanceRecord_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
