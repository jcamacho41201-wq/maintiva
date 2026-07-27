import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  customers,
  demoShop,
  demoUsers,
  maintenanceItems,
  mileageReadings,
  serviceDefinitions,
  vehicles,
} from "../src/lib/demo-data";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? "",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.auditLog.deleteMany();
  await prisma.communication.deleteMany();
  await prisma.automationQueueItem.deleteMany();
  await prisma.vehicleMaintenanceItem.deleteMany();
  await prisma.mileageReading.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.serviceDefinition.deleteMany();
  await prisma.automationRule.deleteMany();
  await prisma.user.deleteMany();
  await prisma.shop.deleteMany();

  await prisma.shop.create({
    data: {
      id: demoShop.id,
      name: demoShop.name,
      slug: demoShop.slug,
      timezone: demoShop.timezone,
      dailyBayHours: demoShop.dailyBayHours,
    },
  });

  const passwordHash = await hash("demo-password", 12);
  await prisma.user.createMany({
    data: demoUsers.map((user) => ({
      id: user.id,
      shopId: user.shopId,
      name: user.name,
      email: user.email,
      role: user.role as "OWNER" | "SERVICE_ADVISOR",
      passwordHash,
    })),
  });

  await prisma.automationRule.create({
    data: {
      shopId: demoShop.id,
      name: "Prevent duplicate bundled outreach",
      channelOrder: ["SMS", "EMAIL", "CALL"],
      minDaysBetweenContacts: 14,
      maxAttempts: 3,
      escalateAfterDays: 7,
      stopAfterAppointmentBooked: true,
    },
  });

  await prisma.serviceDefinition.createMany({
    data: serviceDefinitions.map((service) => ({
      id: service.id,
      shopId: service.shopId,
      name: service.name,
      category: service.category,
      defaultMileageInterval: service.defaultMileageInterval,
      defaultTimeIntervalMonths: service.defaultTimeIntervalMonths,
      defaultNotificationThreshold: service.defaultNotificationThreshold,
      estimatedLaborMinutes: service.estimatedLaborMinutes,
      defaultPriceCents: service.defaultPriceCents,
      description: service.description,
      isActive: service.isActive,
    })),
  });

  await prisma.customer.createMany({
    data: customers.map((customer) => ({
      id: customer.id,
      shopId: customer.shopId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
      email: customer.email,
      preferredContact: customer.preferredContact as "SMS" | "EMAIL" | "CALL",
      smsConsent: customer.smsConsent,
      emailConsent: customer.emailConsent,
      callConsent: customer.callConsent,
      notes: customer.notes,
      status: customer.status as "ACTIVE" | "WATCHLIST" | "PAUSED",
      customerScore: customer.customerScore,
      lifetimeRevenueCents: customer.lifetimeRevenueCents,
    })),
  });

  await prisma.vehicle.createMany({
    data: vehicles.map((vehicle) => ({
      id: vehicle.id,
      shopId: vehicle.shopId,
      customerId: vehicle.customerId,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      vin: vehicle.vin,
      engine: vehicle.engine,
      trim: vehicle.trim,
      vehicleType: "Passenger vehicle",
      estimatedAnnualMileage: vehicle.estimatedAnnualMileage,
      overallHealth: vehicle.overallHealth,
    })),
  });

  for (const [vehicleId, readings] of Object.entries(mileageReadings)) {
    await prisma.mileageReading.createMany({
      data: readings.map((reading) => ({
        shopId: demoShop.id,
        vehicleId,
        mileage: reading.mileage,
        recordedAt: new Date(reading.recordedAt),
        source: reading.source as
          | "SHOP_REPAIR_ORDER"
          | "CUSTOMER_SMS"
          | "CUSTOMER_PORTAL"
          | "MANUAL_ENTRY"
          | "IMPORTED"
          | "ESTIMATED",
        confidence: reading.confidence,
        createdById: demoUsers[0].id,
      })),
    });
  }

  await prisma.vehicleMaintenanceItem.createMany({
    data: maintenanceItems.map((item) => ({
      id: item.id,
      shopId: item.shopId,
      vehicleId: item.vehicleId,
      serviceDefinitionId: item.serviceDefinitionId,
      lastCompletedDate: new Date(item.lastCompletedDate),
      lastCompletedMileage: item.lastCompletedMileage,
      recommendedMileageInterval: item.recommendedMileageInterval,
      recommendedTimeIntervalMonths: item.recommendedTimeIntervalMonths,
      notificationThreshold: item.notificationThreshold,
      estimatedLaborMinutes: item.estimatedLaborMinutes,
      estimatedPriceCents: item.estimatedPriceCents,
      status: item.status as "HEALTHY" | "DUE_SOON" | "OVERDUE",
      mechanicRemainingPercentage: item.mechanicRemainingPercentage,
      communicationStatus: "NOT_CONTACTED",
    })),
  });

  await prisma.auditLog.create({
    data: {
      shopId: demoShop.id,
      actorUserId: demoUsers[0].id,
      action: "seed.demo_data.created",
      entityType: "Shop",
      entityId: demoShop.id,
      metadata: { environment: "development" },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
