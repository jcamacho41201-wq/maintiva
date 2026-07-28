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
