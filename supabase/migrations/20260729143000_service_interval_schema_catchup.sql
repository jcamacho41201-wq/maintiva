-- Idempotent catch-up for editable service intervals in Supabase production.
-- This preserves the existing service architecture:
--   ServiceDefinition = shop service library
--   VehicleMaintenanceRecord = vehicle-level service assignment/overrides

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'TimeIntervalUnit'
  ) THEN
    CREATE TYPE public."TimeIntervalUnit" AS ENUM ('DAYS', 'MONTHS', 'YEARS');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'OutreachThresholdType'
  ) THEN
    CREATE TYPE public."OutreachThresholdType" AS ENUM ('MILES_BEFORE_DUE', 'DAYS_BEFORE_DUE', 'PERCENT_REMAINING');
  END IF;
END $$;

ALTER TYPE public."TimeIntervalUnit" ADD VALUE IF NOT EXISTS 'DAYS';
ALTER TYPE public."TimeIntervalUnit" ADD VALUE IF NOT EXISTS 'MONTHS';
ALTER TYPE public."TimeIntervalUnit" ADD VALUE IF NOT EXISTS 'YEARS';

ALTER TYPE public."OutreachThresholdType" ADD VALUE IF NOT EXISTS 'MILES_BEFORE_DUE';
ALTER TYPE public."OutreachThresholdType" ADD VALUE IF NOT EXISTS 'DAYS_BEFORE_DUE';
ALTER TYPE public."OutreachThresholdType" ADD VALUE IF NOT EXISTS 'PERCENT_REMAINING';

CREATE OR REPLACE FUNCTION public.maintiva_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.maintiva_is_shop_member(target_shop_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."ShopMembership" membership
    WHERE membership."shopId" = target_shop_id
      AND membership."userId" = auth.uid()::text
      AND membership."isActive" = true
  );
$$;

ALTER TABLE public."ServiceDefinition"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "defaultMileageInterval" DROP NOT NULL,
  ALTER COLUMN "defaultTimeIntervalMonths" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "defaultTimeIntervalValue" INTEGER,
  ADD COLUMN IF NOT EXISTS "defaultTimeIntervalUnit" public."TimeIntervalUnit";

UPDATE public."ServiceDefinition"
SET
  "defaultTimeIntervalValue" = COALESCE("defaultTimeIntervalValue", "defaultTimeIntervalMonths"),
  "defaultTimeIntervalUnit" = COALESCE("defaultTimeIntervalUnit", 'MONTHS'::public."TimeIntervalUnit")
WHERE "defaultTimeIntervalValue" IS NULL
   OR "defaultTimeIntervalUnit" IS NULL;

ALTER TABLE public."ServiceDefinition"
  ALTER COLUMN "defaultTimeIntervalUnit" SET DEFAULT 'MONTHS'::public."TimeIntervalUnit",
  ALTER COLUMN "defaultTimeIntervalUnit" SET NOT NULL;

ALTER TABLE public."VehicleMaintenanceRecord" DROP CONSTRAINT IF EXISTS "VehicleMaintenanceRecord_serviceDefinitionId_fkey";
DROP INDEX IF EXISTS public."VehicleMaintenanceRecord_shopId_vehicleId_serviceDefinition_key";

ALTER TABLE public."VehicleMaintenanceRecord"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "serviceDefinitionId" DROP NOT NULL,
  ALTER COLUMN "recommendedMileageInterval" DROP NOT NULL,
  ALTER COLUMN "recommendedTimeIntervalMonths" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "customServiceName" TEXT,
  ADD COLUMN IF NOT EXISTS "customCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "mileageIntervalOverride" INTEGER,
  ADD COLUMN IF NOT EXISTS "timeIntervalValueOverride" INTEGER,
  ADD COLUMN IF NOT EXISTS "timeIntervalUnitOverride" public."TimeIntervalUnit",
  ADD COLUMN IF NOT EXISTS "outreachThresholdType" public."OutreachThresholdType",
  ADD COLUMN IF NOT EXISTS "outreachThresholdValue" INTEGER,
  ADD COLUMN IF NOT EXISTS "priceOverrideCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "laborMinutesOverride" INTEGER,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedByUserId" TEXT;

UPDATE public."VehicleMaintenanceRecord"
SET
  "outreachThresholdType" = COALESCE("outreachThresholdType", 'MILES_BEFORE_DUE'::public."OutreachThresholdType"),
  "outreachThresholdValue" = COALESCE("outreachThresholdValue", 500),
  "isActive" = COALESCE("isActive", true)
WHERE "outreachThresholdType" IS NULL
   OR "outreachThresholdValue" IS NULL
   OR "isActive" IS NULL;

