CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE public."BookingMode" AS ENUM ('INSTANT', 'REQUEST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public."BookingIntakeType" AS ENUM ('WAIT', 'DROP_OFF');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public."ServiceBookingIntakeOption" AS ENUM ('WAIT_ONLY', 'DROP_OFF_ONLY', 'EITHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public."CustomerBookingLinkStatus" AS ENUM ('ACTIVE', 'REVOKED', 'COMPLETED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public."Appointment"
  ADD COLUMN IF NOT EXISTS "bookingLinkId" TEXT,
  ADD COLUMN IF NOT EXISTS "intakeType" public."BookingIntakeType",
  ADD COLUMN IF NOT EXISTS "customerNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "internalNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "requestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "declinedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "customerCancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rescheduledAt" TIMESTAMP(3);

ALTER TABLE public."OutreachRecord"
  ADD COLUMN IF NOT EXISTS "bookingLinkId" TEXT;

GRANT USAGE ON TYPE public."BookingMode" TO authenticated;
GRANT USAGE ON TYPE public."BookingIntakeType" TO authenticated;
GRANT USAGE ON TYPE public."ServiceBookingIntakeOption" TO authenticated;
GRANT USAGE ON TYPE public."CustomerBookingLinkStatus" TO authenticated;

CREATE TABLE IF NOT EXISTS public."ShopBookingSettings" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "onlineBookingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "minimumNoticeMinutes" INTEGER NOT NULL DEFAULT 1440,
  "maximumAdvanceDays" INTEGER NOT NULL DEFAULT 30,
  "defaultBufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
  "defaultBufferAfterMinutes" INTEGER NOT NULL DEFAULT 15,
  "maximumSimultaneousAppointments" INTEGER NOT NULL DEFAULT 2,
  "cancellationCutoffMinutes" INTEGER NOT NULL DEFAULT 1440,
  "reschedulingCutoffMinutes" INTEGER NOT NULL DEFAULT 1440,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopBookingSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."ShopBookingWindow" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopBookingWindow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."ShopBookingBlackout" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "isFullDay" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopBookingBlackout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."ServiceBookingRule" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "serviceDefinitionId" TEXT NOT NULL,
  "bookingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "bookingMode" public."BookingMode" NOT NULL DEFAULT 'REQUEST',
  "estimatedDurationMinutes" INTEGER NOT NULL,
  "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
  "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 15,
  "allowedIntakeType" public."ServiceBookingIntakeOption" NOT NULL DEFAULT 'EITHER',
  "minimumNoticeMinutes" INTEGER,
  "maximumAdvanceDays" INTEGER,
  "maximumSimultaneousBookings" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceBookingRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."ServiceBookingWindow" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "serviceBookingRuleId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceBookingWindow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."CustomerBookingLink" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "opportunityId" TEXT,
  "maintenanceRecordIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "declinedWorkRecordIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" public."CustomerBookingLinkStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "lastViewedAt" TIMESTAMP(3),
  "bookingCompletedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "outreachRecordId" TEXT,
  "appointmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerBookingLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS public."AppointmentChangeRecord" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "bookingLinkId" TEXT,
  "action" TEXT NOT NULL,
  "previousStart" TIMESTAMP(3),
  "previousEnd" TIMESTAMP(3),
  "newStart" TIMESTAMP(3),
  "newEnd" TIMESTAMP(3),
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentChangeRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShopBookingSettings_shopId_key" ON public."ShopBookingSettings"("shopId");
CREATE INDEX IF NOT EXISTS "ShopBookingWindow_shopId_dayOfWeek_isActive_idx" ON public."ShopBookingWindow"("shopId", "dayOfWeek", "isActive");
CREATE INDEX IF NOT EXISTS "ShopBookingBlackout_shopId_startsAt_endsAt_idx" ON public."ShopBookingBlackout"("shopId", "startsAt", "endsAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceBookingRule_serviceDefinitionId_key" ON public."ServiceBookingRule"("serviceDefinitionId");
CREATE INDEX IF NOT EXISTS "ServiceBookingRule_shopId_bookingEnabled_idx" ON public."ServiceBookingRule"("shopId", "bookingEnabled");
CREATE INDEX IF NOT EXISTS "ServiceBookingWindow_shopId_dayOfWeek_isActive_idx" ON public."ServiceBookingWindow"("shopId", "dayOfWeek", "isActive");
CREATE INDEX IF NOT EXISTS "ServiceBookingWindow_serviceBookingRuleId_idx" ON public."ServiceBookingWindow"("serviceBookingRuleId");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerBookingLink_tokenHash_key" ON public."CustomerBookingLink"("tokenHash");
CREATE INDEX IF NOT EXISTS "CustomerBookingLink_shopId_customerId_idx" ON public."CustomerBookingLink"("shopId", "customerId");
CREATE INDEX IF NOT EXISTS "CustomerBookingLink_shopId_vehicleId_idx" ON public."CustomerBookingLink"("shopId", "vehicleId");
CREATE INDEX IF NOT EXISTS "CustomerBookingLink_shopId_opportunityId_idx" ON public."CustomerBookingLink"("shopId", "opportunityId");
CREATE INDEX IF NOT EXISTS "CustomerBookingLink_shopId_status_expiresAt_idx" ON public."CustomerBookingLink"("shopId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "Appointment_shopId_bookingLinkId_idx" ON public."Appointment"("shopId", "bookingLinkId");
CREATE INDEX IF NOT EXISTS "AppointmentChangeRecord_shopId_appointmentId_createdAt_idx" ON public."AppointmentChangeRecord"("shopId", "appointmentId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShopBookingSettings_shopId_fkey'
  ) THEN
    ALTER TABLE public."ShopBookingSettings"
      ADD CONSTRAINT "ShopBookingSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShopBookingWindow_shopId_fkey'
  ) THEN
    ALTER TABLE public."ShopBookingWindow"
      ADD CONSTRAINT "ShopBookingWindow_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShopBookingBlackout_shopId_fkey'
  ) THEN
    ALTER TABLE public."ShopBookingBlackout"
      ADD CONSTRAINT "ShopBookingBlackout_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ServiceBookingRule_shopId_fkey'
  ) THEN
    ALTER TABLE public."ServiceBookingRule"
      ADD CONSTRAINT "ServiceBookingRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ServiceBookingRule_serviceDefinitionId_fkey'
  ) THEN
    ALTER TABLE public."ServiceBookingRule"
      ADD CONSTRAINT "ServiceBookingRule_serviceDefinitionId_fkey" FOREIGN KEY ("serviceDefinitionId") REFERENCES public."ServiceDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ServiceBookingWindow_shopId_fkey'
  ) THEN
    ALTER TABLE public."ServiceBookingWindow"
      ADD CONSTRAINT "ServiceBookingWindow_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ServiceBookingWindow_serviceBookingRuleId_fkey'
  ) THEN
    ALTER TABLE public."ServiceBookingWindow"
      ADD CONSTRAINT "ServiceBookingWindow_serviceBookingRuleId_fkey" FOREIGN KEY ("serviceBookingRuleId") REFERENCES public."ServiceBookingRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerBookingLink_shopId_fkey'
  ) THEN
    ALTER TABLE public."CustomerBookingLink"
      ADD CONSTRAINT "CustomerBookingLink_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerBookingLink_customerId_fkey'
  ) THEN
    ALTER TABLE public."CustomerBookingLink"
      ADD CONSTRAINT "CustomerBookingLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES public."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerBookingLink_vehicleId_fkey'
  ) THEN
    ALTER TABLE public."CustomerBookingLink"
      ADD CONSTRAINT "CustomerBookingLink_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES public."Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerBookingLink_createdByUserId_fkey'
  ) THEN
    ALTER TABLE public."CustomerBookingLink"
      ADD CONSTRAINT "CustomerBookingLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerBookingLink_outreachRecordId_fkey'
  ) THEN
    ALTER TABLE public."CustomerBookingLink"
      ADD CONSTRAINT "CustomerBookingLink_outreachRecordId_fkey" FOREIGN KEY ("outreachRecordId") REFERENCES public."OutreachRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerBookingLink_appointmentId_fkey'
  ) THEN
    ALTER TABLE public."CustomerBookingLink"
      ADD CONSTRAINT "CustomerBookingLink_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES public."Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_bookingLinkId_fkey'
  ) THEN
    ALTER TABLE public."Appointment"
      ADD CONSTRAINT "Appointment_bookingLinkId_fkey" FOREIGN KEY ("bookingLinkId") REFERENCES public."CustomerBookingLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OutreachRecord_bookingLinkId_fkey'
  ) THEN
    ALTER TABLE public."OutreachRecord"
      ADD CONSTRAINT "OutreachRecord_bookingLinkId_fkey" FOREIGN KEY ("bookingLinkId") REFERENCES public."CustomerBookingLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AppointmentChangeRecord_shopId_fkey'
  ) THEN
    ALTER TABLE public."AppointmentChangeRecord"
      ADD CONSTRAINT "AppointmentChangeRecord_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AppointmentChangeRecord_appointmentId_fkey'
  ) THEN
    ALTER TABLE public."AppointmentChangeRecord"
      ADD CONSTRAINT "AppointmentChangeRecord_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES public."Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AppointmentChangeRecord_bookingLinkId_fkey'
  ) THEN
    ALTER TABLE public."AppointmentChangeRecord"
      ADD CONSTRAINT "AppointmentChangeRecord_bookingLinkId_fkey" FOREIGN KEY ("bookingLinkId") REFERENCES public."CustomerBookingLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DROP TRIGGER IF EXISTS "ShopBookingSettings_set_updatedAt" ON public."ShopBookingSettings";
