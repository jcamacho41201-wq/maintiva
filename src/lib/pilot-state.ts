import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  serviceDefinitions as defaultServices,
  type Appointment,
  type BookingMode,
  type Customer,
  type CustomerBookingLink,
  type DeclinedWorkRecord,
  type DemoState,
  type ImportHistoryRecord,
  type MaintenanceService,
  type VehicleDrivingProfile,
  type VehicleMileageReading,
  type OutreachRecord,
  type ServiceBookingIntakeOption,
  type ShopBookingBlackout,
  type ShopBookingSettings,
  type SmartMaintenanceBlock,
  type SmartMaintenanceBlockBlackout,
  type RevenueOpportunityRecord,
  type TimeIntervalUnit,
  type Vehicle,
  type VehicleMaintenanceRecord,
  defaultBookingSettings,
  defaultBookingWindows,
} from "@/lib/demo-data";
import { assertSameShop, type AuthenticatedShopContext } from "@/lib/auth";
import { customerSchema, vehicleSchema } from "@/lib/validation";
import { resolveMaintenanceInterval, timeIntervalToMonths } from "@/lib/service-intervals";
import {
  DEFAULT_ANNUAL_MILEAGE,
  calculateDrivingProfile,
  resolveCurrentMileage,
  resolveEffectiveForecastMileage,
  validateMileageReading,
} from "@/lib/adaptive-mileage";
import { resolveForecastAsOfDate } from "@/lib/forecast-dates";
import { currentDateInTimeZone } from "@/lib/utils";
import { safeDatabaseError, SafeActionError } from "@/lib/server-diagnostics";
import { isCustomerBookingEnabled, isSmartMaintenanceBlocksEnabled } from "@/lib/feature-flags";
import {
  MAINTIVA_IMPORT_ROW_LIMIT,
  importRowLimitMessage,
  isImportRowLimitExceeded,
  classifyImportRowEvent,
  effectiveImportRowAction,
  previewImport,
  summarizeImport,
  type CsvRow,
  type DuplicateImportMode,
  type ImportRowAction,
  type ImportType,
  type MaintivaField,
  type NormalizedCsvValue,
} from "@/lib/csv-import";
import { createCustomerBookingLink } from "@/lib/customer-booking";

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
const bookingModeSchema = z.enum(["INSTANT", "REQUEST"]);
const bookingIntakeOptionSchema = z.enum(["WAIT_ONLY", "DROP_OFF_ONLY", "EITHER"]);

const nullableNonnegativeInt = z.number().int().nonnegative().nullable().optional();
const nullablePositiveInt = z.number().int().positive().nullable().optional();

const baselineAppointmentServiceSelect = {
  id: true,
  shopId: true,
  appointmentId: true,
  serviceDefinitionId: true,
  maintenanceRecordId: true,
  serviceName: true,
  laborMinutes: true,
  priceCents: true,
  createdAt: true,
} satisfies Prisma.AppointmentServiceSelect;

const baselineAppointmentSelect = {
  id: true,
  shopId: true,
  customerId: true,
  vehicleId: true,
  scheduledStart: true,
  scheduledEnd: true,
  status: true,
  totalLaborMinutes: true,
  totalPriceCents: true,
  source: true,
  attributionSource: true,
  opportunityId: true,
  outreachRecordId: true,
  completedRevenueCents: true,
  completedLaborMinutes: true,
  notes: true,
  completedAt: true,
} satisfies Prisma.AppointmentSelect;

const baselineAppointmentWithServicesSelect = {
  ...baselineAppointmentSelect,
  services: { select: baselineAppointmentServiceSelect },
} satisfies Prisma.AppointmentSelect;

const duplicateAppointmentSelect = {
  id: true,
} satisfies Prisma.AppointmentSelect;

const baselineOutreachRecordSelect = {
  id: true,
  shopId: true,
  customerId: true,
  vehicleId: true,
  message: true,
  channel: true,
  status: true,
  copiedAt: true,
  manuallySentAt: true,
  responseStatus: true,
  followUpDate: true,
  appointmentId: true,
  performedByUserId: true,
  createdAt: true,
} satisfies Prisma.OutreachRecordSelect;

const shopBookingSettingsSchema = z.object({
  onlineBookingEnabled: z.boolean(),
  minimumNoticeMinutes: z.number().int().min(0).max(43_200),
  maximumAdvanceDays: z.number().int().min(1).max(180),
  defaultBufferBeforeMinutes: z.number().int().min(0).max(240),
  defaultBufferAfterMinutes: z.number().int().min(0).max(240),
  maximumSimultaneousAppointments: z.number().int().min(1).max(20),
  cancellationCutoffMinutes: z.number().int().min(0).max(43_200),
  reschedulingCutoffMinutes: z.number().int().min(0).max(43_200),
  windows: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    isActive: z.boolean(),
  }).refine((value) => value.endMinute > value.startMinute, {
    message: "Booking window must end after it starts.",
    path: ["endMinute"],
  })).min(1).max(7).optional(),
});

const serviceBookingRuleSchema = z.object({
  bookingEnabled: z.boolean(),
  bookingMode: bookingModeSchema,
  estimatedDurationMinutes: z.number().int().min(15).max(1440),
  bufferBeforeMinutes: z.number().int().min(0).max(240),
  bufferAfterMinutes: z.number().int().min(0).max(240),
  allowedIntakeType: bookingIntakeOptionSchema,
  minimumNoticeMinutes: z.number().int().min(0).max(43_200).nullable().optional(),
  maximumAdvanceDays: z.number().int().min(1).max(180).nullable().optional(),
  maximumSimultaneousBookings: z.number().int().min(1).max(20).nullable().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
}).refine((value) => value.endMinute > value.startMinute, {
  message: "Service booking window must end after it starts.",
  path: ["endMinute"],
});

const smartMaintenanceBlockSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean(),
  timezone: z.string().trim().min(3).max(80).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  serviceDefinitionIds: z.array(z.string().min(1)).min(1).max(50),
  maxVehicles: z.number().int().min(1).max(50),
  maxLaborMinutes: z.number().int().min(15).max(24 * 60),
  minimumNoticeMinutes: z.number().int().min(0).max(180 * 24 * 60),
  maximumHorizonDays: z.number().int().min(1).max(365),
  slotIntervalMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  internalNotes: z.string().trim().max(1000).optional(),
}).refine((value) => value.endMinute > value.startMinute, {
  message: "Block end time must be after the start time.",
  path: ["endMinute"],
});

const smartMaintenanceBlockBlackoutSchema = z.object({
  id: z.string().min(1).optional(),
  blockId: z.string().min(1).nullable().optional(),
  startsAt: z.string().min(8),
  endsAt: z.string().min(8),
  reason: z.string().trim().max(240).optional(),
  isFullDay: z.boolean().optional(),
}).refine((value) => {
  const startsAt = new Date(value.startsAt);
  const endsAt = new Date(value.endsAt);
  return !Number.isNaN(startsAt.getTime()) && !Number.isNaN(endsAt.getTime()) && endsAt > startsAt;
}, {
  message: "Blackout end time must be after the start time.",
  path: ["endsAt"],
});

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

const inspectionRecommendationSchema = z.object({
  serviceName: z.string().optional(),
  result: z.enum(["ACCEPTED", "DECLINED", "UNDECIDED"]).default("UNDECIDED"),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  priceCents: z.number().int().nonnegative().default(0),
  laborMinutes: z.number().int().nonnegative().default(0),
  notes: z.string().optional(),
});

