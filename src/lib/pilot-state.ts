import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  calculateAppointmentTotals,
  serviceDefinitions as defaultServices,
  type Appointment,
  type Customer,
  type DeclinedWorkRecord,
  type DemoState,
  type ImportHistoryRecord,
  type MaintenanceService,
  type OutreachRecord,
  type Vehicle,
  type VehicleMaintenanceRecord,
} from "@/lib/demo-data";
import { assertSameShop, type AuthenticatedShopContext } from "@/lib/auth";
import { customerSchema, vehicleSchema } from "@/lib/validation";

const onboardingSchema = z.object({
  shopName: z.string().min(2),
  phone: z.string().optional(),
  email: z.email().optional().or(z.literal("")),
  address: z.string().optional(),
  timezone: z.string().min(3).default("America/New_York"),
  dailyBayHours: z.number().int().min(1).max(200).default(64),
});

export type OnboardingInput = z.input<typeof onboardingSchema>;

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `shop-${Date.now()}`;
}

function iso(date: Date | string | null | undefined) {
  if (!date) return "";
  return typeof date === "string" ? date : date.toISOString();
}

function dateOnly(date: Date | string | null | undefined) {
  return iso(date).slice(0, 10);
}

export async function seedDefaultServicesForShop(shopId: string) {
  await prisma.serviceDefinition.createMany({
    data: defaultServices.map((service) => ({
      shopId,
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
    skipDuplicates: true,
  });
}

export async function createPilotShopForUser({
  userId,
  email,
  input,
}: {
  userId: string;
  email: string;
  input: OnboardingInput;
}) {
  const parsed = onboardingSchema.parse(input);
  const baseSlug = slugify(parsed.shopName);
  let slug = baseSlug;
  let suffix = 1;

  while (await prisma.shop.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  const shop = await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email,
        name: email.split("@")[0],
      },
      update: {
        email,
      },
    });

    const created = await tx.shop.create({
      data: {
        name: parsed.shopName,
        slug,
        phone: parsed.phone || null,
        email: parsed.email || null,
        address: parsed.address || null,
        timezone: parsed.timezone,
        dailyBayHours: parsed.dailyBayHours,
        status: "ACTIVE",
        onboardingCompletedAt: new Date(),
        memberships: {
          create: {
            userId,
            role: "OWNER",
          },
        },
      },
    });

    await tx.auditLog.create({
      data: {
        shopId: created.id,
        actorUserId: userId,
        action: "shop.onboarded",
        entityType: "Shop",
        entityId: created.id,
      },
    });

    return created;
  });

  await seedDefaultServicesForShop(shop.id);
  return shop;
}

