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
  type VehicleDrivingProfile,
  type VehicleMileageReading,
  type OutreachRecord,
  type TimeIntervalUnit,
  type Vehicle,
  type VehicleMaintenanceRecord,
} from "@/lib/demo-data";
import { assertSameShop, type AuthenticatedShopContext } from "@/lib/auth";
import { customerSchema, vehicleSchema } from "@/lib/validation";
import { resolveMaintenanceInterval, timeIntervalToMonths } from "@/lib/service-intervals";
import {
  DEFAULT_ANNUAL_MILEAGE,
  calculateDrivingProfile,
  resolveCurrentMileage,
  validateMileageReading,
} from "@/lib/adaptive-mileage";
import { currentDateInTimeZone } from "@/lib/utils";
import { safeDatabaseError, SafeActionError } from "@/lib/server-diagnostics";
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
  readingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Reading Date is required."),
  source: z.enum([
    "SHOP_REPAIR_ORDER",
    "SHOP_MANUAL_ENTRY",
    "SERVICE_HISTORY_IMPORT",
    "CUSTOMER_REPORTED",
    "APPOINTMENT_INTAKE",
    "CORRECTION",
    "OTHER",
  ]).default("SHOP_MANUAL_ENTRY"),
  verificationStatus: z.enum(["VERIFIED", "CUSTOMER_REPORTED", "IMPORTED", "UNVERIFIED", "EXCLUDED"]).default("VERIFIED"),
  notes: z.string().optional(),
  allowLowerCorrection: z.boolean().optional(),
  correctionReason: z.string().optional(),
});

const customerReportedMileageSchema = z.object({
  vehicleId: z.string().min(1),
  annualMileage: z.number().int().positive(),
});

