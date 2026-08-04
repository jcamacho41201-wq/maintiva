-- Controlled appointment requests: customer-specific request links and staff approval workflow.
-- This migration is intentionally additive, idempotent, and non-destructive.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'AppointmentRequestStatus') THEN
    CREATE TYPE public."AppointmentRequestStatus" AS ENUM (
      'PENDING',
      'APPROVED',
      'DECLINED',
      'ALTERNATE_PROPOSED',
      'CUSTOMER_ACCEPTED_ALTERNATE',
      'EXPIRED',
      'CANCELLED'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'AppointmentRequestSource') THEN
    CREATE TYPE public."AppointmentRequestSource" AS ENUM (
      'MAINTENANCE_REQUEST_LINK',
      'ADVISOR_CREATED',
      'ALTERNATE_RESPONSE'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'AppointmentRequestLinkStatus') THEN
    CREATE TYPE public."AppointmentRequestLinkStatus" AS ENUM (
      'ACTIVE',
      'REVOKED',
      'USED',
      'EXPIRED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public."AppointmentRequestLink" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "smartMaintenanceBlockId" TEXT NOT NULL,
  "status" public."AppointmentRequestLinkStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "requestAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastRequestAttemptAt" TIMESTAMP(3),
  "regeneratedFromId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentRequestLink_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "tokenHash" TEXT;
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "vehicleId" TEXT;
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "opportunityId" TEXT;
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "smartMaintenanceBlockId" TEXT;
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "status" public."AppointmentRequestLinkStatus" DEFAULT 'ACTIVE';
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "usedAt" TIMESTAMP(3);
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "requestAttemptCount" INTEGER DEFAULT 0;
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "lastRequestAttemptAt" TIMESTAMP(3);
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "regeneratedFromId" TEXT;
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public."AppointmentRequestLink" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

UPDATE public."AppointmentRequestLink" SET
  "status" = COALESCE("status", 'ACTIVE'::public."AppointmentRequestLinkStatus"),
  "requestAttemptCount" = COALESCE("requestAttemptCount", 0),
  "createdAt" = COALESCE("createdAt", CURRENT_TIMESTAMP),
  "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP);

ALTER TABLE public."AppointmentRequestLink" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLink" ALTER COLUMN "tokenHash" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLink" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLink" ALTER COLUMN "vehicleId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLink" ALTER COLUMN "opportunityId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLink" ALTER COLUMN "smartMaintenanceBlockId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLink" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLink" ALTER COLUMN "expiresAt" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLink" ALTER COLUMN "requestAttemptCount" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLink" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLink" ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE TABLE IF NOT EXISTS public."AppointmentRequestLinkService" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "requestLinkId" TEXT NOT NULL,
  "smartMaintenanceBlockId" TEXT NOT NULL,
  "serviceDefinitionId" TEXT NOT NULL,
  "serviceNameSnapshot" TEXT NOT NULL,
  "laborMinutes" INTEGER NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentRequestLinkService_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."AppointmentRequestLinkService" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE public."AppointmentRequestLinkService" ADD COLUMN IF NOT EXISTS "requestLinkId" TEXT;
ALTER TABLE public."AppointmentRequestLinkService" ADD COLUMN IF NOT EXISTS "smartMaintenanceBlockId" TEXT;
ALTER TABLE public."AppointmentRequestLinkService" ADD COLUMN IF NOT EXISTS "serviceDefinitionId" TEXT;
ALTER TABLE public."AppointmentRequestLinkService" ADD COLUMN IF NOT EXISTS "serviceNameSnapshot" TEXT;
ALTER TABLE public."AppointmentRequestLinkService" ADD COLUMN IF NOT EXISTS "laborMinutes" INTEGER;
ALTER TABLE public."AppointmentRequestLinkService" ADD COLUMN IF NOT EXISTS "priceCents" INTEGER;
ALTER TABLE public."AppointmentRequestLinkService" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE public."AppointmentRequestLinkService" SET "createdAt" = COALESCE("createdAt", CURRENT_TIMESTAMP);
ALTER TABLE public."AppointmentRequestLinkService" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLinkService" ALTER COLUMN "requestLinkId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLinkService" ALTER COLUMN "smartMaintenanceBlockId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLinkService" ALTER COLUMN "serviceDefinitionId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLinkService" ALTER COLUMN "serviceNameSnapshot" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLinkService" ALTER COLUMN "laborMinutes" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLinkService" ALTER COLUMN "priceCents" SET NOT NULL;
ALTER TABLE public."AppointmentRequestLinkService" ALTER COLUMN "createdAt" SET NOT NULL;

CREATE TABLE IF NOT EXISTS public."AppointmentRequest" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "smartMaintenanceBlockId" TEXT NOT NULL,
  "requestLinkId" TEXT NOT NULL,
  "requestedStart" TIMESTAMP(3) NOT NULL,
  "requestedEnd" TIMESTAMP(3) NOT NULL,
  "shopTimezone" TEXT NOT NULL,
  "totalLaborMinutes" INTEGER NOT NULL,
  "estimatedRevenueCents" INTEGER NOT NULL,
  "status" public."AppointmentRequestStatus" NOT NULL DEFAULT 'PENDING',
  "source" public."AppointmentRequestSource" NOT NULL DEFAULT 'MAINTENANCE_REQUEST_LINK',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "customerSubmittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "advisorDecisionAt" TIMESTAMP(3),
  "decidedByUserId" TEXT,
  "declineReason" TEXT,
  "alternateProposedStart" TIMESTAMP(3),
  "alternateProposedEnd" TIMESTAMP(3),
  "finalAppointmentId" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentRequest_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "vehicleId" TEXT;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "opportunityId" TEXT;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "smartMaintenanceBlockId" TEXT;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "requestLinkId" TEXT;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "requestedStart" TIMESTAMP(3);
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "requestedEnd" TIMESTAMP(3);
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "shopTimezone" TEXT;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "totalLaborMinutes" INTEGER;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "estimatedRevenueCents" INTEGER;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "status" public."AppointmentRequestStatus" DEFAULT 'PENDING';
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "source" public."AppointmentRequestSource" DEFAULT 'MAINTENANCE_REQUEST_LINK';
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "customerSubmittedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "advisorDecisionAt" TIMESTAMP(3);
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "decidedByUserId" TEXT;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "declineReason" TEXT;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "alternateProposedStart" TIMESTAMP(3);
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "alternateProposedEnd" TIMESTAMP(3);
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "finalAppointmentId" TEXT;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public."AppointmentRequest" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

UPDATE public."AppointmentRequest" SET
  "status" = COALESCE("status", 'PENDING'::public."AppointmentRequestStatus"),
  "source" = COALESCE("source", 'MAINTENANCE_REQUEST_LINK'::public."AppointmentRequestSource"),
  "customerSubmittedAt" = COALESCE("customerSubmittedAt", CURRENT_TIMESTAMP),
  "createdAt" = COALESCE("createdAt", CURRENT_TIMESTAMP),
  "updatedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP);

ALTER TABLE public."AppointmentRequest" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "vehicleId" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "opportunityId" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "smartMaintenanceBlockId" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "requestLinkId" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "requestedStart" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "requestedEnd" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "shopTimezone" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "totalLaborMinutes" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "estimatedRevenueCents" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "source" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "expiresAt" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "customerSubmittedAt" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE public."AppointmentRequest" ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE TABLE IF NOT EXISTS public."AppointmentRequestService" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "shopId" TEXT NOT NULL,
  "appointmentRequestId" TEXT NOT NULL,
  "smartMaintenanceBlockId" TEXT NOT NULL,
  "serviceDefinitionId" TEXT NOT NULL,
  "serviceNameSnapshot" TEXT NOT NULL,
  "laborMinutes" INTEGER NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentRequestService_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."AppointmentRequestService" ADD COLUMN IF NOT EXISTS "shopId" TEXT;
ALTER TABLE public."AppointmentRequestService" ADD COLUMN IF NOT EXISTS "appointmentRequestId" TEXT;
ALTER TABLE public."AppointmentRequestService" ADD COLUMN IF NOT EXISTS "smartMaintenanceBlockId" TEXT;
ALTER TABLE public."AppointmentRequestService" ADD COLUMN IF NOT EXISTS "serviceDefinitionId" TEXT;
ALTER TABLE public."AppointmentRequestService" ADD COLUMN IF NOT EXISTS "serviceNameSnapshot" TEXT;
ALTER TABLE public."AppointmentRequestService" ADD COLUMN IF NOT EXISTS "laborMinutes" INTEGER;
ALTER TABLE public."AppointmentRequestService" ADD COLUMN IF NOT EXISTS "priceCents" INTEGER;
ALTER TABLE public."AppointmentRequestService" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE public."AppointmentRequestService" SET "createdAt" = COALESCE("createdAt", CURRENT_TIMESTAMP);
ALTER TABLE public."AppointmentRequestService" ALTER COLUMN "shopId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestService" ALTER COLUMN "appointmentRequestId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestService" ALTER COLUMN "smartMaintenanceBlockId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestService" ALTER COLUMN "serviceDefinitionId" SET NOT NULL;
ALTER TABLE public."AppointmentRequestService" ALTER COLUMN "serviceNameSnapshot" SET NOT NULL;
ALTER TABLE public."AppointmentRequestService" ALTER COLUMN "laborMinutes" SET NOT NULL;
ALTER TABLE public."AppointmentRequestService" ALTER COLUMN "priceCents" SET NOT NULL;
ALTER TABLE public."AppointmentRequestService" ALTER COLUMN "createdAt" SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE public."AppointmentRequestLink" DROP CONSTRAINT IF EXISTS "AppointmentRequestLink_expiration_check";
  ALTER TABLE public."AppointmentRequestLink" DROP CONSTRAINT IF EXISTS "AppointmentRequestLink_attempts_check";
  ALTER TABLE public."AppointmentRequestLink" DROP CONSTRAINT IF EXISTS "AppointmentRequestLink_tokenHash_check";
  ALTER TABLE public."AppointmentRequestLink" DROP CONSTRAINT IF EXISTS "AppointmentRequestLink_status_timestamps_check";
  ALTER TABLE public."AppointmentRequestLinkService" DROP CONSTRAINT IF EXISTS "AppointmentRequestLinkService_snapshot_check";
  ALTER TABLE public."AppointmentRequestLinkService" DROP CONSTRAINT IF EXISTS "AppointmentRequestLinkService_totals_check";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_time_check";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_totals_check";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_timezone_check";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_alternate_time_check";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_status_final_appointment_check";
  ALTER TABLE public."AppointmentRequestService" DROP CONSTRAINT IF EXISTS "AppointmentRequestService_snapshot_check";
  ALTER TABLE public."AppointmentRequestService" DROP CONSTRAINT IF EXISTS "AppointmentRequestService_totals_check";

  ALTER TABLE public."AppointmentRequestLink" ADD CONSTRAINT "AppointmentRequestLink_expiration_check"
    CHECK ("expiresAt" > "createdAt");
  ALTER TABLE public."AppointmentRequestLink" ADD CONSTRAINT "AppointmentRequestLink_attempts_check"
    CHECK ("requestAttemptCount" >= 0);
  ALTER TABLE public."AppointmentRequestLink" ADD CONSTRAINT "AppointmentRequestLink_tokenHash_check"
    CHECK ("tokenHash" ~ '^[a-f0-9]{64}$');
  ALTER TABLE public."AppointmentRequestLink" ADD CONSTRAINT "AppointmentRequestLink_status_timestamps_check"
    CHECK (
      ("status" <> 'REVOKED' OR "revokedAt" IS NOT NULL) AND
      ("status" <> 'USED' OR "usedAt" IS NOT NULL)
    );
  ALTER TABLE public."AppointmentRequestLinkService" ADD CONSTRAINT "AppointmentRequestLinkService_snapshot_check"
    CHECK (length(btrim("serviceNameSnapshot")) > 0);
  ALTER TABLE public."AppointmentRequestLinkService" ADD CONSTRAINT "AppointmentRequestLinkService_totals_check"
    CHECK ("laborMinutes" > 0 AND "priceCents" >= 0);
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_time_check"
    CHECK ("requestedEnd" > "requestedStart" AND "expiresAt" > "customerSubmittedAt");
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_totals_check"
    CHECK ("totalLaborMinutes" > 0 AND "estimatedRevenueCents" >= 0);
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_timezone_check"
    CHECK (length(btrim("shopTimezone")) > 0);
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_alternate_time_check"
    CHECK (
      (
        "status" NOT IN ('ALTERNATE_PROPOSED', 'CUSTOMER_ACCEPTED_ALTERNATE') AND
        (("alternateProposedStart" IS NULL AND "alternateProposedEnd" IS NULL) OR
          ("alternateProposedStart" IS NOT NULL AND "alternateProposedEnd" IS NOT NULL AND "alternateProposedEnd" > "alternateProposedStart"))
      ) OR
      (
        "status" IN ('ALTERNATE_PROPOSED', 'CUSTOMER_ACCEPTED_ALTERNATE') AND
        "alternateProposedStart" IS NOT NULL AND
        "alternateProposedEnd" IS NOT NULL AND
        "alternateProposedEnd" > "alternateProposedStart"
      )
    );
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_status_final_appointment_check"
    CHECK (
      ("status" <> 'APPROVED' OR "finalAppointmentId" IS NOT NULL) AND
      ("finalAppointmentId" IS NULL OR "status" = 'APPROVED')
    );
  ALTER TABLE public."AppointmentRequestService" ADD CONSTRAINT "AppointmentRequestService_snapshot_check"
    CHECK (length(btrim("serviceNameSnapshot")) > 0);
  ALTER TABLE public."AppointmentRequestService" ADD CONSTRAINT "AppointmentRequestService_totals_check"
    CHECK ("laborMinutes" > 0 AND "priceCents" >= 0);
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequestLink_tokenHash_key" ON public."AppointmentRequestLink" ("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequestLink_id_shop_key" ON public."AppointmentRequestLink" ("id", "shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequestLink_id_shop_customer_vehicle_key" ON public."AppointmentRequestLink" ("id", "shopId", "customerId", "vehicleId");
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequestLink_id_shop_block_key" ON public."AppointmentRequestLink" ("id", "shopId", "smartMaintenanceBlockId");
CREATE INDEX IF NOT EXISTS "AppointmentRequestLink_shop_customer_idx" ON public."AppointmentRequestLink" ("shopId", "customerId");
CREATE INDEX IF NOT EXISTS "AppointmentRequestLink_shop_vehicle_idx" ON public."AppointmentRequestLink" ("shopId", "vehicleId");
CREATE INDEX IF NOT EXISTS "AppointmentRequestLink_shop_opportunity_idx" ON public."AppointmentRequestLink" ("shopId", "opportunityId");
CREATE INDEX IF NOT EXISTS "AppointmentRequestLink_shop_status_expires_idx" ON public."AppointmentRequestLink" ("shopId", "status", "expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequestLinkService_link_service_key" ON public."AppointmentRequestLinkService" ("requestLinkId", "serviceDefinitionId");
CREATE INDEX IF NOT EXISTS "AppointmentRequestLinkService_shop_link_idx" ON public."AppointmentRequestLinkService" ("shopId", "requestLinkId");
CREATE INDEX IF NOT EXISTS "AppointmentRequestLinkService_shop_block_idx" ON public."AppointmentRequestLinkService" ("shopId", "smartMaintenanceBlockId");
CREATE INDEX IF NOT EXISTS "AppointmentRequestLinkService_shop_service_idx" ON public."AppointmentRequestLinkService" ("shopId", "serviceDefinitionId");
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequest_id_shop_key" ON public."AppointmentRequest" ("id", "shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequest_id_shop_block_key" ON public."AppointmentRequest" ("id", "shopId", "smartMaintenanceBlockId");
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequest_link_idempotency_key" ON public."AppointmentRequest" ("requestLinkId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequest_link_active_key" ON public."AppointmentRequest" ("requestLinkId") WHERE "finalAppointmentId" IS NULL AND "status" IN ('PENDING', 'ALTERNATE_PROPOSED', 'CUSTOMER_ACCEPTED_ALTERNATE');
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequest_link_requested_active_key" ON public."AppointmentRequest" ("requestLinkId", "requestedStart") WHERE "finalAppointmentId" IS NULL AND "status" IN ('PENDING', 'ALTERNATE_PROPOSED', 'CUSTOMER_ACCEPTED_ALTERNATE');
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequest_finalAppointment_key" ON public."AppointmentRequest" ("finalAppointmentId") WHERE "finalAppointmentId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "AppointmentRequest_shop_status_start_idx" ON public."AppointmentRequest" ("shopId", "status", "requestedStart");
CREATE INDEX IF NOT EXISTS "AppointmentRequest_shop_customer_idx" ON public."AppointmentRequest" ("shopId", "customerId");
CREATE INDEX IF NOT EXISTS "AppointmentRequest_shop_vehicle_idx" ON public."AppointmentRequest" ("shopId", "vehicleId");
CREATE INDEX IF NOT EXISTS "AppointmentRequest_shop_opportunity_idx" ON public."AppointmentRequest" ("shopId", "opportunityId");
CREATE INDEX IF NOT EXISTS "AppointmentRequest_shop_block_idx" ON public."AppointmentRequest" ("shopId", "smartMaintenanceBlockId");
CREATE INDEX IF NOT EXISTS "AppointmentRequest_shop_link_idx" ON public."AppointmentRequest" ("shopId", "requestLinkId");
CREATE UNIQUE INDEX IF NOT EXISTS "AppointmentRequestService_request_service_key" ON public."AppointmentRequestService" ("appointmentRequestId", "serviceDefinitionId");
CREATE INDEX IF NOT EXISTS "AppointmentRequestService_shop_request_idx" ON public."AppointmentRequestService" ("shopId", "appointmentRequestId");
CREATE INDEX IF NOT EXISTS "AppointmentRequestService_shop_block_idx" ON public."AppointmentRequestService" ("shopId", "smartMaintenanceBlockId");
CREATE INDEX IF NOT EXISTS "AppointmentRequestService_shop_service_idx" ON public."AppointmentRequestService" ("shopId", "serviceDefinitionId");
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_id_shop_key" ON public."Customer" ("id", "shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "Vehicle_id_shop_key" ON public."Vehicle" ("id", "shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "Vehicle_id_shop_customer_key" ON public."Vehicle" ("id", "shopId", "customerId");
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_id_shop_key" ON public."Appointment" ("id", "shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_id_shop_customer_vehicle_key" ON public."Appointment" ("id", "shopId", "customerId", "vehicleId");
CREATE UNIQUE INDEX IF NOT EXISTS "MaintenanceRevenueOpportunity_id_shop_key" ON public."MaintenanceRevenueOpportunity" ("id", "shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "MaintenanceRevenueOpportunity_id_shop_customer_vehicle_key" ON public."MaintenanceRevenueOpportunity" ("id", "shopId", "customerId", "vehicleId");
CREATE UNIQUE INDEX IF NOT EXISTS "SmartMaintenanceBlockService_block_shop_service_key" ON public."SmartMaintenanceBlockService" ("blockId", "shopId", "serviceDefinitionId");

DO $$
BEGIN
  ALTER TABLE public."AppointmentRequestLink" DROP CONSTRAINT IF EXISTS "AppointmentRequestLink_shopId_fkey";
  ALTER TABLE public."AppointmentRequestLink" DROP CONSTRAINT IF EXISTS "AppointmentRequestLink_customerId_fkey";
  ALTER TABLE public."AppointmentRequestLink" DROP CONSTRAINT IF EXISTS "AppointmentRequestLink_vehicleId_fkey";
  ALTER TABLE public."AppointmentRequestLink" DROP CONSTRAINT IF EXISTS "AppointmentRequestLink_opportunityId_shopId_fkey";
  ALTER TABLE public."AppointmentRequestLink" DROP CONSTRAINT IF EXISTS "AppointmentRequestLink_opportunity_scope_fkey";
  ALTER TABLE public."AppointmentRequestLink" DROP CONSTRAINT IF EXISTS "AppointmentRequestLink_smartMaintenanceBlockId_shopId_fkey";
  ALTER TABLE public."AppointmentRequestLink" DROP CONSTRAINT IF EXISTS "AppointmentRequestLink_regeneratedFromId_fkey";
  ALTER TABLE public."AppointmentRequestLink" DROP CONSTRAINT IF EXISTS "AppointmentRequestLink_createdByUserId_fkey";
  ALTER TABLE public."AppointmentRequestLinkService" DROP CONSTRAINT IF EXISTS "AppointmentRequestLinkService_requestLinkId_shopId_fkey";
  ALTER TABLE public."AppointmentRequestLinkService" DROP CONSTRAINT IF EXISTS "AppointmentRequestLinkService_request_link_block_fkey";
  ALTER TABLE public."AppointmentRequestLinkService" DROP CONSTRAINT IF EXISTS "AppointmentRequestLinkService_shopId_fkey";
  ALTER TABLE public."AppointmentRequestLinkService" DROP CONSTRAINT IF EXISTS "AppointmentRequestLinkService_serviceDefinitionId_shopId_fkey";
  ALTER TABLE public."AppointmentRequestLinkService" DROP CONSTRAINT IF EXISTS "AppointmentRequestLinkService_block_service_fkey";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_shopId_fkey";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_customerId_fkey";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_vehicleId_fkey";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_opportunityId_shopId_fkey";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_opportunity_scope_fkey";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_smartMaintenanceBlockId_shopId_fkey";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_requestLinkId_shopId_fkey";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_request_link_scope_fkey";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_finalAppointmentId_shopId_fkey";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_final_appointment_scope_fkey";
  ALTER TABLE public."AppointmentRequest" DROP CONSTRAINT IF EXISTS "AppointmentRequest_decidedByUserId_fkey";
  ALTER TABLE public."AppointmentRequestService" DROP CONSTRAINT IF EXISTS "AppointmentRequestService_appointmentRequestId_shopId_fkey";
  ALTER TABLE public."AppointmentRequestService" DROP CONSTRAINT IF EXISTS "AppointmentRequestService_request_block_fkey";
  ALTER TABLE public."AppointmentRequestService" DROP CONSTRAINT IF EXISTS "AppointmentRequestService_shopId_fkey";
  ALTER TABLE public."AppointmentRequestService" DROP CONSTRAINT IF EXISTS "AppointmentRequestService_serviceDefinitionId_shopId_fkey";
  ALTER TABLE public."AppointmentRequestService" DROP CONSTRAINT IF EXISTS "AppointmentRequestService_block_service_fkey";

  ALTER TABLE public."AppointmentRequestLink" ADD CONSTRAINT "AppointmentRequestLink_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestLink" ADD CONSTRAINT "AppointmentRequestLink_customerId_fkey"
    FOREIGN KEY ("customerId", "shopId") REFERENCES public."Customer"("id", "shopId") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestLink" ADD CONSTRAINT "AppointmentRequestLink_vehicleId_fkey"
    FOREIGN KEY ("vehicleId", "shopId", "customerId") REFERENCES public."Vehicle"("id", "shopId", "customerId") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestLink" ADD CONSTRAINT "AppointmentRequestLink_opportunity_scope_fkey"
    FOREIGN KEY ("opportunityId", "shopId", "customerId", "vehicleId") REFERENCES public."MaintenanceRevenueOpportunity"("id", "shopId", "customerId", "vehicleId") ON DELETE NO ACTION ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestLink" ADD CONSTRAINT "AppointmentRequestLink_smartMaintenanceBlockId_shopId_fkey"
    FOREIGN KEY ("smartMaintenanceBlockId", "shopId") REFERENCES public."SmartMaintenanceBlock"("id", "shopId") ON DELETE NO ACTION ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestLink" ADD CONSTRAINT "AppointmentRequestLink_regeneratedFromId_fkey"
    FOREIGN KEY ("regeneratedFromId") REFERENCES public."AppointmentRequestLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestLink" ADD CONSTRAINT "AppointmentRequestLink_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestLinkService" ADD CONSTRAINT "AppointmentRequestLinkService_request_link_block_fkey"
    FOREIGN KEY ("requestLinkId", "shopId", "smartMaintenanceBlockId") REFERENCES public."AppointmentRequestLink"("id", "shopId", "smartMaintenanceBlockId") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestLinkService" ADD CONSTRAINT "AppointmentRequestLinkService_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestLinkService" ADD CONSTRAINT "AppointmentRequestLinkService_serviceDefinitionId_shopId_fkey"
    FOREIGN KEY ("serviceDefinitionId", "shopId") REFERENCES public."ServiceDefinition"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestLinkService" ADD CONSTRAINT "AppointmentRequestLinkService_block_service_fkey"
    FOREIGN KEY ("smartMaintenanceBlockId", "shopId", "serviceDefinitionId") REFERENCES public."SmartMaintenanceBlockService"("blockId", "shopId", "serviceDefinitionId") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_customerId_fkey"
    FOREIGN KEY ("customerId", "shopId") REFERENCES public."Customer"("id", "shopId") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_vehicleId_fkey"
    FOREIGN KEY ("vehicleId", "shopId", "customerId") REFERENCES public."Vehicle"("id", "shopId", "customerId") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_opportunity_scope_fkey"
    FOREIGN KEY ("opportunityId", "shopId", "customerId", "vehicleId") REFERENCES public."MaintenanceRevenueOpportunity"("id", "shopId", "customerId", "vehicleId") ON DELETE NO ACTION ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_smartMaintenanceBlockId_shopId_fkey"
    FOREIGN KEY ("smartMaintenanceBlockId", "shopId") REFERENCES public."SmartMaintenanceBlock"("id", "shopId") ON DELETE NO ACTION ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_request_link_scope_fkey"
    FOREIGN KEY ("requestLinkId", "shopId", "customerId", "vehicleId") REFERENCES public."AppointmentRequestLink"("id", "shopId", "customerId", "vehicleId") ON DELETE NO ACTION ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_final_appointment_scope_fkey"
    FOREIGN KEY ("finalAppointmentId", "shopId", "customerId", "vehicleId") REFERENCES public."Appointment"("id", "shopId", "customerId", "vehicleId") ON DELETE NO ACTION ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequest" ADD CONSTRAINT "AppointmentRequest_decidedByUserId_fkey"
    FOREIGN KEY ("decidedByUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestService" ADD CONSTRAINT "AppointmentRequestService_request_block_fkey"
    FOREIGN KEY ("appointmentRequestId", "shopId", "smartMaintenanceBlockId") REFERENCES public."AppointmentRequest"("id", "shopId", "smartMaintenanceBlockId") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestService" ADD CONSTRAINT "AppointmentRequestService_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES public."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestService" ADD CONSTRAINT "AppointmentRequestService_serviceDefinitionId_shopId_fkey"
    FOREIGN KEY ("serviceDefinitionId", "shopId") REFERENCES public."ServiceDefinition"("id", "shopId") ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE public."AppointmentRequestService" ADD CONSTRAINT "AppointmentRequestService_block_service_fkey"
    FOREIGN KEY ("smartMaintenanceBlockId", "shopId", "serviceDefinitionId") REFERENCES public."SmartMaintenanceBlockService"("blockId", "shopId", "serviceDefinitionId") ON DELETE RESTRICT ON UPDATE CASCADE;
END $$;

DO $$
BEGIN
  IF to_regproc('public.maintiva_set_updated_at') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'AppointmentRequestLink_set_updatedAt') THEN
      CREATE TRIGGER "AppointmentRequestLink_set_updatedAt"
        BEFORE UPDATE ON public."AppointmentRequestLink"
        FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'AppointmentRequest_set_updatedAt') THEN
      CREATE TRIGGER "AppointmentRequest_set_updatedAt"
        BEFORE UPDATE ON public."AppointmentRequest"
        FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
    END IF;
  END IF;
END $$;

ALTER TABLE public."AppointmentRequestLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AppointmentRequestLinkService" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AppointmentRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AppointmentRequestService" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read appointment request links" ON public."AppointmentRequestLink";
CREATE POLICY "Members can read appointment request links"
ON public."AppointmentRequestLink" FOR SELECT TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert appointment request links" ON public."AppointmentRequestLink";
CREATE POLICY "Members can insert appointment request links"
ON public."AppointmentRequestLink" FOR INSERT TO authenticated
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update appointment request links" ON public."AppointmentRequestLink";
CREATE POLICY "Members can update appointment request links"
ON public."AppointmentRequestLink" FOR UPDATE TO authenticated
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete appointment request links" ON public."AppointmentRequestLink";

DROP POLICY IF EXISTS "Members can read appointment request link services" ON public."AppointmentRequestLinkService";
CREATE POLICY "Members can read appointment request link services"
ON public."AppointmentRequestLinkService" FOR SELECT TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert appointment request link services" ON public."AppointmentRequestLinkService";
CREATE POLICY "Members can insert appointment request link services"
ON public."AppointmentRequestLinkService" FOR INSERT TO authenticated
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update appointment request link services" ON public."AppointmentRequestLinkService";
CREATE POLICY "Members can update appointment request link services"
ON public."AppointmentRequestLinkService" FOR UPDATE TO authenticated
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete appointment request link services" ON public."AppointmentRequestLinkService";

DROP POLICY IF EXISTS "Members can read appointment requests" ON public."AppointmentRequest";
CREATE POLICY "Members can read appointment requests"
ON public."AppointmentRequest" FOR SELECT TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert appointment requests" ON public."AppointmentRequest";
CREATE POLICY "Members can insert appointment requests"
ON public."AppointmentRequest" FOR INSERT TO authenticated
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update appointment requests" ON public."AppointmentRequest";
CREATE POLICY "Members can update appointment requests"
ON public."AppointmentRequest" FOR UPDATE TO authenticated
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete appointment requests" ON public."AppointmentRequest";

DROP POLICY IF EXISTS "Members can read appointment request services" ON public."AppointmentRequestService";
CREATE POLICY "Members can read appointment request services"
ON public."AppointmentRequestService" FOR SELECT TO authenticated
USING (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can insert appointment request services" ON public."AppointmentRequestService";
CREATE POLICY "Members can insert appointment request services"
ON public."AppointmentRequestService" FOR INSERT TO authenticated
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can update appointment request services" ON public."AppointmentRequestService";
CREATE POLICY "Members can update appointment request services"
ON public."AppointmentRequestService" FOR UPDATE TO authenticated
USING (public.maintiva_is_shop_member("shopId"))
WITH CHECK (public.maintiva_is_shop_member("shopId"));

DROP POLICY IF EXISTS "Members can delete appointment request services" ON public."AppointmentRequestService";

REVOKE ALL ON TABLE
  public."AppointmentRequestLink",
  public."AppointmentRequestLinkService",
  public."AppointmentRequest",
  public."AppointmentRequestService"
FROM anon, public;

REVOKE DELETE ON TABLE
  public."AppointmentRequestLink",
  public."AppointmentRequestLinkService",
  public."AppointmentRequest",
  public."AppointmentRequestService"
FROM authenticated;

GRANT USAGE ON TYPE
  public."AppointmentRequestStatus",
  public."AppointmentRequestSource",
  public."AppointmentRequestLinkStatus"
TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public."AppointmentRequestLink",
  public."AppointmentRequestLinkService",
  public."AppointmentRequest",
  public."AppointmentRequestService"
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."AppointmentRequestLink",
  public."AppointmentRequestLinkService",
  public."AppointmentRequest",
  public."AppointmentRequestService"
TO service_role;
