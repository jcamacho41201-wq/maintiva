-- Idempotent catch-up for Maintiva adaptive mileage forecasting foundation.
-- Schema only: this migration does not backfill, delete, reset, or alter existing customer data.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'MileageReadingSource'
  ) THEN
    CREATE TYPE public."MileageReadingSource" AS ENUM (
      'SHOP_REPAIR_ORDER',
      'SHOP_MANUAL_ENTRY',
      'SERVICE_HISTORY_IMPORT',
      'CUSTOMER_REPORTED',
      'APPOINTMENT_INTAKE',
      'CORRECTION',
      'OTHER'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'MileageVerificationStatus'
  ) THEN
    CREATE TYPE public."MileageVerificationStatus" AS ENUM (
      'VERIFIED',
      'CUSTOMER_REPORTED',
      'IMPORTED',
      'UNVERIFIED',
      'EXCLUDED'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'MileageAnomalyStatus'
  ) THEN
    CREATE TYPE public."MileageAnomalyStatus" AS ENUM (
      'NONE',
      'NEEDS_REVIEW',
      'RESOLVED'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'DrivingProfileEstimateSource'
  ) THEN
    CREATE TYPE public."DrivingProfileEstimateSource" AS ENUM (
      'SHOP_VERIFIED_READINGS',
      'IMPORTED_READINGS',
      'CUSTOMER_REPORTED',
      'VERIFIED_PLUS_DEFAULT',
      'SHOP_DEFAULT',
      'MANUAL_OVERRIDE'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'DrivingProfileConfidence'
  ) THEN
    CREATE TYPE public."DrivingProfileConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
  END IF;
END $$;

ALTER TYPE public."MileageReadingSource" ADD VALUE IF NOT EXISTS 'SHOP_REPAIR_ORDER';
ALTER TYPE public."MileageReadingSource" ADD VALUE IF NOT EXISTS 'SHOP_MANUAL_ENTRY';
ALTER TYPE public."MileageReadingSource" ADD VALUE IF NOT EXISTS 'SERVICE_HISTORY_IMPORT';
ALTER TYPE public."MileageReadingSource" ADD VALUE IF NOT EXISTS 'CUSTOMER_REPORTED';
ALTER TYPE public."MileageReadingSource" ADD VALUE IF NOT EXISTS 'APPOINTMENT_INTAKE';
ALTER TYPE public."MileageReadingSource" ADD VALUE IF NOT EXISTS 'CORRECTION';
ALTER TYPE public."MileageReadingSource" ADD VALUE IF NOT EXISTS 'OTHER';

ALTER TYPE public."MileageVerificationStatus" ADD VALUE IF NOT EXISTS 'VERIFIED';
ALTER TYPE public."MileageVerificationStatus" ADD VALUE IF NOT EXISTS 'CUSTOMER_REPORTED';
ALTER TYPE public."MileageVerificationStatus" ADD VALUE IF NOT EXISTS 'IMPORTED';
ALTER TYPE public."MileageVerificationStatus" ADD VALUE IF NOT EXISTS 'UNVERIFIED';
ALTER TYPE public."MileageVerificationStatus" ADD VALUE IF NOT EXISTS 'EXCLUDED';

ALTER TYPE public."MileageAnomalyStatus" ADD VALUE IF NOT EXISTS 'NONE';
ALTER TYPE public."MileageAnomalyStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REVIEW';
ALTER TYPE public."MileageAnomalyStatus" ADD VALUE IF NOT EXISTS 'RESOLVED';

