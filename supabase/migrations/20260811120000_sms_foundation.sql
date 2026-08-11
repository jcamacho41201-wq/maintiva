-- SMS foundation for advisor-triggered outbound messaging.
-- This migration is additive and idempotent. It extends the existing
-- OutreachRecord communication history instead of creating a separate message
-- system.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'SmsConsentStatus'
  ) THEN
    CREATE TYPE public."SmsConsentStatus" AS ENUM (
      'UNKNOWN',
      'OPTED_IN',
      'OPTED_OUT'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'SmsConsentSource'
  ) THEN
    CREATE TYPE public."SmsConsentSource" AS ENUM (
      'STAFF_RECORDED',
      'CUSTOMER_REQUEST',
      'PAPER_FORM',
      'VERBAL',
      'EXISTING_CUSTOMER_RECORD',
      'OTHER'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'SmsDeliveryStatus'
  ) THEN
    CREATE TYPE public."SmsDeliveryStatus" AS ENUM (
      'DRAFT',
      'QUEUED',
      'SENT',
      'DELIVERED',
      'FAILED',
      'SIMULATED'
    );
  END IF;
END $$;

ALTER TYPE public."OutreachChannel" ADD VALUE IF NOT EXISTS 'SMS';

ALTER TABLE public."Customer"
  ADD COLUMN IF NOT EXISTS "smsConsentStatus" public."SmsConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "smsConsentSource" public."SmsConsentSource",
  ADD COLUMN IF NOT EXISTS "smsConsentRecordedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "smsConsentRecordedByUserId" TEXT;

UPDATE public."Customer"
SET
  "smsConsentStatus" = 'OPTED_IN',
  "smsConsentSource" = COALESCE("smsConsentSource", 'EXISTING_CUSTOMER_RECORD'::public."SmsConsentSource"),
  "smsConsentRecordedAt" = COALESCE("smsConsentRecordedAt", "updatedAt")
WHERE "smsConsent" = true
  AND "smsConsentStatus" = 'UNKNOWN';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Customer_smsConsentRecordedByUserId_fkey'
  ) THEN
    ALTER TABLE public."Customer"
      ADD CONSTRAINT "Customer_smsConsentRecordedByUserId_fkey"
      FOREIGN KEY ("smsConsentRecordedByUserId") REFERENCES public."User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Customer_shopId_smsConsentStatus_idx"
  ON public."Customer"("shopId", "smsConsentStatus");

ALTER TABLE public."OutreachRecord"
  ADD COLUMN IF NOT EXISTS "opportunityId" TEXT,
  ADD COLUMN IF NOT EXISTS "appointmentRequestLinkId" TEXT,
  ADD COLUMN IF NOT EXISTS "smsRecipientPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "smsProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "smsDeliveryStatus" public."SmsDeliveryStatus",
  ADD COLUMN IF NOT EXISTS "smsSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "smsDeliveredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "smsFailureCode" TEXT,
  ADD COLUMN IF NOT EXISTS "smsFailureMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "smsIdempotencyKey" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OutreachRecord_opportunityId_fkey'
  ) THEN
    ALTER TABLE public."OutreachRecord"
      ADD CONSTRAINT "OutreachRecord_opportunityId_fkey"
      FOREIGN KEY ("opportunityId") REFERENCES public."MaintenanceRevenueOpportunity"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OutreachRecord_appointmentRequestLinkId_fkey'
  ) THEN
    ALTER TABLE public."OutreachRecord"
      ADD CONSTRAINT "OutreachRecord_appointmentRequestLinkId_fkey"
      FOREIGN KEY ("appointmentRequestLinkId") REFERENCES public."AppointmentRequestLink"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "OutreachRecord_shopId_opportunityId_idx"
  ON public."OutreachRecord"("shopId", "opportunityId");

CREATE INDEX IF NOT EXISTS "OutreachRecord_shopId_appointmentRequestLinkId_idx"
  ON public."OutreachRecord"("shopId", "appointmentRequestLinkId");

CREATE INDEX IF NOT EXISTS "OutreachRecord_sms_duplicate_lookup_idx"
  ON public."OutreachRecord"("shopId", "customerId", "opportunityId", "channel", "createdAt")
  WHERE "smsDeliveryStatus" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "OutreachRecord_sms_provider_message_idx"
  ON public."OutreachRecord"("shopId", "smsProvider", "providerExternalId")
  WHERE "providerExternalId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "OutreachRecord_shopId_smsIdempotencyKey_key"
  ON public."OutreachRecord"("shopId", "smsIdempotencyKey")
  WHERE "smsIdempotencyKey" IS NOT NULL;

GRANT USAGE ON TYPE public."SmsConsentStatus" TO authenticated, service_role;
GRANT USAGE ON TYPE public."SmsConsentSource" TO authenticated, service_role;
GRANT USAGE ON TYPE public."SmsDeliveryStatus" TO authenticated, service_role;
