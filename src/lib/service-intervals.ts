import {
  asOfDate,
  type DrivingProfileConfidence,
  type MaintenanceService,
  type MaintenanceStatus,
  type OutreachThresholdType,
  type TimeIntervalUnit,
  type Vehicle,
  type VehicleMaintenanceRecord,
} from "@/lib/demo-data";
import type { EffectiveForecastMileage, ForecastMileageKind } from "@/lib/adaptive-mileage";

const dayMs = 86_400_000;

export type MaintenanceIntervalStatus = MaintenanceStatus | "NOT_ENOUGH_HISTORY";

export type EffectiveMaintenanceInterval = {
  serviceName: string;
  category: string;
  mileageInterval: number | null;
  timeIntervalValue: number | null;
  timeIntervalUnit: TimeIntervalUnit | null;
  priceCents: number;
  laborMinutes: number;
  thresholdType: OutreachThresholdType;
  thresholdValue: number;
  sourceLabel: "Shop default" | "Custom for this vehicle" | "Vehicle-only service";
  usesShopDefault: boolean;
  nextDueMileage: number | null;
  nextDueDate: string | null;
  status: MaintenanceIntervalStatus;
  dueText: string;
  triggerText: string;
  thresholdCause: string;
  lifeRemaining: number;
  milesUntilDue: number | null;
  daysUntilDue: number | null;
  notEnoughHistoryReason?: string;
  forecastMileage: number | null;
  forecastMileageKind: ForecastMileageKind | "LEGACY";
  latestKnownMileage: number | null;
  latestKnownDate: string | null;
  forecastConfidence: DrivingProfileConfidence | "NONE" | null;
  forecastConfidenceReason?: string;
};

function serviceName(record: VehicleMaintenanceRecord, service?: MaintenanceService) {
  return record.customServiceName || record.serviceName || service?.name || "Custom service";
}

function serviceCategory(record: VehicleMaintenanceRecord, service?: MaintenanceService) {
  return record.customCategory || service?.category || "Custom";
}

export function timeIntervalToMonths(value: number | null | undefined, unit: TimeIntervalUnit | null | undefined) {
  if (!value || !unit) return null;
  if (unit === "DAYS") return value / 30.4375;
  if (unit === "YEARS") return value * 12;
  return value;
}

export function addTimeInterval(date: string, value: number, unit: TimeIntervalUnit) {
  const next = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  if (unit === "DAYS") next.setUTCDate(next.getUTCDate() + value);
  if (unit === "MONTHS") next.setUTCMonth(next.getUTCMonth() + value);
  if (unit === "YEARS") next.setUTCFullYear(next.getUTCFullYear() + value);
  return next.toISOString().slice(0, 10);
}

function intervalText(mileage: number | null, value: number | null, unit: TimeIntervalUnit | null) {
  const parts = [];
  if (mileage) parts.push(`${mileage.toLocaleString()} miles`);
  if (value && unit) parts.push(`${value} ${unit.toLowerCase()}`);
  return parts.join(" or ") || "Non-recurring";
}

export function thresholdText(type: OutreachThresholdType, value: number) {
  if (type === "DAYS_BEFORE_DUE") return `Create an opportunity ${value} days before service is due.`;
  if (type === "PERCENT_REMAINING") return `Create an opportunity when ${value}% or less of the interval remains.`;
  return `Create an opportunity ${value.toLocaleString()} miles before service is due.`;
}

function remainingPercent(remaining: number, interval: number) {
  return Math.max(0, Math.min(100, Math.round((remaining / interval) * 100)));
}

function bestStatus(statuses: MaintenanceIntervalStatus[]) {
  if (statuses.includes("OVERDUE")) return "OVERDUE";
  if (statuses.includes("DUE")) return "DUE";
  if (statuses.includes("DUE_SOON")) return "DUE_SOON";
  if (statuses.includes("NOT_ENOUGH_HISTORY")) return "NOT_ENOUGH_HISTORY";
  return "HEALTHY";
}

function formatCause(causes: string[]) {
  if (causes.length === 0) return "";
  if (causes.length === 1) return causes[0];
  return "both mileage and time";
}