export async function buildPilotState(context: AuthenticatedShopContext): Promise<DemoState> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: context.shopId },
    include: {
      memberships: { include: { user: true }, where: { isActive: true } },
      customers: { where: { archivedAt: null }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] },
      vehicles: { where: { archivedAt: null }, orderBy: [{ make: "asc" }, { model: "asc" }] },
      serviceDefinitions: { orderBy: { name: "asc" } },
      maintenanceRecords: { where: { archivedAt: null }, orderBy: { updatedAt: "desc" } },
      serviceHistoryRecords: { orderBy: { completedAt: "desc" } },
      declinedWorkRecords: { orderBy: { declinedAt: "desc" } },
      outreachRecords: { orderBy: { createdAt: "desc" } },
      importHistory: { orderBy: { importedAt: "desc" } },
      appointments: {
        include: { services: true },
        orderBy: { scheduledStart: "asc" },
      },
    },
  });
  assertSameShop(context, shop.id);

  const services: MaintenanceService[] = shop.serviceDefinitions.map((service) => ({
    id: service.id,
    shopId: service.shopId,
    name: service.name,
    category: service.category,
    defaultMileageInterval: service.defaultMileageInterval,
    defaultTimeIntervalMonths: service.defaultTimeIntervalMonths,
    defaultNotificationThreshold: service.defaultNotificationThreshold,
    estimatedLaborMinutes: service.estimatedLaborMinutes,
    defaultPriceCents: service.defaultPriceCents,
    description: service.description ?? "",
    isActive: service.isActive,
  }));

  return {
    shop: {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      phone: shop.phone ?? "",
      email: shop.email ?? "",
      address: shop.address ?? "",
      timezone: shop.timezone,
      dailyBayHours: shop.dailyBayHours,
      isDemo: shop.isDemo,
      onboardingCompletedAt: iso(shop.onboardingCompletedAt) || null,
    },
    users: shop.memberships.map((membership) => ({
      id: membership.userId,
      shopId: membership.shopId,
      name: membership.user.name ?? membership.user.email,
      email: membership.user.email,
      role: membership.role,
    })),
    customers: shop.customers.map((customer): Customer => ({
      id: customer.id,
      shopId: customer.shopId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      preferredContact: customer.preferredContact,
      smsConsent: customer.smsConsent,
      emailConsent: customer.emailConsent,
      callConsent: customer.callConsent,
      address: customer.address ?? "",
      notes: customer.notes ?? "",
      status: customer.status,
      customerScore: customer.customerScore,
      lifetimeRevenueCents: customer.lifetimeRevenueCents,
      lastVisit: dateOnly(customer.lastVisit || customer.updatedAt),
    })),
    vehicles: shop.vehicles.map((vehicle): Vehicle => ({
      id: vehicle.id,
      shopId: vehicle.shopId,
      customerId: vehicle.customerId,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      vin: vehicle.vin ?? "",
      licensePlate: vehicle.licensePlate ?? "",
      engine: vehicle.engine ?? "",
      trim: vehicle.trim ?? "",
      vehicleType: vehicle.vehicleType ?? "Passenger vehicle",
      currentMileage: vehicle.currentMileage,
      estimatedAnnualMileage: vehicle.estimatedAnnualMileage ?? 12_000,
      overallHealth: vehicle.overallHealth,
      lastServiceDate: dateOnly(vehicle.lastServiceDate || vehicle.updatedAt),
    })),
    services,
    maintenanceRecords: shop.maintenanceRecords.map((record): VehicleMaintenanceRecord => ({
      id: record.id,
      shopId: record.shopId,
      vehicleId: record.vehicleId,
      serviceId: record.serviceDefinitionId,
      serviceName: record.serviceName,
      lastCompletedDate: dateOnly(record.lastCompletedDate || record.createdAt),
      lastCompletedMileage: record.lastCompletedMileage ?? 0,
      recommendedMileageInterval: record.recommendedMileageInterval,
      recommendedTimeIntervalMonths: record.recommendedTimeIntervalMonths,
      priceCents: record.priceCents,
      laborHours: record.laborMinutes / 60,
      notificationThreshold: record.notificationThreshold,
      outreachStatus: record.outreachStatus,
      outreachRecordId: record.outreachRecordId ?? undefined,
      appointmentId: record.appointmentId ?? undefined,
    })),
    serviceRecords: shop.serviceHistoryRecords.map((record) => ({
      id: record.id,
      shopId: record.shopId,
      customerId: record.customerId,
      vehicleId: record.vehicleId,
      serviceName: record.serviceName,
      completedAt: dateOnly(record.completedAt),
      mileage: record.mileage ?? 0,
      priceCents: record.priceCents,
      notes: record.notes ?? "",
    })),
    declinedWorkRecords: shop.declinedWorkRecords.map((record): DeclinedWorkRecord => ({
      id: record.id,
      shopId: record.shopId,
      customerId: record.customerId,
      vehicleId: record.vehicleId,
      serviceName: record.serviceName,
      declinedAt: iso(record.declinedAt),
      recommendedPriceCents: record.recommendedPriceCents,
      laborHours: record.laborMinutes / 60,
      advisorNotes: record.advisorNotes ?? "",
      status: record.status,
      outreachStatus: record.outreachStatus,
      appointmentId: record.appointmentId ?? undefined,
    })),
    outreachRecords: shop.outreachRecords.map((record): OutreachRecord => ({
      id: record.id,
      shopId: record.shopId,
      customerId: record.customerId,
      vehicleId: record.vehicleId,
      maintenanceRecordIds: shop.maintenanceRecords
        .filter((item) => item.outreachRecordId === record.id)
        .map((item) => item.id),
      serviceNames: shop.maintenanceRecords
        .filter((item) => item.outreachRecordId === record.id)
        .map((item) => item.serviceName),
      message: record.message,
      channel: record.channel,
      sentAt: iso(record.manuallySentAt || record.createdAt),
      copiedAt: iso(record.copiedAt) || undefined,
      manuallySentAt: iso(record.manuallySentAt) || undefined,
      responseStatus: record.responseStatus,
      followUpDate: iso(record.followUpDate) || undefined,
      appointmentId: record.appointmentId ?? undefined,
      performedByUserId: record.performedByUserId ?? undefined,
      status: record.status,
    })),
    appointments: shop.appointments.map((appointment): Appointment => ({
      id: appointment.id,
      shopId: appointment.shopId,
      customerId: appointment.customerId,
      vehicleId: appointment.vehicleId,
      maintenanceRecordIds: appointment.services
        .map((service) => service.maintenanceRecordId)
        .filter((id): id is string => Boolean(id)),
      serviceNames: appointment.services.map((service) => service.serviceName),
      scheduledStart: iso(appointment.scheduledStart),
      scheduledEnd: iso(appointment.scheduledEnd),
      status: appointment.status,
      totalPriceCents: appointment.totalPriceCents,
      totalLaborHours: appointment.totalLaborMinutes / 60,
      source: appointment.source,
      attributionSource: appointment.attributionSource,
      opportunityId: appointment.opportunityId ?? undefined,
      outreachRecordId: appointment.outreachRecordId ?? undefined,
      completedRevenueCents: appointment.completedRevenueCents ?? undefined,
      completedLaborHours: appointment.completedLaborMinutes ? appointment.completedLaborMinutes / 60 : undefined,
      completedAt: iso(appointment.completedAt) || undefined,
      notes: appointment.notes ?? "",
    })),
    importHistory: shop.importHistory.map((record): ImportHistoryRecord => ({
      id: record.id,
      shopId: record.shopId,
      userId: record.userId ?? "",
      fileName: record.fileName,
      importType: record.importType,
      status: record.status,
      importedAt: iso(record.importedAt),
      totalRows: record.totalRows,
      successfulRows: record.successfulRows,
      duplicateRows: record.duplicateRows,
      updatedRows: record.updatedRows,
      skippedRows: record.skippedRows,
      failedRows: record.failedRows,
      errorReportUrl: record.errorReportUrl ?? undefined,
    })),
    seededAt: new Date().toISOString(),
  };
}

