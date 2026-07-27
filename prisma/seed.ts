import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  appointments,
  customers,
  demoShop,
  demoUsers,
  maintenanceItems,
  serviceDefinitions,
  serviceRecords,
  vehicles,
  outreachRecords,
} from "../src/lib/demo-data";
import { getRecordStatus } from "../src/lib/demo-calculations";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? "",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.auditLog.deleteMany();
  await prisma.appointmentService.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.vehicleMaintenanceRecord.deleteMany();
  await prisma.outreachRecord.deleteMany();
  await prisma.serviceHistoryRecord.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.serviceDefinition.deleteMany();
  await prisma.shopMembership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.shop.deleteMany();

  await prisma.shop.create({
    data: {
      id: demoShop.id,
      name: demoShop.name,
      slug: demoShop.slug,
      phone: demoShop.phone,
      email: demoShop.email,
      address: demoShop.address,
      timezone: demoShop.timezone,
      dailyBayHours: demoShop.dailyBayHours,
      isDemo: true,
      status: "ACTIVE",
      onboardingCompletedAt: new Date(demoShop.onboardingCompletedAt ?? new Date()),
    },
  });

  await prisma.user.createMany({
    data: demoUsers.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
    })),
  });

  await prisma.shopMembership.createMany({
    data: demoUsers.map((user) => ({
      shopId: user.shopId,
      userId: user.id,
      role: user.role,
    })),
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
      preferredContact: customer.preferredContact,
      smsConsent: customer.smsConsent,
      emailConsent: customer.emailConsent,
      callConsent: customer.callConsent,
      address: customer.address,
      notes: customer.notes,
      status: customer.status,
      customerScore: customer.customerScore,
      lifetimeRevenueCents: customer.lifetimeRevenueCents,
      lastVisit: new Date(customer.lastVisit),
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
      licensePlate: vehicle.licensePlate,
      engine: vehicle.engine,
      trim: vehicle.trim,
      vehicleType: vehicle.vehicleType,
      currentMileage: vehicle.currentMileage,
      estimatedAnnualMileage: vehicle.estimatedAnnualMileage,
      overallHealth: vehicle.overallHealth,
      lastServiceDate: new Date(vehicle.lastServiceDate),
    })),
  });

  for (const record of serviceRecords) {
    const definition = await prisma.serviceDefinition.findFirst({
      where: { shopId: record.shopId, name: record.serviceName },
    });
    await prisma.serviceHistoryRecord.create({
      data: {
        id: record.id,
        shopId: record.shopId,
        customerId: record.customerId,
        vehicleId: record.vehicleId,
        serviceDefinitionId: definition?.id,
        serviceName: record.serviceName,
        completedAt: new Date(record.completedAt),
        mileage: record.mileage,
        priceCents: record.priceCents,
        notes: record.notes,
      },
    });
  }

  await prisma.outreachRecord.createMany({
    data: outreachRecords.map((record) => ({
      id: record.id,
      shopId: record.shopId,
      customerId: record.customerId,
      vehicleId: record.vehicleId,
      message: record.message,
      channel: record.channel,
      status: record.status,
      copiedAt: record.copiedAt ? new Date(record.copiedAt) : null,
      manuallySentAt: record.manuallySentAt ? new Date(record.manuallySentAt) : null,
      createdAt: new Date(record.sentAt),
    })),
  });

  await prisma.vehicleMaintenanceRecord.createMany({
    data: maintenanceItems.map((item) => {
      const status = getRecordStatus(
        {
          shop: demoShop,
          users: demoUsers,
          customers,
          vehicles,
          services: serviceDefinitions,
          maintenanceRecords: maintenanceItems,
          serviceRecords,
          outreachRecords,
          appointments,
          seededAt: new Date().toISOString(),
        },
        item,
      ).status;

      return {
        id: item.id,
        shopId: item.shopId,
        vehicleId: item.vehicleId,
        serviceDefinitionId: item.serviceId,
        serviceName: item.serviceName,
        lastCompletedDate: new Date(item.lastCompletedDate),
        lastCompletedMileage: item.lastCompletedMileage,
        recommendedMileageInterval: item.recommendedMileageInterval,
        recommendedTimeIntervalMonths: item.recommendedTimeIntervalMonths,
        notificationThreshold: item.notificationThreshold,
        laborMinutes: Math.round(item.laborHours * 60),
        priceCents: item.priceCents,
        status,
        outreachStatus: item.outreachStatus,
        outreachRecordId: item.outreachRecordId,
      };
    }),
  });

  for (const appointment of appointments) {
    await prisma.appointment.create({
      data: {
        id: appointment.id,
        shopId: appointment.shopId,
        customerId: appointment.customerId,
        vehicleId: appointment.vehicleId,
        scheduledStart: new Date(appointment.scheduledStart),
        scheduledEnd: new Date(appointment.scheduledEnd),
        status: appointment.status,
        totalLaborMinutes: Math.round(appointment.totalLaborHours * 60),
        totalPriceCents: appointment.totalPriceCents,
        source: appointment.source,
        notes: appointment.notes,
        services: {
          create: appointment.maintenanceRecordIds.map((maintenanceRecordId) => {
            const item = maintenanceItems.find((record) => record.id === maintenanceRecordId);
            return {
              shopId: appointment.shopId,
              serviceDefinitionId: item?.serviceId,
              maintenanceRecordId,
              serviceName: item?.serviceName ?? "Service",
              laborMinutes: item ? Math.round(item.laborHours * 60) : 0,
              priceCents: item?.priceCents ?? 0,
            };
          }),
        },
      },
    });
  }

  for (const item of maintenanceItems.filter((record) => record.appointmentId)) {
    await prisma.vehicleMaintenanceRecord.update({
      where: { id: item.id },
      data: { appointmentId: item.appointmentId },
    });
  }

  await prisma.auditLog.create({
    data: {
      shopId: demoShop.id,
      actorUserId: demoUsers[0].id,
      action: "seed.demo_data.created",
      entityType: "Shop",
      entityId: demoShop.id,
      metadata: { environment: "development", auth: "supabase" },
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