ALTER TYPE public."DrivingProfileEstimateSource" ADD VALUE IF NOT EXISTS 'SHOP_VERIFIED_READINGS';
ALTER TYPE public."DrivingProfileEstimateSource" ADD VALUE IF NOT EXISTS 'IMPORTED_READINGS';
ALTER TYPE public."DrivingProfileEstimateSource" ADD VALUE IF NOT EXISTS 'CUSTOMER_REPORTED';
ALTER TYPE public."DrivingProfileEstimateSource" ADD VALUE IF NOT EXISTS 'VERIFIED_PLUS_DEFAULT';
ALTER TYPE public."DrivingProfileEstimateSource" ADD VALUE IF NOT EXISTS 'SHOP_DEFAULT';
ALTER TYPE public."DrivingProfileEstimateSource" ADD VALUE IF NOT EXISTS 'MANUAL_OVERRIDE';

ALTER TYPE public."DrivingProfileConfidence" ADD VALUE IF NOT EXISTS 'LOW';
ALTER TYPE public."DrivingProfileConfidence" ADD VALUE IF NOT EXISTS 'MEDIUM';
ALTER TYPE public."DrivingProfileConfidence" ADD VALUE IF NOT EXISTS 'HIGH';

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

ALTER TABLE public."Shop"
  ADD COLUMN IF NOT EXISTS "defaultAnnualMileage" INTEGER NOT NULL DEFAULT 12500;

CREATE TABLE IF NOT EXISTS public."VehicleMileageReading" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "readingMileage" INTEGER NOT NULL,
  "readingDate" TIMESTAMP(3) NOT NULL,
  "source" public."MileageReadingSource" NOT NULL,
  "verificationStatus" public."MileageVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED'::public."MileageVerificationStatus",
  "anomalyStatus" public."MileageAnomalyStatus" NOT NULL DEFAULT 'NONE'::public."MileageAnomalyStatus",
  "includedInForecast" BOOLEAN NOT NULL DEFAULT true,
  "correctionReason" TEXT,
  "reviewNotes" TEXT,
  "sourceReferenceType" TEXT,
  "sourceReferenceId" TEXT,
  "recordedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public."VehicleMileageReading"
  ADD COLUMN IF NOT EXISTS "readingMileage" INTEGER,
  ADD COLUMN IF NOT EXISTS "readingDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "source" public."MileageReadingSource",
  ADD COLUMN IF NOT EXISTS "verificationStatus" public."MileageVerificationStatus",
  ADD COLUMN IF NOT EXISTS "anomalyStatus" public."MileageAnomalyStatus",
  ADD COLUMN IF NOT EXISTS "includedInForecast" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "correctionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceReferenceType" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceReferenceId" TEXT,
  ADD COLUMN IF NOT EXISTS "recordedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

ALTER TABLE public."VehicleMileageReading"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN "verificationStatus" SET DEFAULT 'UNVERIFIED'::public."MileageVerificationStatus",
  ALTER COLUMN "anomalyStatus" SET DEFAULT 'NONE'::public."MileageAnomalyStatus",
  ALTER COLUMN "includedInForecast" SET DEFAULT true,
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS public."VehicleDrivingProfile" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "customerReportedAnnualMileage" INTEGER,
  "customerReportedAt" TIMESTAMP(3),
  "customerReportedByUserId" TEXT,
  "calculatedAnnualMileage" INTEGER NOT NULL DEFAULT 12500,
  "estimateSource" public."DrivingProfileEstimateSource" NOT NULL DEFAULT 'SHOP_DEFAULT'::public."DrivingProfileEstimateSource",
  "confidence" public."DrivingProfileConfidence" NOT NULL DEFAULT 'LOW'::public."DrivingProfileConfidence",
  "confidenceReason" TEXT NOT NULL DEFAULT 'Using Maintiva default because no usable mileage history is available.',
  "manualAnnualMileageOverride" INTEGER,
  "manualOverrideReason" TEXT,
  "manualOverrideNotes" TEXT,
  "manualOverrideSetAt" TIMESTAMP(3),
  "manualOverrideSetByUserId" TEXT,
  "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public."VehicleDrivingProfile"
  ADD COLUMN IF NOT EXISTS "customerReportedAnnualMileage" INTEGER,
  ADD COLUMN IF NOT EXISTS "customerReportedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "customerReportedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "calculatedAnnualMileage" INTEGER,
  ADD COLUMN IF NOT EXISTS "estimateSource" public."DrivingProfileEstimateSource",
  ADD COLUMN IF NOT EXISTS "confidence" public."DrivingProfileConfidence",
  ADD COLUMN IF NOT EXISTS "confidenceReason" TEXT,
  ADD COLUMN IF NOT EXISTS "manualAnnualMileageOverride" INTEGER,
  ADD COLUMN IF NOT EXISTS "manualOverrideReason" TEXT,
  ADD COLUMN IF NOT EXISTS "manualOverrideNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "manualOverrideSetAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "manualOverrideSetByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastCalculatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

