-- Smart Maintenance Blocks: shop-controlled capacity foundation.
-- This migration is intentionally standalone, idempotent, and non-destructive.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public."SmartMaintenanceBlock" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
  "daysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "maxVehicles" INTEGER NOT NULL DEFAULT 1,
  "maxLaborMinutes" INTEGER NOT NULL DEFAULT 60,
  "minimumNoticeMinutes" INTEGER NOT NULL DEFAULT 1440,
  "maximumHorizonDays" INTEGER NOT NULL DEFAULT 30,
  "slotIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
  "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
  "internalNotes" TEXT,
  "createdByUserId" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartMaintenanceBlock_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN DEFAULT true;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "timezone" TEXT DEFAULT 'America/New_York';
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "startMinute" INTEGER;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "endMinute" INTEGER;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "maxVehicles" INTEGER DEFAULT 1;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "maxLaborMinutes" INTEGER DEFAULT 60;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "minimumNoticeMinutes" INTEGER DEFAULT 1440;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "maximumHorizonDays" INTEGER DEFAULT 30;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "slotIntervalMinutes" INTEGER DEFAULT 30;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "approvalRequired" BOOLEAN DEFAULT true;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "internalNotes" TEXT;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public."SmartMaintenanceBlock" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

UPDATE public."SmartMaintenanceBlock" SET
  "isActive" = COALESCE("isActive", true),
  "timezone" = COALESCE("timezone", 'America/New_York'),
  "daysOfWeek" = COALESCE("daysOfWeek", ARRAY[]::INTEGER[]),
  "maxVehicles" = COALESCE("maxVehicles", 1),
  "maxLaborMinutes" = COALESCE("maxLaborMinutes", 60),
  "minimumNoticeMinutes" = COALESCE("minimumNoticeMinutes", 1440),
  "maximumHorizonDays" = COALESCE("maximumHorizonDays", 30),
  "slotIntervalMinutes" = COALESCE("slotIntervalMinutes", 30),
  "approvalRequired" = true,
  "createdAt" = COALESCE("createdAt", CURRENT_TIMESTAMP),
  "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP);

ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "isActive" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "timezone" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "daysOfWeek" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "startMinute" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "endMinute" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "maxVehicles" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "maxLaborMinutes" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "minimumNoticeMinutes" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "maximumHorizonDays" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "slotIntervalMinutes" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "approvalRequired" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlock" ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE TABLE IF NOT EXISTS public."SmartMaintenanceBlockService" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "blockId" TEXT NOT NULL,
  "serviceDefinitionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartMaintenanceBlockService_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."SmartMaintenanceBlockService" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE public."SmartMaintenanceBlockService" ADD COLUMN IF NOT EXISTS "blockId" TEXT;
ALTER TABLE public."SmartMaintenanceBlockService" ADD COLUMN IF NOT EXISTS "serviceDefinitionId" TEXT;
ALTER TABLE public."SmartMaintenanceBlockService" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE public."SmartMaintenanceBlockService" SET "createdAt" = COALESCE("createdAt", CURRENT_TIMESTAMP);
ALTER TABLE public."SmartMaintenanceBlockService" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlockService" ALTER COLUMN "blockId" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlockService" ALTER COLUMN "serviceDefinitionId" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlockService" ALTER COLUMN "createdAt" SET NOT NULL;

CREATE TABLE IF NOT EXISTS public."SmartMaintenanceBlockBlackout" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "blockId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "isFullDay" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmartMaintenanceBlockBlackout_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD COLUMN IF NOT EXISTS "blockId" TEXT;
ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD COLUMN IF NOT EXISTS "startsAt" TIMESTAMP(3);
ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD COLUMN IF NOT EXISTS "endsAt" TIMESTAMP(3);
ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD COLUMN IF NOT EXISTS "isFullDay" BOOLEAN DEFAULT false;
ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE public."SmartMaintenanceBlockBlackout" SET
  "isFullDay" = COALESCE("isFullDay", false),
  "createdAt" = COALESCE("createdAt", CURRENT_TIMESTAMP),
  "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP);