export function resolveMaintenanceInterval({
  record,
  service,
  vehicle,
  forecastMileage,
  asOf = asOfDate,
}: {
  record: VehicleMaintenanceRecord;
  service?: MaintenanceService;
  vehicle: Vehicle;
  forecastMileage?: EffectiveForecastMileage;
  asOf?: Date;
}): EffectiveMaintenanceInterval {
  const hasMileageOverride = record.mileageIntervalOverride !== null && record.mileageIntervalOverride !== undefined;
  const hasTimeOverride = record.timeIntervalValueOverride !== null && record.timeIntervalValueOverride !== undefined;
  const hasPriceOverride = record.priceOverrideCents !== null && record.priceOverrideCents !== undefined;
  const hasLaborOverride = record.laborMinutesOverride !== null && record.laborMinutesOverride !== undefined;
  const legacyMileageOverride = record.recommendedMileageInterval !== null && record.recommendedMileageInterval !== undefined
    ? record.recommendedMileageInterval
    : null;
  const legacyTimeOverride = record.recommendedTimeIntervalMonths !== null && record.recommendedTimeIntervalMonths !== undefined
    ? record.recommendedTimeIntervalMonths
    : null;
  const vehicleOnly = !record.serviceId;
  const mileageInterval = hasMileageOverride
    ? record.mileageIntervalOverride ?? null
    : service?.defaultMileageInterval ?? legacyMileageOverride;
  const timeIntervalValue = hasTimeOverride
    ? record.timeIntervalValueOverride ?? null
    : service?.defaultTimeIntervalValue ?? legacyTimeOverride;
  const timeIntervalUnit = hasTimeOverride
    ? record.timeIntervalUnitOverride ?? null
    : service?.defaultTimeIntervalUnit ?? (legacyTimeOverride ? "MONTHS" : null);
  const priceCents = hasPriceOverride
    ? record.priceOverrideCents ?? 0
    : service?.defaultPriceCents ?? record.priceCents;
  const laborMinutes = hasLaborOverride
    ? record.laborMinutesOverride ?? 0
    : service?.estimatedLaborMinutes ?? Math.round(record.laborHours * 60);
  const hasVehicleOverride = hasMileageOverride || hasTimeOverride || hasPriceOverride || hasLaborOverride || vehicleOnly;
  const thresholdType = record.outreachThresholdType ?? "MILES_BEFORE_DUE";
  // MVP default: create outreach opportunities 500 miles before the effective due mileage.
  const thresholdValue = record.outreachThresholdValue ?? (
    thresholdType === "MILES_BEFORE_DUE" ? 500 : thresholdType === "DAYS_BEFORE_DUE" ? 30 : record.notificationThreshold
  );
  const statuses: MaintenanceIntervalStatus[] = [];
  const dueCauses: string[] = [];
  const soonCauses: string[] = [];
  let nextDueMileage: number | null = null;
  let nextDueDate: string | null = null;
  let milesUntilDue: number | null = null;
  let daysUntilDue: number | null = null;
  const lifeValues: number[] = [];
  const reasons: string[] = [];
  const mileageForForecast = forecastMileage ? forecastMileage.mileage : vehicle.currentMileage;

  if (mileageInterval) {
    if (record.lastCompletedMileage === null || record.lastCompletedMileage === undefined || mileageForForecast === null || mileageForForecast === undefined) {
      statuses.push("NOT_ENOUGH_HISTORY");
      reasons.push("Unable to calculate until latest known mileage and last completed mileage are entered.");
    } else {
      nextDueMileage = record.lastCompletedMileage + mileageInterval;
      milesUntilDue = nextDueMileage - mileageForForecast;
      lifeValues.push(remainingPercent(milesUntilDue, mileageInterval));
      if (milesUntilDue < 0) {
        statuses.push("OVERDUE");
        dueCauses.push("mileage");
      } else if (milesUntilDue === 0) {
        statuses.push("DUE");
        dueCauses.push("mileage");
      } else if (
        thresholdType === "MILES_BEFORE_DUE"
          ? milesUntilDue <= thresholdValue
          : thresholdType === "PERCENT_REMAINING"
            ? remainingPercent(milesUntilDue, mileageInterval) <= thresholdValue
            : false
      ) {
        statuses.push("DUE_SOON");
        soonCauses.push("mileage");
      } else {
        statuses.push("HEALTHY");
      }
    }
  }

  if (timeIntervalValue && timeIntervalUnit) {
    if (!record.lastCompletedDate) {
      statuses.push("NOT_ENOUGH_HISTORY");
      reasons.push("Unable to calculate until last completed date is entered.");
    } else {
      nextDueDate = addTimeInterval(record.lastCompletedDate, timeIntervalValue, timeIntervalUnit);
      daysUntilDue = Math.ceil((new Date(`${nextDueDate}T12:00:00Z`).getTime() - asOf.getTime()) / dayMs);
      const totalDays = Math.max(1, (timeIntervalToMonths(timeIntervalValue, timeIntervalUnit) ?? 0) * 30.4375);
      lifeValues.push(remainingPercent(daysUntilDue, totalDays));
      if (daysUntilDue < 0) {
        statuses.push("OVERDUE");
        dueCauses.push("time");
      } else if (daysUntilDue === 0) {
        statuses.push("DUE");
        dueCauses.push("time");
      } else if (
        thresholdType === "DAYS_BEFORE_DUE"
          ? daysUntilDue <= thresholdValue
          : thresholdType === "PERCENT_REMAINING"
            ? remainingPercent(daysUntilDue, totalDays) <= thresholdValue
            : false
      ) {
        statuses.push("DUE_SOON");
        soonCauses.push("time");
      } else {
        statuses.push("HEALTHY");
      }
    }
  }

  if (!mileageInterval && !(timeIntervalValue && timeIntervalUnit)) {
    statuses.push("HEALTHY");
  }

  const status = bestStatus(statuses);
  const lifeRemaining = lifeValues.length ? Math.min(...lifeValues) : 100;
  const cause = status === "DUE_SOON" ? formatCause(soonCauses) : formatCause(dueCauses);
  let dueText = "Non-recurring service";

  if (status === "NOT_ENOUGH_HISTORY") {
    dueText = reasons[0] ?? "Not enough history to calculate status.";
  } else if (status === "OVERDUE") {
    const parts = [
      milesUntilDue !== null && milesUntilDue < 0 ? `${Math.abs(milesUntilDue).toLocaleString()} miles` : "",
      daysUntilDue !== null && daysUntilDue < 0 ? `${Math.abs(daysUntilDue)} days` : "",
    ].filter(Boolean);
    dueText = `Overdue by ${parts.join(" and ")}`;
  } else if (status === "DUE") {
    dueText = `Due now by ${cause || "interval"}`;
  } else if (status === "DUE_SOON") {
    if (cause === "time" && daysUntilDue !== null) dueText = `Due in ${daysUntilDue} days`;
    else if (milesUntilDue !== null) dueText = `Due in ${milesUntilDue.toLocaleString()} miles`;
    else dueText = `Due soon by ${cause || "interval"}`;
  } else if (milesUntilDue !== null && daysUntilDue !== null) {
    dueText = `Due in ${milesUntilDue.toLocaleString()} miles or ${daysUntilDue} days`;
  } else if (milesUntilDue !== null) {
    dueText = `Due in ${milesUntilDue.toLocaleString()} miles`;
  } else if (daysUntilDue !== null) {
    dueText = `Due in ${daysUntilDue} days`;
  }

  return {
    serviceName: serviceName(record, service),
    category: serviceCategory(record, service),
    mileageInterval,
    timeIntervalValue,
    timeIntervalUnit,
    priceCents,
    laborMinutes,
    thresholdType,
    thresholdValue,
    sourceLabel: vehicleOnly ? "Vehicle-only service" : hasVehicleOverride ? "Custom for this vehicle" : "Shop default",
    usesShopDefault: Boolean(service && !hasVehicleOverride),
    nextDueMileage,
    nextDueDate,
    status,
    dueText,
    triggerText: thresholdText(thresholdType, thresholdValue),
    thresholdCause: cause,
    lifeRemaining,
    milesUntilDue,
    daysUntilDue,
    notEnoughHistoryReason: reasons[0],
    forecastMileage: mileageForForecast ?? null,
    forecastMileageKind: forecastMileage?.kind ?? "LEGACY",
    latestKnownMileage: forecastMileage?.latestKnownMileage ?? null,
    latestKnownDate: forecastMileage?.latestKnownDate ?? null,
    forecastConfidence: forecastMileage?.confidence ?? null,
    forecastConfidenceReason: forecastMileage?.confidenceReason,
  };
}

export function formatInterval(mileage: number | null, value: number | null, unit: TimeIntervalUnit | null) {
  return intervalText(mileage, value, unit);
}