ALTER TABLE public."VehicleDrivingProfile"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN "calculatedAnnualMileage" SET DEFAULT 12500,
  ALTER COLUMN "estimateSource" SET DEFAULT 'SHOP_DEFAULT'::public."DrivingProfileEstimateSource",
  ALTER COLUMN "confidence" SET DEFAULT 'LOW'::public."DrivingProfileConfidence",
  ALTER COLUMN "confidenceReason" SET DEFAULT 'Using Maintiva default because no usable mileage history is available.',
  ALTER COLUMN "lastCalculatedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VehicleMileageReading_shopId_fkey'
      AND conrelid = 'public."VehicleMileageReading"'::regclass
  ) THEN
    ALTER TABLE public."VehicleMileageReading"
      ADD CONSTRAINT "VehicleMileageReading_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES public."Shop"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VehicleMileageReading_vehicleId_fkey'
      AND conrelid = 'public."VehicleMileageReading"'::regclass
  ) THEN
    ALTER TABLE public."VehicleMileageReading"
      ADD CONSTRAINT "VehicleMileageReading_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES public."Vehicle"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VehicleMileageReading_recordedByUserId_fkey'
      AND conrelid = 'public."VehicleMileageReading"'::regclass
  ) THEN
    ALTER TABLE public."VehicleMileageReading"
      ADD CONSTRAINT "VehicleMileageReading_recordedByUserId_fkey"
      FOREIGN KEY ("recordedByUserId") REFERENCES public."User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VehicleMileageReading_readingMileage_nonnegative'
      AND conrelid = 'public."VehicleMileageReading"'::regclass
  ) THEN
    ALTER TABLE public."VehicleMileageReading"
      ADD CONSTRAINT "VehicleMileageReading_readingMileage_nonnegative"
      CHECK ("readingMileage" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VehicleDrivingProfile_shopId_fkey'
      AND conrelid = 'public."VehicleDrivingProfile"'::regclass
  ) THEN
    ALTER TABLE public."VehicleDrivingProfile"
      ADD CONSTRAINT "VehicleDrivingProfile_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES public."Shop"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VehicleDrivingProfile_vehicleId_fkey'
      AND conrelid = 'public."VehicleDrivingProfile"'::regclass
  ) THEN
    ALTER TABLE public."VehicleDrivingProfile"
      ADD CONSTRAINT "VehicleDrivingProfile_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES public."Vehicle"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VehicleDrivingProfile_customerReportedByUserId_fkey'
      AND conrelid = 'public."VehicleDrivingProfile"'::regclass
  ) THEN
    ALTER TABLE public."VehicleDrivingProfile"
      ADD CONSTRAINT "VehicleDrivingProfile_customerReportedByUserId_fkey"
      FOREIGN KEY ("customerReportedByUserId") REFERENCES public."User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VehicleDrivingProfile_manualOverrideSetByUserId_fkey'
      AND conrelid = 'public."VehicleDrivingProfile"'::regclass
  ) THEN
    ALTER TABLE public."VehicleDrivingProfile"
      ADD CONSTRAINT "VehicleDrivingProfile_manualOverrideSetByUserId_fkey"
      FOREIGN KEY ("manualOverrideSetByUserId") REFERENCES public."User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VehicleDrivingProfile_calculatedAnnualMileage_nonnegative'
      AND conrelid = 'public."VehicleDrivingProfile"'::regclass
  ) THEN
    ALTER TABLE public."VehicleDrivingProfile"
      ADD CONSTRAINT "VehicleDrivingProfile_calculatedAnnualMileage_nonnegative"
      CHECK ("calculatedAnnualMileage" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "VehicleMileageReading_shopId_vehicleId_readingDate_idx"
ON public."VehicleMileageReading"("shopId", "vehicleId", "readingDate");

CREATE INDEX IF NOT EXISTS "VehicleMileageReading_shopId_vehicleId_included_anomaly_idx"
ON public."VehicleMileageReading"("shopId", "vehicleId", "includedInForecast", "anomalyStatus");

CREATE INDEX IF NOT EXISTS "VehicleMileageReading_source_reference_idx"
ON public."VehicleMileageReading"("shopId", "sourceReferenceType", "sourceReferenceId");

CREATE UNIQUE INDEX IF NOT EXISTS "VehicleDrivingProfile_vehicleId_key"
ON public."VehicleDrivingProfile"("vehicleId");

CREATE INDEX IF NOT EXISTS "VehicleDrivingProfile_shopId_confidence_idx"
ON public."VehicleDrivingProfile"("shopId", "confidence");

CREATE INDEX IF NOT EXISTS "VehicleDrivingProfile_shopId_estimateSource_idx"
ON public."VehicleDrivingProfile"("shopId", "estimateSource");

DROP TRIGGER IF EXISTS "VehicleMileageReading_set_updatedAt" ON public."VehicleMileageReading";
CREATE TRIGGER "VehicleMileageReading_set_updatedAt"
BEFORE UPDATE ON public."VehicleMileageReading"
FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();

DROP TRIGGER IF EXISTS "VehicleDrivingProfile_set_updatedAt" ON public."VehicleDrivingProfile";
CREATE TRIGGER "VehicleDrivingProfile_set_updatedAt"
BEFORE UPDATE ON public."VehicleDrivingProfile"
FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();

ALTER TABLE public."VehicleMileageReading" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."VehicleDrivingProfile" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read mileage readings" ON public."VehicleMileageReading";
CREATE POLICY "Members can read mileage readings"
ON public."VehicleMileageReading"
FOR SELECT
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert mileage readings" ON public."VehicleMileageReading";
CREATE POLICY "Members can insert mileage readings"
ON public."VehicleMileageReading"
FOR INSERT
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update mileage readings" ON public."VehicleMileageReading";
CREATE POLICY "Members can update mileage readings"
ON public."VehicleMileageReading"
FOR UPDATE
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete mileage readings" ON public."VehicleMileageReading";
CREATE POLICY "Members can delete mileage readings"
ON public."VehicleMileageReading"
FOR DELETE
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can read driving profiles" ON public."VehicleDrivingProfile";
CREATE POLICY "Members can read driving profiles"
ON public."VehicleDrivingProfile"
FOR SELECT
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert driving profiles" ON public."VehicleDrivingProfile";
CREATE POLICY "Members can insert driving profiles"
ON public."VehicleDrivingProfile"
FOR INSERT
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update driving profiles" ON public."VehicleDrivingProfile";
CREATE POLICY "Members can update driving profiles"
ON public."VehicleDrivingProfile"
FOR UPDATE
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete driving profiles" ON public."VehicleDrivingProfile";
CREATE POLICY "Members can delete driving profiles"
ON public."VehicleDrivingProfile"
FOR DELETE
USING (public.maintiva_is_shop_member("shopId"));

GRANT EXECUTE ON FUNCTION public.maintiva_is_shop_member(text) TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."VehicleMileageReading" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."VehicleDrivingProfile" TO authenticated;