const manualMileageOverrideSchema = z.object({
  vehicleId: z.string().min(1),
  annualMileage: z.number().int().positive(),
  reason: z.string().min(3),
  notes: z.string().optional(),
  reviewCondition: z.enum(["AFTER_2_VERIFIED_READINGS", "NEXT_SERVICE_VISIT", "ON_REVIEW_DATE"]).default("AFTER_2_VERIFIED_READINGS"),
  reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

const mileageReadingReviewSchema = z.object({
  readingId: z.string().min(1),
  includedInForecast: z.boolean(),
  anomalyStatus: z.enum(["NONE", "NEEDS_REVIEW", "RESOLVED"]),
  reviewNotes: z.string().optional(),
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

function dateFromDateOnly(value: string) {
  return new Date(`${value}T12:00:00Z`);
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

type StateServiceDefinition = {
  id: string;
  shopId: string;
  name: string;
  category: string;
  defaultMileageInterval: number | null;
  defaultTimeIntervalMonths: number | null;
  defaultTimeIntervalValue?: number | null;
  defaultTimeIntervalUnit?: TimeIntervalUnit | null;
  defaultNotificationThreshold: number;
  estimatedLaborMinutes: number;
  defaultPriceCents: number;
  description: string | null;
  isActive: boolean;
};

type StateMaintenanceRecord = {
  id: string;
  shopId: string;
  vehicleId: string;
  serviceDefinitionId: string | null;
  serviceName: string;
  customServiceName?: string | null;
  customCategory?: string | null;
  lastCompletedDate: Date | null;
  lastCompletedMileage: number | null;
  recommendedMileageInterval: number | null;
  recommendedTimeIntervalMonths: number | null;
  mileageIntervalOverride?: number | null;
  timeIntervalValueOverride?: number | null;
  timeIntervalUnitOverride?: TimeIntervalUnit | null;
  notificationThreshold: number;
  outreachThresholdType?: VehicleMaintenanceRecord["outreachThresholdType"] | null;
  outreachThresholdValue?: number | null;
  priceCents: number;
  laborMinutes: number;
  priceOverrideCents?: number | null;
  laborMinutesOverride?: number | null;
  outreachStatus: VehicleMaintenanceRecord["outreachStatus"];
  outreachRecordId: string | null;
  appointmentId: string | null;
  isActive?: boolean | null;
  notes?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type StateMileageReading = {
  id: string;
  shopId: string;
  vehicleId: string;
  readingMileage: number;
  readingDate: Date;
  source: VehicleMileageReading["source"];
  verificationStatus: VehicleMileageReading["verificationStatus"];
  anomalyStatus: VehicleMileageReading["anomalyStatus"];
  includedInForecast: boolean;
  correctionReason: string | null;
  reviewNotes: string | null;
  sourceReferenceType: string | null;
  sourceReferenceId: string | null;
  recordedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type StateDrivingProfile = {
  id: string;
  shopId: string;
  vehicleId: string;
  customerReportedAnnualMileage: number | null;
  customerReportedAt: Date | null;
  customerReportedByUserId: string | null;
  calculatedAnnualMileage: number;
  estimateSource: VehicleDrivingProfile["estimateSource"];
  confidence: VehicleDrivingProfile["confidence"];
  confidenceReason: string;
  manualAnnualMileageOverride: number | null;
  manualOverrideReason: string | null;
  manualOverrideNotes: string | null;
  manualOverrideSetAt: Date | null;
  manualOverrideSetByUserId: string | null;
  lastCalculatedAt: Date;
};

type MileageTransactionClient = Pick<
  typeof prisma,
  "vehicleDrivingProfile" | "vehicleMileageReading" | "$queryRaw"
>;

export function isMissingServiceIntervalSchema(error: unknown) {
  const database = safeDatabaseError(error);
  if (database.code !== "P2022") return false;

  const missingIntervalColumns = [
    "defaultTimeIntervalValue",
    "defaultTimeIntervalUnit",
    "customServiceName",
    "customCategory",
    "mileageIntervalOverride",
    "timeIntervalValueOverride",
    "timeIntervalUnitOverride",
    "outreachThresholdType",
    "outreachThresholdValue",
    "priceOverrideCents",
    "laborMinutesOverride",
    "isActive",
    "createdByUserId",
    "updatedByUserId",
  ];

  return missingIntervalColumns.some((column) => database.message?.includes(column));
}

export function isMissingAdaptiveMileageSchema(error: unknown) {
  const database = safeDatabaseError(error);
  if (!["P2010", "P2021", "P2022", "42P01", "42703", "42704"].includes(database.code ?? "")) return false;
  return [
    "VehicleMileageReading",
    "VehicleDrivingProfile",
    "defaultAnnualMileage",
    "MileageReadingSource",
    "DrivingProfileEstimateSource",
  ].some((needle) => database.message?.includes(needle) || database.details?.includes(needle));
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

export function canManageDrivingEstimates(role: AuthenticatedShopContext["role"]) {
  return role === "OWNER" || role === "MANAGER";
}

function requireDrivingEstimateManager(context: AuthenticatedShopContext) {
  if (canManageDrivingEstimates(context.role)) return;
  throw new SafeActionError({
    code: "DRIVING_ESTIMATE_MANAGER_REQUIRED",
    message: "Only owners and managers can edit driving estimates.",
    status: 403,
    table: "VehicleDrivingProfile",
    operation: "UPDATE",
  });
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

async function loadStateServiceDefinitions(shopId: string): Promise<StateServiceDefinition[]> {
  try {
    return await prisma.serviceDefinition.findMany({
      where: { shopId },
      orderBy: { name: "asc" },
    });
  } catch (error) {
    if (!isMissingServiceIntervalSchema(error)) throw error;

    console.warn("Maintiva service interval migration missing during state load; using legacy service definition columns.", {
      database: safeDatabaseError(error),
    });
    return prisma.serviceDefinition.findMany({
      where: { shopId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        shopId: true,
        name: true,
        category: true,
        defaultMileageInterval: true,
        defaultTimeIntervalMonths: true,
        defaultNotificationThreshold: true,
        estimatedLaborMinutes: true,
        defaultPriceCents: true,
        description: true,
        isActive: true,
      },
    });
  }
}

async function loadStateMaintenanceRecords(shopId: string): Promise<StateMaintenanceRecord[]> {
  try {
    return await prisma.vehicleMaintenanceRecord.findMany({
      where: { shopId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
  } catch (error) {
    if (!isMissingServiceIntervalSchema(error)) throw error;

    console.warn("Maintiva service interval migration missing during state load; using legacy maintenance record columns.", {
      database: safeDatabaseError(error),
    });
    return prisma.vehicleMaintenanceRecord.findMany({
      where: { shopId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        shopId: true,
        vehicleId: true,
        serviceDefinitionId: true,
        serviceName: true,
        lastCompletedDate: true,
        lastCompletedMileage: true,
        recommendedMileageInterval: true,
        recommendedTimeIntervalMonths: true,
        notificationThreshold: true,
        priceCents: true,
        laborMinutes: true,
        outreachStatus: true,
        outreachRecordId: true,
        appointmentId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}

async function loadShopDefaultAnnualMileage(shopId: string) {
  try {
    const rows = await prisma.$queryRaw<{ defaultAnnualMileage: number | null }[]>`
      SELECT "defaultAnnualMileage" FROM public."Shop" WHERE "id" = ${shopId} LIMIT 1
    `;
    return rows[0]?.defaultAnnualMileage ?? DEFAULT_ANNUAL_MILEAGE;
  } catch (error) {
    if (!isMissingAdaptiveMileageSchema(error)) throw error;
    return DEFAULT_ANNUAL_MILEAGE;
  }
}

async function loadStateMileageReadings(shopId: string): Promise<StateMileageReading[]> {
  try {
    return await prisma.vehicleMileageReading.findMany({
      where: { shopId },
      orderBy: [{ readingDate: "desc" }, { createdAt: "desc" }],
    });
  } catch (error) {
    if (!isMissingAdaptiveMileageSchema(error)) throw error;
    return [];
  }
}

async function loadStateDrivingProfiles(shopId: string): Promise<StateDrivingProfile[]> {
  try {
    return await prisma.vehicleDrivingProfile.findMany({
      where: { shopId },
      orderBy: { updatedAt: "desc" },
    });
  } catch (error) {
    if (!isMissingAdaptiveMileageSchema(error)) throw error;
    return [];
  }
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
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      email: true,
      address: true,
      timezone: true,
      dailyBayHours: true,
      isDemo: true,
      onboardingCompletedAt: true,
      updatedAt: true,
      memberships: { include: { user: true }, where: { isActive: true } },
      customers: { where: { archivedAt: null }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] },
      vehicles: { where: { archivedAt: null }, orderBy: [{ make: "asc" }, { model: "asc" }] },
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
  const [serviceDefinitions, maintenanceRecords, shopDefaultAnnualMileage, mileageReadingRows, drivingProfileRows] = await Promise.all([
    loadStateServiceDefinitions(context.shopId),
    loadStateMaintenanceRecords(context.shopId),
    loadShopDefaultAnnualMileage(context.shopId),
    loadStateMileageReadings(context.shopId),
    loadStateDrivingProfiles(context.shopId),
  ]);

  const services: MaintenanceService[] = serviceDefinitions.map((service) => ({
    id: service.id,
    shopId: service.shopId,
    name: service.name,
    category: service.category,
    defaultMileageInterval: service.defaultMileageInterval,
    defaultTimeIntervalMonths: service.defaultTimeIntervalMonths,
    defaultTimeIntervalValue: service.defaultTimeIntervalValue ?? service.defaultTimeIntervalMonths,
    defaultTimeIntervalUnit: service.defaultTimeIntervalUnit ?? "MONTHS",
    defaultNotificationThreshold: service.defaultNotificationThreshold,
    estimatedLaborMinutes: service.estimatedLaborMinutes,
    defaultPriceCents: service.defaultPriceCents,
    description: service.description ?? "",
    isActive: service.isActive,
  }));
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const readingsByVehicle = new Map<string, StateMileageReading[]>();
  for (const reading of mileageReadingRows) {
    const existing = readingsByVehicle.get(reading.vehicleId) ?? [];
    existing.push(reading);
    readingsByVehicle.set(reading.vehicleId, existing);
  }
  const persistedProfileByVehicle = new Map(drivingProfileRows.map((profile) => [profile.vehicleId, profile]));
  const stateMileageReadings: VehicleMileageReading[] = mileageReadingRows.map((reading) => ({
    id: reading.id,
    shopId: reading.shopId,
    vehicleId: reading.vehicleId,
    readingMileage: reading.readingMileage,
    readingDate: dateOnly(reading.readingDate),
    source: reading.source,
    verificationStatus: reading.verificationStatus,
    anomalyStatus: reading.anomalyStatus,
    includedInForecast: reading.includedInForecast,
    correctionReason: reading.correctionReason ?? undefined,
    reviewNotes: reading.reviewNotes ?? undefined,
    sourceReferenceType: reading.sourceReferenceType ?? undefined,
    sourceReferenceId: reading.sourceReferenceId ?? undefined,
    recordedByUserId: reading.recordedByUserId ?? undefined,
    createdAt: iso(reading.createdAt),
    updatedAt: iso(reading.updatedAt),
  }));
  const stateVehicles: Vehicle[] = shop.vehicles.map((vehicle): Vehicle => {
    const readings = readingsByVehicle.get(vehicle.id) ?? [];
    const current = resolveCurrentMileage({ currentMileage: vehicle.currentMileage }, readings.map((reading) => ({
      readingMileage: reading.readingMileage,
      readingDate: dateOnly(reading.readingDate),
      source: reading.source,
      verificationStatus: reading.verificationStatus,
      anomalyStatus: reading.anomalyStatus,
      includedInForecast: reading.includedInForecast,
    })));
    return {
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
      currentMileage: current.currentMileage,
      estimatedAnnualMileage: vehicle.estimatedAnnualMileage ?? shopDefaultAnnualMileage,
      overallHealth: vehicle.overallHealth,
      lastServiceDate: dateOnly(vehicle.lastServiceDate || vehicle.updatedAt),
    };
  });
  const vehicleById = new Map(stateVehicles.map((vehicle) => [vehicle.id, vehicle]));
  const stateDrivingProfiles: VehicleDrivingProfile[] = stateVehicles.map((vehicle) => {
    const persisted = persistedProfileByVehicle.get(vehicle.id);
    const readingDrafts = (readingsByVehicle.get(vehicle.id) ?? []).map((reading) => ({
      readingMileage: reading.readingMileage,
      readingDate: dateOnly(reading.readingDate),
      source: reading.source,
      verificationStatus: reading.verificationStatus,
      anomalyStatus: reading.anomalyStatus,
      includedInForecast: reading.includedInForecast,
    }));
    const calculated = calculateDrivingProfile({
      shopId: context.shopId,
      vehicleId: vehicle.id,
      readings: readingDrafts,
      shopDefaultAnnualMileage,
      customerReportedAnnualMileage: persisted?.customerReportedAnnualMileage ?? vehicle.estimatedAnnualMileage,
      customerReportedAt: persisted ? dateOnly(persisted.customerReportedAt) || null : null,
      customerReportedByUserId: persisted?.customerReportedByUserId ?? null,
      existingProfile: persisted
        ? {
            customerReportedAnnualMileage: persisted.customerReportedAnnualMileage,
            customerReportedAt: dateOnly(persisted.customerReportedAt) || null,
            customerReportedByUserId: persisted.customerReportedByUserId,
            manualAnnualMileageOverride: persisted.manualAnnualMileageOverride,
            manualOverrideReason: persisted.manualOverrideReason,
            manualOverrideNotes: persisted.manualOverrideNotes,
            manualOverrideSetAt: iso(persisted.manualOverrideSetAt) || null,
            manualOverrideSetByUserId: persisted.manualOverrideSetByUserId,
          }
        : null,
    });
    return {
      id: persisted?.id ?? `profile-${vehicle.id}`,
      shopId: context.shopId,
      vehicleId: vehicle.id,
      customerReportedAnnualMileage: calculated.customerReportedAnnualMileage,
      customerReportedAt: calculated.customerReportedAt,
      customerReportedByUserId: calculated.customerReportedByUserId,
      calculatedAnnualMileage: calculated.calculatedAnnualMileage,
      estimateSource: calculated.estimateSource,
      confidence: calculated.confidence,
      confidenceReason: calculated.confidenceReason,
      manualAnnualMileageOverride: calculated.manualAnnualMileageOverride,
      manualOverrideReason: calculated.manualOverrideReason,
      manualOverrideNotes: calculated.manualOverrideNotes,
      manualOverrideSetAt: calculated.manualOverrideSetAt,
      manualOverrideSetByUserId: calculated.manualOverrideSetByUserId,
      lastCalculatedAt: calculated.lastCalculatedAt,
    };
  });

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
      defaultAnnualMileage: shopDefaultAnnualMileage,
      isDemo: shop.isDemo,
      onboardingCompletedAt: iso(shop.onboardingCompletedAt) || null,
    },
    currentUserId: context.userId,
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
    vehicles: stateVehicles,
    services,
    maintenanceRecords: maintenanceRecords.map((record): VehicleMaintenanceRecord => {
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
        mileageIntervalOverride: record.mileageIntervalOverride ?? null,
        timeIntervalValueOverride: record.timeIntervalValueOverride ?? null,
        timeIntervalUnitOverride: record.timeIntervalUnitOverride ?? null,
        priceCents: record.priceCents,
        laborHours: record.laborMinutes / 60,
        priceOverrideCents: record.priceOverrideCents ?? null,
        laborMinutesOverride: record.laborMinutesOverride ?? null,
        notificationThreshold: record.notificationThreshold,
        outreachThresholdType: record.outreachThresholdType ?? "MILES_BEFORE_DUE",
        outreachThresholdValue: record.outreachThresholdValue ?? 500,
        outreachStatus: record.outreachStatus,
        outreachRecordId: record.outreachRecordId ?? undefined,
        appointmentId: record.appointmentId ?? undefined,
        isActive: record.isActive ?? true,
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
          lastServiceDate: vehicle.lastServiceDate,
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
    mileageReadings: stateMileageReadings,
    drivingProfiles: stateDrivingProfiles,
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
      maintenanceRecordIds: maintenanceRecords
        .filter((item) => item.outreachRecordId === record.id)
        .map((item) => item.id),
      serviceNames: maintenanceRecords
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
    initialMileageReadingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(input);
  const customer = await prisma.customer.findUnique({ where: { id: parsed.customerId } });
  assertSameShop(context, customer?.shopId);

  await prisma.$transaction(async (tx) => {
    const readingDate = parsed.initialMileageReadingDate ?? currentDateInTimeZone(context.shopTimezone);
    const validationIssues = validateMileageReading({
      reading: { readingMileage: parsed.currentMileage, readingDate },
      existingReadings: [],
      vehicleYear: parsed.year,
      asOf: currentDateInTimeZone(context.shopTimezone),
    });
    const blockingIssue = validationIssues.find((issue) => issue.severity === "error");
    if (blockingIssue) {
      throw new SafeActionError({
        code: blockingIssue.code,
        message: blockingIssue.message,
        status: 400,
        table: "VehicleMileageReading",
        operation: "INSERT",
      });
    }

    const vehicle = await tx.vehicle.create({
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
        lastServiceDate: dateFromDateOnly(readingDate),
      },
    });

    const services = await tx.serviceDefinition.findMany({
      where: { shopId: context.shopId, isActive: true },
      take: 6,
    });

    await tx.vehicleMaintenanceRecord.createMany({
      data: services.map((service) => ({
        shopId: context.shopId,
        vehicleId: vehicle.id,
        serviceDefinitionId: service.id,
        serviceName: service.name,
        lastCompletedDate: dateFromDateOnly(readingDate),
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

    if (parsed.currentMileage > 0) {
      const warningMessages = validationIssues
        .filter((issue) => issue.severity === "warning")
        .map((issue) => issue.message);
      await tx.vehicleMileageReading.create({
        data: {
          shopId: context.shopId,
          vehicleId: vehicle.id,
          readingMileage: parsed.currentMileage,
          readingDate: dateFromDateOnly(readingDate),
          source: "SHOP_MANUAL_ENTRY",
          verificationStatus: "VERIFIED",
          anomalyStatus: warningMessages.length > 0 ? "NEEDS_REVIEW" : "NONE",
          includedInForecast: warningMessages.length === 0,
          reviewNotes: warningMessages.join(" ") || null,
          recordedByUserId: context.userId,
        },
      });
      await recalculatePersistedDrivingProfile({ tx, context, vehicleId: vehicle.id });
    }
  });
}

export async function updatePilotVehicle(
  context: AuthenticatedShopContext,
  vehicleId: string,
  input: unknown,
) {
  const existing = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  assertSameShop(context, existing?.shopId);
  const parsed = vehicleSchema.partial().omit({ customerId: true }).extend({
    mileageReadingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(input);
  const { currentMileage, mileageReadingDate, ...vehicleData } = parsed;
  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: vehicleData,
  });
  if (currentMileage !== undefined && currentMileage !== existing?.currentMileage) {
    await updatePilotVehicleMileage(context, {
      vehicleId,
      currentMileage,
      readingDate: mileageReadingDate ?? currentDateInTimeZone(context.shopTimezone),
      allowLowerCorrection: currentMileage < (existing?.currentMileage ?? 0),
      correctionReason: currentMileage < (existing?.currentMileage ?? 0) ? "Corrected from vehicle edit." : undefined,
    });
  }
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
  const existingReadings = await prisma.vehicleMileageReading.findMany({
    where: { shopId: context.shopId, vehicleId: record.vehicleId },
    orderBy: [{ readingDate: "asc" }, { createdAt: "asc" }],
  });
  const validationIssues = validateMileageReading({
    reading: {
      readingMileage: parsed.completedMileage,
      readingDate: parsed.completedAt,
    },
    existingReadings: existingReadings.map((reading) => ({
      readingMileage: reading.readingMileage,
      readingDate: dateOnly(reading.readingDate),
      source: reading.source,
      verificationStatus: reading.verificationStatus,
      anomalyStatus: reading.anomalyStatus,
      includedInForecast: reading.includedInForecast,
    })),
    vehicleYear: record.vehicle.year,
    asOf: currentDateInTimeZone(context.shopTimezone),
  });
  const blockingIssue = validationIssues.find((issue) => issue.severity === "error");
  if (blockingIssue) {
    throw new SafeActionError({
      code: blockingIssue.code,
      message: blockingIssue.message,
      status: 400,
      table: "VehicleMileageReading",
      operation: "INSERT",
    });
  }

  await prisma.$transaction(async (tx) => {
    const completedDate = dateFromDateOnly(parsed.completedAt);
    const warningMessages = validationIssues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.message);
    const serviceHistory = await tx.serviceHistoryRecord.create({
      data: {
        shopId: context.shopId,
        customerId: record.vehicle.customerId,
        vehicleId: record.vehicleId,
        serviceDefinitionId: record.serviceDefinitionId,
        maintenanceRecordId: record.id,
        serviceName: record.customServiceName || record.serviceName,
        completedAt: completedDate,
        mileage: parsed.completedMileage,
        laborMinutes: parsed.finalLaborMinutes,
        priceCents: parsed.finalPriceCents,
        notes: parsed.notes || null,
      },
    });
    await tx.vehicleMileageReading.create({
      data: {
        shopId: context.shopId,
        vehicleId: record.vehicleId,
        readingMileage: parsed.completedMileage,
        readingDate: completedDate,
        source: "SHOP_REPAIR_ORDER",
        verificationStatus: "VERIFIED",
        anomalyStatus: warningMessages.length > 0 ? "NEEDS_REVIEW" : "NONE",
        includedInForecast: warningMessages.length === 0,
        reviewNotes: warningMessages.join(" ") || null,
        sourceReferenceType: "ServiceHistoryRecord",
        sourceReferenceId: serviceHistory.id,
        recordedByUserId: context.userId,
      },
    });
    await tx.vehicleMaintenanceRecord.update({
      where: { id: record.id },
      data: {
        lastCompletedDate: completedDate,
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
        lastServiceDate: completedDate,
      },
    });
    await tx.maintenanceRevenueOpportunity.updateMany({
      where: { shopId: context.shopId, maintenanceRecordId: record.id },
      data: { stage: "COMPLETED", lastActivityAt: completedDate },
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
          readingDate: parsed.completedAt,
          warnings: warningMessages,
        },
      },
    });
    await recalculatePersistedDrivingProfile({ tx, context, vehicleId: record.vehicleId });
  });
}

async function recalculatePersistedDrivingProfile({
  tx,
  context,
  vehicleId,
  customerReportedAnnualMileage,
  clearManualOverride = false,
  manualAnnualMileageOverride,
  manualOverrideReason,
  manualOverrideNotes,
}: {
  tx: MileageTransactionClient;
  context: AuthenticatedShopContext;
  vehicleId: string;
  customerReportedAnnualMileage?: number | null;
  clearManualOverride?: boolean;
  manualAnnualMileageOverride?: number | null;
  manualOverrideReason?: string | null;
  manualOverrideNotes?: string | null;
}) {
  const existing = await tx.vehicleDrivingProfile.findUnique({ where: { vehicleId } });
  const shopDefaultRows = await tx.$queryRaw<{ defaultAnnualMileage: number | null }[]>`
    SELECT "defaultAnnualMileage" FROM public."Shop" WHERE "id" = ${context.shopId} LIMIT 1
  `;
  const readings = await tx.vehicleMileageReading.findMany({
    where: { shopId: context.shopId, vehicleId },
    orderBy: [{ readingDate: "asc" }, { createdAt: "asc" }],
  });
  const customerReported = customerReportedAnnualMileage ?? existing?.customerReportedAnnualMileage ?? null;
  const now = new Date();
  const manualOverride = clearManualOverride
    ? null
    : manualAnnualMileageOverride ?? existing?.manualAnnualMileageOverride ?? null;
  const calculated = calculateDrivingProfile({
    shopId: context.shopId,
    vehicleId,
    readings: readings.map((reading) => ({
      readingMileage: reading.readingMileage,
      readingDate: dateOnly(reading.readingDate),
      source: reading.source,
      verificationStatus: reading.verificationStatus,
      anomalyStatus: reading.anomalyStatus,
      includedInForecast: reading.includedInForecast,
    })),
    shopDefaultAnnualMileage: shopDefaultRows[0]?.defaultAnnualMileage ?? DEFAULT_ANNUAL_MILEAGE,
    customerReportedAnnualMileage: customerReported,
    customerReportedAt: customerReportedAnnualMileage !== undefined ? now.toISOString() : iso(existing?.customerReportedAt) || null,
    customerReportedByUserId: customerReportedAnnualMileage !== undefined ? context.userId : existing?.customerReportedByUserId ?? null,
    existingProfile: {
      customerReportedAnnualMileage: customerReported,
      customerReportedAt: customerReportedAnnualMileage !== undefined ? now.toISOString() : iso(existing?.customerReportedAt) || null,
      customerReportedByUserId: customerReportedAnnualMileage !== undefined ? context.userId : existing?.customerReportedByUserId ?? null,
      manualAnnualMileageOverride: manualOverride,
      manualOverrideReason: clearManualOverride ? null : manualOverrideReason ?? existing?.manualOverrideReason ?? null,
      manualOverrideNotes: clearManualOverride ? null : manualOverrideNotes ?? existing?.manualOverrideNotes ?? null,
      manualOverrideSetAt: manualAnnualMileageOverride !== undefined ? now.toISOString() : clearManualOverride ? null : iso(existing?.manualOverrideSetAt) || null,
      manualOverrideSetByUserId: manualAnnualMileageOverride !== undefined ? context.userId : clearManualOverride ? null : existing?.manualOverrideSetByUserId ?? null,
    },
    asOf: now,
  });

  await tx.vehicleDrivingProfile.upsert({
    where: { vehicleId },
    create: {
      shopId: context.shopId,
      vehicleId,
      customerReportedAnnualMileage: calculated.customerReportedAnnualMileage,
      customerReportedAt: calculated.customerReportedAt ? new Date(calculated.customerReportedAt) : null,
      customerReportedByUserId: calculated.customerReportedByUserId,
      calculatedAnnualMileage: calculated.calculatedAnnualMileage,
      estimateSource: calculated.estimateSource,
      confidence: calculated.confidence,
      confidenceReason: calculated.confidenceReason,
      manualAnnualMileageOverride: calculated.manualAnnualMileageOverride,
      manualOverrideReason: calculated.manualOverrideReason,
      manualOverrideNotes: calculated.manualOverrideNotes,
      manualOverrideSetAt: calculated.manualOverrideSetAt ? new Date(calculated.manualOverrideSetAt) : null,
      manualOverrideSetByUserId: calculated.manualOverrideSetByUserId,
      lastCalculatedAt: now,
    },
    update: {
      customerReportedAnnualMileage: calculated.customerReportedAnnualMileage,
      customerReportedAt: calculated.customerReportedAt ? new Date(calculated.customerReportedAt) : null,
      customerReportedByUserId: calculated.customerReportedByUserId,
      calculatedAnnualMileage: calculated.calculatedAnnualMileage,
      estimateSource: calculated.estimateSource,
      confidence: calculated.confidence,
      confidenceReason: calculated.confidenceReason,
      manualAnnualMileageOverride: calculated.manualAnnualMileageOverride,
      manualOverrideReason: calculated.manualOverrideReason,
      manualOverrideNotes: calculated.manualOverrideNotes,
      manualOverrideSetAt: calculated.manualOverrideSetAt ? new Date(calculated.manualOverrideSetAt) : null,
      manualOverrideSetByUserId: calculated.manualOverrideSetByUserId,
      lastCalculatedAt: now,
    },
  });
}

export async function updatePilotVehicleMileage(context: AuthenticatedShopContext, input: unknown) {
  const parsed = mileageUpdateSchema.parse(input);
  const vehicle = await requireVehicleInActiveShop(context, parsed.vehicleId);
  const existingReadings = await prisma.vehicleMileageReading.findMany({
    where: { shopId: context.shopId, vehicleId: vehicle.id },
    orderBy: [{ readingDate: "asc" }, { createdAt: "asc" }],
  });
  const validationIssues = validateMileageReading({
    reading: {
      readingMileage: parsed.currentMileage,
      readingDate: parsed.readingDate,
    },
    existingReadings: existingReadings.map((reading) => ({
      readingMileage: reading.readingMileage,
      readingDate: dateOnly(reading.readingDate),
      source: reading.source,
      verificationStatus: reading.verificationStatus,
      anomalyStatus: reading.anomalyStatus,
      includedInForecast: reading.includedInForecast,
    })),
    vehicleYear: vehicle.year,
    asOf: currentDateInTimeZone(context.shopTimezone),
  });
  const blockingIssue = validationIssues.find((issue) => issue.severity === "error");
  if (blockingIssue) {
    throw new SafeActionError({
      code: blockingIssue.code,
      message: blockingIssue.message,
      status: 400,
      table: "VehicleMileageReading",
      operation: "INSERT",
    });
  }
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
    const warningMessages = validationIssues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.message);
    const needsReview = warningMessages.length > 0;
    await tx.vehicleMileageReading.create({
      data: {
        shopId: context.shopId,
        vehicleId: vehicle.id,
        readingMileage: parsed.currentMileage,
        readingDate: dateFromDateOnly(parsed.readingDate),
        source: parsed.currentMileage < vehicle.currentMileage ? "CORRECTION" : parsed.source,
        verificationStatus: parsed.verificationStatus,
        anomalyStatus: needsReview ? "NEEDS_REVIEW" : parsed.currentMileage < vehicle.currentMileage ? "RESOLVED" : "NONE",
        includedInForecast: !needsReview,
        correctionReason: parsed.correctionReason || null,
        reviewNotes: [parsed.notes?.trim(), warningMessages.join(" ")]
          .filter(Boolean)
          .join(" ")
          || null,
        recordedByUserId: context.userId,
      },
    });
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
          readingDate: parsed.readingDate,
          correctionReason: parsed.correctionReason,
          warnings: warningMessages,
        },
      },
    });
    await recalculatePersistedDrivingProfile({ tx, context, vehicleId: vehicle.id });
  });
}

export async function setPilotCustomerReportedMileage(context: AuthenticatedShopContext, input: unknown) {
  requireDrivingEstimateManager(context);
  const parsed = customerReportedMileageSchema.parse(input);
  const vehicle = await requireVehicleInActiveShop(context, parsed.vehicleId);

  await prisma.$transaction(async (tx) => {
    await recalculatePersistedDrivingProfile({
      tx,
      context,
      vehicleId: vehicle.id,
      customerReportedAnnualMileage: parsed.annualMileage,
    });
    await tx.vehicle.update({
      where: { id: vehicle.id },
      data: { estimatedAnnualMileage: parsed.annualMileage },
    });
    await tx.auditLog.create({
      data: {
        shopId: context.shopId,
        actorUserId: context.userId,
        action: "vehicle.customer_reported_annual_mileage_set",
        entityType: "Vehicle",
        entityId: vehicle.id,
        metadata: { annualMileage: parsed.annualMileage },
      },
    });
  });
}

export async function setPilotManualMileageOverride(context: AuthenticatedShopContext, input: unknown) {
  requireDrivingEstimateManager(context);
  const parsed = manualMileageOverrideSchema.parse(input);
  const vehicle = await requireVehicleInActiveShop(context, parsed.vehicleId);
  const reviewNote = [
    parsed.notes?.trim(),
    `Review condition: ${parsed.reviewCondition.replaceAll("_", " ").toLowerCase()}.`,
    parsed.reviewDate ? `Review date: ${parsed.reviewDate}.` : "",
  ].filter(Boolean).join("\n");

  await prisma.$transaction(async (tx) => {
    await recalculatePersistedDrivingProfile({
      tx,
      context,
      vehicleId: vehicle.id,
      manualAnnualMileageOverride: parsed.annualMileage,
      manualOverrideReason: parsed.reason,
      manualOverrideNotes: reviewNote || null,
    });
    await tx.auditLog.create({
      data: {
        shopId: context.shopId,
        actorUserId: context.userId,
        action: "vehicle.driving_profile_manual_override_set",
        entityType: "Vehicle",
        entityId: vehicle.id,
        metadata: {
          annualMileage: parsed.annualMileage,
          reason: parsed.reason,
          reviewCondition: parsed.reviewCondition,
          reviewDate: parsed.reviewDate || null,
        },
      },
    });
  });
}

export async function resetPilotManualMileageOverride(context: AuthenticatedShopContext, input: unknown) {
  requireDrivingEstimateManager(context);
  const parsed = z.object({ vehicleId: z.string().min(1) }).parse(input);
  const vehicle = await requireVehicleInActiveShop(context, parsed.vehicleId);

  await prisma.$transaction(async (tx) => {
    await recalculatePersistedDrivingProfile({
      tx,
      context,
      vehicleId: vehicle.id,
      clearManualOverride: true,
    });
    await tx.auditLog.create({
      data: {
        shopId: context.shopId,
        actorUserId: context.userId,
        action: "vehicle.driving_profile_manual_override_reset",
        entityType: "Vehicle",
        entityId: vehicle.id,
      },
    });
  });
}

export async function reviewPilotMileageReading(context: AuthenticatedShopContext, input: unknown) {
  requireDrivingEstimateManager(context);
  const parsed = mileageReadingReviewSchema.parse(input);
  const reading = await prisma.vehicleMileageReading.findUnique({ where: { id: parsed.readingId } });
  assertSameShop(context, reading?.shopId);

  await prisma.$transaction(async (tx) => {
    await tx.vehicleMileageReading.update({
      where: { id: parsed.readingId },
      data: {
        includedInForecast: parsed.includedInForecast,
        anomalyStatus: parsed.anomalyStatus,
        reviewNotes: parsed.reviewNotes || null,
      },
    });
    await recalculatePersistedDrivingProfile({ tx, context, vehicleId: reading!.vehicleId });
    await tx.auditLog.create({
      data: {
        shopId: context.shopId,
        actorUserId: context.userId,
        action: "vehicle.mileage_reading_reviewed",
        entityType: "VehicleMileageReading",
        entityId: parsed.readingId,
        metadata: {
          includedInForecast: parsed.includedInForecast,
          anomalyStatus: parsed.anomalyStatus,
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
    const importedMileageKeys = new Set<string>();

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
        const serviceDate = stringValue(normalized, "serviceDate");
        const serviceMileage = numberValue(normalized, "serviceMileage") || numberValue(normalized, "currentMileage");
        const serviceHistory = await tx.serviceHistoryRecord.create({
          data: {
            shopId: context.shopId,
            customerId: customer.id,
            vehicleId: vehicle.id,
            serviceDefinitionId: service.id,
            serviceName,
            completedAt: dateFromDateOnly(serviceDate),
            mileage: serviceMileage,
            laborMinutes,
            priceCents,
            notes: "Imported from CSV.",
          },
        });
        const mileageKey = `${vehicle.id}|${serviceDate}|${serviceMileage}`;
        const existingReading = serviceMileage > 0
          ? await tx.vehicleMileageReading.findFirst({
            where: {
              shopId: context.shopId,
              vehicleId: vehicle.id,
              readingDate: dateFromDateOnly(serviceDate),
              readingMileage: serviceMileage,
            },
          })
          : null;
        if (serviceMileage > 0 && !existingReading && !importedMileageKeys.has(mileageKey)) {
          importedMileageKeys.add(mileageKey);
          await tx.vehicleMileageReading.create({
            data: {
              shopId: context.shopId,
              vehicleId: vehicle.id,
              readingMileage: serviceMileage,
              readingDate: dateFromDateOnly(serviceDate),
              source: "SERVICE_HISTORY_IMPORT",
              verificationStatus: "IMPORTED",
              anomalyStatus: "NONE",
              includedInForecast: true,
              sourceReferenceType: "ServiceHistoryRecord",
              sourceReferenceId: serviceHistory.id,
              recordedByUserId: context.userId,
            },
          });
          await recalculatePersistedDrivingProfile({ tx, context, vehicleId: vehicle.id });
        }
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