const inspectionSchema = z.object({
  vehicleId: z.string().min(1),
  inspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Inspection date is required."),
  mileage: z.number().int().nonnegative().optional().nullable(),
  technician: z.string().optional(),
  condition: z.enum(["PASS", "MONITOR", "REQUIRES_ATTENTION", "FAIL"]).default("MONITOR"),
  componentsInspected: z.string().optional(),
  notes: z.string().optional(),
  recommendations: z.array(inspectionRecommendationSchema).max(10).default([]),
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

function stringValue(record: Record<string, NormalizedCsvValue>, key: string) {
  return String(record[key] ?? "").trim();
}

function numberValue(record: Record<string, NormalizedCsvValue>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumberValue(record: Record<string, NormalizedCsvValue>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function appointmentDateTime(date: string, time: string) {
  if (!date || !time) return undefined;
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function daysBetween(start: Date, end = new Date()) {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

function priorityForOpportunity(input: {
  source: "DUE_MAINTENANCE" | "OVERDUE_MAINTENANCE" | "DECLINED_WORK";
  daysOverdue: number;
  milesOverdue: number;
  estimatedRevenueCents: number;
  booked: boolean;
}) {
  if (input.booked) {
    return {
      priority: "LOW" as const,
      priorityReason: "Appointment already booked.",
    };
  }
  if (
    input.source === "DECLINED_WORK" ||
    input.daysOverdue >= 30 ||
    input.milesOverdue >= 1000
  ) {
    return {
      priority: "HIGH" as const,
      priorityReason:
        input.source === "DECLINED_WORK"
          ? "Previously declined work is recoverable and ready for advisor follow-up."
          : "High urgency or value based on overdue severity and estimated revenue.",
    };
  }
  if (input.daysOverdue > 0 || input.milesOverdue > 0 || input.estimatedRevenueCents >= 10000) {
    return {
      priority: "MEDIUM" as const,
      priorityReason: "Due service has meaningful value and should fill future capacity.",
    };
  }
  return {
    priority: "LOW" as const,
    priorityReason: "Lower urgency; keep available for capacity gaps.",
  };
}

function stageFromOutreach(input: {
  outreachStatus?: string | null;
  responseStatus?: string | null;
  appointmentId?: string | null;
  completed?: boolean;
  lost?: boolean;
}) {
  if (input.completed) return "COMPLETED" as const;
  if (input.lost) return "LOST" as const;
  if (input.appointmentId || input.outreachStatus === "SCHEDULED") return "BOOKED" as const;
  if (input.responseStatus && input.responseStatus !== "NO_RESPONSE") {
    return input.responseStatus === "DECLINED" || input.responseStatus === "DO_NOT_CONTACT"
      ? ("LOST" as const)
      : ("RESPONDED" as const);
  }
  if (input.outreachStatus === "SNOOZED") return "CONTACTED" as const;
  if (input.outreachStatus === "MANUALLY_SENT" || input.outreachStatus === "RESPONDED") return "CONTACTED" as const;
  if (input.outreachStatus === "DECLINED" || input.outreachStatus === "STOPPED") return "LOST" as const;
  return "IDENTIFIED" as const;
}

type OpportunitySyncClient = Pick<
  typeof prisma,
  "$executeRaw" | "$queryRaw" | "maintenanceRevenueOpportunity" | "vehicleMaintenanceRecord" | "declinedWorkRecord" | "vehicleMileageReading" | "vehicleDrivingProfile"
>;

function toStateVehicle(vehicle: {
  id: string;
  shopId: string;
  customerId: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  licensePlate: string | null;
  engine: string | null;
  trim: string | null;
  vehicleType: string | null;
  currentMileage: number;
  estimatedAnnualMileage: number | null;
  overallHealth: number;
  lastServiceDate: Date | null;
  updatedAt?: Date;
}): Vehicle {
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
    currentMileage: vehicle.currentMileage,
    estimatedAnnualMileage: vehicle.estimatedAnnualMileage ?? DEFAULT_ANNUAL_MILEAGE,
    overallHealth: vehicle.overallHealth,
    lastServiceDate: dateOnly(vehicle.lastServiceDate || vehicle.updatedAt),
  };
}

async function resolveVehicleForecastMileageForSync({
  tx,
  context,
  vehicle,
  asOf,
}: {
  tx: OpportunitySyncClient;
  context: AuthenticatedShopContext;
  vehicle: Parameters<typeof toStateVehicle>[0];
  asOf: Date | string;
}) {
  const [readings, existingProfile, shopDefaultRows] = await Promise.all([
    tx.vehicleMileageReading.findMany({
      where: { shopId: context.shopId, vehicleId: vehicle.id },
      orderBy: [{ readingDate: "asc" }, { createdAt: "asc" }],
    }),
    tx.vehicleDrivingProfile.findUnique({ where: { vehicleId: vehicle.id } }),
    tx.$queryRaw<{ defaultAnnualMileage: number | null }[]>`
      SELECT "defaultAnnualMileage" FROM public."Shop" WHERE "id" = ${context.shopId} LIMIT 1
    `,
  ]);

  return resolveEffectiveForecastMileage({
    shopId: context.shopId,
    vehicleId: vehicle.id,
    readings: readings.map((reading) => ({
      readingMileage: reading.readingMileage,
      readingDate: dateOnly(reading.readingDate),
      source: reading.source,
      verificationStatus: reading.verificationStatus,
      anomalyStatus: reading.anomalyStatus,
      includedInForecast: reading.includedInForecast,
    })),
    shopDefaultAnnualMileage: shopDefaultRows[0]?.defaultAnnualMileage ?? DEFAULT_ANNUAL_MILEAGE,
    customerReportedAnnualMileage: existingProfile?.customerReportedAnnualMileage ?? vehicle.estimatedAnnualMileage,
    customerReportedAt: dateOnly(existingProfile?.customerReportedAt) || null,
    customerReportedByUserId: existingProfile?.customerReportedByUserId ?? null,
    existingProfile: existingProfile
      ? {
          customerReportedAnnualMileage: existingProfile.customerReportedAnnualMileage,
          customerReportedAt: dateOnly(existingProfile.customerReportedAt) || null,
          customerReportedByUserId: existingProfile.customerReportedByUserId,
          manualAnnualMileageOverride: existingProfile.manualAnnualMileageOverride,
          manualOverrideReason: existingProfile.manualOverrideReason,
          manualOverrideNotes: existingProfile.manualOverrideNotes,
          manualOverrideSetAt: iso(existingProfile.manualOverrideSetAt) || null,
          manualOverrideSetByUserId: existingProfile.manualOverrideSetByUserId,
        }
      : null,
    asOf,
    shopTimezone: context.shopTimezone,
  });
}

function toStateServiceDefinition(service: {
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
  bookingRule?: StateServiceDefinition["bookingRule"];
}): MaintenanceService {
  return {
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
    bookingRule: service.bookingRule ? {
      id: service.bookingRule.id,
      shopId: service.bookingRule.shopId,
      serviceDefinitionId: service.bookingRule.serviceDefinitionId,
      bookingEnabled: service.bookingRule.bookingEnabled,
      bookingMode: service.bookingRule.bookingMode,
      estimatedDurationMinutes: service.bookingRule.estimatedDurationMinutes,
      bufferBeforeMinutes: service.bookingRule.bufferBeforeMinutes,
      bufferAfterMinutes: service.bookingRule.bufferAfterMinutes,
      allowedIntakeType: service.bookingRule.allowedIntakeType,
      minimumNoticeMinutes: service.bookingRule.minimumNoticeMinutes,
      maximumAdvanceDays: service.bookingRule.maximumAdvanceDays,
      maximumSimultaneousBookings: service.bookingRule.maximumSimultaneousBookings,
      windows: service.bookingRule.windows.map((window) => ({
        id: window.id,
        shopId: window.shopId,
        dayOfWeek: window.dayOfWeek,
        startMinute: window.startMinute,
        endMinute: window.endMinute,
        isActive: window.isActive,
      })),
    } : undefined,
  };
}

function toStateMaintenanceRecord(record: {
  id: string;
  shopId: string;
  vehicleId: string;
  serviceDefinitionId: string | null;
  serviceName: string;
  customServiceName: string | null;
  customCategory: string | null;
  lastCompletedDate: Date | null;
  lastCompletedMileage: number | null;
  recommendedMileageInterval: number | null;
  recommendedTimeIntervalMonths: number | null;
  mileageIntervalOverride: number | null;
  timeIntervalValueOverride: number | null;
  timeIntervalUnitOverride: TimeIntervalUnit | null;
  notificationThreshold: number;
  outreachThresholdType: VehicleMaintenanceRecord["outreachThresholdType"];
  outreachThresholdValue: number;
  priceCents: number;
  laborMinutes: number;
  priceOverrideCents: number | null;
  laborMinutesOverride: number | null;
  outreachStatus: VehicleMaintenanceRecord["outreachStatus"];
  outreachRecordId: string | null;
  appointmentId: string | null;
  isActive: boolean | null;
  notes: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
}): VehicleMaintenanceRecord {
  return {
    id: record.id,
    shopId: record.shopId,
    vehicleId: record.vehicleId,
    serviceId: record.serviceDefinitionId,
    serviceName: record.serviceName,
    customServiceName: record.customServiceName ?? undefined,
    customCategory: record.customCategory ?? undefined,
    lastCompletedDate: dateOnly(record.lastCompletedDate) || null,
    lastCompletedMileage: record.lastCompletedMileage,
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
    isActive: record.isActive ?? true,
    notes: record.notes ?? undefined,
    createdByUserId: record.createdByUserId ?? undefined,
    updatedByUserId: record.updatedByUserId ?? undefined,
  };
}

function maintenanceStatusForDatabase(status: ReturnType<typeof resolveMaintenanceInterval>["status"]) {
  return status === "NOT_ENOUGH_HISTORY" ? "HEALTHY" : status;
}

function isMaintenanceOpportunityEligible(status: ReturnType<typeof resolveMaintenanceInterval>["status"]) {
  return ["DUE_SOON", "DUE", "OVERDUE"].includes(status);
}

function preserveRevenueStage({
  existingStage,
  recalculatedStage,
  closingStage,
}: {
  existingStage?: "IDENTIFIED" | "CONTACTED" | "RESPONDED" | "BOOKED" | "COMPLETED" | "LOST";
  recalculatedStage: "IDENTIFIED" | "CONTACTED" | "RESPONDED" | "BOOKED" | "COMPLETED" | "LOST";
  closingStage?: "COMPLETED" | "LOST";
}) {
  if (closingStage) return closingStage;
  if (!existingStage || ["COMPLETED", "LOST"].includes(existingStage)) return recalculatedStage;
  if (["BOOKED", "COMPLETED", "LOST"].includes(recalculatedStage)) return recalculatedStage;
  if (existingStage === "BOOKED") return "BOOKED";
  if (existingStage === "RESPONDED") return "RESPONDED";
  if (existingStage === "CONTACTED" && recalculatedStage === "IDENTIFIED") return "CONTACTED";
  return recalculatedStage;
}

async function syncMaintenanceRevenueOpportunities(
  tx: OpportunitySyncClient,
  context: AuthenticatedShopContext,
  maintenanceRecordIds: string[],
) {
  const uniqueIds = Array.from(new Set(maintenanceRecordIds));
  if (uniqueIds.length === 0) return [];

  const records = await tx.vehicleMaintenanceRecord.findMany({
    where: { id: { in: uniqueIds }, shopId: context.shopId },
    include: { vehicle: true, serviceDefinition: true },
  });
  const synced = [];

  for (const record of records) {
    assertSameShop(context, record.shopId);
    assertSameShop(context, record.vehicle.shopId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${context.shopId}:maintenance:${record.id}`}))`;
    const now = new Date();
    const forecastAsOfDate = resolveForecastAsOfDate({ shopTimezone: context.shopTimezone, now });
    const forecastMileage = await resolveVehicleForecastMileageForSync({
      tx,
      context,
      vehicle: record.vehicle,
      asOf: forecastAsOfDate,
    });
    const effective = resolveMaintenanceInterval({
      record: toStateMaintenanceRecord(record),
      service: record.serviceDefinition ? toStateServiceDefinition(record.serviceDefinition) : undefined,
      vehicle: toStateVehicle(record.vehicle),
      forecastMileage,
      asOf: forecastAsOfDate,
      shopTimezone: context.shopTimezone,
    });
    const computedStatus = maintenanceStatusForDatabase(effective.status);
    if (record.status !== computedStatus) {
      await tx.vehicleMaintenanceRecord.update({
        where: { id: record.id },
        data: { status: computedStatus, updatedByUserId: context.userId },
      });
    }
    const existing = await tx.maintenanceRevenueOpportunity.findFirst({
      where: {
        shopId: context.shopId,
        maintenanceRecordId: record.id,
        declinedWorkRecordId: null,
      },
    });

    const eligible = isMaintenanceOpportunityEligible(effective.status);
    if (!eligible || record.archivedAt || record.isActive === false) {
      if (existing && !["COMPLETED", "LOST"].includes(existing.stage)) {
        synced.push(await tx.maintenanceRevenueOpportunity.update({
          where: { id: existing.id },
          data: {
            stage: preserveRevenueStage({
              existingStage: existing.stage,
              recalculatedStage: "COMPLETED",
              closingStage: record.archivedAt || record.isActive === false ? "LOST" : "COMPLETED",
            }),
            explanation: record.archivedAt || record.isActive === false
              ? "Maintenance item was archived and no longer appears in the open queue."
              : "Maintenance item is no longer due.",
            lastActivityAt: new Date(),
          },
        }));
      }
      continue;
    }

    if (existing && ["COMPLETED", "LOST"].includes(existing.stage)) {
      continue;
    }

    const dueMileage = effective.nextDueMileage;
    const dueDate = effective.nextDueDate ? dateFromDateOnly(effective.nextDueDate) : null;
    const milesOverdue = effective.milesUntilDue !== null ? Math.max(0, -effective.milesUntilDue) : 0;
    const daysLate = effective.daysUntilDue !== null ? Math.max(0, -effective.daysUntilDue) : 0;
    const source = effective.status === "OVERDUE" || milesOverdue > 0 || daysLate > 0
      ? "OVERDUE_MAINTENANCE" as const
      : "DUE_MAINTENANCE" as const;
    const recalculatedStage = stageFromOutreach({
      outreachStatus: record.outreachStatus,
      appointmentId: record.appointmentId,
    });
    const stage = preserveRevenueStage({ existingStage: existing?.stage, recalculatedStage });
    const priority = priorityForOpportunity({
      source,
      daysOverdue: daysLate,
      milesOverdue,
      estimatedRevenueCents: effective.priceCents,
      booked: stage === "BOOKED" || stage === "COMPLETED",
    });
    const forecastNote = effective.forecastMileageKind === "ESTIMATED" && effective.latestKnownMileage !== null && effective.latestKnownDate
      ? ` Mileage is estimated from ${effective.latestKnownMileage.toLocaleString()} mi on ${effective.latestKnownDate}; ${(effective.forecastConfidence ?? "LOW").toLowerCase()} confidence.`
      : "";
    const explanation = (source === "OVERDUE_MAINTENANCE"
      ? `${effective.serviceName} is overdue for this vehicle.`
      : `${effective.serviceName} ${effective.dueText.toLowerCase()}.`) + forecastNote;
    const prioritized = effective.forecastMileageKind === "ESTIMATED" &&
      effective.forecastConfidence === "LOW" &&
      daysLate === 0 &&
      source !== "OVERDUE_MAINTENANCE"
      ? {
          priority: "LOW" as const,
          priorityReason: "Needs advisor confirmation; mileage is estimated from limited odometer history.",
        }
      : priority;
    const data = {
      shopId: context.shopId,
      customerId: record.vehicle.customerId,
      vehicleId: record.vehicleId,
      maintenanceRecordId: record.id,
      declinedWorkRecordId: null,
      source,
      stage,
      priority: prioritized.priority,
      explanation,
      priorityReason: prioritized.priorityReason,
      estimatedRevenueCents: effective.priceCents,
      estimatedLaborMinutes: effective.laborMinutes,
      dueDate,
      dueMileage,
      daysOverdue: daysLate,
      milesOverdue,
      lastActivityAt: new Date(),
    };

    synced.push(existing
      ? await tx.maintenanceRevenueOpportunity.update({
          where: { id: existing.id },
          data,
        })
      : await tx.maintenanceRevenueOpportunity.create({ data }));
  }

  return synced;
}

async function syncDeclinedWorkRevenueOpportunities(
  tx: OpportunitySyncClient,
  context: AuthenticatedShopContext,
  declinedWorkRecordIds: string[],
) {
  const uniqueIds = Array.from(new Set(declinedWorkRecordIds));
  if (uniqueIds.length === 0) return [];

  const records = await tx.declinedWorkRecord.findMany({
    where: { id: { in: uniqueIds }, shopId: context.shopId },
    include: { vehicle: true },
  });
  const synced = [];

  for (const record of records) {
    assertSameShop(context, record.shopId);
    assertSameShop(context, record.vehicle.shopId);
    if (record.vehicle.customerId !== record.customerId) continue;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${context.shopId}:declined-work:${record.id}`}))`;

    const existing = await tx.maintenanceRevenueOpportunity.findFirst({
      where: {
        shopId: context.shopId,
        declinedWorkRecordId: record.id,
        maintenanceRecordId: null,
      },
    });
    const stage = stageFromOutreach({
      outreachStatus: record.outreachStatus,
      appointmentId: record.appointmentId,
      completed: record.status === "COMPLETED",
      lost: record.status === "DECLINED",
    });
    const priority = priorityForOpportunity({
      source: "DECLINED_WORK",
      daysOverdue: daysBetween(record.declinedAt),
      milesOverdue: 0,
      estimatedRevenueCents: record.recommendedPriceCents,
      booked: stage === "BOOKED" || stage === "COMPLETED",
    });
    const data = {
      shopId: context.shopId,
      customerId: record.customerId,
      vehicleId: record.vehicleId,
      maintenanceRecordId: null,
      declinedWorkRecordId: record.id,
      source: "DECLINED_WORK" as const,
      stage,
      priority: priority.priority,
      explanation: `${record.serviceName} was declined on ${record.declinedAt.toISOString().slice(0, 10)}.`,
      priorityReason: priority.priorityReason,
      estimatedRevenueCents: record.recommendedPriceCents,
      estimatedLaborMinutes: record.laborMinutes,
      dueDate: record.declinedAt,
      dueMileage: null,
      daysOverdue: daysBetween(record.declinedAt),
      milesOverdue: 0,
      lastActivityAt: new Date(),
    };

    synced.push(existing
      ? await tx.maintenanceRevenueOpportunity.update({
          where: { id: existing.id },
          data,
        })
      : await tx.maintenanceRevenueOpportunity.create({ data }));
  }

  return synced;
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
  bookingRule?: {
    id: string;
    shopId: string;
    serviceDefinitionId: string;
    bookingEnabled: boolean;
    bookingMode: BookingMode;
    estimatedDurationMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    allowedIntakeType: ServiceBookingIntakeOption;
    minimumNoticeMinutes: number | null;
    maximumAdvanceDays: number | null;
    maximumSimultaneousBookings: number | null;
    windows: Array<{
      id: string;
      shopId: string;
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
      isActive: boolean;
    }>;
  } | null;
};

function importErrorReportSummary(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const report = value as {
    displayStatus?: ImportHistoryRecord["displayStatus"];
    heldRows?: number;
    invalidRows?: number;
    resultMessage?: string;
  };
  return {
    displayStatus: report.displayStatus,
    heldRows: typeof report.heldRows === "number" ? report.heldRows : undefined,
    invalidRows: typeof report.invalidRows === "number" ? report.invalidRows : undefined,
    resultMessage: typeof report.resultMessage === "string" ? report.resultMessage : undefined,
  };
}

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

type StateSmartMaintenanceBlock = {
  id: string;
  shopId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  timezone: string;
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  maxVehicles: number;
  maxLaborMinutes: number;
  minimumNoticeMinutes: number;
  maximumHorizonDays: number;
  slotIntervalMinutes: number;
  approvalRequired: boolean;
  internalNotes: string | null;
  createdByUserId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  services: Array<{
    serviceDefinitionId: string;
  }>;
};

type StateSmartMaintenanceBlockBlackout = {
  id: string;
  shopId: string;
  blockId: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
  isFullDay: boolean;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
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

export function isMissingCustomerBookingSchema(error: unknown) {
  const database = safeDatabaseError(error);
  if (!["P2010", "P2021", "P2022", "42P01", "42703", "42704"].includes(database.code ?? "")) return false;
  return [
    "ShopBookingSettings",
    "ShopBookingWindow",
    "ShopBookingBlackout",
    "ServiceBookingRule",
    "ServiceBookingWindow",
    "CustomerBookingLink",
    "AppointmentChangeRecord",
    "bookingLinkId",
    "intakeType",
  ].some((needle) => database.message?.includes(needle) || database.details?.includes(needle));
}

export function isMissingSmartMaintenanceBlocksSchema(error: unknown) {
  const database = safeDatabaseError(error);
  if (!["P2010", "P2021", "P2022", "42P01", "42703", "42704"].includes(database.code ?? "")) return false;
  return [
    "SmartMaintenanceBlock",
    "SmartMaintenanceBlockService",
    "SmartMaintenanceBlockBlackout",
    "serviceDefinitionIds",
    "slotIntervalMinutes",
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

function queueActionError({
  code,
  message,
  status = 400,
  operation = "UPDATE",
}: {
  code: string;
  message: string;
  status?: number;
  operation?: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
}) {
  return new SafeActionError({
    code,
    message,
    status,
    table: "MaintenanceRevenueOpportunity",
    operation,
  });
}

function assertCustomerBookingFeatureEnabled() {
  if (!isCustomerBookingEnabled()) {
    throw new SafeActionError({
      code: "CUSTOMER_BOOKING_DISABLED",
      message: "Customer booking is not available.",
      status: 404,
    });
  }
}

function assertSmartMaintenanceBlocksFeatureEnabled() {
  if (!isSmartMaintenanceBlocksEnabled()) {
    throw new SafeActionError({
      code: "SMART_MAINTENANCE_BLOCKS_DISABLED",
      message: "Smart Maintenance Blocks are not available.",
      status: 404,
    });
  }
}

function responseOutreachStatus(responseStatus?: OutreachRecord["responseStatus"]) {
  if (responseStatus === "DECLINED" || responseStatus === "DO_NOT_CONTACT") return "DECLINED" as const;
  if (responseStatus && responseStatus !== "NO_RESPONSE") return "RESPONDED" as const;
  return "MANUALLY_SENT" as const;
}

function responseOpportunityStage(responseStatus?: OutreachRecord["responseStatus"]) {
  if (responseStatus === "DECLINED" || responseStatus === "DO_NOT_CONTACT") return "LOST" as const;
  if (responseStatus && responseStatus !== "NO_RESPONSE") return "RESPONDED" as const;
  return "CONTACTED" as const;
}

function outreachIdFromIdempotencyKey(idempotencyKey?: string) {
  if (!idempotencyKey) return undefined;
  const normalized = idempotencyKey.trim();
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(normalized)) {
    throw queueActionError({
      code: "INVALID_OUTREACH_IDEMPOTENCY_KEY",
      message: "Refresh the page and try recording the outreach again.",
      status: 400,
      operation: "INSERT",
    });
  }
  return `outreach-${normalized}`;
}

function appointmentIdFromIdempotencyKey(idempotencyKey?: string) {
  if (!idempotencyKey) return undefined;
  const normalized = idempotencyKey.trim();
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(normalized)) {
    throw new SafeActionError({
      code: "INVALID_APPOINTMENT_IDEMPOTENCY_KEY",
      message: "Refresh the page and try creating the appointment again.",
      status: 400,
      table: "Appointment",
      operation: "INSERT",
    });
  }
  return `appt-${normalized}`;
}

function startOfLocalDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function requireFutureDate(value: string) {
  const parsed = startOfLocalDate(value);
  const today = startOfLocalDate(new Date().toISOString().slice(0, 10));
  if (Number.isNaN(parsed.getTime()) || parsed <= today) {
    throw queueActionError({
      code: "SNOOZE_DATE_NOT_FUTURE",
      message: "Choose a future snooze date.",
      status: 400,
    });
  }
  return parsed;
}

async function loadOpenQueueTargets(
  context: AuthenticatedShopContext,
  input: {
    customerId: string;
    vehicleId: string;
    opportunityIds: string[];
  },
) {
  const opportunityIds = Array.from(new Set(input.opportunityIds));
  if (opportunityIds.length === 0) {
    throw queueActionError({
      code: "OPPORTUNITY_REQUIRED",
      message: "Select at least one open opportunity.",
      status: 400,
      operation: "SELECT",
    });
  }
  opportunityIds.forEach((id) => assertProductionEntityId(id, "The selected opportunity"));

  const [customer, vehicle, opportunities] = await Promise.all([
    prisma.customer.findUnique({ where: { id: input.customerId } }),
    prisma.vehicle.findUnique({ where: { id: input.vehicleId } }),
    prisma.maintenanceRevenueOpportunity.findMany({
      where: {
        id: { in: opportunityIds },
        shopId: context.shopId,
      },
    }),
  ]);

  assertSameShop(context, customer?.shopId);
  assertSameShop(context, vehicle?.shopId);
  if (!vehicle || vehicle.customerId !== input.customerId) {
    throw queueActionError({
      code: "VEHICLE_CUSTOMER_MISMATCH",
      message: "Vehicle does not belong to the selected customer.",
      status: 403,
      operation: "SELECT",
    });
  }
  if (opportunities.length !== opportunityIds.length) {
    throw queueActionError({
      code: "OPPORTUNITY_NOT_IN_ACTIVE_SHOP",
      message: "You do not have permission to update this opportunity.",
      status: 403,
      operation: "SELECT",
    });
  }
  if (opportunities.some((opportunity) => opportunity.customerId !== input.customerId || opportunity.vehicleId !== input.vehicleId)) {
    throw queueActionError({
      code: "OPPORTUNITY_TARGET_MISMATCH",
      message: "This opportunity is no longer open.",
      status: 409,
      operation: "SELECT",
    });
  }
  if (opportunities.some((opportunity) => ["BOOKED", "COMPLETED", "LOST"].includes(opportunity.stage))) {
    throw queueActionError({
      code: "OPPORTUNITY_NOT_OPEN",
      message: "This opportunity is no longer open.",
      status: 409,
      operation: "SELECT",
    });
  }

  const maintenanceRecordIds = opportunities
    .map((opportunity) => opportunity.maintenanceRecordId)
    .filter((id): id is string => Boolean(id));
  const declinedWorkRecordIds = opportunities
    .map((opportunity) => opportunity.declinedWorkRecordId)
    .filter((id): id is string => Boolean(id));

  const [maintenanceRecords, declinedWorkRecords] = await Promise.all([
    maintenanceRecordIds.length
      ? prisma.vehicleMaintenanceRecord.findMany({
          where: { id: { in: maintenanceRecordIds }, shopId: context.shopId },
        })
      : Promise.resolve([]),
    declinedWorkRecordIds.length
      ? prisma.declinedWorkRecord.findMany({
          where: { id: { in: declinedWorkRecordIds }, shopId: context.shopId },
        })
      : Promise.resolve([]),
  ]);

  if (maintenanceRecords.length !== maintenanceRecordIds.length || declinedWorkRecords.length !== declinedWorkRecordIds.length) {
    throw queueActionError({
      code: "OPPORTUNITY_SOURCE_MISSING",
      message: "This opportunity is no longer open.",
      status: 409,
      operation: "SELECT",
    });
  }
  if (
    maintenanceRecords.some((record) => record.vehicleId !== input.vehicleId) ||
    declinedWorkRecords.some((record) => record.vehicleId !== input.vehicleId || record.customerId !== input.customerId)
  ) {
    throw queueActionError({
      code: "OPPORTUNITY_SOURCE_MISMATCH",
      message: "This opportunity is no longer open.",
      status: 409,
      operation: "SELECT",
    });
  }

  return {
    opportunityIds,
    opportunities,
    maintenanceRecords,
    declinedWorkRecords,
    maintenanceRecordIds,
    declinedWorkRecordIds,
  };
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
  if (!isCustomerBookingEnabled()) {
    return prisma.serviceDefinition.findMany({
      where: { shopId },
      orderBy: { name: "asc" },
    });
  }

  try {
    return await prisma.serviceDefinition.findMany({
      where: { shopId },
      orderBy: { name: "asc" },
      include: { bookingRule: { include: { windows: true } } },
    });
  } catch (error) {
    if (!isMissingServiceIntervalSchema(error) && !isMissingCustomerBookingSchema(error)) throw error;

    console.warn("Maintiva service or booking migration missing during state load; using legacy service definition columns.", {
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

async function loadStateBookingSettings(shopId: string): Promise<ShopBookingSettings> {
  if (!isCustomerBookingEnabled()) {
    return { ...defaultBookingSettings, shopId, id: `default-${shopId}` };
  }

  try {
    const settings = await prisma.shopBookingSettings.findUnique({ where: { shopId } });
    return settings ? {
      id: settings.id,
      shopId: settings.shopId,
      onlineBookingEnabled: settings.onlineBookingEnabled,
      minimumNoticeMinutes: settings.minimumNoticeMinutes,
      maximumAdvanceDays: settings.maximumAdvanceDays,
      defaultBufferBeforeMinutes: settings.defaultBufferBeforeMinutes,
      defaultBufferAfterMinutes: settings.defaultBufferAfterMinutes,
      maximumSimultaneousAppointments: settings.maximumSimultaneousAppointments,
      cancellationCutoffMinutes: settings.cancellationCutoffMinutes,
      reschedulingCutoffMinutes: settings.reschedulingCutoffMinutes,
    } : { ...defaultBookingSettings, shopId, id: `default-${shopId}` };
  } catch (error) {
    if (!isMissingCustomerBookingSchema(error)) throw error;
    return { ...defaultBookingSettings, shopId, id: `default-${shopId}` };
  }
}

async function loadStateBookingWindows(shopId: string) {
  if (!isCustomerBookingEnabled()) {
    return defaultBookingWindows.map((window) => ({ ...window, shopId, id: `default-${shopId}-${window.dayOfWeek}` }));
  }

  try {
    const windows = await prisma.shopBookingWindow.findMany({
      where: { shopId },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    });
    return windows.length > 0 ? windows.map((window) => ({
      id: window.id,
      shopId: window.shopId,
      dayOfWeek: window.dayOfWeek,
      startMinute: window.startMinute,
      endMinute: window.endMinute,
      isActive: window.isActive,
    })) : defaultBookingWindows.map((window) => ({ ...window, shopId, id: `default-${shopId}-${window.dayOfWeek}` }));
  } catch (error) {
    if (!isMissingCustomerBookingSchema(error)) throw error;
    return defaultBookingWindows.map((window) => ({ ...window, shopId, id: `default-${shopId}-${window.dayOfWeek}` }));
  }
}

async function loadStateBookingBlackouts(shopId: string): Promise<ShopBookingBlackout[]> {
  if (!isCustomerBookingEnabled()) {
    return [];
  }

  try {
    const blackouts = await prisma.shopBookingBlackout.findMany({
      where: { shopId },
      orderBy: { startsAt: "asc" },
    });
    return blackouts.map((blackout) => ({
      id: blackout.id,
      shopId: blackout.shopId,
      startsAt: iso(blackout.startsAt),
      endsAt: iso(blackout.endsAt),
      reason: blackout.reason ?? undefined,
      isFullDay: blackout.isFullDay,
    }));
  } catch (error) {
    if (!isMissingCustomerBookingSchema(error)) throw error;
    return [];
  }
}

async function loadStateCustomerBookingLinks(shopId: string): Promise<CustomerBookingLink[]> {
  if (!isCustomerBookingEnabled()) {
    return [];
  }

  try {
    const links = await prisma.customerBookingLink.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return links.map((link) => ({
      id: link.id,
      shopId: link.shopId,
      customerId: link.customerId,
      vehicleId: link.vehicleId,
      opportunityId: link.opportunityId ?? undefined,
      maintenanceRecordIds: link.maintenanceRecordIds,
      declinedWorkRecordIds: link.declinedWorkRecordIds,
      status: link.status,
      expiresAt: iso(link.expiresAt),
      revokedAt: iso(link.revokedAt) || undefined,
      usedAt: iso(link.usedAt) || undefined,
      lastViewedAt: iso(link.lastViewedAt) || undefined,
      bookingCompletedAt: iso(link.bookingCompletedAt) || undefined,
      outreachRecordId: link.outreachRecordId ?? undefined,
      appointmentId: link.appointmentId ?? undefined,
      createdAt: iso(link.createdAt),
    }));
  } catch (error) {
    if (!isMissingCustomerBookingSchema(error)) throw error;
    return [];
  }
}

function toStateSmartMaintenanceBlock(block: StateSmartMaintenanceBlock): SmartMaintenanceBlock {
  return {
    id: block.id,
    shopId: block.shopId,
    name: block.name,
    description: block.description ?? "",
    isActive: block.isActive,
    timezone: block.timezone,
    daysOfWeek: block.daysOfWeek,
    startMinute: block.startMinute,
    endMinute: block.endMinute,
    serviceDefinitionIds: block.services.map((service) => service.serviceDefinitionId),
    maxVehicles: block.maxVehicles,
    maxLaborMinutes: block.maxLaborMinutes,
    minimumNoticeMinutes: block.minimumNoticeMinutes,
    maximumHorizonDays: block.maximumHorizonDays,
    slotIntervalMinutes: block.slotIntervalMinutes === 15 || block.slotIntervalMinutes === 60 ? block.slotIntervalMinutes : 30,
    approvalRequired: true,
    internalNotes: block.internalNotes ?? "",
    createdByUserId: block.createdByUserId ?? undefined,
    archivedAt: iso(block.archivedAt) || undefined,
    createdAt: iso(block.createdAt),
    updatedAt: iso(block.updatedAt),
  };
}

function toStateSmartMaintenanceBlockBlackout(blackout: StateSmartMaintenanceBlockBlackout): SmartMaintenanceBlockBlackout {
  return {
    id: blackout.id,
    shopId: blackout.shopId,
    blockId: blackout.blockId,
    startsAt: iso(blackout.startsAt),
    endsAt: iso(blackout.endsAt),
    reason: blackout.reason ?? "",
    isFullDay: blackout.isFullDay,
    createdByUserId: blackout.createdByUserId ?? undefined,
    createdAt: iso(blackout.createdAt),
    updatedAt: iso(blackout.updatedAt),
  };
}

async function loadStateSmartMaintenanceBlocks(shopId: string): Promise<SmartMaintenanceBlock[]> {
  if (!isSmartMaintenanceBlocksEnabled()) {
    return [];
  }

  try {
    const blocks = await prisma.smartMaintenanceBlock.findMany({
      where: { shopId },
      include: { services: { select: { serviceDefinitionId: true } } },
      orderBy: [{ archivedAt: "asc" }, { createdAt: "desc" }],
    });
    return blocks.map(toStateSmartMaintenanceBlock);
  } catch (error) {
    if (!isMissingSmartMaintenanceBlocksSchema(error)) throw error;
    console.warn("Maintiva smart maintenance blocks migration missing during state load; omitting blocks.", {
      database: safeDatabaseError(error),
    });
    return [];
  }
}

async function loadStateSmartMaintenanceBlockBlackouts(shopId: string): Promise<SmartMaintenanceBlockBlackout[]> {
  if (!isSmartMaintenanceBlocksEnabled()) {
    return [];
  }

  try {
    const blackouts = await prisma.smartMaintenanceBlockBlackout.findMany({
      where: { shopId },
      orderBy: { startsAt: "asc" },
    });
    return blackouts.map(toStateSmartMaintenanceBlockBlackout);
  } catch (error) {
    if (!isMissingSmartMaintenanceBlocksSchema(error)) throw error;
    console.warn("Maintiva smart maintenance blocks migration missing during blackout state load; omitting blackouts.", {
      database: safeDatabaseError(error),
    });
    return [];
  }
}

async function loadStateOutreachBookingLinkIds(shopId: string) {
  if (!isCustomerBookingEnabled()) {
    return [];
  }

  try {
    return await prisma.outreachRecord.findMany({
      where: { shopId },
      select: {
        id: true,
        bookingLinkId: true,
      },
    });
  } catch (error) {
    if (!isMissingCustomerBookingSchema(error)) throw error;
    console.warn("Maintiva customer scheduling migration missing during outreach state load; omitting booking link references.", {
      database: safeDatabaseError(error),
    });
    return [];
  }
}

async function loadStateAppointmentBookingMetadata(shopId: string) {
  if (!isCustomerBookingEnabled()) {
    return [];
  }

  try {
    return await prisma.appointment.findMany({
      where: { shopId },
      select: {
        id: true,
        bookingLinkId: true,
        intakeType: true,
        customerNotes: true,
        internalNotes: true,
        requestedAt: true,
        approvedAt: true,
        declinedAt: true,
        customerCancelledAt: true,
        rescheduledAt: true,
      },
    });
  } catch (error) {
    if (!isMissingCustomerBookingSchema(error)) throw error;
    console.warn("Maintiva customer scheduling migration missing during appointment state load; omitting booking metadata.", {
      database: safeDatabaseError(error),
    });
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

async function expirePastQueueSnoozes(context: AuthenticatedShopContext) {
  const now = new Date();
  const expired = await prisma.outreachRecord.findMany({
    where: {
      shopId: context.shopId,
      status: "SNOOZED",
      followUpDate: { lte: now },
    },
    select: {
      id: true,
      customerId: true,
      vehicleId: true,
    },
  });
  if (expired.length === 0) return;

  const outreachIds = expired.map((record) => record.id);
  const vehicleIds = Array.from(new Set(expired.map((record) => record.vehicleId)));
  const customerIds = Array.from(new Set(expired.map((record) => record.customerId)));

  await prisma.$transaction(async (tx) => {
    const maintenance = await tx.vehicleMaintenanceRecord.findMany({
      where: {
        shopId: context.shopId,
        outreachRecordId: { in: outreachIds },
        outreachStatus: "SNOOZED",
      },
      select: { id: true },
    });
    const declined = await tx.declinedWorkRecord.findMany({
      where: {
        shopId: context.shopId,
        customerId: { in: customerIds },
        vehicleId: { in: vehicleIds },
        outreachStatus: "SNOOZED",
      },
      select: { id: true },
    });
    const maintenanceRecordIds = maintenance.map((record) => record.id);
    const declinedWorkRecordIds = declined.map((record) => record.id);

    if (maintenanceRecordIds.length > 0) {
      await tx.vehicleMaintenanceRecord.updateMany({
        where: { id: { in: maintenanceRecordIds }, shopId: context.shopId },
        data: {
          outreachStatus: "NEEDS_OUTREACH",
          updatedByUserId: context.userId,
        },
      });
      await tx.maintenanceRevenueOpportunity.updateMany({
        where: {
          shopId: context.shopId,
          maintenanceRecordId: { in: maintenanceRecordIds },
          stage: "CONTACTED",
        },
        data: {
          stage: "IDENTIFIED",
          lastActivityAt: now,
        },
      });
    }

    if (declinedWorkRecordIds.length > 0) {
      await tx.declinedWorkRecord.updateMany({
        where: { id: { in: declinedWorkRecordIds }, shopId: context.shopId },
        data: {
          status: "OPEN",
          outreachStatus: "NEEDS_OUTREACH",
        },
      });
      await tx.maintenanceRevenueOpportunity.updateMany({
        where: {
          shopId: context.shopId,
          declinedWorkRecordId: { in: declinedWorkRecordIds },
          stage: "CONTACTED",
        },
        data: {
          stage: "IDENTIFIED",
          lastActivityAt: now,
        },
      });
    }
  });
}

export async function buildPilotState(context: AuthenticatedShopContext): Promise<DemoState> {
  await expirePastQueueSnoozes(context);

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
      revenueOpportunities: { orderBy: [{ priority: "asc" }, { updatedAt: "desc" }] },
      outreachRecords: {
        orderBy: { createdAt: "desc" },
        select: baselineOutreachRecordSelect,
      },
      importHistory: { orderBy: { importedAt: "desc" } },
      appointments: {
        select: baselineAppointmentWithServicesSelect,
        orderBy: { scheduledStart: "asc" },
      },
    },
  });
  assertSameShop(context, shop.id);
  const [
    serviceDefinitions,
    maintenanceRecords,
    shopDefaultAnnualMileage,
    mileageReadingRows,
    drivingProfileRows,
    bookingSettings,
    bookingWindows,
    bookingBlackouts,
    customerBookingLinks,
    smartMaintenanceBlocks,
    smartMaintenanceBlockBlackouts,
    outreachBookingLinkIds,
    appointmentBookingMetadata,
  ] = await Promise.all([
    loadStateServiceDefinitions(context.shopId),
    loadStateMaintenanceRecords(context.shopId),
    loadShopDefaultAnnualMileage(context.shopId),
    loadStateMileageReadings(context.shopId),
    loadStateDrivingProfiles(context.shopId),
    loadStateBookingSettings(context.shopId),
    loadStateBookingWindows(context.shopId),
    loadStateBookingBlackouts(context.shopId),
    loadStateCustomerBookingLinks(context.shopId),
    loadStateSmartMaintenanceBlocks(context.shopId),
    loadStateSmartMaintenanceBlockBlackouts(context.shopId),
    loadStateOutreachBookingLinkIds(context.shopId),
    loadStateAppointmentBookingMetadata(context.shopId),
  ]);

  const forecastAsOfDate = resolveForecastAsOfDate({ shopTimezone: shop.timezone });
  const services: MaintenanceService[] = serviceDefinitions.map(toStateServiceDefinition);
  const outreachBookingLinkById = new Map(outreachBookingLinkIds.map((record) => [record.id, record.bookingLinkId]));
  const appointmentBookingMetadataById = new Map(appointmentBookingMetadata.map((appointment) => [appointment.id, appointment]));
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
    })).filter((reading) => reading.readingDate <= forecastAsOfDate));
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
      asOf: forecastAsOfDate,
      shopTimezone: shop.timezone,
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
        lastCompletedDate: dateOnly(record.lastCompletedDate) || null,
        lastCompletedMileage: record.lastCompletedMileage,
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
      const readingDrafts = (readingsByVehicle.get(vehicle.id) ?? []).map((reading) => ({
        readingMileage: reading.readingMileage,
        readingDate: dateOnly(reading.readingDate),
        source: reading.source,
        verificationStatus: reading.verificationStatus,
        anomalyStatus: reading.anomalyStatus,
        includedInForecast: reading.includedInForecast,
      }));
      const persistedProfile = persistedProfileByVehicle.get(vehicle.id);
      const forecastMileage = resolveEffectiveForecastMileage({
        shopId: context.shopId,
        vehicleId: vehicle.id,
        readings: readingDrafts,
        shopDefaultAnnualMileage,
        customerReportedAnnualMileage: persistedProfile?.customerReportedAnnualMileage ?? vehicle.estimatedAnnualMileage,
        customerReportedAt: persistedProfile ? dateOnly(persistedProfile.customerReportedAt) || null : null,
        customerReportedByUserId: persistedProfile?.customerReportedByUserId ?? null,
        existingProfile: persistedProfile
          ? {
              customerReportedAnnualMileage: persistedProfile.customerReportedAnnualMileage,
              customerReportedAt: dateOnly(persistedProfile.customerReportedAt) || null,
              customerReportedByUserId: persistedProfile.customerReportedByUserId,
              manualAnnualMileageOverride: persistedProfile.manualAnnualMileageOverride,
              manualOverrideReason: persistedProfile.manualOverrideReason,
              manualOverrideNotes: persistedProfile.manualOverrideNotes,
              manualOverrideSetAt: iso(persistedProfile.manualOverrideSetAt) || null,
              manualOverrideSetByUserId: persistedProfile.manualOverrideSetByUserId,
            }
          : null,
        asOf: forecastAsOfDate,
        shopTimezone: shop.timezone,
      });
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
        forecastMileage,
        asOf: forecastAsOfDate,
        shopTimezone: shop.timezone,
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
    revenueOpportunities: shop.revenueOpportunities.map((opportunity): RevenueOpportunityRecord => ({
      id: opportunity.id,
      shopId: opportunity.shopId,
      customerId: opportunity.customerId,
      vehicleId: opportunity.vehicleId,
      maintenanceRecordId: opportunity.maintenanceRecordId ?? undefined,
      declinedWorkRecordId: opportunity.declinedWorkRecordId ?? undefined,
      source: opportunity.source,
      stage: opportunity.stage,
      priority: opportunity.priority,
      explanation: opportunity.explanation,
      priorityReason: opportunity.priorityReason,
      estimatedRevenueCents: opportunity.estimatedRevenueCents,
      estimatedLaborHours: opportunity.estimatedLaborMinutes / 60,
      dueDate: iso(opportunity.dueDate) || undefined,
      dueMileage: opportunity.dueMileage ?? undefined,
      daysOverdue: opportunity.daysOverdue,
      milesOverdue: opportunity.milesOverdue,
      lastActivityAt: iso(opportunity.lastActivityAt) || undefined,
      createdAt: iso(opportunity.createdAt),
      updatedAt: iso(opportunity.updatedAt),
    })),
    serviceRecords: shop.serviceHistoryRecords.map((record) => ({
      id: record.id,
      shopId: record.shopId,
      customerId: record.customerId,
      vehicleId: record.vehicleId,
      serviceName: record.serviceName,
      completedAt: dateOnly(record.completedAt),
      mileage: record.mileage,
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
      bookingLinkId: outreachBookingLinkById.get(record.id) ?? undefined,
      performedByUserId: record.performedByUserId ?? undefined,
      status: record.status,
    })),
    appointments: shop.appointments.map((appointment): Appointment => {
      const bookingMetadata = appointmentBookingMetadataById.get(appointment.id);
      return {
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
        bookingLinkId: bookingMetadata?.bookingLinkId ?? undefined,
        intakeType: bookingMetadata?.intakeType ?? undefined,
        customerNotes: bookingMetadata?.customerNotes ?? undefined,
        internalNotes: bookingMetadata?.internalNotes ?? undefined,
        completedRevenueCents: appointment.completedRevenueCents ?? undefined,
        completedLaborHours: appointment.completedLaborMinutes ? appointment.completedLaborMinutes / 60 : undefined,
        completedAt: iso(appointment.completedAt) || undefined,
        requestedAt: iso(bookingMetadata?.requestedAt) || undefined,
        approvedAt: iso(bookingMetadata?.approvedAt) || undefined,
        declinedAt: iso(bookingMetadata?.declinedAt) || undefined,
        customerCancelledAt: iso(bookingMetadata?.customerCancelledAt) || undefined,
        rescheduledAt: iso(bookingMetadata?.rescheduledAt) || undefined,
        notes: appointment.notes ?? "",
      };
    }),
    bookingSettings,
    bookingWindows,
    bookingBlackouts,
    customerBookingLinks,
    smartMaintenanceBlocks,
    smartMaintenanceBlockBlackouts,
    forecastAsOfDate,
    importHistory: shop.importHistory.map((record): ImportHistoryRecord => {
      const reportSummary = importErrorReportSummary(record.errorReport);
      return {
        id: record.id,
        shopId: record.shopId,
        userId: record.userId ?? "",
        fileName: record.fileName,
        importType: record.importType,
        status: record.status,
        displayStatus: reportSummary.displayStatus,
        importedAt: iso(record.importedAt),
        totalRows: record.totalRows,
        successfulRows: record.successfulRows,
        duplicateRows: record.duplicateRows,
        updatedRows: record.updatedRows,
        skippedRows: record.skippedRows,
        failedRows: record.failedRows,
        heldRows: reportSummary.heldRows,
        invalidRows: reportSummary.invalidRows,
        resultMessage: reportSummary.resultMessage,
        errorReportUrl: record.errorReportUrl ?? undefined,
      };
    }),
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
    const createdMaintenanceRecords = await tx.vehicleMaintenanceRecord.findMany({
      where: { shopId: context.shopId, vehicleId: vehicle.id, isActive: true, archivedAt: null },
      select: { id: true },
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
    await syncMaintenanceRevenueOpportunities(
      tx,
      context,
      createdMaintenanceRecords.map((record) => record.id),
    );
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
  await prisma.$transaction(async (tx) => {
    await tx.serviceDefinition.update({
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
    const inheritedMaintenanceRecords = await tx.vehicleMaintenanceRecord.findMany({
      where: {
        shopId: context.shopId,
        serviceDefinitionId,
        isActive: true,
        archivedAt: null,
        mileageIntervalOverride: null,
        timeIntervalValueOverride: null,
      },
      select: { id: true },
    });
    await syncMaintenanceRevenueOpportunities(
      tx,
      context,
      inheritedMaintenanceRecords.map((record) => record.id),
    );
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
  const maintenance = await prisma.$transaction(async (tx) => {
    const created = await tx.vehicleMaintenanceRecord.create({
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
    await syncMaintenanceRevenueOpportunities(tx, context, [created.id]);
    return created;
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

  await prisma.$transaction(async (tx) => {
    await tx.vehicleMaintenanceRecord.update({
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
    await syncMaintenanceRevenueOpportunities(tx, context, [maintenanceRecordId]);
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
    const activeMaintenanceRecords = await tx.vehicleMaintenanceRecord.findMany({
      where: { shopId: context.shopId, vehicleId: record.vehicleId, isActive: true, archivedAt: null },
      select: { id: true },
    });
    await syncMaintenanceRevenueOpportunities(
      tx,
      context,
      [
        record.id,
        ...activeMaintenanceRecords.map((item) => item.id),
      ],
    );
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
  const forecastAsOfDate = resolveForecastAsOfDate({ shopTimezone: context.shopTimezone, now });
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
    asOf: forecastAsOfDate,
    shopTimezone: context.shopTimezone,
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
  const source = parsed.currentMileage < vehicle.currentMileage ? "CORRECTION" : parsed.source;
  const duplicateReading = existingReadings.find((reading) =>
    dateOnly(reading.readingDate) === parsed.readingDate &&
    reading.readingMileage === parsed.currentMileage &&
    reading.source === source,
  );
  if (duplicateReading) {
    await prisma.$transaction(async (tx) => {
      const activeMaintenanceRecords = await tx.vehicleMaintenanceRecord.findMany({
        where: { shopId: context.shopId, vehicleId: vehicle.id, isActive: true, archivedAt: null },
        select: { id: true },
      });
      await syncMaintenanceRevenueOpportunities(
        tx,
        context,
        activeMaintenanceRecords.map((record) => record.id),
      );
    });
    return;
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
        source,
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
    const activeMaintenanceRecords = await tx.vehicleMaintenanceRecord.findMany({
      where: { shopId: context.shopId, vehicleId: vehicle.id, isActive: true, archivedAt: null },
      select: { id: true },
    });
    await syncMaintenanceRevenueOpportunities(
      tx,
      context,
      activeMaintenanceRecords.map((record) => record.id),
    );
  });
}

export async function recordPilotInspection(context: AuthenticatedShopContext, input: unknown) {
  const parsed = inspectionSchema.parse(input);
  const vehicle = await requireVehicleInActiveShop(context, parsed.vehicleId);
  const inspectionDate = dateFromDateOnly(parsed.inspectionDate);
  if (inspectionDate.getTime() > dateFromDateOnly(currentDateInTimeZone(context.shopTimezone)).getTime()) {
    throw new SafeActionError({
      code: "INSPECTION_DATE_FUTURE",
      message: "Inspection date cannot be in the future.",
      status: 400,
      table: "ServiceHistoryRecord",
      operation: "INSERT",
    });
  }

  const mileage = parsed.mileage ?? null;
  const existingReadings = mileage
    ? await prisma.vehicleMileageReading.findMany({
        where: { shopId: context.shopId, vehicleId: vehicle.id },
        orderBy: [{ readingDate: "asc" }, { createdAt: "asc" }],
      })
    : [];
  const validationIssues = mileage
    ? validateMileageReading({
        reading: {
          readingMileage: mileage,
          readingDate: parsed.inspectionDate,
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
      })
    : [];
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
  if (mileage !== null && mileage < vehicle.currentMileage) {
    throw new SafeActionError({
      code: "INSPECTION_MILEAGE_BELOW_CURRENT",
      message: "Inspection mileage is below the current vehicle mileage. Add an odometer correction first.",
      status: 400,
      table: "VehicleMileageReading",
      operation: "INSERT",
    });
  }

  const recommendations = parsed.recommendations
    .map((recommendation) => ({
      ...recommendation,
      serviceName: recommendation.serviceName?.trim() ?? "",
      notes: recommendation.notes?.trim() || undefined,
    }))
    .filter((recommendation) => recommendation.serviceName);

  await prisma.$transaction(async (tx) => {
    const recommendationSummary = recommendations.map((recommendation) =>
      `${recommendation.serviceName} (${recommendation.result.toLowerCase()}, ${recommendation.urgency.toLowerCase()} urgency)`,
    );
    const notes = [
      `[Inspection]`,
      parsed.technician?.trim() ? `Recorded by: ${parsed.technician.trim()}` : "",
      `Condition: ${parsed.condition.replaceAll("_", " ").toLowerCase()}`,
      parsed.componentsInspected?.trim() ? `Components inspected: ${parsed.componentsInspected.trim()}` : "",
      parsed.notes?.trim() ? `Notes: ${parsed.notes.trim()}` : "",
      recommendationSummary.length > 0 ? `Recommendations: ${recommendationSummary.join("; ")}` : "",
    ].filter(Boolean).join("\n");

    const inspectionRecord = await tx.serviceHistoryRecord.create({
      data: {
        shopId: context.shopId,
        customerId: vehicle.customerId,
        vehicleId: vehicle.id,
        serviceName: "Vehicle Inspection",
        completedAt: inspectionDate,
        mileage,
        laborMinutes: 0,
        priceCents: 0,
        notes,
      },
    });

    if (mileage !== null) {
      const duplicateInspectionReading = await tx.vehicleMileageReading.findFirst({
        where: {
          shopId: context.shopId,
          vehicleId: vehicle.id,
          readingDate: inspectionDate,
          readingMileage: mileage,
          sourceReferenceType: "Inspection",
        },
      });
      if (!duplicateInspectionReading) {
        const warningMessages = validationIssues
          .filter((issue) => issue.severity === "warning")
          .map((issue) => issue.message);
        await tx.vehicleMileageReading.create({
          data: {
            shopId: context.shopId,
            vehicleId: vehicle.id,
            readingMileage: mileage,
            readingDate: inspectionDate,
            source: "OTHER",
            verificationStatus: "VERIFIED",
            anomalyStatus: warningMessages.length > 0 ? "NEEDS_REVIEW" : "NONE",
            includedInForecast: warningMessages.length === 0,
            reviewNotes: [parsed.notes?.trim(), warningMessages.join(" ")]
              .filter(Boolean)
              .join(" ") || null,
            sourceReferenceType: "Inspection",
            sourceReferenceId: inspectionRecord.id,
            recordedByUserId: context.userId,
          },
        });
      }
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          currentMileage: mileage,
          lastServiceDate: inspectionDate,
        },
      });
      await recalculatePersistedDrivingProfile({ tx, context, vehicleId: vehicle.id });
    }

    const touchedMaintenanceRecordIds: string[] = [];
    const touchedDeclinedWorkRecordIds: string[] = [];
    for (const recommendation of recommendations) {
      let service = await tx.serviceDefinition.findFirst({
        where: { shopId: context.shopId, name: recommendation.serviceName },
      });
      service ??= await tx.serviceDefinition.create({
        data: {
          shopId: context.shopId,
          name: recommendation.serviceName,
          category: "Inspection Recommendation",
          defaultMileageInterval: null,
          defaultTimeIntervalMonths: null,
          defaultTimeIntervalValue: null,
          defaultTimeIntervalUnit: "MONTHS",
          defaultNotificationThreshold: 10,
          estimatedLaborMinutes: recommendation.laborMinutes,
          defaultPriceCents: recommendation.priceCents,
          description: "Created from a recorded inspection recommendation.",
          isActive: true,
        },
      });
      const existingMaintenance = await tx.vehicleMaintenanceRecord.findFirst({
        where: {
          shopId: context.shopId,
          vehicleId: vehicle.id,
          serviceDefinitionId: service.id,
          isActive: true,
          archivedAt: null,
        },
      });
      const maintenance = existingMaintenance
        ? await tx.vehicleMaintenanceRecord.update({
            where: { id: existingMaintenance.id },
            data: {
              priceCents: recommendation.priceCents,
              laborMinutes: recommendation.laborMinutes,
              priceOverrideCents: recommendation.priceCents,
              laborMinutesOverride: recommendation.laborMinutes,
              status: "DUE_SOON",
              outreachStatus: "NEEDS_OUTREACH",
              notes: recommendation.notes ?? parsed.notes ?? null,
              updatedByUserId: context.userId,
            },
          })
        : await tx.vehicleMaintenanceRecord.create({
            data: {
              shopId: context.shopId,
              vehicleId: vehicle.id,
              serviceDefinitionId: service.id,
              serviceName: recommendation.serviceName,
              lastCompletedDate: null,
              lastCompletedMileage: mileage,
              recommendedMileageInterval: null,
              recommendedTimeIntervalMonths: null,
              mileageIntervalOverride: null,
              timeIntervalValueOverride: null,
              timeIntervalUnitOverride: null,
              notificationThreshold: service.defaultNotificationThreshold,
              outreachThresholdType: "MILES_BEFORE_DUE",
              outreachThresholdValue: 500,
              laborMinutes: recommendation.laborMinutes,
              priceCents: recommendation.priceCents,
              priceOverrideCents: recommendation.priceCents,
              laborMinutesOverride: recommendation.laborMinutes,
              status: "DUE_SOON",
              outreachStatus: "NEEDS_OUTREACH",
              isActive: true,
              notes: recommendation.notes ?? parsed.notes ?? null,
              createdByUserId: context.userId,
              updatedByUserId: context.userId,
            },
          });
      touchedMaintenanceRecordIds.push(maintenance.id);

      if (recommendation.result === "DECLINED") {
        const existingDeclined = await tx.declinedWorkRecord.findFirst({
          where: {
            shopId: context.shopId,
            customerId: vehicle.customerId,
            vehicleId: vehicle.id,
            serviceName: recommendation.serviceName,
            declinedAt: inspectionDate,
          },
        });
        const declinedRecord = existingDeclined ?? await tx.declinedWorkRecord.create({
          data: {
            shopId: context.shopId,
            customerId: vehicle.customerId,
            vehicleId: vehicle.id,
            serviceName: recommendation.serviceName,
            declinedAt: inspectionDate,
            recommendedPriceCents: recommendation.priceCents,
            laborMinutes: recommendation.laborMinutes,
            advisorNotes: recommendation.notes ?? parsed.notes ?? null,
            status: "OPEN",
            outreachStatus: "NEEDS_OUTREACH",
          },
        });
        touchedDeclinedWorkRecordIds.push(declinedRecord.id);
      }
    }

    const activeMaintenanceRecords = await tx.vehicleMaintenanceRecord.findMany({
      where: { shopId: context.shopId, vehicleId: vehicle.id, isActive: true, archivedAt: null },
      select: { id: true },
    });
    await syncMaintenanceRevenueOpportunities(
      tx,
      context,
      [
        ...touchedMaintenanceRecordIds,
        ...activeMaintenanceRecords.map((record) => record.id),
      ],
    );
    await syncDeclinedWorkRevenueOpportunities(tx, context, touchedDeclinedWorkRecordIds);
    await tx.auditLog.create({
      data: {
        shopId: context.shopId,
        actorUserId: context.userId,
        action: "vehicle.inspection_recorded",
        entityType: "ServiceHistoryRecord",
        entityId: inspectionRecord.id,
        metadata: {
          vehicleId: vehicle.id,
          inspectionDate: parsed.inspectionDate,
          mileage,
          recommendations: recommendations.length,
          declinedRecommendations: recommendations.filter((recommendation) => recommendation.result === "DECLINED").length,
        },
      },
    });
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
      select: baselineOutreachRecordSelect,
    });
    await tx.vehicleMaintenanceRecord.updateMany({
      where: { id: { in: input.maintenanceRecordIds }, shopId: context.shopId },
      data: {
        outreachStatus: "MANUALLY_SENT",
        outreachRecordId: outreach.id,
      },
    });
    const synced = await syncMaintenanceRevenueOpportunities(tx, context, input.maintenanceRecordIds);
    await tx.maintenanceRevenueOpportunity.updateMany({
      where: { id: { in: synced.map((opportunity) => opportunity.id) }, shopId: context.shopId },
      data: {
        stage: input.responseStatus && input.responseStatus !== "NO_RESPONSE"
          ? input.responseStatus === "DECLINED" || input.responseStatus === "DO_NOT_CONTACT"
            ? "LOST"
            : "RESPONDED"
          : "CONTACTED",
        lastActivityAt: new Date(),
      },
    });
  });
}

export async function recordPilotOpportunityContact(
  context: AuthenticatedShopContext,
  input: {
    customerId: string;
    vehicleId: string;
    opportunityIds: string[];
    message: string;
    channel: OutreachRecord["channel"];
    responseStatus: OutreachRecord["responseStatus"];
    followUpDate?: string;
    bookingLinkId?: string;
    idempotencyKey?: string;
  },
) {
  const targets = await loadOpenQueueTargets(context, input);
  const sourceStatus = responseOutreachStatus(input.responseStatus);
  const stage = responseOpportunityStage(input.responseStatus);
  const followUpDate = input.followUpDate ? dateFromDateOnly(input.followUpDate) : null;
  const outreachId = outreachIdFromIdempotencyKey(input.idempotencyKey);

  await prisma.$transaction(async (tx) => {
    const existingOutreach = outreachId
      ? await tx.outreachRecord.findUnique({
          where: { id: outreachId },
          select: baselineOutreachRecordSelect,
        })
      : null;
    if (existingOutreach) {
      if (
        existingOutreach.shopId !== context.shopId ||
        existingOutreach.customerId !== input.customerId ||
        existingOutreach.vehicleId !== input.vehicleId
      ) {
        throw queueActionError({
          code: "OUTREACH_IDEMPOTENCY_CONFLICT",
          message: "Refresh the page and try recording the outreach again.",
          status: 409,
          operation: "INSERT",
        });
      }
    }
    const outreach = existingOutreach ?? await tx.outreachRecord.create({
      data: {
        ...(outreachId ? { id: outreachId } : {}),
        shopId: context.shopId,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        message: input.message,
        channel: input.channel,
        status: "MANUALLY_SENT",
        responseStatus: input.responseStatus,
        followUpDate,
        copiedAt: input.channel === "TEXT" || input.channel === "EMAIL" ? new Date() : null,
        manuallySentAt: new Date(),
        performedByUserId: context.userId,
      },
      select: baselineOutreachRecordSelect,
    });

    if (input.bookingLinkId && isCustomerBookingEnabled()) {
      await tx.customerBookingLink.updateMany({
        where: {
          id: input.bookingLinkId,
          shopId: context.shopId,
          customerId: input.customerId,
          vehicleId: input.vehicleId,
        },
        data: { outreachRecordId: outreach.id },
      });
    }

    if (targets.maintenanceRecordIds.length > 0) {
      await tx.vehicleMaintenanceRecord.updateMany({
        where: { id: { in: targets.maintenanceRecordIds }, shopId: context.shopId },
        data: {
          outreachStatus: sourceStatus,
          outreachRecordId: outreach.id,
          updatedByUserId: context.userId,
        },
      });
    }
    if (targets.declinedWorkRecordIds.length > 0) {
      await tx.declinedWorkRecord.updateMany({
        where: { id: { in: targets.declinedWorkRecordIds }, shopId: context.shopId },
        data: { outreachStatus: sourceStatus },
      });
    }
    await tx.maintenanceRevenueOpportunity.updateMany({
      where: { id: { in: targets.opportunityIds }, shopId: context.shopId },
      data: {
        stage,
        lastActivityAt: new Date(),
      },
    });
  });
}

export async function createPilotBookingLink(
  context: AuthenticatedShopContext,
  input: {
    customerId: string;
    vehicleId: string;
    opportunityIds: string[];
    appUrl: string;
  },
) {
  assertCustomerBookingFeatureEnabled();
  const targets = await loadOpenQueueTargets(context, input);
  const link = await createCustomerBookingLink({
    context,
    appUrl: input.appUrl,
    customerId: input.customerId,
    vehicleId: input.vehicleId,
    opportunityIds: targets.opportunityIds,
  });
  const [customer, vehicle, shop] = await Promise.all([
    prisma.customer.findFirst({ where: { id: input.customerId, shopId: context.shopId } }),
    prisma.vehicle.findFirst({ where: { id: input.vehicleId, shopId: context.shopId } }),
    prisma.shop.findFirst({ where: { id: context.shopId } }),
  ]);
  const serviceNames = [
    ...targets.maintenanceRecords.map((record) => record.serviceName),
    ...targets.declinedWorkRecords.map((record) => record.serviceName),
  ];
  return {
    ...link,
    message: `Hi ${customer?.firstName ?? "there"}, this is ${shop?.name ?? context.shopName}. Based on your ${vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "vehicle"} service history, ${serviceNames.join(", ") || "recommended maintenance"} is ready to schedule. You can view available times and schedule here: ${link.url}`,
  };
}

export async function savePilotBookingSettings(context: AuthenticatedShopContext, input: unknown) {
  assertCustomerBookingFeatureEnabled();
  const parsed = shopBookingSettingsSchema.parse(input);
  const { windows, ...settings } = parsed;
  await prisma.$transaction(async (tx) => {
    await tx.shopBookingSettings.upsert({
      where: { shopId: context.shopId },
      create: {
        shopId: context.shopId,
        ...settings,
      },
      update: settings,
    });
    if (windows) {
      await tx.shopBookingWindow.deleteMany({ where: { shopId: context.shopId } });
      await tx.shopBookingWindow.createMany({
        data: Array.from(new Map(windows.map((window) => [window.dayOfWeek, window])).values()).map((window) => ({
          shopId: context.shopId,
          dayOfWeek: window.dayOfWeek,
          startMinute: window.startMinute,
          endMinute: window.endMinute,
          isActive: window.isActive,
        })),
      });
    }
  });
}

export async function savePilotServiceBookingRule(
  context: AuthenticatedShopContext,
  serviceDefinitionId: string,
  input: unknown,
) {
  assertCustomerBookingFeatureEnabled();
  const parsed = serviceBookingRuleSchema.parse(input);
  await requireServiceDefinitionInActiveShop(context, serviceDefinitionId);

  await prisma.$transaction(async (tx) => {
    const rule = await tx.serviceBookingRule.upsert({
      where: { serviceDefinitionId },
      create: {
        shopId: context.shopId,
        serviceDefinitionId,
        bookingEnabled: parsed.bookingEnabled,
        bookingMode: parsed.bookingMode,
        estimatedDurationMinutes: parsed.estimatedDurationMinutes,
        bufferBeforeMinutes: parsed.bufferBeforeMinutes,
        bufferAfterMinutes: parsed.bufferAfterMinutes,
        allowedIntakeType: parsed.allowedIntakeType,
        minimumNoticeMinutes: parsed.minimumNoticeMinutes ?? null,
        maximumAdvanceDays: parsed.maximumAdvanceDays ?? null,
        maximumSimultaneousBookings: parsed.maximumSimultaneousBookings ?? null,
      },
      update: {
        bookingEnabled: parsed.bookingEnabled,
        bookingMode: parsed.bookingMode,
        estimatedDurationMinutes: parsed.estimatedDurationMinutes,
        bufferBeforeMinutes: parsed.bufferBeforeMinutes,
        bufferAfterMinutes: parsed.bufferAfterMinutes,
        allowedIntakeType: parsed.allowedIntakeType,
        minimumNoticeMinutes: parsed.minimumNoticeMinutes ?? null,
        maximumAdvanceDays: parsed.maximumAdvanceDays ?? null,
        maximumSimultaneousBookings: parsed.maximumSimultaneousBookings ?? null,
      },
    });
    await tx.serviceBookingWindow.deleteMany({
      where: { shopId: context.shopId, serviceBookingRuleId: rule.id },
    });
    await tx.serviceBookingWindow.createMany({
      data: Array.from(new Set(parsed.weekdays)).map((dayOfWeek) => ({
        shopId: context.shopId,
        serviceBookingRuleId: rule.id,
        dayOfWeek,
        startMinute: parsed.startMinute,
        endMinute: parsed.endMinute,
        isActive: true,
      })),
    });
  });
}

async function validateSmartBlockServices(context: AuthenticatedShopContext, serviceDefinitionIds: string[]) {
  const uniqueIds = Array.from(new Set(serviceDefinitionIds));
  const services = await prisma.serviceDefinition.findMany({
    where: {
      id: { in: uniqueIds },
      shopId: context.shopId,
      isActive: true,
    },
    select: { id: true },
  });
  if (services.length !== uniqueIds.length) {
    throw new SafeActionError({
      code: "SMART_BLOCK_SERVICE_NOT_ACTIVE",
      message: "Choose active services from the current shop.",
      status: 400,
      table: "SmartMaintenanceBlockService",
      operation: "INSERT",
    });
  }
  return uniqueIds;
}

async function requireSmartMaintenanceBlockInActiveShop(
  context: AuthenticatedShopContext,
  blockId: string,
) {
  assertProductionEntityId(blockId, "The selected maintenance block");
  const block = await prisma.smartMaintenanceBlock.findFirst({
    where: { id: blockId, shopId: context.shopId },
    include: { services: true },
  });
  if (block) return block;

  const target = await prisma.smartMaintenanceBlock.findUnique({
    where: { id: blockId },
    select: { shopId: true },
  });
  throw new SafeActionError({
    code: "SMART_BLOCK_NOT_IN_ACTIVE_SHOP",
    message: "The selected maintenance block does not belong to your active shop.",
    status: target ? 403 : 404,
    table: "SmartMaintenanceBlock",
    operation: "SELECT",
    details: target?.shopId
      ? `Maintenance block exists in a different shop: ${shortId(target.shopId)}.`
      : "Maintenance block was not found.",
  });
}

export async function savePilotSmartMaintenanceBlock(context: AuthenticatedShopContext, input: unknown) {
  assertSmartMaintenanceBlocksFeatureEnabled();
  const parsed = smartMaintenanceBlockSchema.parse(input);
  const serviceDefinitionIds = await validateSmartBlockServices(context, parsed.serviceDefinitionIds);
  if (parsed.id) {
    await requireSmartMaintenanceBlockInActiveShop(context, parsed.id);
  }

  await prisma.$transaction(async (tx) => {
    const data = {
      shopId: context.shopId,
      name: parsed.name,
      description: parsed.description || null,
      isActive: parsed.isActive,
      timezone: parsed.timezone || context.shopTimezone,
      daysOfWeek: Array.from(new Set(parsed.daysOfWeek)).sort(),
      startMinute: parsed.startMinute,
      endMinute: parsed.endMinute,
      maxVehicles: parsed.maxVehicles,
      maxLaborMinutes: parsed.maxLaborMinutes,
      minimumNoticeMinutes: parsed.minimumNoticeMinutes,
      maximumHorizonDays: parsed.maximumHorizonDays,
      slotIntervalMinutes: parsed.slotIntervalMinutes,
      approvalRequired: true,
      internalNotes: parsed.internalNotes || null,
      archivedAt: null,
    };
    const block = parsed.id
      ? await tx.smartMaintenanceBlock.update({
          where: { id: parsed.id },
          data,
        })
      : await tx.smartMaintenanceBlock.create({
          data: {
            ...data,
            createdByUserId: context.userId,
          },
        });

    await tx.smartMaintenanceBlockService.deleteMany({
      where: { shopId: context.shopId, blockId: block.id },
    });
    await tx.smartMaintenanceBlockService.createMany({
      data: serviceDefinitionIds.map((serviceDefinitionId) => ({
        shopId: context.shopId,
        blockId: block.id,
        serviceDefinitionId,
      })),
      skipDuplicates: true,
    });
  });
}

export async function deletePilotSmartMaintenanceBlock(context: AuthenticatedShopContext, blockId: string) {
  assertSmartMaintenanceBlocksFeatureEnabled();
  await requireSmartMaintenanceBlockInActiveShop(context, blockId);
  await prisma.smartMaintenanceBlock.update({
    where: { id: blockId },
    data: {
      isActive: false,
      archivedAt: new Date(),
    },
  });
}

export async function duplicatePilotSmartMaintenanceBlock(context: AuthenticatedShopContext, blockId: string) {
  assertSmartMaintenanceBlocksFeatureEnabled();
  const source = await requireSmartMaintenanceBlockInActiveShop(context, blockId);
  await prisma.$transaction(async (tx) => {
    const duplicate = await tx.smartMaintenanceBlock.create({
      data: {
        shopId: context.shopId,
        name: `${source.name} copy`,
        description: source.description,
        isActive: false,
        timezone: source.timezone,
        daysOfWeek: source.daysOfWeek,
        startMinute: source.startMinute,
        endMinute: source.endMinute,
        maxVehicles: source.maxVehicles,
        maxLaborMinutes: source.maxLaborMinutes,
        minimumNoticeMinutes: source.minimumNoticeMinutes,
        maximumHorizonDays: source.maximumHorizonDays,
        slotIntervalMinutes: source.slotIntervalMinutes,
        approvalRequired: true,
        internalNotes: source.internalNotes,
        createdByUserId: context.userId,
      },
    });
    await tx.smartMaintenanceBlockService.createMany({
      data: source.services.map((service) => ({
        shopId: context.shopId,
        blockId: duplicate.id,
        serviceDefinitionId: service.serviceDefinitionId,
      })),
      skipDuplicates: true,
    });
  });
}

export async function savePilotSmartMaintenanceBlockBlackout(context: AuthenticatedShopContext, input: unknown) {
  assertSmartMaintenanceBlocksFeatureEnabled();
  const parsed = smartMaintenanceBlockBlackoutSchema.parse(input);
  if (parsed.blockId) {
    await requireSmartMaintenanceBlockInActiveShop(context, parsed.blockId);
  }
  if (parsed.id) {
    const existing = await prisma.smartMaintenanceBlockBlackout.findFirst({
      where: { id: parsed.id, shopId: context.shopId },
    });
    if (!existing) {
      throw new SafeActionError({
        code: "SMART_BLOCK_BLACKOUT_NOT_FOUND",
        message: "The selected blackout was not found.",
        status: 404,
        table: "SmartMaintenanceBlockBlackout",
        operation: "UPDATE",
      });
    }
  }

  const data = {
    shopId: context.shopId,
    blockId: parsed.blockId ?? null,
    startsAt: new Date(parsed.startsAt),
    endsAt: new Date(parsed.endsAt),
    reason: parsed.reason || null,
    isFullDay: parsed.isFullDay ?? false,
  };
  if (parsed.id) {
    await prisma.smartMaintenanceBlockBlackout.update({
      where: { id: parsed.id },
      data,
    });
    return;
  }

  await prisma.smartMaintenanceBlockBlackout.create({
    data: {
      ...data,
      createdByUserId: context.userId,
    },
  });
}

export async function deletePilotSmartMaintenanceBlockBlackout(
  context: AuthenticatedShopContext,
  blackoutId: string,
) {
  assertSmartMaintenanceBlocksFeatureEnabled();
  const existing = await prisma.smartMaintenanceBlockBlackout.findFirst({
    where: { id: blackoutId, shopId: context.shopId },
  });
  if (!existing) {
    throw new SafeActionError({
      code: "SMART_BLOCK_BLACKOUT_NOT_FOUND",
      message: "The selected blackout was not found.",
      status: 404,
      table: "SmartMaintenanceBlockBlackout",
      operation: "DELETE",
    });
  }
  await prisma.smartMaintenanceBlockBlackout.delete({ where: { id: blackoutId } });
}

export async function approvePilotAppointmentRequest(context: AuthenticatedShopContext, appointmentId: string) {
  assertCustomerBookingFeatureEnabled();
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, shopId: context.shopId },
    include: { services: true },
  });
  if (!appointment || appointment.status !== "REQUESTED") {
    throw new SafeActionError({
      code: "APPOINTMENT_REQUEST_NOT_FOUND",
      message: "Appointment request was not found.",
      status: 404,
      table: "Appointment",
      operation: "UPDATE",
    });
  }

  const maintenanceRecordIds = appointment.services
    .map((service) => service.maintenanceRecordId)
    .filter((id): id is string => Boolean(id));
  const declinedWorkRecordIds = await prisma.declinedWorkRecord.findMany({
    where: { appointmentId: appointment.id, shopId: context.shopId },
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: "CONFIRMED", approvedAt: new Date() },
    });
    if (appointment.bookingLinkId) {
      await tx.customerBookingLink.updateMany({
        where: { id: appointment.bookingLinkId, shopId: context.shopId },
        data: {
          status: "COMPLETED",
          bookingCompletedAt: new Date(),
          appointmentId: appointment.id,
        },
      });
    }
    await tx.vehicleMaintenanceRecord.updateMany({
      where: { id: { in: maintenanceRecordIds }, shopId: context.shopId },
      data: { outreachStatus: "SCHEDULED", appointmentId: appointment.id, updatedByUserId: context.userId },
    });
    await tx.declinedWorkRecord.updateMany({
      where: { appointmentId: appointment.id, shopId: context.shopId },
      data: { status: "BOOKED", outreachStatus: "SCHEDULED" },
    });
    await tx.maintenanceRevenueOpportunity.updateMany({
      where: {
        shopId: context.shopId,
        OR: [
          appointment.opportunityId ? { id: appointment.opportunityId } : undefined,
          maintenanceRecordIds.length ? { maintenanceRecordId: { in: maintenanceRecordIds } } : undefined,
          declinedWorkRecordIds.length ? { declinedWorkRecordId: { in: declinedWorkRecordIds.map((record) => record.id) } } : undefined,
        ].filter((item): item is Exclude<typeof item, undefined> => Boolean(item)),
      },
      data: { stage: "BOOKED", lastActivityAt: new Date() },
    });
  });
}

export async function declinePilotAppointmentRequest(
  context: AuthenticatedShopContext,
  appointmentId: string,
  input: unknown,
) {
  assertCustomerBookingFeatureEnabled();
  const parsed = z.object({ reason: z.string().optional() }).parse(input ?? {});
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, shopId: context.shopId },
  });
  if (!appointment || appointment.status !== "REQUESTED") {
    throw new SafeActionError({
      code: "APPOINTMENT_REQUEST_NOT_FOUND",
      message: "Appointment request was not found.",
      status: 404,
      table: "Appointment",
      operation: "UPDATE",
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: "CANCELLED",
        declinedAt: new Date(),
        internalNotes: parsed.reason ?? appointment.internalNotes,
      },
    });
    await tx.appointmentChangeRecord.create({
      data: {
        shopId: context.shopId,
        appointmentId: appointment.id,
        bookingLinkId: appointment.bookingLinkId,
        action: "SHOP_DECLINED_REQUEST",
        previousStart: appointment.scheduledStart,
        previousEnd: appointment.scheduledEnd,
        reason: parsed.reason,
      },
    });
    if (appointment.opportunityId) {
      await tx.maintenanceRevenueOpportunity.updateMany({
        where: { id: appointment.opportunityId, shopId: context.shopId },
        data: { stage: "RESPONDED", lastActivityAt: new Date() },
      });
    }
  });
}

export async function snoozePilotOpportunity(
  context: AuthenticatedShopContext,
  input: {
    customerId: string;
    vehicleId: string;
    opportunityIds: string[];
    snoozedUntil: string;
    reason: string;
    notes?: string;
  },
) {
  const snoozedUntil = requireFutureDate(input.snoozedUntil);
  const reason = input.reason.trim();
  if (!reason) {
    throw queueActionError({
      code: "SNOOZE_REASON_REQUIRED",
      message: "Choose a snooze reason.",
      status: 400,
    });
  }
  const targets = await loadOpenQueueTargets(context, input);
  const message = [
    `Snoozed until ${input.snoozedUntil}.`,
    `Reason: ${reason}.`,
    input.notes?.trim() ? `Notes: ${input.notes.trim()}` : "",
  ].filter(Boolean).join("\n");

  await prisma.$transaction(async (tx) => {
    const outreach = await tx.outreachRecord.create({
      data: {
        shopId: context.shopId,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        message,
        channel: "OTHER",
        status: "SNOOZED",
        responseStatus: "NOT_NOW",
        followUpDate: snoozedUntil,
        performedByUserId: context.userId,
      },
      select: baselineOutreachRecordSelect,
    });

    if (targets.maintenanceRecordIds.length > 0) {
      await tx.vehicleMaintenanceRecord.updateMany({
        where: { id: { in: targets.maintenanceRecordIds }, shopId: context.shopId },
        data: {
          outreachStatus: "SNOOZED",
          outreachRecordId: outreach.id,
          updatedByUserId: context.userId,
        },
      });
    }
    if (targets.declinedWorkRecordIds.length > 0) {
      await tx.declinedWorkRecord.updateMany({
        where: { id: { in: targets.declinedWorkRecordIds }, shopId: context.shopId },
        data: {
          status: "SNOOZED",
          outreachStatus: "SNOOZED",
        },
      });
    }
    await tx.maintenanceRevenueOpportunity.updateMany({
      where: { id: { in: targets.opportunityIds }, shopId: context.shopId },
      data: {
        stage: "CONTACTED",
        lastActivityAt: new Date(),
      },
    });
  });
}

export async function endPilotOpportunitySnooze(
  context: AuthenticatedShopContext,
  input: {
    customerId: string;
    vehicleId: string;
    opportunityIds: string[];
  },
) {
  const targets = await loadOpenQueueTargets(context, input);

  await prisma.$transaction(async (tx) => {
    const outreach = await tx.outreachRecord.create({
      data: {
        shopId: context.shopId,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        message: "Snooze ended now. Opportunity returned to Needs Attention.",
        channel: "OTHER",
        status: "NEEDS_OUTREACH",
        responseStatus: "NO_RESPONSE",
        performedByUserId: context.userId,
      },
      select: baselineOutreachRecordSelect,
    });

    if (targets.maintenanceRecordIds.length > 0) {
      await tx.vehicleMaintenanceRecord.updateMany({
        where: { id: { in: targets.maintenanceRecordIds }, shopId: context.shopId },
        data: {
          outreachStatus: "NEEDS_OUTREACH",
          outreachRecordId: outreach.id,
          updatedByUserId: context.userId,
        },
      });
    }
    if (targets.declinedWorkRecordIds.length > 0) {
      await tx.declinedWorkRecord.updateMany({
        where: { id: { in: targets.declinedWorkRecordIds }, shopId: context.shopId },
        data: {
          status: "OPEN",
          outreachStatus: "NEEDS_OUTREACH",
        },
      });
    }
    await tx.maintenanceRevenueOpportunity.updateMany({
      where: { id: { in: targets.opportunityIds }, shopId: context.shopId },
      data: {
        stage: "IDENTIFIED",
        lastActivityAt: new Date(),
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
    opportunityIds?: string[];
    date: string;
    time: string;
    status: Appointment["status"];
    notes?: string;
    idempotencyKey?: string;
  },
) {
  const targets = input.opportunityIds?.length
    ? await loadOpenQueueTargets(context, {
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        opportunityIds: input.opportunityIds,
      })
    : undefined;
  const records = targets?.maintenanceRecords ?? await prisma.vehicleMaintenanceRecord.findMany({
    where: { id: { in: input.maintenanceRecordIds }, shopId: context.shopId },
  });
  const declinedWorkRecords = targets?.declinedWorkRecords ?? [];
  if (!targets && records.length !== input.maintenanceRecordIds.length) {
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
  if (declinedWorkRecords.some((record) => record.vehicleId !== input.vehicleId || record.customerId !== input.customerId)) {
    throw new Error("Selected declined work does not belong to the selected vehicle.");
  }
  const serviceItems = [
    ...records.map((record) => ({
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
  ];
  if (serviceItems.length === 0) {
    throw new Error("Select at least one service before booking.");
  }
  const totalLaborMinutes = serviceItems.reduce((sum, item) => sum + item.laborMinutes, 0);
  const totalPriceCents = serviceItems.reduce((sum, item) => sum + item.priceCents, 0);
  const scheduledStart = new Date(`${input.date}T${input.time}:00`);
  const scheduledEnd = new Date(scheduledStart.getTime() + Math.max(totalLaborMinutes, 30) * 60 * 1000);
  const appointmentId = appointmentIdFromIdempotencyKey(input.idempotencyKey);
  const duplicateAppointment = await prisma.appointment.findFirst({
    where: {
      shopId: context.shopId,
      ...(appointmentId ? { id: { not: appointmentId } } : {}),
      vehicleId: input.vehicleId,
      scheduledStart,
      status: {
        notIn: ["CANCELLED", "NO_SHOW"],
      },
    },
    select: duplicateAppointmentSelect,
  });

  if (duplicateAppointment) {
    throw new SafeActionError({
      code: "APPOINTMENT_SLOT_UNAVAILABLE",
      message: "That time is no longer available. Choose another appointment time.",
      status: 409,
      table: "Appointment",
      operation: "INSERT",
    });
  }

  await prisma.$transaction(async (tx) => {
    const maintenanceRecordIds = targets?.maintenanceRecordIds ?? input.maintenanceRecordIds;
    const synced = targets ? [] : await syncMaintenanceRevenueOpportunities(tx, context, maintenanceRecordIds);
    const existingAppointment = appointmentId
      ? await tx.appointment.findUnique({
          where: { id: appointmentId },
          select: baselineAppointmentSelect,
        })
      : null;
    if (
      existingAppointment &&
      (existingAppointment.shopId !== context.shopId ||
        existingAppointment.customerId !== input.customerId ||
        existingAppointment.vehicleId !== input.vehicleId ||
        existingAppointment.scheduledStart.getTime() !== scheduledStart.getTime())
    ) {
      throw new SafeActionError({
        code: "APPOINTMENT_RETRY_CONFLICT",
        message: "Refresh the page and try creating the appointment again.",
        status: 409,
        table: "Appointment",
        operation: "INSERT",
      });
    }
    const appointment = existingAppointment ?? await tx.appointment.create({
      data: {
        ...(appointmentId ? { id: appointmentId } : {}),
        shopId: context.shopId,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        scheduledStart,
        scheduledEnd,
        status: input.status,
        totalLaborMinutes,
        totalPriceCents,
        source: "AUTOMATION",
        attributionSource: "MAINTIVA_OUTREACH",
        opportunityId: targets?.opportunityIds[0] ?? synced[0]?.id,
        notes: input.notes,
        services: {
          create: serviceItems.map((record) => ({
            shopId: context.shopId,
            serviceDefinitionId: record.serviceDefinitionId,
            maintenanceRecordId: record.maintenanceRecordId,
            serviceName: record.serviceName,
            laborMinutes: record.laborMinutes,
            priceCents: record.priceCents,
          })),
        },
      },
      select: baselineAppointmentSelect,
    });
    if (maintenanceRecordIds.length > 0) {
      await tx.vehicleMaintenanceRecord.updateMany({
        where: { id: { in: maintenanceRecordIds }, shopId: context.shopId },
        data: {
          outreachStatus: "SCHEDULED",
          appointmentId: appointment.id,
          updatedByUserId: context.userId,
        },
      });
    }
    if (targets?.declinedWorkRecordIds.length) {
      await tx.declinedWorkRecord.updateMany({
        where: { id: { in: targets.declinedWorkRecordIds }, shopId: context.shopId },
        data: {
          status: "BOOKED",
          outreachStatus: "SCHEDULED",
          appointmentId: appointment.id,
        },
      });
    }
    if (targets) {
      await tx.maintenanceRevenueOpportunity.updateMany({
        where: { id: { in: targets.opportunityIds }, shopId: context.shopId },
        data: {
          stage: "BOOKED",
          lastActivityAt: new Date(),
        },
      });
    } else {
      await syncMaintenanceRevenueOpportunities(tx, context, input.maintenanceRecordIds);
    }
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
    select: baselineAppointmentWithServicesSelect,
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
      select: baselineAppointmentSelect,
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
    const maintenanceRecordIds = appointment.services
      .map((service) => service.maintenanceRecordId)
      .filter((id): id is string => Boolean(id));
    await syncMaintenanceRevenueOpportunities(tx, context, maintenanceRecordIds);
    const declinedRecords = await tx.declinedWorkRecord.findMany({
      where: { appointmentId: appointment.id, shopId: context.shopId },
      select: { id: true },
    });
    await syncDeclinedWorkRevenueOpportunities(tx, context, declinedRecords.map((record) => record.id));
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
  const rowCount = input.rows.length;
  if (isImportRowLimitExceeded(rowCount)) {
    throw new SafeActionError({
      code: "IMPORT_ROW_LIMIT_EXCEEDED",
      message: importRowLimitMessage(rowCount),
      status: 400,
      table: "ImportHistoryRecord",
      operation: "INSERT",
      details: `rowCount=${rowCount}; limit=${MAINTIVA_IMPORT_ROW_LIMIT}`,
    });
  }

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
  const rowAction = (row: (typeof preview.rows)[number]) => effectiveImportRowAction(row, rowActions, input.duplicateMode);
  const rowsToImport = preview.rows.filter((row) => {
    const action = rowAction(row);
    return (
      row.status !== "INVALID" &&
      row.status !== "HELD" &&
      (action === "IMPORT" || action === "UPDATE" || action === "IMPORT_AS_NEW")
    );
  });
  const defaultService = await prisma.serviceDefinition.findFirst({
    where: { shopId: context.shopId, isActive: true },
    orderBy: { name: "asc" },
  });

  await prisma.$transaction(async (tx) => {
    const customerByKey = new Map<string, { id: string; firstName: string; lastName: string; email: string | null; phone: string | null }>();
    const vehicleByKey = new Map<string, { id: string; customerId: string; year: number; make: string; model: string; vin: string | null; currentMileage: number; licensePlate: string | null }>();
    const importedMileageKeys = new Set<string>();
    const touchedVehicleIds = new Set<string>();
    const touchedMaintenanceRecordIds: string[] = [];
    const touchedDeclinedWorkRecordIds: string[] = [];

    for (const row of rowsToImport) {
      const normalized = row.normalized;
      const email = stringValue(normalized, "customerEmail").toLowerCase();
      const phone = stringValue(normalized, "customerPhone");
      const firstName = stringValue(normalized, "customerFirstName");
      const lastName = stringValue(normalized, "customerLastName");
      const vin = stringValue(normalized, "vin").toUpperCase();
      const action = rowAction(row);
      const currentMileage = nullableNumberValue(normalized, "currentMileage");
      const serviceMileage = nullableNumberValue(normalized, "serviceMileage");
      const importEvent = classifyImportRowEvent(input.importType, normalized);
      if (importEvent.ambiguousConflict) continue;
      const serviceDateValue = stringValue(normalized, "serviceDate");
      const importsCompletedService = importEvent.importsCompletedService;
      const importsDeclinedWork = importEvent.importsDeclinedWork;
      const actualCurrentMileage = importsCompletedService && serviceDateValue ? null : currentMileage;
      const historicalServiceMileage = importsCompletedService && serviceDateValue && serviceMileage === null
        ? currentMileage
        : serviceMileage;

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

      const shouldCreateSeparateVehicle = action === "IMPORT_AS_NEW" && row.entities.vehicle.status !== "MATCH";
      const existingVinVehicle = !shouldCreateSeparateVehicle && vin
        ? await tx.vehicle.findFirst({ where: { shopId: context.shopId, vin } })
        : null;
      const vehicleVin = existingVinVehicle && action === "IMPORT_AS_NEW" && row.entities.vehicle.status !== "MATCH" ? null : vin || null;
      let vehicle = row.entities.vehicle.key ? vehicleByKey.get(row.entities.vehicle.key) ?? null : null;
      vehicle ??= existingVinVehicle;
      vehicle ??= !shouldCreateSeparateVehicle
        ? await tx.vehicle.findFirst({
          where: {
            shopId: context.shopId,
            customerId: customer.id,
            year: numberValue(normalized, "vehicleYear"),
            make: stringValue(normalized, "vehicleMake"),
            model: stringValue(normalized, "vehicleModel"),
          },
        })
        : null;

      if (vehicle) {
        vehicle = await tx.vehicle.update({
          where: { id: vehicle.id },
          data: {
            customerId: customer.id,
            year: numberValue(normalized, "vehicleYear") || vehicle.year,
            make: stringValue(normalized, "vehicleMake") || vehicle.make,
            model: stringValue(normalized, "vehicleModel") || vehicle.model,
            currentMileage: actualCurrentMileage ?? vehicle.currentMileage,
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
            currentMileage: actualCurrentMileage ?? 0,
            estimatedAnnualMileage: 12_000,
            lastServiceDate: new Date(),
          },
        });
      } else {
        continue;
      }
      if (row.entities.vehicle.key) vehicleByKey.set(row.entities.vehicle.key, vehicle);
      touchedVehicleIds.add(vehicle.id);

      if (actualCurrentMileage !== null) {
        const currentMileageDate = currentDateInTimeZone(context.shopTimezone);
        const currentMileageKey = `${vehicle.id}|${currentMileageDate}|${actualCurrentMileage}`;
        const existingCurrentMileageReading = await tx.vehicleMileageReading.findFirst({
          where: {
            shopId: context.shopId,
            vehicleId: vehicle.id,
            readingDate: dateFromDateOnly(currentMileageDate),
            readingMileage: actualCurrentMileage,
          },
        });
        if (!existingCurrentMileageReading && !importedMileageKeys.has(currentMileageKey)) {
          importedMileageKeys.add(currentMileageKey);
          await tx.vehicleMileageReading.create({
            data: {
              shopId: context.shopId,
              vehicleId: vehicle.id,
              readingMileage: actualCurrentMileage,
              readingDate: dateFromDateOnly(currentMileageDate),
              source: "SHOP_MANUAL_ENTRY",
              verificationStatus: "IMPORTED",
              anomalyStatus: "NONE",
              includedInForecast: true,
              sourceReferenceType: "ImportRowRecord",
              recordedByUserId: context.userId,
            },
          });
          await recalculatePersistedDrivingProfile({ tx, context, vehicleId: vehicle.id });
        }
      }

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
        const maintenance = await tx.vehicleMaintenanceRecord.update({
          where: { id: existingMaintenance.id },
          data: {
            lastCompletedDate: importsCompletedService && stringValue(normalized, "serviceDate")
              ? new Date(stringValue(normalized, "serviceDate"))
              : undefined,
            lastCompletedMileage: importsCompletedService ? historicalServiceMileage ?? undefined : undefined,
            priceOverrideCents: priceCents,
            laborMinutesOverride: laborMinutes,
            priceCents,
            laborMinutes,
            updatedByUserId: context.userId,
          },
        });
        touchedMaintenanceRecordIds.push(maintenance.id);
      } else {
        const maintenance = await tx.vehicleMaintenanceRecord.create({
          data: {
          shopId: context.shopId,
          vehicleId: vehicle.id,
          serviceDefinitionId: service.id,
          serviceName,
          lastCompletedDate: stringValue(normalized, "serviceDate")
            && importsCompletedService
            ? new Date(stringValue(normalized, "serviceDate"))
            : null,
          lastCompletedMileage: importsCompletedService ? historicalServiceMileage : null,
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
        touchedMaintenanceRecordIds.push(maintenance.id);
      }

      if (importsCompletedService && stringValue(normalized, "serviceDate")) {
        const serviceDate = stringValue(normalized, "serviceDate");
        const serviceHistory = await tx.serviceHistoryRecord.create({
          data: {
            shopId: context.shopId,
            customerId: customer.id,
            vehicleId: vehicle.id,
            serviceDefinitionId: service.id,
            serviceName,
            completedAt: dateFromDateOnly(serviceDate),
            mileage: historicalServiceMileage,
            laborMinutes,
            priceCents,
            notes: "Imported from CSV.",
          },
        });
        const mileageKey = `${vehicle.id}|${serviceDate}|${historicalServiceMileage ?? "missing"}`;
        const existingReading = historicalServiceMileage !== null
          ? await tx.vehicleMileageReading.findFirst({
            where: {
              shopId: context.shopId,
              vehicleId: vehicle.id,
              readingDate: dateFromDateOnly(serviceDate),
              readingMileage: historicalServiceMileage,
            },
          })
          : null;
        if (historicalServiceMileage !== null && !existingReading && !importedMileageKeys.has(mileageKey)) {
          importedMileageKeys.add(mileageKey);
          await tx.vehicleMileageReading.create({
            data: {
              shopId: context.shopId,
              vehicleId: vehicle.id,
              readingMileage: historicalServiceMileage,
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

      if (importsDeclinedWork) {
        const declinedRecord = await tx.declinedWorkRecord.create({
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
        touchedDeclinedWorkRecordIds.push(declinedRecord.id);
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
          select: duplicateAppointmentSelect,
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
            select: duplicateAppointmentSelect,
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
        status: summary.heldRows > 0 ? "PARTIAL" : "COMPLETED",
        totalRows: summary.totalRows,
        successfulRows: summary.importedRows,
        duplicateRows: summary.duplicateSkippedRows,
        updatedRows: summary.updatedRows,
        skippedRows: summary.skippedRows,
        failedRows: 0,
        errorReportUrl: summary.heldRows > 0 || summary.skippedRows > 0 ? "downloadable-result-report" : null,
        errorReport: {
          displayStatus: summary.successfulRows + summary.updatedRows > 0
            ? summary.heldRows > 0
              ? "COMPLETED_WITH_REVIEW"
              : "COMPLETED"
            : summary.heldRows > 0
              ? "REVIEW_REQUIRED"
              : "COMPLETED",
          heldRows: summary.heldRows,
          reviewRows: summary.reviewRows,
          invalidRows: summary.invalidRows,
          duplicateSkippedRows: summary.duplicateSkippedRows,
          importedRows: summary.importedRows,
          matchedExistingRows: summary.matchedExistingRows,
          needsReviewRows: summary.needsReviewRows,
          skippedByUserRows: summary.skippedByUserRows,
          totalProcessedRows: summary.totalProcessedRows,
          resultMessage: summary.resultMessage,
          rows: preview.rows.map((row) => {
            const action = rowAction(row);
            return {
              rowNumber: row.rowNumber,
              primaryOutcome: row.status === "INVALID"
                ? "INVALID"
                : row.status === "HELD" || action === "HOLD"
                  ? "NEEDS_REVIEW"
                  : action === "SKIP" && row.entities.child.status === "DUPLICATE"
                    ? "DUPLICATE_SKIPPED"
                    : action === "SKIP"
                      ? "SKIPPED_BY_USER"
                      : action === "UPDATE"
                        ? "MATCHED_EXISTING"
                        : "IMPORTED",
              customer: {
                status: row.entities.customer.status,
                matchField: row.entities.customer.matchField,
                message: row.entities.customer.message,
              },
              vehicle: {
                status: row.entities.vehicle.status,
                matchField: row.entities.vehicle.matchField,
                message: row.entities.vehicle.message,
              },
              child: {
                entity: row.entities.child.entity,
                status: row.entities.child.status,
                message: row.entities.child.message,
              },
            };
          }),
        },
      },
    });

    const touchedVehicleMaintenanceRecords = await tx.vehicleMaintenanceRecord.findMany({
      where: {
        shopId: context.shopId,
        vehicleId: { in: Array.from(touchedVehicleIds) },
        isActive: true,
        archivedAt: null,
      },
      select: { id: true },
    });
    await syncMaintenanceRevenueOpportunities(
      tx,
      context,
      [
        ...touchedMaintenanceRecordIds,
        ...touchedVehicleMaintenanceRecords.map((record) => record.id),
      ],
    );
    await syncDeclinedWorkRevenueOpportunities(tx, context, touchedDeclinedWorkRecordIds);

    await tx.importRowRecord.createMany({
      data: preview.rows.map((row) => {
        const action = rowAction(row);
        const status = row.status === "INVALID"
          ? "INVALID"
          : row.status === "HELD"
            ? "NEEDS_REVIEW"
            : action === "HOLD"
              ? "NEEDS_REVIEW"
              : action === "SKIP"
                ? "DUPLICATE_SKIPPED"
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
