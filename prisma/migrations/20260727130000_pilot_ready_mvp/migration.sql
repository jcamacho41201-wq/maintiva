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
