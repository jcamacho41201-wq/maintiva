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
import {
  previewImport,
  summarizeImport,
  type CsvRow,
  type DuplicateImportMode,
  type ImportRowAction,
  type ImportType,
  type MaintivaField,
} from "@/lib/csv-import";
import {
  dateKeyInTimeZone,
  minutesInZone,
  zonedDateTimeToIso,
} from "@/lib/calendar";

const onboardingSchema = z.object({
  shopName: z.string().min(2),
  phone: z.string().optional(),
  email: z.email().optional().or(z.literal("")),
  address: z.string().optional(),
  timezone: z.string().min(3).default("America/New_York"),
  dailyBayHours: z.number().int().min(1).max(200).default(64),
});

export type OnboardingInput = z.input<typeof onboardingSchema>;

const appointmentStatusSchema = z.enum([
  "TENTATIVE",
  "SCHEDULED",
  "REQUESTED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

const appointmentAttributionSchema = z.enum([
  "MAINTIVA_OUTREACH",
  "MANUAL_SHOP_ENTRY",
  "IMPORTED_APPOINTMENT",
  "OTHER",
]);

const appointmentSourceSchema = z.enum([
  "AUTOMATION",
  "CUSTOMER_BOOKING",
  "MANUAL",
  "IMPORTED",
]);

const calendarAppointmentSchema = z.object({
  customerId: z.string().min(1),
  vehicleId: z.string().min(1),
  maintenanceRecordIds: z.array(z.string().min(1)).default([]),
  declinedWorkRecordIds: z.array(z.string().min(1)).default([]),
  serviceDefinitionIds: z.array(z.string().min(1)).default([]),
  opportunityId: z.string().optional(),
  outreachRecordId: z.string().optional(),
  date: z.string().min(8),
  time: z.string().min(4),
  status: appointmentStatusSchema.default("SCHEDULED"),
  source: appointmentSourceSchema.default("MANUAL"),
  attributionSource: appointmentAttributionSchema.default("MANUAL_SHOP_ENTRY"),
  totalLaborHours: z.number().positive(),
  totalPriceCents: z.number().int().nonnegative(),
  notes: z.string().optional(),
});

const appointmentUpdateSchema = z.object({
  appointmentId: z.string().min(1),
  date: z.string().min(8).optional(),
  time: z.string().min(4).optional(),
  durationMinutes: z.number().int().positive().optional(),
  totalLaborHours: z.number().positive().optional(),
  totalPriceCents: z.number().int().nonnegative().optional(),
  status: appointmentStatusSchema.optional(),
  notes: z.string().optional(),
});

const opportunitySnoozeSchema = z.object({
  maintenanceRecordIds: z.array(z.string().min(1)).default([]),
  declinedWorkRecordIds: z.array(z.string().min(1)).default([]),
  followUpDate: z.string().min(8),
});

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

function stringValue(record: Record<string, string | number>, key: string) {
  return String(record[key] ?? "").trim();
}

function numberValue(record: Record<string, string | number>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function appointmentDateTime(date: string, time: string, timeZone: string) {
  if (!date || !time) return undefined;
  const parsed = new Date(zonedDateTimeToIso(date, time, timeZone));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function timeKeyInTimeZone(date: Date | string, timeZone: string) {
  const minutes = minutesInZone(date, timeZone);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function appointmentEnd(start: Date, laborHours: number) {
  return new Date(start.getTime() + Math.round(laborHours * 60) * 60_000);
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
  const scheduledStart = appointmentDateTime(input.date, input.time, context.timezone);
  if (!scheduledStart) throw new Error("Appointment date and time are invalid.");
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

export async function createPilotCalendarAppointment(
  context: AuthenticatedShopContext,
  input: unknown,
) {
  const parsed = calendarAppointmentSchema.parse(input);
  const customer = await prisma.customer.findUnique({ where: { id: parsed.customerId } });
  const vehicle = await prisma.vehicle.findUnique({ where: { id: parsed.vehicleId } });
  assertSameShop(context, customer?.shopId);
  assertSameShop(context, vehicle?.shopId);
  if (!vehicle || vehicle.customerId !== parsed.customerId) {
    throw new Error("Vehicle does not belong to the selected customer.");
  }

  const [maintenanceRecords, declinedWorkRecords, serviceDefinitions, outreachRecord] = await Promise.all([
    prisma.vehicleMaintenanceRecord.findMany({
      where: { id: { in: parsed.maintenanceRecordIds }, shopId: context.shopId },
    }),
    prisma.declinedWorkRecord.findMany({
      where: { id: { in: parsed.declinedWorkRecordIds }, shopId: context.shopId },
    }),
    prisma.serviceDefinition.findMany({
      where: { id: { in: parsed.serviceDefinitionIds }, shopId: context.shopId, isActive: true },
    }),
    parsed.outreachRecordId
      ? prisma.outreachRecord.findUnique({ where: { id: parsed.outreachRecordId } })
      : Promise.resolve(null),
  ]);

  if (maintenanceRecords.length !== parsed.maintenanceRecordIds.length) {
    throw new Error("One or more selected maintenance services are unavailable.");
  }
  if (declinedWorkRecords.length !== parsed.declinedWorkRecordIds.length) {
    throw new Error("One or more declined-work services are unavailable.");
  }
  if (serviceDefinitions.length !== parsed.serviceDefinitionIds.length) {
    throw new Error("One or more selected services are unavailable.");
  }
  if (outreachRecord) assertSameShop(context, outreachRecord.shopId);
  if (maintenanceRecords.some((record) => record.vehicleId !== parsed.vehicleId)) {
    throw new Error("Selected maintenance services do not belong to the selected vehicle.");
  }
  if (declinedWorkRecords.some((record) => record.vehicleId !== parsed.vehicleId)) {
    throw new Error("Selected declined work does not belong to the selected vehicle.");
  }

  const serviceRows = [
    ...serviceDefinitions.map((service) => ({
      serviceDefinitionId: service.id,
      maintenanceRecordId: null,
      serviceName: service.name,
      laborMinutes: service.estimatedLaborMinutes,
      priceCents: service.defaultPriceCents,
    })),
    ...maintenanceRecords.map((record) => ({
      serviceDefinitionId: record.serviceDefinitionId,
      maintenanceRecordId: record.id,
      serviceName: record.serviceName,
      laborMinutes: record.laborMinutes,
      priceCents: record.priceCents,
    })),
    ...declinedWorkRecords.map((record) => ({
      serviceDefinitionId: null,
      maintenanceRecordId: null,
      serviceName: record.serviceName,
      laborMinutes: record.laborMinutes,
      priceCents: record.recommendedPriceCents,
    })),
  ].filter((row, index, rows) =>
    rows.findIndex((candidate) => candidate.serviceName === row.serviceName) === index,
  );

  if (serviceRows.length === 0) {
    throw new Error("Select at least one service.");
  }

  const scheduledStart = appointmentDateTime(parsed.date, parsed.time, context.timezone);
  if (!scheduledStart) throw new Error("Appointment date and time are invalid.");
  const scheduledEnd = appointmentEnd(scheduledStart, parsed.totalLaborHours);
  const duplicateAppointment = await prisma.appointment.findFirst({
    where: {
      shopId: context.shopId,
      vehicleId: parsed.vehicleId,
      scheduledStart,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
  });

  if (duplicateAppointment) {
    throw new Error("This vehicle already has an appointment at that time.");
  }

  await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.create({
      data: {
        shopId: context.shopId,
        customerId: parsed.customerId,
        vehicleId: parsed.vehicleId,
        scheduledStart,
        scheduledEnd,
        status: parsed.status,
        totalLaborMinutes: Math.round(parsed.totalLaborHours * 60),
        totalPriceCents: parsed.totalPriceCents,
        source: parsed.source,
        attributionSource: parsed.attributionSource,
        opportunityId: parsed.opportunityId,
        outreachRecordId: parsed.outreachRecordId,
        notes: parsed.notes,
        services: {
          create: serviceRows.map((service) => ({
            shopId: context.shopId,
            ...service,
          })),
        },
      },
    });

    if (parsed.maintenanceRecordIds.length > 0) {
      await tx.vehicleMaintenanceRecord.updateMany({
        where: { id: { in: parsed.maintenanceRecordIds }, shopId: context.shopId },
        data: {
          outreachStatus: "SCHEDULED",
          appointmentId: appointment.id,
        },
      });
    }
    if (parsed.declinedWorkRecordIds.length > 0) {
      await tx.declinedWorkRecord.updateMany({
        where: { id: { in: parsed.declinedWorkRecordIds }, shopId: context.shopId },
        data: {
          status: "BOOKED",
          outreachStatus: "SCHEDULED",
          appointmentId: appointment.id,
        },
      });
    }
    if (parsed.outreachRecordId) {
      await tx.outreachRecord.updateMany({
        where: { id: parsed.outreachRecordId, shopId: context.shopId },
        data: {
          status: "SCHEDULED",
          responseStatus: "BOOKED",
          appointmentId: appointment.id,
        },
      });
    }
    if (parsed.opportunityId) {
      await tx.maintenanceRevenueOpportunity.updateMany({
        where: { id: parsed.opportunityId, shopId: context.shopId },
        data: {
          stage: "BOOKED",
          lastActivityAt: new Date(),
        },
      });
    }
    await tx.auditLog.create({
      data: {
        shopId: context.shopId,
        actorUserId: context.userId,
        action: "appointment.created",
        entityType: "Appointment",
        entityId: appointment.id,
        metadata: {
          attributionSource: parsed.attributionSource,
          opportunityId: parsed.opportunityId,
        },
      },
    });
  });
}

export async function updatePilotAppointment(
  context: AuthenticatedShopContext,
  input: unknown,
) {
  const parsed = appointmentUpdateSchema.parse(input);
  const appointment = await prisma.appointment.findUnique({
    where: { id: parsed.appointmentId },
    include: { services: true },
  });
  assertSameShop(context, appointment?.shopId);
  if (!appointment) throw new Error("Appointment not found.");

  const changesSchedule = Boolean(parsed.date || parsed.time || parsed.durationMinutes || parsed.totalLaborHours);
  if (appointment.status === "COMPLETED" && changesSchedule) {
    throw new Error("Completed appointments cannot be moved or resized.");
  }

  const start = parsed.date || parsed.time
    ? appointmentDateTime(
        parsed.date ?? dateKeyInTimeZone(appointment.scheduledStart, context.timezone),
        parsed.time ?? timeKeyInTimeZone(appointment.scheduledStart, context.timezone),
        context.timezone,
      )
    : appointment.scheduledStart;
  if (!start) throw new Error("Appointment date and time are invalid.");
  const durationMinutes = parsed.durationMinutes ??
    Math.max(30, Math.round((appointment.scheduledEnd.getTime() - appointment.scheduledStart.getTime()) / 60_000));
  const totalLaborMinutes = parsed.totalLaborHours
    ? Math.round(parsed.totalLaborHours * 60)
    : parsed.durationMinutes
      ? durationMinutes
      : appointment.totalLaborMinutes;

  if (changesSchedule) {
    const duplicateAppointment = await prisma.appointment.findFirst({
      where: {
        id: { not: appointment.id },
        shopId: context.shopId,
        vehicleId: appointment.vehicleId,
        scheduledStart: start,
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
    });
    if (duplicateAppointment) {
      throw new Error("This vehicle already has an appointment at that time.");
    }
  }

  await prisma.$transaction(async (tx) => {
    const nextStatus = parsed.status ?? appointment.status;
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + durationMinutes * 60_000),
        totalLaborMinutes,
        totalPriceCents: parsed.totalPriceCents ?? appointment.totalPriceCents,
        status: nextStatus,
        notes: parsed.notes ?? appointment.notes,
        cancelledAt: ["CANCELLED", "NO_SHOW"].includes(nextStatus) ? new Date() : appointment.cancelledAt,
      },
    });
    await tx.auditLog.create({
      data: {
        shopId: context.shopId,
        actorUserId: context.userId,
        action: "appointment.updated",
        entityType: "Appointment",
        entityId: appointment.id,
        metadata: {
          status: nextStatus,
          moved: changesSchedule,
        },
      },
    });
  });
}

export async function snoozePilotOpportunity(
  context: AuthenticatedShopContext,
  input: unknown,
) {
  const parsed = opportunitySnoozeSchema.parse(input);
  const [maintenanceRecords, declinedWorkRecords] = await Promise.all([
    prisma.vehicleMaintenanceRecord.findMany({
      where: { id: { in: parsed.maintenanceRecordIds }, shopId: context.shopId },
    }),
    prisma.declinedWorkRecord.findMany({
      where: { id: { in: parsed.declinedWorkRecordIds }, shopId: context.shopId },
    }),
  ]);
  if (maintenanceRecords.length !== parsed.maintenanceRecordIds.length) {
    throw new Error("One or more selected maintenance services are unavailable.");
  }
  if (declinedWorkRecords.length !== parsed.declinedWorkRecordIds.length) {
    throw new Error("One or more declined-work services are unavailable.");
  }
  if (maintenanceRecords.length === 0 && declinedWorkRecords.length === 0) {
    throw new Error("Select at least one opportunity to snooze.");
  }

  const outreachIds = maintenanceRecords
    .map((record) => record.outreachRecordId)
    .filter((id): id is string => Boolean(id));

  await prisma.$transaction(async (tx) => {
    await tx.vehicleMaintenanceRecord.updateMany({
      where: { id: { in: parsed.maintenanceRecordIds }, shopId: context.shopId },
      data: { outreachStatus: "SNOOZED" },
    });
    await tx.declinedWorkRecord.updateMany({
      where: { id: { in: parsed.declinedWorkRecordIds }, shopId: context.shopId },
      data: { status: "SNOOZED", outreachStatus: "SNOOZED" },
    });
    if (outreachIds.length > 0) {
      await tx.outreachRecord.updateMany({
        where: { id: { in: outreachIds }, shopId: context.shopId },
        data: {
          status: "SNOOZED",
          followUpDate: new Date(parsed.followUpDate),
          performedByUserId: context.userId,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        shopId: context.shopId,
        actorUserId: context.userId,
        action: "opportunity.snoozed",
        entityType: "Opportunity",
        metadata: {
          maintenanceRecordIds: parsed.maintenanceRecordIds,
          declinedWorkRecordIds: parsed.declinedWorkRecordIds,
          followUpDate: parsed.followUpDate,
        },
      },
    });
  });
}

export async function completePilotAppointment(
  context: AuthenticatedShopContext,
  input: {
    appointmentId: string;
    completedRevenueCents: number;
    completedLaborHours: number;
    completedAt: string;
    notes?: string;
  },
) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    include: { services: true },
  });
  assertSameShop(context, appointment?.shopId);
  if (!appointment) {
    throw new Error("Appointment not found.");
  }
  if (input.completedRevenueCents < 0 || input.completedLaborHours <= 0) {
    throw new Error("Completed revenue and labor must be valid.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: "COMPLETED",
        completedRevenueCents: input.completedRevenueCents,
        completedLaborMinutes: Math.round(input.completedLaborHours * 60),
        completedAt: new Date(input.completedAt),
        notes: input.notes ?? appointment.notes,
      },
    });
    await tx.vehicleMaintenanceRecord.updateMany({
      where: {
        id: {
          in: appointment.services
            .map((service) => service.maintenanceRecordId)
            .filter((id): id is string => Boolean(id)),
        },
        shopId: context.shopId,
      },
      data: {
        outreachStatus: "SCHEDULED",
        status: "COMPLETED",
      },
    });
    await tx.declinedWorkRecord.updateMany({
      where: { appointmentId: appointment.id, shopId: context.shopId },
      data: { status: "COMPLETED", outreachStatus: "SCHEDULED" },
    });
    if (appointment.opportunityId) {
      await tx.maintenanceRevenueOpportunity.updateMany({
        where: { id: appointment.opportunityId, shopId: context.shopId },
        data: { stage: "COMPLETED", lastActivityAt: new Date() },
      });
    }
    if (appointment.outreachRecordId) {
      await tx.outreachRecord.updateMany({
        where: { id: appointment.outreachRecordId, shopId: context.shopId },
        data: { status: "SCHEDULED", responseStatus: "BOOKED" },
      });
    }
    await tx.auditLog.create({
      data: {
        shopId: context.shopId,
        actorUserId: context.userId,
        action: "appointment.completed",
        entityType: "Appointment",
        entityId: appointment.id,
        metadata: {
          completedRevenueCents: input.completedRevenueCents,
          completedLaborMinutes: Math.round(input.completedLaborHours * 60),
        },
      },
    });
  });
}

