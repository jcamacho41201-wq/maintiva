-- Maintiva initial Supabase schema.
-- Generated from the Prisma migrations so Supabase CLI deployments create the exact tables used by the application.
-- Business data is accessed through Prisma; Supabase Auth user ids are stored in public."User".id and public."ShopMembership"."userId".
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MANAGER', 'SERVICE_ADVISOR', 'TECHNICIAN');

-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'WATCHLIST', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('SMS', 'EMAIL', 'CALL');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('HEALTHY', 'DUE_SOON', 'DUE', 'OVERDUE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('NEEDS_OUTREACH', 'DRAFTED', 'MANUALLY_SENT', 'SCHEDULED', 'DECLINED');

-- CreateEnum
CREATE TYPE "OutreachChannel" AS ENUM ('SMS', 'EMAIL', 'CALL');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('AUTOMATION', 'CUSTOMER_BOOKING', 'MANUAL', 'IMPORTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "dailyBayHours" INTEGER NOT NULL DEFAULT 64,
    "status" "ShopStatus" NOT NULL DEFAULT 'ONBOARDING',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopMembership" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "preferredContact" "ContactMethod" NOT NULL DEFAULT 'SMS',
    "smsConsent" BOOLEAN NOT NULL DEFAULT false,
    "emailConsent" BOOLEAN NOT NULL DEFAULT false,
    "callConsent" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT,
    "notes" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "customerScore" INTEGER NOT NULL DEFAULT 70,
    "lifetimeRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "lastVisit" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vin" TEXT,
    "licensePlate" TEXT,
    "engine" TEXT,
    "trim" TEXT,
    "vehicleType" TEXT,
    "currentMileage" INTEGER NOT NULL DEFAULT 0,
    "estimatedAnnualMileage" INTEGER,
    "overallHealth" INTEGER NOT NULL DEFAULT 80,
    "lastServiceDate" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceDefinition" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "defaultMileageInterval" INTEGER NOT NULL,
    "defaultTimeIntervalMonths" INTEGER NOT NULL,
    "defaultNotificationThreshold" INTEGER NOT NULL DEFAULT 10,
    "estimatedLaborMinutes" INTEGER NOT NULL,
    "defaultPriceCents" INTEGER NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleMaintenanceRecord" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceDefinitionId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "lastCompletedDate" TIMESTAMP(3),
    "lastCompletedMileage" INTEGER,
    "recommendedMileageInterval" INTEGER NOT NULL,
    "recommendedTimeIntervalMonths" INTEGER NOT NULL,
    "notificationThreshold" INTEGER NOT NULL DEFAULT 10,
    "priceCents" INTEGER NOT NULL,
    "laborMinutes" INTEGER NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'HEALTHY',
    "outreachStatus" "OutreachStatus" NOT NULL DEFAULT 'NEEDS_OUTREACH',
    "outreachRecordId" TEXT,
    "appointmentId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleMaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceHistoryRecord" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceDefinitionId" TEXT,
    "maintenanceRecordId" TEXT,
    "serviceName" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "mileage" INTEGER,
    "laborMinutes" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceHistoryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachRecord" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "channel" "OutreachChannel" NOT NULL DEFAULT 'SMS',
    "status" "OutreachStatus" NOT NULL DEFAULT 'DRAFTED',
    "copiedAt" TIMESTAMP(3),
    "manuallySentAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "providerExternalId" TEXT,
    "providerPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "totalLaborMinutes" INTEGER NOT NULL,
    "totalPriceCents" INTEGER NOT NULL,
    "source" "AppointmentSource" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentService" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "serviceDefinitionId" TEXT,
    "maintenanceRecordId" TEXT,
    "serviceName" TEXT NOT NULL,
    "laborMinutes" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_slug_key" ON "Shop"("slug");

-- CreateIndex
CREATE INDEX "Shop_status_idx" ON "Shop"("status");

-- CreateIndex
CREATE INDEX "ShopMembership_userId_isActive_idx" ON "ShopMembership"("userId", "isActive");

-- CreateIndex
CREATE INDEX "ShopMembership_shopId_role_idx" ON "ShopMembership"("shopId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ShopMembership_shopId_userId_key" ON "ShopMembership"("shopId", "userId");

-- CreateIndex
CREATE INDEX "Customer_shopId_status_idx" ON "Customer"("shopId", "status");

-- CreateIndex
CREATE INDEX "Customer_shopId_archivedAt_idx" ON "Customer"("shopId", "archivedAt");

-- CreateIndex
CREATE INDEX "Customer_shopId_lastName_firstName_idx" ON "Customer"("shopId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "Vehicle_shopId_customerId_idx" ON "Vehicle"("shopId", "customerId");

-- CreateIndex
CREATE INDEX "Vehicle_shopId_archivedAt_idx" ON "Vehicle"("shopId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_shopId_vin_key" ON "Vehicle"("shopId", "vin");

-- CreateIndex
CREATE INDEX "ServiceDefinition_shopId_isActive_idx" ON "ServiceDefinition"("shopId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDefinition_shopId_name_key" ON "ServiceDefinition"("shopId", "name");

-- CreateIndex
CREATE INDEX "VehicleMaintenanceRecord_shopId_vehicleId_status_idx" ON "VehicleMaintenanceRecord"("shopId", "vehicleId", "status");

-- CreateIndex
CREATE INDEX "VehicleMaintenanceRecord_shopId_outreachStatus_idx" ON "VehicleMaintenanceRecord"("shopId", "outreachStatus");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleMaintenanceRecord_shopId_vehicleId_serviceDefinition_key" ON "VehicleMaintenanceRecord"("shopId", "vehicleId", "serviceDefinitionId");

-- CreateIndex
CREATE INDEX "ServiceHistoryRecord_shopId_customerId_completedAt_idx" ON "ServiceHistoryRecord"("shopId", "customerId", "completedAt");

-- CreateIndex
CREATE INDEX "ServiceHistoryRecord_shopId_vehicleId_completedAt_idx" ON "ServiceHistoryRecord"("shopId", "vehicleId", "completedAt");

-- CreateIndex
CREATE INDEX "OutreachRecord_shopId_status_createdAt_idx" ON "OutreachRecord"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OutreachRecord_shopId_customerId_createdAt_idx" ON "OutreachRecord"("shopId", "customerId", "createdAt");

-- CreateIndex
CREATE INDEX "OutreachRecord_shopId_vehicleId_createdAt_idx" ON "OutreachRecord"("shopId", "vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "Appointment_shopId_scheduledStart_status_idx" ON "Appointment"("shopId", "scheduledStart", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_shopId_vehicleId_scheduledStart_key" ON "Appointment"("shopId", "vehicleId", "scheduledStart");

-- CreateIndex
CREATE INDEX "AppointmentService_shopId_appointmentId_idx" ON "AppointmentService"("shopId", "appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentService_appointmentId_serviceName_key" ON "AppointmentService"("appointmentId", "serviceName");

-- CreateIndex
CREATE INDEX "AuditLog_shopId_createdAt_idx" ON "AuditLog"("shopId", "createdAt");

-- AddForeignKey
ALTER TABLE "ShopMembership" ADD CONSTRAINT "ShopMembership_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopMembership" ADD CONSTRAINT "ShopMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDefinition" ADD CONSTRAINT "ServiceDefinition_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMaintenanceRecord" ADD CONSTRAINT "VehicleMaintenanceRecord_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMaintenanceRecord" ADD CONSTRAINT "VehicleMaintenanceRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMaintenanceRecord" ADD CONSTRAINT "VehicleMaintenanceRecord_serviceDefinitionId_fkey" FOREIGN KEY ("serviceDefinitionId") REFERENCES "ServiceDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMaintenanceRecord" ADD CONSTRAINT "VehicleMaintenanceRecord_outreachRecordId_fkey" FOREIGN KEY ("outreachRecordId") REFERENCES "OutreachRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleMaintenanceRecord" ADD CONSTRAINT "VehicleMaintenanceRecord_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceHistoryRecord" ADD CONSTRAINT "ServiceHistoryRecord_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceHistoryRecord" ADD CONSTRAINT "ServiceHistoryRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceHistoryRecord" ADD CONSTRAINT "ServiceHistoryRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceHistoryRecord" ADD CONSTRAINT "ServiceHistoryRecord_serviceDefinitionId_fkey" FOREIGN KEY ("serviceDefinitionId") REFERENCES "ServiceDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceHistoryRecord" ADD CONSTRAINT "ServiceHistoryRecord_maintenanceRecordId_fkey" FOREIGN KEY ("maintenanceRecordId") REFERENCES "VehicleMaintenanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachRecord" ADD CONSTRAINT "OutreachRecord_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachRecord" ADD CONSTRAINT "OutreachRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachRecord" ADD CONSTRAINT "OutreachRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_serviceDefinitionId_fkey" FOREIGN KEY ("serviceDefinitionId") REFERENCES "ServiceDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_maintenanceRecordId_fkey" FOREIGN KEY ("maintenanceRecordId") REFERENCES "VehicleMaintenanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "CustomerResponseStatus" AS ENUM ('NO_RESPONSE', 'INTERESTED', 'WANTS_CALLBACK', 'BOOKED', 'DECLINED', 'NOT_NOW', 'WRONG_CONTACT', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "AppointmentAttributionSource" AS ENUM ('MAINTIVA_OUTREACH', 'MANUAL_SHOP_ENTRY', 'IMPORTED_APPOINTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "OpportunitySource" AS ENUM ('DUE_MAINTENANCE', 'OVERDUE_MAINTENANCE', 'DECLINED_WORK', 'DEFERRED_WORK', 'REACTIVATION');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('IDENTIFIED', 'CONTACTED', 'RESPONDED', 'BOOKED', 'COMPLETED', 'LOST');

-- CreateEnum
CREATE TYPE "OpportunityPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('CUSTOMERS', 'VEHICLES', 'SERVICE_HISTORY', 'DECLINED_WORK', 'APPOINTMENTS', 'COMBINED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEWED', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "DeclinedWorkStatus" AS ENUM ('OPEN', 'BOOKED', 'COMPLETED', 'DECLINED', 'SNOOZED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OutreachStatus" ADD VALUE 'RESPONDED';
ALTER TYPE "OutreachStatus" ADD VALUE 'SNOOZED';
ALTER TYPE "OutreachStatus" ADD VALUE 'STOPPED';

-- AlterEnum
BEGIN;
CREATE TYPE "OutreachChannel_new" AS ENUM ('PHONE', 'TEXT', 'EMAIL', 'CALL', 'IN_PERSON', 'OTHER');
ALTER TABLE "OutreachRecord" ALTER COLUMN "channel" DROP DEFAULT;
ALTER TABLE "OutreachRecord" ALTER COLUMN "channel" TYPE "OutreachChannel_new" USING (
  CASE
    WHEN "channel"::text = 'SMS' THEN 'TEXT'
    ELSE "channel"::text
  END::"OutreachChannel_new"
);
ALTER TYPE "OutreachChannel" RENAME TO "OutreachChannel_old";
ALTER TYPE "OutreachChannel_new" RENAME TO "OutreachChannel";
DROP TYPE "OutreachChannel_old";
ALTER TABLE "OutreachRecord" ALTER COLUMN "channel" SET DEFAULT 'TEXT';
COMMIT;

-- AlterTable
ALTER TABLE "OutreachRecord" ADD COLUMN     "appointmentId" TEXT,
ADD COLUMN     "followUpDate" TIMESTAMP(3),
ADD COLUMN     "performedByUserId" TEXT,
ADD COLUMN     "responseStatus" "CustomerResponseStatus" NOT NULL DEFAULT 'NO_RESPONSE',
ALTER COLUMN "channel" SET DEFAULT 'TEXT';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "attributionSource" "AppointmentAttributionSource" NOT NULL DEFAULT 'MANUAL_SHOP_ENTRY',
ADD COLUMN     "completedLaborMinutes" INTEGER,
ADD COLUMN     "completedRevenueCents" INTEGER,
ADD COLUMN     "opportunityId" TEXT,
ADD COLUMN     "outreachRecordId" TEXT;

-- CreateTable
CREATE TABLE "DeclinedWorkRecord" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "declinedAt" TIMESTAMP(3) NOT NULL,
    "recommendedPriceCents" INTEGER NOT NULL,
    "laborMinutes" INTEGER NOT NULL,
    "advisorNotes" TEXT,
    "status" "DeclinedWorkStatus" NOT NULL DEFAULT 'OPEN',
    "outreachStatus" "OutreachStatus" NOT NULL DEFAULT 'NEEDS_OUTREACH',
    "appointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeclinedWorkRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRevenueOpportunity" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "maintenanceRecordId" TEXT,
    "declinedWorkRecordId" TEXT,
    "source" "OpportunitySource" NOT NULL,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'IDENTIFIED',
    "priority" "OpportunityPriority" NOT NULL DEFAULT 'MEDIUM',
    "explanation" TEXT NOT NULL,
    "priorityReason" TEXT NOT NULL,
    "estimatedRevenueCents" INTEGER NOT NULL,
    "estimatedLaborMinutes" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3),
    "dueMileage" INTEGER,
    "daysOverdue" INTEGER NOT NULL DEFAULT 0,
    "milesOverdue" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceRevenueOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportHistoryRecord" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "userId" TEXT,
    "fileName" TEXT NOT NULL,
    "importType" "ImportType" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'COMPLETED',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successfulRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "errorReportUrl" TEXT,
    "errorReport" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportHistoryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeclinedWorkRecord_shopId_status_declinedAt_idx" ON "DeclinedWorkRecord"("shopId", "status", "declinedAt");

-- CreateIndex
CREATE INDEX "DeclinedWorkRecord_shopId_customerId_idx" ON "DeclinedWorkRecord"("shopId", "customerId");

-- CreateIndex
CREATE INDEX "DeclinedWorkRecord_shopId_vehicleId_idx" ON "DeclinedWorkRecord"("shopId", "vehicleId");

-- CreateIndex
CREATE INDEX "MaintenanceRevenueOpportunity_shopId_stage_priority_idx" ON "MaintenanceRevenueOpportunity"("shopId", "stage", "priority");

-- CreateIndex
CREATE INDEX "MaintenanceRevenueOpportunity_shopId_source_idx" ON "MaintenanceRevenueOpportunity"("shopId", "source");

-- CreateIndex
CREATE INDEX "MaintenanceRevenueOpportunity_shopId_vehicleId_idx" ON "MaintenanceRevenueOpportunity"("shopId", "vehicleId");

-- CreateIndex
CREATE INDEX "ImportHistoryRecord_shopId_importedAt_idx" ON "ImportHistoryRecord"("shopId", "importedAt");

-- CreateIndex
CREATE INDEX "ImportHistoryRecord_shopId_importType_idx" ON "ImportHistoryRecord"("shopId", "importType");

-- AddForeignKey
ALTER TABLE "DeclinedWorkRecord" ADD CONSTRAINT "DeclinedWorkRecord_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeclinedWorkRecord" ADD CONSTRAINT "DeclinedWorkRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeclinedWorkRecord" ADD CONSTRAINT "DeclinedWorkRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeclinedWorkRecord" ADD CONSTRAINT "DeclinedWorkRecord_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRevenueOpportunity" ADD CONSTRAINT "MaintenanceRevenueOpportunity_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRevenueOpportunity" ADD CONSTRAINT "MaintenanceRevenueOpportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRevenueOpportunity" ADD CONSTRAINT "MaintenanceRevenueOpportunity_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRevenueOpportunity" ADD CONSTRAINT "MaintenanceRevenueOpportunity_maintenanceRecordId_fkey" FOREIGN KEY ("maintenanceRecordId") REFERENCES "VehicleMaintenanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRevenueOpportunity" ADD CONSTRAINT "MaintenanceRevenueOpportunity_declinedWorkRecordId_fkey" FOREIGN KEY ("declinedWorkRecordId") REFERENCES "DeclinedWorkRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachRecord" ADD CONSTRAINT "OutreachRecord_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachRecord" ADD CONSTRAINT "OutreachRecord_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportHistoryRecord" ADD CONSTRAINT "ImportHistoryRecord_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportHistoryRecord" ADD CONSTRAINT "ImportHistoryRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ImportRowRecord" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "importHistoryRecordId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "entityType" TEXT,
    "errorMessage" TEXT,
    "sourceRow" JSONB NOT NULL,
    "normalizedRow" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRowRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportRowRecord_importHistoryRecordId_rowNumber_key" ON "ImportRowRecord"("importHistoryRecordId", "rowNumber");

-- CreateIndex
CREATE INDEX "ImportRowRecord_shopId_importHistoryRecordId_idx" ON "ImportRowRecord"("shopId", "importHistoryRecordId");

-- CreateIndex
CREATE INDEX "ImportRowRecord_shopId_status_idx" ON "ImportRowRecord"("shopId", "status");

-- AddForeignKey
ALTER TABLE "ImportRowRecord" ADD CONSTRAINT "ImportRowRecord_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRowRecord" ADD CONSTRAINT "ImportRowRecord_importHistoryRecordId_fkey" FOREIGN KEY ("importHistoryRecordId") REFERENCES "ImportHistoryRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase operational defaults and Row Level Security.
-- Prisma generates string ids client-side, but these UUID-text defaults keep
-- direct SQL/Supabase inserts from failing on shop-owned tables.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE "Shop" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "ShopMembership" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "Customer" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "Vehicle" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "ServiceDefinition" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "VehicleMaintenanceRecord" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "ServiceHistoryRecord" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "OutreachRecord" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "Appointment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "AppointmentService" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "AuditLog" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "DeclinedWorkRecord" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "MaintenanceRevenueOpportunity" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "ImportHistoryRecord" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
ALTER TABLE "ImportRowRecord" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

ALTER TABLE "User" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Shop" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ShopMembership" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Customer" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Vehicle" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ServiceDefinition" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "VehicleMaintenanceRecord" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ServiceHistoryRecord" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "OutreachRecord" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Appointment" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DeclinedWorkRecord" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MaintenanceRevenueOpportunity" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION public.maintiva_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_set_updatedAt" BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
CREATE TRIGGER "Shop_set_updatedAt" BEFORE UPDATE ON "Shop" FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
CREATE TRIGGER "ShopMembership_set_updatedAt" BEFORE UPDATE ON "ShopMembership" FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
CREATE TRIGGER "Customer_set_updatedAt" BEFORE UPDATE ON "Customer" FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
CREATE TRIGGER "Vehicle_set_updatedAt" BEFORE UPDATE ON "Vehicle" FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
CREATE TRIGGER "ServiceDefinition_set_updatedAt" BEFORE UPDATE ON "ServiceDefinition" FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
CREATE TRIGGER "VehicleMaintenanceRecord_set_updatedAt" BEFORE UPDATE ON "VehicleMaintenanceRecord" FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
CREATE TRIGGER "ServiceHistoryRecord_set_updatedAt" BEFORE UPDATE ON "ServiceHistoryRecord" FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
CREATE TRIGGER "OutreachRecord_set_updatedAt" BEFORE UPDATE ON "OutreachRecord" FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
CREATE TRIGGER "Appointment_set_updatedAt" BEFORE UPDATE ON "Appointment" FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
CREATE TRIGGER "DeclinedWorkRecord_set_updatedAt" BEFORE UPDATE ON "DeclinedWorkRecord" FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();
CREATE TRIGGER "MaintenanceRevenueOpportunity_set_updatedAt" BEFORE UPDATE ON "MaintenanceRevenueOpportunity" FOR EACH ROW EXECUTE FUNCTION public.maintiva_set_updated_at();

CREATE OR REPLACE FUNCTION public.maintiva_handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public."User" ("id", "email", "name", "updatedAt")
  VALUES (
    NEW.id::text,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(COALESCE(NEW.email, ''), '@', 1)),
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("id") DO UPDATE
  SET
    "email" = EXCLUDED."email",
    "name" = COALESCE(public."User"."name", EXCLUDED."name"),
    "updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "maintiva_auth_user_created" ON auth.users;
CREATE TRIGGER "maintiva_auth_user_created"
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.maintiva_handle_new_auth_user();

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

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shop" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vehicle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VehicleMaintenanceRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceHistoryRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutreachRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppointmentService" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeclinedWorkRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaintenanceRevenueOpportunity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportHistoryRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportRowRecord" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own user row" ON "User" FOR SELECT TO authenticated USING ("id" = auth.uid()::text);
CREATE POLICY "Users can update own user row" ON "User" FOR UPDATE TO authenticated USING ("id" = auth.uid()::text) WITH CHECK ("id" = auth.uid()::text);
CREATE POLICY "Users can insert own user row" ON "User" FOR INSERT TO authenticated WITH CHECK ("id" = auth.uid()::text);

CREATE POLICY "Members can read their shops" ON "Shop" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("id"));
CREATE POLICY "Members can create shops" ON "Shop" FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Members can update their shops" ON "Shop" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("id")) WITH CHECK (public.maintiva_is_shop_member("id"));
CREATE POLICY "Members can delete their shops" ON "Shop" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("id"));

CREATE POLICY "Members can read shop memberships" ON "ShopMembership" FOR SELECT TO authenticated USING ("userId" = auth.uid()::text OR public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Users can create own active memberships" ON "ShopMembership" FOR INSERT TO authenticated WITH CHECK ("userId" = auth.uid()::text);
CREATE POLICY "Members can update shop memberships" ON "ShopMembership" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete shop memberships" ON "ShopMembership" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read customers" ON "Customer" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert customers" ON "Customer" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update customers" ON "Customer" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete customers" ON "Customer" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read vehicles" ON "Vehicle" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert vehicles" ON "Vehicle" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update vehicles" ON "Vehicle" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete vehicles" ON "Vehicle" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read service definitions" ON "ServiceDefinition" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert service definitions" ON "ServiceDefinition" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update service definitions" ON "ServiceDefinition" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete service definitions" ON "ServiceDefinition" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read maintenance records" ON "VehicleMaintenanceRecord" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert maintenance records" ON "VehicleMaintenanceRecord" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update maintenance records" ON "VehicleMaintenanceRecord" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete maintenance records" ON "VehicleMaintenanceRecord" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read service history" ON "ServiceHistoryRecord" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert service history" ON "ServiceHistoryRecord" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update service history" ON "ServiceHistoryRecord" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete service history" ON "ServiceHistoryRecord" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read outreach records" ON "OutreachRecord" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert outreach records" ON "OutreachRecord" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update outreach records" ON "OutreachRecord" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete outreach records" ON "OutreachRecord" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read appointments" ON "Appointment" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert appointments" ON "Appointment" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update appointments" ON "Appointment" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete appointments" ON "Appointment" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read appointment services" ON "AppointmentService" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert appointment services" ON "AppointmentService" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update appointment services" ON "AppointmentService" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete appointment services" ON "AppointmentService" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read audit logs" ON "AuditLog" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert audit logs" ON "AuditLog" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update audit logs" ON "AuditLog" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete audit logs" ON "AuditLog" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read declined work" ON "DeclinedWorkRecord" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert declined work" ON "DeclinedWorkRecord" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update declined work" ON "DeclinedWorkRecord" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete declined work" ON "DeclinedWorkRecord" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read revenue opportunities" ON "MaintenanceRevenueOpportunity" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert revenue opportunities" ON "MaintenanceRevenueOpportunity" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update revenue opportunities" ON "MaintenanceRevenueOpportunity" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete revenue opportunities" ON "MaintenanceRevenueOpportunity" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read import history" ON "ImportHistoryRecord" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert import history" ON "ImportHistoryRecord" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update import history" ON "ImportHistoryRecord" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete import history" ON "ImportHistoryRecord" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));

CREATE POLICY "Members can read import rows" ON "ImportRowRecord" FOR SELECT TO authenticated USING (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can insert import rows" ON "ImportRowRecord" FOR INSERT TO authenticated WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can update import rows" ON "ImportRowRecord" FOR UPDATE TO authenticated USING (public.maintiva_is_shop_member("shopId")) WITH CHECK (public.maintiva_is_shop_member("shopId"));
CREATE POLICY "Members can delete import rows" ON "ImportRowRecord" FOR DELETE TO authenticated USING (public.maintiva_is_shop_member("shopId"));