export async function addPilotCustomer(context: AuthenticatedShopContext, input: unknown) {
  const parsed = customerSchema.parse(input);
  await prisma.customer.create({
    data: {
      shopId: context.shopId,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      phone: parsed.phone || null,
      email: parsed.email || null,
      preferredContact: parsed.preferredContact,
      smsConsent: parsed.smsConsent,
      emailConsent: parsed.emailConsent,
      callConsent: parsed.callConsent,
      address: parsed.address || null,
      notes: parsed.notes || null,
      status: parsed.status,
      lastVisit: new Date(),
    },
  });
}

export async function updatePilotCustomer(
  context: AuthenticatedShopContext,
  customerId: string,
  input: unknown,
) {
  const existing = await prisma.customer.findUnique({ where: { id: customerId } });
  assertSameShop(context, existing?.shopId);
  const parsed = customerSchema.partial().parse(input);
  await prisma.customer.update({
    where: { id: customerId },
    data: parsed,
  });
}

export async function addPilotVehicle(context: AuthenticatedShopContext, input: unknown) {
  const parsed = vehicleSchema.extend({
    engine: z.string().optional(),
    trim: z.string().optional(),
    estimatedAnnualMileage: z.number().int().nonnegative().optional(),
  }).parse(input);
  const customer = await prisma.customer.findUnique({ where: { id: parsed.customerId } });
  assertSameShop(context, customer?.shopId);
  const vehicle = await prisma.vehicle.create({
    data: {
      shopId: context.shopId,
      customerId: parsed.customerId,
      year: parsed.year,
      make: parsed.make,
      model: parsed.model,
      vin: parsed.vin || null,
      engine: parsed.engine || null,
      trim: parsed.trim || null,
      currentMileage: parsed.currentMileage,
      estimatedAnnualMileage: parsed.estimatedAnnualMileage ?? 12_000,
      lastServiceDate: new Date(),
    },
  });

  const services = await prisma.serviceDefinition.findMany({
    where: { shopId: context.shopId, isActive: true },
    take: 6,
  });

  await prisma.vehicleMaintenanceRecord.createMany({
    data: services.map((service) => ({
      shopId: context.shopId,
      vehicleId: vehicle.id,
      serviceDefinitionId: service.id,
      serviceName: service.name,
      lastCompletedDate: new Date(),
      lastCompletedMileage: parsed.currentMileage,
      recommendedMileageInterval: service.defaultMileageInterval,
      recommendedTimeIntervalMonths: service.defaultTimeIntervalMonths,
      notificationThreshold: service.defaultNotificationThreshold,
      priceCents: service.defaultPriceCents,
      laborMinutes: service.estimatedLaborMinutes,
      status: "HEALTHY" as const,
    })),
  });
}

export async function updatePilotVehicle(
  context: AuthenticatedShopContext,
  vehicleId: string,
  input: unknown,
) {
  const existing = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  assertSameShop(context, existing?.shopId);
  const parsed = vehicleSchema.partial().omit({ customerId: true }).parse(input);
  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: parsed,
  });
}

