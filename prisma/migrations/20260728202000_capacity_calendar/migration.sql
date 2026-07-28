ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'TENTATIVE';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

CREATE INDEX IF NOT EXISTS "Appointment_shopId_status_idx" ON "Appointment"("shopId", "status");
CREATE INDEX IF NOT EXISTS "Appointment_shopId_customerId_scheduledStart_idx" ON "Appointment"("shopId", "customerId", "scheduledStart");
CREATE INDEX IF NOT EXISTS "Appointment_shopId_vehicleId_scheduledStart_idx" ON "Appointment"("shopId", "vehicleId", "scheduledStart");
CREATE INDEX IF NOT EXISTS "Appointment_shopId_opportunityId_idx" ON "Appointment"("shopId", "opportunityId");
