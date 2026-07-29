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
  type TimeIntervalUnit,
  type Vehicle,
  type VehicleMaintenanceRecord,
} from "@/lib/demo-data";
import { assertSameShop, type AuthenticatedShopContext } from "@/lib/auth";
import { customerSchema, vehicleSchema } from "@/lib/validation";
import { resolveMaintenanceInterval, timeIntervalToMonths } from "@/lib/service-intervals";
import { SafeActionError } from "@/lib/server-diagnostics";
import {
  previewImport,
  summarizeImport,
  type CsvRow,
  type DuplicateImportMode,
  type ImportRowAction,
  type ImportType,
  type MaintivaField,
} from "@/lib/csv-import";

const onboardingSchema = z.object({
  shopName: z.string().min(2),
  phone: z.string().optional(),
  email: z.email().optional().or(z.literal("")),
  address: z.string().optional(),
  timezone: z.string().min(3).default("America/New_York"),
  dailyBayHours: z.number().int().min(1).max(200).default(64),
});
const timeIntervalUnitSchema = z.enum(["DAYS", "MONTHS", "YEARS"]);
const thresholdTypeSchema = z.enum(["MILES_BEFORE_DUE", "DAYS_BEFORE_DUE", "PERCENT_REMAINING"]);

const nullableNonnegativeInt = z.number().int().nonnegative().nullable().optional();
const nullablePositiveInt = z.number().int().positive().nullable().optional();

const serviceDefinitionSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  defaultMileageInterval: nullablePositiveInt,
  defaultTimeIntervalValue: nullablePositiveInt,
  defaultTimeIntervalUnit: timeIntervalUnitSchema.default("MONTHS"),
  defaultNotificationThreshold: z.number().int().min(0).max(100).default(10),
  estimatedLaborMinutes: z.number().int().nonnegative(),
  defaultPriceCents: z.number().int().nonnegative(),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

const maintenanceItemSchema = z.object({
  vehicleId: z.string().min(1),
  serviceDefinitionId: z.string().optional().nullable(),
  customServiceName: z.string().optional(),
  customCategory: z.string().optional(),
  addToLibrary: z.boolean().optional(),
  useShopDefaults: z.boolean().default(true),
  allowDuplicate: z.boolean().optional(),
  mileageIntervalOverride: nullablePositiveInt,
  timeIntervalValueOverride: nullablePositiveInt,
  timeIntervalUnitOverride: timeIntervalUnitSchema.nullable().optional(),
  priceOverrideCents: nullableNonnegativeInt,
  laborMinutesOverride: nullableNonnegativeInt,
  lastCompletedDate: z.string().optional(),
  lastCompletedMileage: nullableNonnegativeInt,
  outreachThresholdType: thresholdTypeSchema.default("MILES_BEFORE_DUE"),
  outreachThresholdValue: z.number().int().nonnegative().default(500),
  notes: z.string().optional(),
});

const maintenanceItemUpdateSchema = maintenanceItemSchema
  .omit({ vehicleId: true, serviceDefinitionId: true, customServiceName: true, customCategory: true, addToLibrary: true, allowDuplicate: true })
  .extend({ useShopDefaults: z.boolean().optional() })
  .partial();

const serviceCompletionSchema = z.object({
  maintenanceRecordId: z.string().min(1),
  completedAt: z.string().min(8),
  completedMileage: z.number().int().nonnegative(),
  finalPriceCents: z.number().int().nonnegative(),
  finalLaborMinutes: z.number().int().nonnegative(),
  notes: z.string().optional(),
});