export async function markPilotOutreachManuallySent(
  context: AuthenticatedShopContext,
  input: {
    customerId: string;
    vehicleId: string;
    maintenanceRecordIds: string[];
    message: string;
    channel?: OutreachRecord["channel"];
    responseStatus?: OutreachRecord["responseStatus"];
  },
) {
  const records = await prisma.vehicleMaintenanceRecord.findMany({
    where: {
      id: { in: input.maintenanceRecordIds },
      shopId: context.shopId,
    },
  });
  if (records.length !== input.maintenanceRecordIds.length) {
    throw new Error("One or more selected services are unavailable.");
  }
  records.forEach((record) => assertSameShop(context, record.shopId));
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  const vehicle = await prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
  assertSameShop(context, customer?.shopId);
  assertSameShop(context, vehicle?.shopId);
  if (!vehicle || vehicle.customerId !== input.customerId) {
    throw new Error("Vehicle does not belong to the selected customer.");
  }
  if (records.some((record) => record.vehicleId !== input.vehicleId)) {
    throw new Error("Selected services do not belong to the selected vehicle.");
  }

  await prisma.$transaction(async (tx) => {
    const outreach = await tx.outreachRecord.create({
      data: {
        shopId: context.shopId,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        message: input.message,
        channel: input.channel ?? "TEXT",
        status: "MANUALLY_SENT",
        responseStatus: input.responseStatus ?? "NO_RESPONSE",
        copiedAt: new Date(),
        manuallySentAt: new Date(),
        performedByUserId: context.userId,
      },
    });
    await tx.vehicleMaintenanceRecord.updateMany({
      where: { id: { in: input.maintenanceRecordIds }, shopId: context.shopId },
      data: {
        outreachStatus: "MANUALLY_SENT",
        outreachRecordId: outreach.id,
      },
    });
  });
}

export async function bookPilotAppointment(
  context: AuthenticatedShopContext,
  input: {
    customerId: string;
    vehicleId: string;
    maintenanceRecordIds: string[];
    date: string;
    time: string;
    status: Appointment["status"];
    notes?: string;
  },
) {
  const records = await prisma.vehicleMaintenanceRecord.findMany({
    where: { id: { in: input.maintenanceRecordIds }, shopId: context.shopId },
  });
  if (records.length !== input.maintenanceRecordIds.length) {
    throw new Error("One or more selected services are unavailable.");
  }
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  const vehicle = await prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
  assertSameShop(context, customer?.shopId);
  assertSameShop(context, vehicle?.shopId);
  if (!vehicle || vehicle.customerId !== input.customerId) {
    throw new Error("Vehicle does not belong to the selected customer.");
  }
  if (records.some((record) => record.vehicleId !== input.vehicleId)) {
    throw new Error("Selected services do not belong to the selected vehicle.");
  }
  const totals = calculateAppointmentTotals(
    records.map((record) => ({
      id: record.id,
      shopId: record.shopId,
      vehicleId: record.vehicleId,
      serviceId: record.serviceDefinitionId,
      serviceName: record.serviceName,
      lastCompletedDate: dateOnly(record.lastCompletedDate || record.createdAt),
      lastCompletedMileage: record.lastCompletedMileage ?? 0,
      recommendedMileageInterval: record.recommendedMileageInterval,
      recommendedTimeIntervalMonths: record.recommendedTimeIntervalMonths,
      priceCents: record.priceCents,
      laborHours: record.laborMinutes / 60,
      notificationThreshold: record.notificationThreshold,
      outreachStatus: record.outreachStatus,
    })),
  );
  const scheduledStart = new Date(`${input.date}T${input.time}:00`);
  const scheduledEnd = new Date(scheduledStart.getTime() + totals.recommendedHours * 60 * 60 * 1000);
  const duplicateAppointment = await prisma.appointment.findFirst({
    where: {
      shopId: context.shopId,
      vehicleId: input.vehicleId,
      scheduledStart,
      status: {
        notIn: ["CANCELLED", "NO_SHOW"],
      },
    },
  });

  if (duplicateAppointment) {
    throw new Error("This vehicle already has an appointment at that time.");
  }

  await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.create({
      data: {
        shopId: context.shopId,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        scheduledStart,
        scheduledEnd,
        status: input.status,
        totalLaborMinutes: Math.round(totals.recommendedHours * 60),
        totalPriceCents: totals.totalPriceCents,
        source: "AUTOMATION",
        attributionSource: "MAINTIVA_OUTREACH",
        notes: input.notes,
        services: {
          create: records.map((record) => ({
            shopId: context.shopId,
            serviceDefinitionId: record.serviceDefinitionId,
            maintenanceRecordId: record.id,
            serviceName: record.serviceName,
            laborMinutes: record.laborMinutes,
            priceCents: record.priceCents,
          })),
        },
      },
    });
    await tx.vehicleMaintenanceRecord.updateMany({
      where: { id: { in: input.maintenanceRecordIds }, shopId: context.shopId },
      data: {
        outreachStatus: "SCHEDULED",
        appointmentId: appointment.id,
      },
    });
  });
}