export async function importPilotCsvRows(
  context: AuthenticatedShopContext,
  input: {
    fileName: string;
    importType: ImportType;
    duplicateMode: DuplicateImportMode;
    rowActions?: Record<string, ImportRowAction>;
    rows: CsvRow[];
    mapping: Record<string, MaintivaField>;
  },
) {
  const state = await buildPilotState(context);
  const preview = previewImport({
    rows: input.rows,
    mapping: input.mapping,
    importType: input.importType,
    state,
    timeZone: context.timezone,
  });
  const rowActions = Object.fromEntries(
    Object.entries(input.rowActions ?? {}).map(([rowNumber, action]) => [Number(rowNumber), action]),
  ) as Record<number, ImportRowAction>;
  const summary = summarizeImport(preview.rows, input.duplicateMode, rowActions);
  const rowAction = (row: (typeof preview.rows)[number]) => {
    const override = rowActions[row.rowNumber];
    if (override) return override;
    if (row.status === "INVALID") return "HOLD" as const;
    if (row.entities.child.status === "DUPLICATE") {
      if (input.duplicateMode === "UPDATE") return "UPDATE" as const;
      if (input.duplicateMode === "IMPORT_AS_NEW") return "IMPORT_AS_NEW" as const;
      return "SKIP" as const;
    }
    return row.action;
  };
  const rowsToImport = preview.rows.filter((row) => {
    const action = rowAction(row);
    return action === "IMPORT" || action === "UPDATE" || action === "IMPORT_AS_NEW";
  });
  const defaultService = await prisma.serviceDefinition.findFirst({
    where: { shopId: context.shopId, isActive: true },
    orderBy: { name: "asc" },
  });

  await prisma.$transaction(async (tx) => {
    const customerByKey = new Map<string, { id: string; firstName: string; lastName: string; email: string | null; phone: string | null }>();
    const vehicleByKey = new Map<string, { id: string; customerId: string; year: number; make: string; model: string; vin: string | null; currentMileage: number; licensePlate: string | null }>();

    for (const row of rowsToImport) {
      const normalized = row.normalized;
      const email = stringValue(normalized, "customerEmail").toLowerCase();
      const phone = stringValue(normalized, "customerPhone");
      const firstName = stringValue(normalized, "customerFirstName");
      const lastName = stringValue(normalized, "customerLastName");
      const vin = stringValue(normalized, "vin").toUpperCase();
      const action = rowAction(row);

      let customer = row.entities.customer.key ? customerByKey.get(row.entities.customer.key) ?? null : null;
      customer ??= await tx.customer.findFirst({
        where: {
          shopId: context.shopId,
          OR: [
            email ? { email } : undefined,
            phone ? { phone } : undefined,
            firstName && lastName ? { firstName, lastName } : undefined,
          ].filter((item): item is Exclude<typeof item, undefined> => Boolean(item)),
        },
      });

      if (customer && action === "UPDATE") {
        customer = await tx.customer.update({
          where: { id: customer.id },
          data: {
            firstName: firstName || customer.firstName,
            lastName: lastName || customer.lastName,
            email: email || customer.email,
            phone: phone || customer.phone,
            lastVisit: new Date(),
          },
        });
      }

      customer ??= await tx.customer.create({
        data: {
          shopId: context.shopId,
          firstName,
          lastName,
          email: email || null,
          phone: phone || null,
          preferredContact: email ? "EMAIL" : "SMS",
          smsConsent: Boolean(phone),
          emailConsent: Boolean(email),
          callConsent: Boolean(phone),
          status: "ACTIVE",
          lastVisit: new Date(),
          notes: row.status === "DUPLICATE" ? "Imported as a new record after duplicate review." : null,
        },
      });
      if (row.entities.customer.key) customerByKey.set(row.entities.customer.key, customer);

      const existingVinVehicle = vin
        ? await tx.vehicle.findFirst({ where: { shopId: context.shopId, vin } })
        : null;
      const vehicleVin = existingVinVehicle && action === "IMPORT_AS_NEW" && row.entities.vehicle.status !== "MATCH" ? null : vin || null;
      let vehicle = row.entities.vehicle.key ? vehicleByKey.get(row.entities.vehicle.key) ?? null : null;
      vehicle ??= existingVinVehicle;

      if (vehicle) {
        vehicle = await tx.vehicle.update({
          where: { id: vehicle.id },
          data: {
            customerId: customer.id,
            year: numberValue(normalized, "vehicleYear") || vehicle.year,
            make: stringValue(normalized, "vehicleMake") || vehicle.make,
            model: stringValue(normalized, "vehicleModel") || vehicle.model,
            currentMileage: numberValue(normalized, "currentMileage") || vehicle.currentMileage,
            licensePlate: stringValue(normalized, "licensePlate") || vehicle.licensePlate,
            lastServiceDate: new Date(),
          },
        });
      } else if (
        stringValue(normalized, "vehicleMake") &&
        stringValue(normalized, "vehicleModel") &&
        numberValue(normalized, "vehicleYear")
      ) {
        vehicle = await tx.vehicle.create({
          data: {
            shopId: context.shopId,
            customerId: customer.id,
            year: numberValue(normalized, "vehicleYear"),
            make: stringValue(normalized, "vehicleMake"),
            model: stringValue(normalized, "vehicleModel"),
            vin: vehicleVin,
            licensePlate: stringValue(normalized, "licensePlate") || null,
            currentMileage: numberValue(normalized, "currentMileage"),
            estimatedAnnualMileage: 12_000,
            lastServiceDate: new Date(),
          },
        });
      } else {
        continue;
      }
      if (row.entities.vehicle.key) vehicleByKey.set(row.entities.vehicle.key, vehicle);

      const serviceName = stringValue(normalized, "serviceName") || stringValue(normalized, "services");
      const priceCents = numberValue(normalized, "price");
      const laborMinutes = Math.round(numberValue(normalized, "laborHours") * 60);
      if (!serviceName || priceCents <= 0 || laborMinutes <= 0) continue;

      let service = await tx.serviceDefinition.findFirst({
        where: { shopId: context.shopId, name: serviceName },
      });
      if (!service) {
        service = await tx.serviceDefinition.create({
          data: {
            shopId: context.shopId,
            name: serviceName,
            category: "Imported",
            defaultMileageInterval: defaultService?.defaultMileageInterval ?? 12_000,
            defaultTimeIntervalMonths: defaultService?.defaultTimeIntervalMonths ?? 12,
            defaultNotificationThreshold: defaultService?.defaultNotificationThreshold ?? 10,
            estimatedLaborMinutes: laborMinutes,
            defaultPriceCents: priceCents,
            description: "Imported from CSV.",
            isActive: true,
          },
        });
      }

      await tx.vehicleMaintenanceRecord.upsert({
        where: {
          shopId_vehicleId_serviceDefinitionId: {
            shopId: context.shopId,
            vehicleId: vehicle.id,
            serviceDefinitionId: service.id,
          },
        },
        create: {
          shopId: context.shopId,
          vehicleId: vehicle.id,
          serviceDefinitionId: service.id,
          serviceName,
          lastCompletedDate: stringValue(normalized, "serviceDate")
            ? new Date(stringValue(normalized, "serviceDate"))
            : null,
          lastCompletedMileage: numberValue(normalized, "serviceMileage") || numberValue(normalized, "currentMileage"),
          recommendedMileageInterval: service.defaultMileageInterval,
          recommendedTimeIntervalMonths: service.defaultTimeIntervalMonths,
          notificationThreshold: service.defaultNotificationThreshold,
          laborMinutes,
          priceCents,
          status: "DUE_SOON",
          outreachStatus: "NEEDS_OUTREACH",
        },
        update: {
          lastCompletedDate: stringValue(normalized, "serviceDate")
            ? new Date(stringValue(normalized, "serviceDate"))
            : undefined,
          lastCompletedMileage: numberValue(normalized, "serviceMileage") || undefined,
          laborMinutes,
          priceCents,
        },
      });

      if (stringValue(normalized, "serviceDate")) {
        await tx.serviceHistoryRecord.create({
          data: {
            shopId: context.shopId,
            customerId: customer.id,
            vehicleId: vehicle.id,
            serviceDefinitionId: service.id,
            serviceName,
            completedAt: new Date(stringValue(normalized, "serviceDate")),
            mileage: numberValue(normalized, "serviceMileage") || numberValue(normalized, "currentMileage"),
            laborMinutes,
            priceCents,
            notes: "Imported from CSV.",
          },
        });
      }

      if (
        input.importType === "DECLINED_WORK" ||
        stringValue(normalized, "declinedDate") ||
        stringValue(normalized, "status").toLowerCase().includes("declin")
      ) {
        await tx.declinedWorkRecord.create({
          data: {
            shopId: context.shopId,
            customerId: customer.id,
            vehicleId: vehicle.id,
            serviceName,
            declinedAt: stringValue(normalized, "declinedDate")
              ? new Date(stringValue(normalized, "declinedDate"))
              : new Date(),
            recommendedPriceCents: priceCents,
            laborMinutes,
            advisorNotes: stringValue(normalized, "advisorNotes") || null,
            status: "OPEN",
            outreachStatus: "NEEDS_OUTREACH",
          },
        });
      }

      const scheduledStart = appointmentDateTime(
        stringValue(normalized, "appointmentDate"),
        stringValue(normalized, "appointmentTime"),
        context.timezone,
      );
      if (scheduledStart) {
        const scheduledEnd = new Date(scheduledStart.getTime() + laborMinutes * 60 * 1000);
        const duplicateAppointment = await tx.appointment.findFirst({
          where: {
            shopId: context.shopId,
            vehicleId: vehicle.id,
            scheduledStart,
            status: { notIn: ["CANCELLED", "NO_SHOW"] },
          },
        });
        if (!duplicateAppointment) {
          await tx.appointment.create({
            data: {
              shopId: context.shopId,
              customerId: customer.id,
              vehicleId: vehicle.id,
              scheduledStart,
              scheduledEnd,
              status: "CONFIRMED",
              totalLaborMinutes: laborMinutes,
              totalPriceCents: priceCents,
              source: "IMPORTED",
              attributionSource: "IMPORTED_APPOINTMENT",
              notes: "Imported from CSV.",
              services: {
                create: {
                  shopId: context.shopId,
                  serviceDefinitionId: service.id,
                  serviceName,
                  laborMinutes,
                  priceCents,
                },
              },
            },
          });
        }
      }
    }

    const importHistory = await tx.importHistoryRecord.create({
      data: {
        shopId: context.shopId,
        userId: context.userId,
        fileName: input.fileName,
        importType: input.importType,
        status: summary.failedRows > 0 ? "PARTIAL" : "COMPLETED",
        totalRows: summary.totalRows,
        successfulRows: summary.successfulRows,
        duplicateRows: summary.duplicateRows,
        updatedRows: summary.updatedRows,
        skippedRows: summary.skippedRows,
        failedRows: summary.failedRows,
        errorReportUrl: summary.failedRows > 0 ? "downloadable-error-report" : null,
      },
    });

    await tx.importRowRecord.createMany({
      data: preview.rows.map((row) => {
        const action = rowAction(row);
        const status = row.status === "INVALID"
          ? "FAILED"
          : action === "HOLD"
            ? "HELD"
            : action === "SKIP"
              ? "SKIPPED"
              : action === "UPDATE"
                ? "UPDATED"
                : "IMPORTED";

        return {
          shopId: context.shopId,
          importHistoryRecordId: importHistory.id,
          rowNumber: row.rowNumber,
          action,
          status,
          entityType: row.entities.child.entity,
          errorMessage: row.errors.join("; ") || row.issue || null,
          sourceRow: row.raw,
          normalizedRow: row.normalized,
        };
      }),
    });
  });
}