ALTER TABLE public."VehicleMaintenanceRecord"
  ALTER COLUMN "outreachThresholdType" SET DEFAULT 'MILES_BEFORE_DUE'::public."OutreachThresholdType",
  ALTER COLUMN "outreachThresholdType" SET NOT NULL,
  ALTER COLUMN "outreachThresholdValue" SET DEFAULT 500,
  ALTER COLUMN "outreachThresholdValue" SET NOT NULL,
  ALTER COLUMN "isActive" SET DEFAULT true,
  ALTER COLUMN "isActive" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'VehicleMaintenanceRecord_serviceDefinitionId_fkey'
      AND conrelid = 'public."VehicleMaintenanceRecord"'::regclass
  ) THEN
    ALTER TABLE public."VehicleMaintenanceRecord"
      ADD CONSTRAINT "VehicleMaintenanceRecord_serviceDefinitionId_fkey"
      FOREIGN KEY ("serviceDefinitionId")
      REFERENCES public."ServiceDefinition"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'VehicleMaintenanceRecord_createdByUserId_fkey'
      AND conrelid = 'public."VehicleMaintenanceRecord"'::regclass
  ) THEN
    ALTER TABLE public."VehicleMaintenanceRecord"
      ADD CONSTRAINT "VehicleMaintenanceRecord_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId")
      REFERENCES public."User"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'VehicleMaintenanceRecord_updatedByUserId_fkey'
      AND conrelid = 'public."VehicleMaintenanceRecord"'::regclass
  ) THEN
    ALTER TABLE public."VehicleMaintenanceRecord"
      ADD CONSTRAINT "VehicleMaintenanceRecord_updatedByUserId_fkey"
      FOREIGN KEY ("updatedByUserId")
      REFERENCES public."User"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ServiceHistoryRecord_maintenanceRecordId_fkey'
      AND conrelid = 'public."ServiceHistoryRecord"'::regclass
  ) THEN
    ALTER TABLE public."ServiceHistoryRecord"
      ADD CONSTRAINT "ServiceHistoryRecord_maintenanceRecordId_fkey"
      FOREIGN KEY ("maintenanceRecordId")
      REFERENCES public."VehicleMaintenanceRecord"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AppointmentService_maintenanceRecordId_fkey'
      AND conrelid = 'public."AppointmentService"'::regclass
  ) THEN
    ALTER TABLE public."AppointmentService"
      ADD CONSTRAINT "AppointmentService_maintenanceRecordId_fkey"
      FOREIGN KEY ("maintenanceRecordId")
      REFERENCES public."VehicleMaintenanceRecord"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MaintenanceRevenueOpportunity_maintenanceRecordId_fkey'
      AND conrelid = 'public."MaintenanceRevenueOpportunity"'::regclass
  ) THEN
    ALTER TABLE public."MaintenanceRevenueOpportunity"
      ADD CONSTRAINT "MaintenanceRevenueOpportunity_maintenanceRecordId_fkey"
      FOREIGN KEY ("maintenanceRecordId")
      REFERENCES public."VehicleMaintenanceRecord"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceDefinition_shopId_name_key"
ON public."ServiceDefinition"("shopId", "name");