ALTER TABLE public."SmartMaintenanceBlockBlackout" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlockBlackout" ALTER COLUMN "startsAt" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlockBlackout" ALTER COLUMN "endsAt" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlockBlackout" ALTER COLUMN "isFullDay" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlockBlackout" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE public."SmartMaintenanceBlockBlackout" ALTER COLUMN "updatedAt" SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE public."SmartMaintenanceBlock" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlock_name_check";
  ALTER TABLE public."SmartMaintenanceBlock" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlock_time_check";
  ALTER TABLE public."SmartMaintenanceBlock" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlock_capacity_check";
  ALTER TABLE public."SmartMaintenanceBlock" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlock_notice_horizon_check";
  ALTER TABLE public."SmartMaintenanceBlock" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlock_slot_interval_check";
  ALTER TABLE public."SmartMaintenanceBlock" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlock_approval_required_check";
  ALTER TABLE public."SmartMaintenanceBlock" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlock_days_check";
  ALTER TABLE public."SmartMaintenanceBlockBlackout" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlockBlackout_time_check";

  ALTER TABLE public."SmartMaintenanceBlock" ADD CONSTRAINT "SmartMaintenanceBlock_name_check"
    CHECK (length(btrim("name")) > 0);
  ALTER TABLE public."SmartMaintenanceBlock" ADD CONSTRAINT "SmartMaintenanceBlock_time_check"
    CHECK ("startMinute" >= 0 AND "startMinute" <= 1439 AND "endMinute" >= 1 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");
  ALTER TABLE public."SmartMaintenanceBlock" ADD CONSTRAINT "SmartMaintenanceBlock_capacity_check"
    CHECK ("maxVehicles" >= 1 AND "maxLaborMinutes" >= 1);
  ALTER TABLE public."SmartMaintenanceBlock" ADD CONSTRAINT "SmartMaintenanceBlock_notice_horizon_check"
    CHECK ("minimumNoticeMinutes" >= 0 AND "maximumHorizonDays" >= 1 AND ("maximumHorizonDays" * 1440) > "minimumNoticeMinutes");
  ALTER TABLE public."SmartMaintenanceBlock" ADD CONSTRAINT "SmartMaintenanceBlock_slot_interval_check"
    CHECK ("slotIntervalMinutes" IN (15, 30, 60));
  ALTER TABLE public."SmartMaintenanceBlock" ADD CONSTRAINT "SmartMaintenanceBlock_approval_required_check"
    CHECK ("approvalRequired" = true);
  ALTER TABLE public."SmartMaintenanceBlock" ADD CONSTRAINT "SmartMaintenanceBlock_days_check"
    CHECK (cardinality("daysOfWeek") > 0 AND "daysOfWeek" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);
  ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD CONSTRAINT "SmartMaintenanceBlockBlackout_time_check"
    CHECK ("endsAt" > "startsAt");
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "SmartMaintenanceBlock_id_shop_key" ON public."SmartMaintenanceBlock" ("id", "shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceDefinition_id_shop_key" ON public."ServiceDefinition" ("id", "shopId");

DO $$
BEGIN
  ALTER TABLE public."SmartMaintenanceBlock" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlock_shopId_fkey";
  ALTER TABLE public."SmartMaintenanceBlock" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlock_createdByUserId_fkey";
  ALTER TABLE public."SmartMaintenanceBlockService" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlockService_shopId_fkey";
  ALTER TABLE public."SmartMaintenanceBlockService" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlockService_blockId_fkey";
  ALTER TABLE public."SmartMaintenanceBlockService" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlockService_serviceDefinitionId_fkey";
  ALTER TABLE public."SmartMaintenanceBlockBlackout" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlockBlackout_shopId_fkey";
  ALTER TABLE public."SmartMaintenanceBlockBlackout" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlockBlackout_blockId_fkey";
  ALTER TABLE public."SmartMaintenanceBlockBlackout" DROP CONSTRAINT IF EXISTS "SmartMaintenanceBlockBlackout_createdByUserId_fkey";

  ALTER TABLE public."SmartMaintenanceBlock" ADD CONSTRAINT "SmartMaintenanceBlock_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."SmartMaintenanceBlock" ADD CONSTRAINT "SmartMaintenanceBlock_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE public."SmartMaintenanceBlockService" ADD CONSTRAINT "SmartMaintenanceBlockService_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."SmartMaintenanceBlockService" ADD CONSTRAINT "SmartMaintenanceBlockService_blockId_fkey"
    FOREIGN KEY ("blockId", "shopId") REFERENCES public."SmartMaintenanceBlock"("id", "shopId") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."SmartMaintenanceBlockService" ADD CONSTRAINT "SmartMaintenanceBlockService_serviceDefinitionId_fkey"
    FOREIGN KEY ("serviceDefinitionId", "shopId") REFERENCES public."ServiceDefinition"("id", "shopId") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD CONSTRAINT "SmartMaintenanceBlockBlackout_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD CONSTRAINT "SmartMaintenanceBlockBlackout_blockId_fkey"
    FOREIGN KEY ("blockId", "shopId") REFERENCES public."SmartMaintenanceBlock"("id", "shopId") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."SmartMaintenanceBlockBlackout" ADD CONSTRAINT "SmartMaintenanceBlockBlackout_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
END $$;

CREATE INDEX IF NOT EXISTS "SmartMaintenanceBlock_shop_active_idx" ON public."SmartMaintenanceBlock" ("shopId", "isActive", "archivedAt");
CREATE INDEX IF NOT EXISTS "SmartMaintenanceBlock_shop_created_idx" ON public."SmartMaintenanceBlock" ("shopId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SmartMaintenanceBlockService_block_service_key" ON public."SmartMaintenanceBlockService" ("blockId", "serviceDefinitionId");
CREATE INDEX IF NOT EXISTS "SmartMaintenanceBlockService_shop_block_idx" ON public."SmartMaintenanceBlockService" ("shopId", "blockId");
CREATE INDEX IF NOT EXISTS "SmartMaintenanceBlockService_shop_service_idx" ON public."SmartMaintenanceBlockService" ("shopId", "serviceDefinitionId");
CREATE INDEX IF NOT EXISTS "SmartMaintenanceBlockBlackout_shop_time_idx" ON public."SmartMaintenanceBlockBlackout" ("shopId", "startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "SmartMaintenanceBlockBlackout_shop_block_idx" ON public."SmartMaintenanceBlockBlackout" ("shopId", "blockId");
CREATE UNIQUE INDEX IF NOT EXISTS "SmartMaintenanceBlockBlackout_block_time_key" ON public."SmartMaintenanceBlockBlackout" ("shopId", "blockId", "startsAt", "endsAt") WHERE "blockId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "SmartMaintenanceBlockBlackout_shop_time_key" ON public."SmartMaintenanceBlockBlackout" ("shopId", "startsAt", "endsAt") WHERE "blockId" IS NULL;

DO $$
BEGIN
  IF to_regproc('public.maintiva_set_updated_at') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'SmartMaintenanceBlock_set_updatedAt') THEN
      CREATE TRIGGER "SmartMaintenanceBlock_set_updatedAt"
        BEFORE UPDATE ON public."SmartMaintenanceBlock"
        FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'SmartMaintenanceBlockBlackout_set_updatedAt') THEN
      CREATE TRIGGER "SmartMaintenanceBlockBlackout_set_updatedAt"
        BEFORE UPDATE ON public."SmartMaintenanceBlockBlackout"
        FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
    END IF;
  END IF;
END $$;

ALTER TABLE public."SmartMaintenanceBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SmartMaintenanceBlockService" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SmartMaintenanceBlockBlackout" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read smart maintenance blocks" ON public."SmartMaintenanceBlock";
CREATE POLICY "Members can read smart maintenance blocks"
ON public."SmartMaintenanceBlock" FOR SELECT TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert smart maintenance blocks" ON public."SmartMaintenanceBlock";
CREATE POLICY "Members can insert smart maintenance blocks"
ON public."SmartMaintenanceBlock" FOR INSERT TO authenticated
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update smart maintenance blocks" ON public."SmartMaintenanceBlock";
CREATE POLICY "Members can update smart maintenance blocks"
ON public."SmartMaintenanceBlock" FOR UPDATE TO authenticated
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete smart maintenance blocks" ON public."SmartMaintenanceBlock";

DROP POLICY IF EXISTS "Members can read smart block services" ON public."SmartMaintenanceBlockService";
CREATE POLICY "Members can read smart block services"
ON public."SmartMaintenanceBlockService" FOR SELECT TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert smart block services" ON public."SmartMaintenanceBlockService";
CREATE POLICY "Members can insert smart block services"
ON public."SmartMaintenanceBlockService" FOR INSERT TO authenticated
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update smart block services" ON public."SmartMaintenanceBlockService";
CREATE POLICY "Members can update smart block services"
ON public."SmartMaintenanceBlockService" FOR UPDATE TO authenticated
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete smart block services" ON public."SmartMaintenanceBlockService";

DROP POLICY IF EXISTS "Members can read smart block blackouts" ON public."SmartMaintenanceBlockBlackout";
CREATE POLICY "Members can read smart block blackouts"
ON public."SmartMaintenanceBlockBlackout" FOR SELECT TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert smart block blackouts" ON public."SmartMaintenanceBlockBlackout";
CREATE POLICY "Members can insert smart block blackouts"
ON public."SmartMaintenanceBlockBlackout" FOR INSERT TO authenticated
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update smart block blackouts" ON public."SmartMaintenanceBlockBlackout";
CREATE POLICY "Members can update smart block blackouts"
ON public."SmartMaintenanceBlockBlackout" FOR UPDATE TO authenticated
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete smart block blackouts" ON public."SmartMaintenanceBlockBlackout";
CREATE POLICY "Members can delete smart block blackouts"
ON public."SmartMaintenanceBlockBlackout" FOR DELETE TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

REVOKE DELETE ON TABLE
  public."SmartMaintenanceBlock",
  public."SmartMaintenanceBlockService"
FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public."SmartMaintenanceBlock",
  public."SmartMaintenanceBlockService"
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."SmartMaintenanceBlockBlackout"
TO authenticated;