CREATE TRIGGER "ShopBookingSettings_set_updatedAt"
  BEFORE UPDATE ON public."ShopBookingSettings"
  FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();

DROP TRIGGER IF EXISTS "ShopBookingWindow_set_updatedAt" ON public."ShopBookingWindow";
CREATE TRIGGER "ShopBookingWindow_set_updatedAt"
  BEFORE UPDATE ON public."ShopBookingWindow"
  FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();

DROP TRIGGER IF EXISTS "ShopBookingBlackout_set_updatedAt" ON public."ShopBookingBlackout";
CREATE TRIGGER "ShopBookingBlackout_set_updatedAt"
  BEFORE UPDATE ON public."ShopBookingBlackout"
  FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();

DROP TRIGGER IF EXISTS "ServiceBookingRule_set_updatedAt" ON public."ServiceBookingRule";
CREATE TRIGGER "ServiceBookingRule_set_updatedAt"
  BEFORE UPDATE ON public."ServiceBookingRule"
  FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();

DROP TRIGGER IF EXISTS "ServiceBookingWindow_set_updatedAt" ON public."ServiceBookingWindow";
CREATE TRIGGER "ServiceBookingWindow_set_updatedAt"
  BEFORE UPDATE ON public."ServiceBookingWindow"
  FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();

DROP TRIGGER IF EXISTS "CustomerBookingLink_set_updatedAt" ON public."CustomerBookingLink";
CREATE TRIGGER "CustomerBookingLink_set_updatedAt"
  BEFORE UPDATE ON public."CustomerBookingLink"
  FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();

ALTER TABLE public."ShopBookingSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ShopBookingWindow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ShopBookingBlackout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ServiceBookingRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ServiceBookingWindow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CustomerBookingLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AppointmentChangeRecord" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ShopBookingSettings',
    'ShopBookingWindow',
    'ShopBookingBlackout',
    'ServiceBookingRule',
    'ServiceBookingWindow',
    'CustomerBookingLink',
    'AppointmentChangeRecord'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Members can read %s" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "Members can read %s" ON public.%I FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"))', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Members can insert %s" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "Members can insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"))', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Members can update %s" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "Members can update %s" ON public.%I FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"))', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "Members can delete %s" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "Members can delete %s" ON public.%I FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"))', table_name, table_name);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public."ShopBookingSettings",
  public."ShopBookingWindow",
  public."ShopBookingBlackout",
  public."ServiceBookingRule",
  public."ServiceBookingWindow",
  public."CustomerBookingLink",
  public."AppointmentChangeRecord"
TO authenticated;