CREATE INDEX IF NOT EXISTS "ServiceDefinition_shopId_isActive_idx"
ON public."ServiceDefinition"("shopId", "isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "VehicleMaintenanceRecord_active_service_definition_key"
ON public."VehicleMaintenanceRecord"("shopId", "vehicleId", "serviceDefinitionId")
WHERE "serviceDefinitionId" IS NOT NULL AND "isActive" = true AND "archivedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "VehicleMaintenanceRecord_shopId_vehicleId_status_idx"
ON public."VehicleMaintenanceRecord"("shopId", "vehicleId", "status");

CREATE INDEX IF NOT EXISTS "VehicleMaintenanceRecord_shopId_outreachStatus_idx"
ON public."VehicleMaintenanceRecord"("shopId", "outreachStatus");

CREATE INDEX IF NOT EXISTS "VehicleMaintenanceRecord_shopId_vehicleId_isActive_idx"
ON public."VehicleMaintenanceRecord"("shopId", "vehicleId", "isActive");

CREATE INDEX IF NOT EXISTS "VehicleMaintenanceRecord_shopId_vehicleId_serviceDefinitionId_idx"
ON public."VehicleMaintenanceRecord"("shopId", "vehicleId", "serviceDefinitionId");

CREATE INDEX IF NOT EXISTS "ServiceHistoryRecord_shopId_customerId_completedAt_idx"
ON public."ServiceHistoryRecord"("shopId", "customerId", "completedAt");

CREATE INDEX IF NOT EXISTS "ServiceHistoryRecord_shopId_vehicleId_completedAt_idx"
ON public."ServiceHistoryRecord"("shopId", "vehicleId", "completedAt");

CREATE INDEX IF NOT EXISTS "AppointmentService_shopId_appointmentId_idx"
ON public."AppointmentService"("shopId", "appointmentId");

CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentService_appointmentId_serviceName_key"
ON public."AppointmentService"("appointmentId", "serviceName");

CREATE INDEX IF NOT EXISTS "MaintenanceRevenueOpportunity_shopId_stage_priority_idx"
ON public."MaintenanceRevenueOpportunity"("shopId", "stage", "priority");

CREATE INDEX IF NOT EXISTS "MaintenanceRevenueOpportunity_shopId_source_idx"
ON public."MaintenanceRevenueOpportunity"("shopId", "source");

CREATE INDEX IF NOT EXISTS "MaintenanceRevenueOpportunity_shopId_vehicleId_idx"
ON public."MaintenanceRevenueOpportunity"("shopId", "vehicleId");

DROP TRIGGER IF EXISTS "ServiceDefinition_set_updatedAt" ON public."ServiceDefinition";
CREATE TRIGGER "ServiceDefinition_set_updatedAt"
BEFORE UPDATE ON public."ServiceDefinition"
FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();

DROP TRIGGER IF EXISTS "VehicleMaintenanceRecord_set_updatedAt" ON public."VehicleMaintenanceRecord";
CREATE TRIGGER "VehicleMaintenanceRecord_set_updatedAt"
BEFORE UPDATE ON public."VehicleMaintenanceRecord"
FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();

ALTER TABLE public."ServiceDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."VehicleMaintenanceRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ServiceHistoryRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AppointmentService" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MaintenanceRevenueOpportunity" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read service definitions" ON public."ServiceDefinition";
CREATE POLICY "Members can read service definitions"
ON public."ServiceDefinition"
FOR SELECT TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert service definitions" ON public."ServiceDefinition";
CREATE POLICY "Members can insert service definitions"
ON public."ServiceDefinition"
FOR INSERT TO authenticated
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update service definitions" ON public."ServiceDefinition";
CREATE POLICY "Members can update service definitions"
ON public."ServiceDefinition"
FOR UPDATE TO authenticated
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete service definitions" ON public."ServiceDefinition";
CREATE POLICY "Members can delete service definitions"
ON public."ServiceDefinition"
FOR DELETE TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can read maintenance records" ON public."VehicleMaintenanceRecord";
CREATE POLICY "Members can read maintenance records"
ON public."VehicleMaintenanceRecord"
FOR SELECT TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert maintenance records" ON public."VehicleMaintenanceRecord";
CREATE POLICY "Members can insert maintenance records"
ON public."VehicleMaintenanceRecord"
FOR INSERT TO authenticated
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update maintenance records" ON public."VehicleMaintenanceRecord";
CREATE POLICY "Members can update maintenance records"
ON public."VehicleMaintenanceRecord"
FOR UPDATE TO authenticated
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete maintenance records" ON public."VehicleMaintenanceRecord";
CREATE POLICY "Members can delete maintenance records"
ON public."VehicleMaintenanceRecord"
FOR DELETE TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can read service history" ON public."ServiceHistoryRecord";
CREATE POLICY "Members can read service history"
ON public."ServiceHistoryRecord"
FOR SELECT TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert service history" ON public."ServiceHistoryRecord";
CREATE POLICY "Members can insert service history"
ON public."ServiceHistoryRecord"
FOR INSERT TO authenticated
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update service history" ON public."ServiceHistoryRecord";
CREATE POLICY "Members can update service history"
ON public."ServiceHistoryRecord"
FOR UPDATE TO authenticated
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete service history" ON public."ServiceHistoryRecord";
CREATE POLICY "Members can delete service history"
ON public."ServiceHistoryRecord"
FOR DELETE TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can read appointment services" ON public."AppointmentService";
CREATE POLICY "Members can read appointment services"
ON public."AppointmentService"
FOR SELECT TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert appointment services" ON public."AppointmentService";
CREATE POLICY "Members can insert appointment services"
ON public."AppointmentService"
FOR INSERT TO authenticated
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update appointment services" ON public."AppointmentService";
CREATE POLICY "Members can update appointment services"
ON public."AppointmentService"
FOR UPDATE TO authenticated
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete appointment services" ON public."AppointmentService";
CREATE POLICY "Members can delete appointment services"
ON public."AppointmentService"
FOR DELETE TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can read revenue opportunities" ON public."MaintenanceRevenueOpportunity";
CREATE POLICY "Members can read revenue opportunities"
ON public."MaintenanceRevenueOpportunity"
FOR SELECT TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert revenue opportunities" ON public."MaintenanceRevenueOpportunity";
CREATE POLICY "Members can insert revenue opportunities"
ON public."MaintenanceRevenueOpportunity"
FOR INSERT TO authenticated
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update revenue opportunities" ON public."MaintenanceRevenueOpportunity";
CREATE POLICY "Members can update revenue opportunities"
ON public."MaintenanceRevenueOpportunity"
FOR UPDATE TO authenticated
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete revenue opportunities" ON public."MaintenanceRevenueOpportunity";
CREATE POLICY "Members can delete revenue opportunities"
ON public."MaintenanceRevenueOpportunity"
FOR DELETE TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON TYPE public."TimeIntervalUnit" TO authenticated;
GRANT USAGE ON TYPE public."OutreachThresholdType" TO authenticated;
GRANT EXECUTE ON FUNCTION public.maintiva_is_shop_member(text) TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."ServiceDefinition",
  public."VehicleMaintenanceRecord",
  public."ServiceHistoryRecord",
  public."AppointmentService",
  public."MaintenanceRevenueOpportunity"
TO authenticated;