const mileageUpdateSchema = z.object({
  vehicleId: z.string().min(1),
  currentMileage: z.number().int().nonnegative(),
  allowLowerCorrection: z.boolean().optional(),
  correctionReason: z.string().optional(),
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

function stringValue(record: Record<string, string | number>, key: string) {
  return String(record[key] ?? "").trim();
}

function numberValue(record: Record<string, string | number>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function appointmentDateTime(date: string, time: string) {
  if (!date || !time) return undefined;
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function monthsFromTime(value: number | null | undefined, unit: TimeIntervalUnit | null | undefined) {
  const months = timeIntervalToMonths(value, unit);
  return months === null ? null : Math.max(1, Math.round(months));
}

function isDemoEntityId(id: string) {
  return /^(cust|veh|svc|item|appt|hist|service|outreach|declined|import)-/.test(id);
}

function shortId(id: string | null | undefined) {
  if (!id) return undefined;
  return id.length <= 14 ? id : `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function assertProductionEntityId(id: string, entityName: string) {
  if (isDemoEntityId(id)) {
    throw new SafeActionError({
      code: "DEMO_ID_NOT_PERSISTED",
      message: `${entityName} is not a persisted production record. Refresh the page and try again.`,
      status: 400,
    });
  }
}

async function requireVehicleInActiveShop(context: AuthenticatedShopContext, vehicleId: string) {
  assertProductionEntityId(vehicleId, "The selected vehicle");
  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: vehicleId,
      shopId: context.shopId,
      archivedAt: null,
    },
  });

  if (vehicle) return vehicle;

  const target = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { shopId: true },
  });

  throw new SafeActionError({
    code: "VEHICLE_NOT_IN_ACTIVE_SHOP",
    message: "The selected vehicle does not belong to your active shop.",
    status: target ? 403 : 404,
    table: "Vehicle",
    operation: "SELECT",
    details: target?.shopId
      ? `Vehicle exists in a different shop: ${shortId(target.shopId)}.`
      : "Vehicle was not found.",
  });
}

async function requireServiceDefinitionInActiveShop(
  context: AuthenticatedShopContext,
  serviceDefinitionId: string,
) {
  assertProductionEntityId(serviceDefinitionId, "The selected service");
  const service = await prisma.serviceDefinition.findFirst({
    where: {
      id: serviceDefinitionId,
      shopId: context.shopId,
    },
  });

  if (service) return service;

  const target = await prisma.serviceDefinition.findUnique({
    where: { id: serviceDefinitionId },
    select: { shopId: true },
  });

  throw new SafeActionError({
    code: "SERVICE_NOT_IN_ACTIVE_SHOP",
    message: "The selected service does not belong to your active shop.",
    status: target ? 403 : 404,
    table: "ServiceDefinition",
    operation: "SELECT",
    details: target?.shopId
      ? `Service exists in a different shop: ${shortId(target.shopId)}.`
      : "Service was not found.",
  });
}

async function requireMaintenanceRecordInActiveShop(
  context: AuthenticatedShopContext,
  maintenanceRecordId: string,
) {
  assertProductionEntityId(maintenanceRecordId, "The selected maintenance item");
  const record = await prisma.vehicleMaintenanceRecord.findFirst({
    where: {
      id: maintenanceRecordId,
      shopId: context.shopId,
      archivedAt: null,
    },
  });

  if (record) return record;

  const target = await prisma.vehicleMaintenanceRecord.findUnique({
    where: { id: maintenanceRecordId },
    select: { shopId: true },
  });

  throw new SafeActionError({
    code: "MAINTENANCE_ITEM_NOT_IN_ACTIVE_SHOP",
    message: "The selected maintenance item does not belong to your active shop.",
    status: target ? 403 : 404,
    table: "VehicleMaintenanceRecord",
    operation: "SELECT",
    details: target?.shopId
      ? `Maintenance item exists in a different shop: ${shortId(target.shopId)}.`
      : "Maintenance item was not found.",
  });
}

export async function seedDefaultServicesForShop(shopId: string) {
  await prisma.serviceDefinition.createMany({
    data: defaultServices.map((service) => ({
      shopId,
      name: service.name,
      category: service.category,
      defaultMileageInterval: service.defaultMileageInterval,
      defaultTimeIntervalMonths: service.defaultTimeIntervalMonths,
      defaultTimeIntervalValue: service.defaultTimeIntervalValue,
      defaultTimeIntervalUnit: service.defaultTimeIntervalUnit,
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
    defaultTimeIntervalValue: service.defaultTimeIntervalValue ?? service.defaultTimeIntervalMonths,
    defaultTimeIntervalUnit: service.defaultTimeIntervalUnit,
    defaultNotificationThreshold: service.defaultNotificationThreshold,
    estimatedLaborMinutes: service.estimatedLaborMinutes,
    defaultPriceCents: service.defaultPriceCents,
    description: service.description ?? "",
    isActive: service.isActive,
  }));
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const vehicleById = new Map(shop.vehicles.map((vehicle) => [vehicle.id, vehicle]));

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
    maintenanceRecords: shop.maintenanceRecords.map((record): VehicleMaintenanceRecord => {
      const service = record.serviceDefinitionId ? serviceById.get(record.serviceDefinitionId) : undefined;
      const vehicle = vehicleById.get(record.vehicleId);
      const baseRecord: VehicleMaintenanceRecord = {
        id: record.id,
        shopId: record.shopId,
        vehicleId: record.vehicleId,
        serviceId: record.serviceDefinitionId,
        serviceName: record.serviceName,
        customServiceName: record.customServiceName ?? undefined,
        customCategory: record.customCategory ?? undefined,
        lastCompletedDate: dateOnly(record.lastCompletedDate || record.createdAt),
        lastCompletedMileage: record.lastCompletedMileage ?? 0,
        recommendedMileageInterval: record.recommendedMileageInterval,
        recommendedTimeIntervalMonths: record.recommendedTimeIntervalMonths,
        mileageIntervalOverride: record.mileageIntervalOverride,
        timeIntervalValueOverride: record.timeIntervalValueOverride,
        timeIntervalUnitOverride: record.timeIntervalUnitOverride,
        priceCents: record.priceCents,
        laborHours: record.laborMinutes / 60,
        priceOverrideCents: record.priceOverrideCents,
        laborMinutesOverride: record.laborMinutesOverride,
        notificationThreshold: record.notificationThreshold,
        outreachThresholdType: record.outreachThresholdType,
        outreachThresholdValue: record.outreachThresholdValue,
        outreachStatus: record.outreachStatus,
        outreachRecordId: record.outreachRecordId ?? undefined,
        appointmentId: record.appointmentId ?? undefined,
        isActive: record.isActive,
        notes: record.notes ?? undefined,
        createdByUserId: record.createdByUserId ?? undefined,
        updatedByUserId: record.updatedByUserId ?? undefined,
      };
      if (!vehicle) return baseRecord;
      const effective = resolveMaintenanceInterval({
        record: baseRecord,
        service,
        vehicle: {
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
        },
      });
      return {
        ...baseRecord,
        serviceName: effective.serviceName,
        recommendedMileageInterval: effective.mileageInterval,
        recommendedTimeIntervalMonths: monthsFromTime(effective.timeIntervalValue, effective.timeIntervalUnit),
        priceCents: effective.priceCents,
        laborHours: effective.laborMinutes / 60,
      };
    }),
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
      recommendedMileageInterval: null,
      recommendedTimeIntervalMonths: null,
      mileageIntervalOverride: null,
      timeIntervalValueOverride: null,
      timeIntervalUnitOverride: null,
      notificationThreshold: service.defaultNotificationThreshold,
      outreachThresholdType: "MILES_BEFORE_DUE" as const,
      outreachThresholdValue: 500,
      priceCents: service.defaultPriceCents,
      laborMinutes: service.estimatedLaborMinutes,
      status: "HEALTHY" as const,
      isActive: true,
      createdByUserId: context.userId,
      updatedByUserId: context.userId,
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

export async function addPilotServiceDefinition(context: AuthenticatedShopContext, input: unknown) {
  const parsed = serviceDefinitionSchema.parse(input);
  if (!parsed.defaultMileageInterval && !parsed.defaultTimeIntervalValue && parsed.category.toLowerCase().includes("maintenance")) {
    throw new SafeActionError({
      code: "SERVICE_INTERVAL_REQUIRED",
      message: "A recurring maintenance service needs a mileage or time interval.",
      table: "ServiceDefinition",
      operation: "INSERT",
    });
  }

  const duplicate = await prisma.serviceDefinition.findUnique({
    where: {
      shopId_name: {
        shopId: context.shopId,
        name: parsed.name,
      },
    },
  });
  if (duplicate) {
    throw new SafeActionError({
      code: "DUPLICATE_SERVICE_DEFINITION",
      message: "A service with this name already exists for your shop.",
      status: 409,
      table: "ServiceDefinition",
      operation: "INSERT",
    });
  }

  const service = await prisma.serviceDefinition.create({
    data: {
      shopId: context.shopId,
      name: parsed.name,
      category: parsed.category,
      defaultMileageInterval: parsed.defaultMileageInterval ?? null,
      defaultTimeIntervalMonths: monthsFromTime(parsed.defaultTimeIntervalValue, parsed.defaultTimeIntervalUnit),
      defaultTimeIntervalValue: parsed.defaultTimeIntervalValue ?? null,
      defaultTimeIntervalUnit: parsed.defaultTimeIntervalUnit,
      defaultNotificationThreshold: parsed.defaultNotificationThreshold,
      estimatedLaborMinutes: parsed.estimatedLaborMinutes,
      defaultPriceCents: parsed.defaultPriceCents,
      description: parsed.description || null,
      isActive: parsed.isActive,
    },
  });
  assertSameShop(context, service.shopId);
}

export async function updatePilotServiceDefinition(
  context: AuthenticatedShopContext,
  serviceDefinitionId: string,
  input: unknown,
) {
  const existing = await requireServiceDefinitionInActiveShop(context, serviceDefinitionId);
  const parsed = serviceDefinitionSchema.partial().parse(input);
  await prisma.serviceDefinition.update({
    where: { id: serviceDefinitionId },
    data: {
      ...parsed,
      defaultTimeIntervalMonths: parsed.defaultTimeIntervalValue !== undefined || parsed.defaultTimeIntervalUnit !== undefined
        ? monthsFromTime(
          parsed.defaultTimeIntervalValue ?? existing?.defaultTimeIntervalValue,
          parsed.defaultTimeIntervalUnit ?? existing?.defaultTimeIntervalUnit,
        )
        : undefined,
      description: parsed.description === undefined ? undefined : parsed.description || null,
    },
  });
}

export async function addPilotMaintenanceItem(context: AuthenticatedShopContext, input: unknown) {
  const parsed = maintenanceItemSchema.parse(input);
  const vehicle = await requireVehicleInActiveShop(context, parsed.vehicleId);

  let service = parsed.serviceDefinitionId
    ? await requireServiceDefinitionInActiveShop(context, parsed.serviceDefinitionId)
    : null;

  if (!service && !parsed.customServiceName?.trim()) {
    throw new SafeActionError({
      code: "SERVICE_REQUIRED",
      message: "Choose a service or enter a custom service name.",
      table: "VehicleMaintenanceRecord",
      operation: "INSERT",
    });
  }

  if (service && !parsed.allowDuplicate) {
    const duplicate = await prisma.vehicleMaintenanceRecord.findFirst({
      where: {
        shopId: context.shopId,
        vehicleId: vehicle.id,
        serviceDefinitionId: service.id,
        isActive: true,
        archivedAt: null,
      },
    });
    if (duplicate) {
      throw new SafeActionError({
        code: "DUPLICATE_VEHICLE_SERVICE",
        message: "This service already exists for the vehicle.",
        status: 409,
        table: "VehicleMaintenanceRecord",
        operation: "INSERT",
      });
    }
  }

  if (!service && parsed.addToLibrary && parsed.customServiceName) {
    service = await prisma.serviceDefinition.create({
      data: {
        shopId: context.shopId,
        name: parsed.customServiceName,
        category: parsed.customCategory || "Custom",
        defaultMileageInterval: parsed.mileageIntervalOverride ?? null,
        defaultTimeIntervalMonths: monthsFromTime(parsed.timeIntervalValueOverride, parsed.timeIntervalUnitOverride),
        defaultTimeIntervalValue: parsed.timeIntervalValueOverride ?? null,
        defaultTimeIntervalUnit: parsed.timeIntervalUnitOverride ?? "MONTHS",
        defaultNotificationThreshold: 10,
        estimatedLaborMinutes: parsed.laborMinutesOverride ?? 0,
        defaultPriceCents: parsed.priceOverrideCents ?? 0,
        description: parsed.notes || null,
        isActive: true,
      },
    });
  }

  const useDefaults = Boolean(service && parsed.useShopDefaults);
  const mileageOverride = useDefaults ? null : parsed.mileageIntervalOverride ?? null;
  const timeValueOverride = useDefaults ? null : parsed.timeIntervalValueOverride ?? null;
  const timeUnitOverride = useDefaults ? null : parsed.timeIntervalUnitOverride ?? null;
  const priceOverride = useDefaults ? null : parsed.priceOverrideCents ?? null;
  const laborOverride = useDefaults ? null : parsed.laborMinutesOverride ?? null;
  const maintenance = await prisma.vehicleMaintenanceRecord.create({
    data: {
      shopId: context.shopId,
      vehicleId: vehicle.id,
      serviceDefinitionId: service?.id ?? null,
      serviceName: service?.name ?? parsed.customServiceName?.trim() ?? "Custom service",
      customServiceName: service ? null : parsed.customServiceName?.trim() ?? null,
      customCategory: service ? null : parsed.customCategory || "Custom",
      lastCompletedDate: parsed.lastCompletedDate ? new Date(parsed.lastCompletedDate) : null,
      lastCompletedMileage: parsed.lastCompletedMileage ?? null,
      recommendedMileageInterval: mileageOverride,
      recommendedTimeIntervalMonths: monthsFromTime(timeValueOverride, timeUnitOverride),
      mileageIntervalOverride: mileageOverride,
      timeIntervalValueOverride: timeValueOverride,
      timeIntervalUnitOverride: timeUnitOverride,
      notificationThreshold: 10,
      outreachThresholdType: parsed.outreachThresholdType,
      outreachThresholdValue: parsed.outreachThresholdValue,
      priceCents: priceOverride ?? service?.defaultPriceCents ?? parsed.priceOverrideCents ?? 0,
      laborMinutes: laborOverride ?? service?.estimatedLaborMinutes ?? parsed.laborMinutesOverride ?? 0,
      priceOverrideCents: priceOverride,
      laborMinutesOverride: laborOverride,
      status: "HEALTHY",
      outreachStatus: "NEEDS_OUTREACH",
      isActive: true,
      notes: parsed.notes || null,
      createdByUserId: context.userId,
      updatedByUserId: context.userId,
    },
  });
  assertSameShop(context, maintenance.shopId);
}

export async function updatePilotMaintenanceItem(
  context: AuthenticatedShopContext,
  maintenanceRecordId: string,
  input: unknown,
) {
  const existing = await requireMaintenanceRecordInActiveShop(context, maintenanceRecordId);
  const parsed = maintenanceItemUpdateSchema.parse(input);
  const clearOverrides = parsed.useShopDefaults === true;

  await prisma.vehicleMaintenanceRecord.update({
    where: { id: maintenanceRecordId },
    data: {
      recommendedMileageInterval: clearOverrides ? null : parsed.mileageIntervalOverride,
      recommendedTimeIntervalMonths: clearOverrides
        ? null
        : parsed.timeIntervalValueOverride !== undefined || parsed.timeIntervalUnitOverride !== undefined
          ? monthsFromTime(
            parsed.timeIntervalValueOverride ?? existing.timeIntervalValueOverride,
            parsed.timeIntervalUnitOverride ?? existing.timeIntervalUnitOverride,
          )
          : undefined,
      mileageIntervalOverride: clearOverrides ? null : parsed.mileageIntervalOverride,
      timeIntervalValueOverride: clearOverrides ? null : parsed.timeIntervalValueOverride,
      timeIntervalUnitOverride: clearOverrides ? null : parsed.timeIntervalUnitOverride,
      priceOverrideCents: clearOverrides ? null : parsed.priceOverrideCents,
      laborMinutesOverride: clearOverrides ? null : parsed.laborMinutesOverride,
      lastCompletedDate: parsed.lastCompletedDate ? new Date(parsed.lastCompletedDate) : undefined,
      lastCompletedMileage: parsed.lastCompletedMileage,
      outreachThresholdType: parsed.outreachThresholdType,
      outreachThresholdValue: parsed.outreachThresholdValue,
      notes: parsed.notes,
      updatedByUserId: context.userId,
      outreachStatus: "NEEDS_OUTREACH",
    },
  });
}

export async function deactivatePilotMaintenanceItem(
  context: AuthenticatedShopContext,
  maintenanceRecordId: string,
) {
  await requireMaintenanceRecordInActiveShop(context, maintenanceRecordId);
  await prisma.$transaction(async (tx) => {
    await tx.vehicleMaintenanceRecord.update({
      where: { id: maintenanceRecordId },
      data: {
        isActive: false,
        archivedAt: new Date(),
        outreachStatus: "STOPPED",
        updatedByUserId: context.userId,
      },
    });
    await tx.maintenanceRevenueOpportunity.updateMany({
      where: {
        shopId: context.shopId,
        maintenanceRecordId,
        stage: { in: ["IDENTIFIED", "CONTACTED", "RESPONDED"] },
      },
      data: {
        stage: "LOST",
        explanation: "Maintenance item was deactivated and no longer generates outreach.",
      },
    });
  });
}

export async function markPilotMaintenanceServiceComplete(
  context: AuthenticatedShopContext,
  input: unknown,
) {
  const parsed = serviceCompletionSchema.parse(input);
  assertProductionEntityId(parsed.maintenanceRecordId, "The selected maintenance item");
  const record = await prisma.vehicleMaintenanceRecord.findFirst({
    where: {
      id: parsed.maintenanceRecordId,
      shopId: context.shopId,
      archivedAt: null,
    },
    include: { vehicle: true },
  });
  if (!record) {
    throw new SafeActionError({
      code: "MAINTENANCE_ITEM_NOT_IN_ACTIVE_SHOP",
      message: "The selected maintenance item does not belong to your active shop.",
      status: 404,
      table: "VehicleMaintenanceRecord",
      operation: "SELECT",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.serviceHistoryRecord.create({
      data: {
        shopId: context.shopId,
        customerId: record.vehicle.customerId,
        vehicleId: record.vehicleId,
        serviceDefinitionId: record.serviceDefinitionId,
        maintenanceRecordId: record.id,
        serviceName: record.customServiceName || record.serviceName,
        completedAt: new Date(parsed.completedAt),
        mileage: parsed.completedMileage,
        laborMinutes: parsed.finalLaborMinutes,
        priceCents: parsed.finalPriceCents,
        notes: parsed.notes || null,
      },
    });
    await tx.vehicleMaintenanceRecord.update({
      where: { id: record.id },
      data: {
        lastCompletedDate: new Date(parsed.completedAt),
        lastCompletedMileage: parsed.completedMileage,
        priceCents: parsed.finalPriceCents,
        laborMinutes: parsed.finalLaborMinutes,
        status: "HEALTHY",
        outreachStatus: "NEEDS_OUTREACH",
        appointmentId: null,
        updatedByUserId: context.userId,
      },
    });
    await tx.vehicle.update({
      where: { id: record.vehicleId },
      data: {
        currentMileage: Math.max(record.vehicle.currentMileage, parsed.completedMileage),
        lastServiceDate: new Date(parsed.completedAt),
      },
    });
    await tx.maintenanceRevenueOpportunity.updateMany({
      where: { shopId: context.shopId, maintenanceRecordId: record.id },
      data: { stage: "COMPLETED", lastActivityAt: new Date(parsed.completedAt) },
    });
    await tx.auditLog.create({
      data: {
        shopId: context.shopId,
        actorUserId: context.userId,
        action: "maintenance.service_completed",
        entityType: "VehicleMaintenanceRecord",
        entityId: record.id,
        metadata: {
          completedMileage: parsed.completedMileage,
          finalPriceCents: parsed.finalPriceCents,
          finalLaborMinutes: parsed.finalLaborMinutes,
        },
      },
    });
  });
}

export async function updatePilotVehicleMileage(context: AuthenticatedShopContext, input: unknown) {
  const parsed = mileageUpdateSchema.parse(input);
  const vehicle = await requireVehicleInActiveShop(context, parsed.vehicleId);
  if (parsed.currentMileage < vehicle.currentMileage && !parsed.allowLowerCorrection) {
    throw new SafeActionError({
      code: "MILEAGE_CORRECTION_REQUIRED",
      message: "Mileage is below the current reading. Confirm a correction and provide a reason.",
      table: "Vehicle",
      operation: "UPDATE",
    });
  }
  if (parsed.currentMileage < vehicle.currentMileage && !parsed.correctionReason?.trim()) {
    throw new SafeActionError({
      code: "MILEAGE_CORRECTION_REASON_REQUIRED",
      message: "A correction reason is required for lower mileage.",
      table: "Vehicle",
      operation: "UPDATE",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.vehicle.update({
      where: { id: vehicle.id },
      data: { currentMileage: parsed.currentMileage },
    });
    await tx.vehicleMaintenanceRecord.updateMany({
      where: { shopId: context.shopId, vehicleId: vehicle.id, isActive: true },
      data: { updatedByUserId: context.userId },
    });
    await tx.auditLog.create({
      data: {
        shopId: context.shopId,
        actorUserId: context.userId,
        action: "vehicle.mileage_updated",
        entityType: "Vehicle",
        entityId: vehicle.id,
        metadata: {
          previousMileage: vehicle.currentMileage,
          currentMileage: parsed.currentMileage,
          correctionReason: parsed.correctionReason,
        },
      },
    });
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
            defaultTimeIntervalValue: defaultService?.defaultTimeIntervalValue ?? defaultService?.defaultTimeIntervalMonths ?? 12,
            defaultTimeIntervalUnit: defaultService?.defaultTimeIntervalUnit ?? "MONTHS",
            defaultNotificationThreshold: defaultService?.defaultNotificationThreshold ?? 10,
            estimatedLaborMinutes: laborMinutes,
            defaultPriceCents: priceCents,
            description: "Imported from CSV.",
            isActive: true,
          },
        });
      }

      const existingMaintenance = await tx.vehicleMaintenanceRecord.findFirst({
        where: {
          shopId: context.shopId,
          vehicleId: vehicle.id,
          serviceDefinitionId: service.id,
          isActive: true,
          archivedAt: null,
        },
      });

      if (existingMaintenance) {
        await tx.vehicleMaintenanceRecord.update({
          where: { id: existingMaintenance.id },
          data: {
            lastCompletedDate: stringValue(normalized, "serviceDate")
              ? new Date(stringValue(normalized, "serviceDate"))
              : undefined,
            lastCompletedMileage: numberValue(normalized, "serviceMileage") || undefined,
            priceOverrideCents: priceCents,
            laborMinutesOverride: laborMinutes,
            priceCents,
            laborMinutes,
            updatedByUserId: context.userId,
          },
        });
      } else {
        await tx.vehicleMaintenanceRecord.create({
          data: {
          shopId: context.shopId,
          vehicleId: vehicle.id,
          serviceDefinitionId: service.id,
          serviceName,
          lastCompletedDate: stringValue(normalized, "serviceDate")
            ? new Date(stringValue(normalized, "serviceDate"))
            : null,
          lastCompletedMileage: numberValue(normalized, "serviceMileage") || numberValue(normalized, "currentMileage"),
          recommendedMileageInterval: null,
          recommendedTimeIntervalMonths: null,
          mileageIntervalOverride: null,
          timeIntervalValueOverride: null,
          timeIntervalUnitOverride: null,
          notificationThreshold: service.defaultNotificationThreshold,
          outreachThresholdType: "MILES_BEFORE_DUE",
          outreachThresholdValue: 500,
          laborMinutes,
          priceCents,
          priceOverrideCents: priceCents,
          laborMinutesOverride: laborMinutes,
          status: "DUE_SOON",
          outreachStatus: "NEEDS_OUTREACH",
          isActive: true,
          createdByUserId: context.userId,
          updatedByUserId: context.userId,
        },
        });
      }

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
