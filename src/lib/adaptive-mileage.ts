import { type DrivingProfileConfidence, type DrivingProfileEstimateSource, type MileageAnomalyStatus, type MileageVerificationStatus, type Vehicle, type VehicleDrivingProfile, type VehicleMileageReading } from "@/lib/demo-data";
import type { EffectiveMaintenanceInterval } from "@/lib/service-intervals";
import { addCalendarDays, calendarDaysBetween, normalizeDateOnly, resolveForecastAsOfDate } from "@/lib/forecast-dates";

export const DEFAULT_ANNUAL_MILEAGE = 12_500;
export const DEFAULT_MONTHLY_MILEAGE = Math.round(DEFAULT_ANNUAL_MILEAGE / 12);
export const DEFAULT_DAILY_MILEAGE = DEFAULT_ANNUAL_MILEAGE / 365;

const reasonableAnnualMileageCeiling = 75_000;

export type MileageReadingDraft = Pick<
  VehicleMileageReading,
  "readingMileage" | "readingDate" | "source" | "verificationStatus" | "includedInForecast"
> & {
  anomalyStatus?: MileageAnomalyStatus;
};

export type DrivingProfileCalculationInput = {
  vehicleId: string;
  shopId: string;
  readings: MileageReadingDraft[];
  shopDefaultAnnualMileage?: number | null;
  customerReportedAnnualMileage?: number | null;
  customerReportedAt?: string | null;
  customerReportedByUserId?: string | null;
  existingProfile?: Partial<VehicleDrivingProfile> | null;
  asOf?: Date | string;
  shopTimezone?: string | null;
};

export type DrivingProfileCalculation = Omit<VehicleDrivingProfile, "id"> & {
  effectiveAnnualMileage: number;
  effectiveDailyMileage: number;
  usableReadingCount: number;
  latestMileageReading?: MileageReadingDraft;
};

export type ForecastMileageKind = "ACTUAL" | "ESTIMATED" | "UNAVAILABLE";

export type EffectiveForecastMileage = {
  mileage: number | null;
  kind: ForecastMileageKind;
  latestKnownMileage: number | null;
  latestKnownDate: string | null;
  latestKnownReading?: MileageReadingDraft;
  annualMileage: number | null;
  dailyMileage: number | null;
  source: DrivingProfileEstimateSource | "NO_HISTORY";
  confidence: DrivingProfileConfidence | "NONE";
  confidenceReason: string;
  daysSinceLatestKnownReading: number | null;
  asOf: string;
};

export type MileageAnomalyReview = {
  index: number;
  status: MileageAnomalyStatus;
  reason?: string;
};

export type MileageReadingValidationIssue = {
  code:
    | "READING_DATE_REQUIRED"
    | "READING_DATE_FUTURE"
    | "READING_DATE_BEFORE_MODEL_YEAR"
    | "ODOMETER_SEQUENCE_CONFLICT"
    | "DUPLICATE_READING";
  severity: "error" | "warning";
  message: string;
};

function parseDate(value: Date | string) {
  return new Date(`${dateKey(value)}T12:00:00Z`);
}

function dateKey(value: Date | string) {
  return normalizeDateOnly(value);
}

function daysBetween(start: Date | string, end: Date | string) {
  return Math.max(0, calendarDaysBetween(start, end));
}

function annualize(first: MileageReadingDraft, last: MileageReadingDraft) {
  const days = daysBetween(first.readingDate, last.readingDate);
  if (days <= 0 || last.readingMileage <= first.readingMileage) return null;
  return Math.round(((last.readingMileage - first.readingMileage) / days) * 365);
}

function annualizeStableSpan(readings: MileageReadingDraft[]) {
  if (spanDays(readings) < 30) return null;
  return annualize(readings[0], readings[readings.length - 1]);
}

function cleanAnnualMileage(value?: number | null) {
  if (!value || value <= 0) return null;
  return Math.round(value);
}

export function isUsableMileageReading(reading: MileageReadingDraft, asOf: Date | string = resolveForecastAsOfDate()) {
  const parsedDate = parseDate(reading.readingDate);
  return (
    reading.includedInForecast !== false &&
    reading.verificationStatus !== "EXCLUDED" &&
    reading.anomalyStatus !== "NEEDS_REVIEW" &&
    reading.readingMileage >= 0 &&
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.getTime() <= parseDate(asOf).getTime()
  );
}

export function sortMileageReadings<T extends MileageReadingDraft>(readings: T[]) {
  return [...readings].sort((a, b) =>
    parseDate(a.readingDate).getTime() - parseDate(b.readingDate).getTime() ||
    a.readingMileage - b.readingMileage,
  );
}

function readingsByStatus(readings: MileageReadingDraft[], statuses: MileageVerificationStatus[], asOf: Date | string = resolveForecastAsOfDate()) {
  return sortMileageReadings(
    readings.filter((reading) =>
      isUsableMileageReading(reading, asOf) && statuses.includes(reading.verificationStatus),
    ),
  );
}

function spanDays(readings: MileageReadingDraft[]) {
  if (readings.length < 2) return 0;
  return daysBetween(readings[0].readingDate, readings[readings.length - 1].readingDate);
}

function repeatedActivity(readings: MileageReadingDraft[]) {
  return readings.some((reading, index) => index > 0 && reading.readingMileage > readings[index - 1].readingMileage);
}

function hasUnresolvedSeriousAnomaly(readings: MileageReadingDraft[]) {
  return readings.some((reading) => reading.anomalyStatus === "NEEDS_REVIEW");
}

function classifyConfidence({
  readings,
  annualMileage,
  source,
  asOf,
}: {
  readings: MileageReadingDraft[];
  annualMileage: number;
  source: DrivingProfileEstimateSource;
  asOf: Date | string;
}): { confidence: DrivingProfileConfidence; reason: string } {
  const verified = readingsByStatus(readings, ["VERIFIED"], asOf);
  const usable = sortMileageReadings(readings.filter((reading) => isUsableMileageReading(reading, asOf)));
  const usableSpan = spanDays(usable);
  const verifiedSpan = spanDays(verified);
  const reasonablePace = annualMileage > 0 && annualMileage <= reasonableAnnualMileageCeiling;

  if (
    verified.length >= 3 &&
    verifiedSpan >= 180 &&
    repeatedActivity(verified) &&
    reasonablePace &&
    !hasUnresolvedSeriousAnomaly(readings)
  ) {
    return {
      confidence: "HIGH",
      reason: "At least three verified readings span 180+ days with repeated activity and no unresolved anomaly.",
    };
  }

  if (
    usable.length >= 2 &&
    usableSpan >= 30 &&
    repeatedActivity(usable) &&
    reasonablePace &&
    !hasUnresolvedSeriousAnomaly(readings)
  ) {
    return {
      confidence: "MEDIUM",
      reason: "At least two usable readings span 30+ days with a reasonable annualized pace.",
    };
  }

  if (source === "CUSTOMER_REPORTED") {
    return {
      confidence: "LOW",
      reason: "Using customer-reported annual mileage until shop history confirms the pace.",
    };
  }

  if (source === "VERIFIED_PLUS_DEFAULT") {
    return {
      confidence: "LOW",
      reason: "Using one mileage reading with the shop default annual mileage until more history exists.",
    };
  }

  return {
    confidence: "LOW",
    reason: "Using Maintiva default because no usable mileage history is available.",
  };
}

export function detectMileageAnomalies(readings: MileageReadingDraft[]): MileageAnomalyReview[] {
  const sorted = sortMileageReadings(readings);
  return sorted.map((reading, index) => {
    const previous = index > 0 ? sorted[index - 1] : undefined;
    if (previous && reading.readingMileage < previous.readingMileage) {
      return {
        index,
        status: "NEEDS_REVIEW",
        reason: "Mileage is lower than the prior dated reading.",
      };
    }
    return { index, status: reading.anomalyStatus ?? "NONE" };
  });
}

export function validateMileageReading({
  reading,
  existingReadings,
  vehicleYear,
  asOf = new Date(),
}: {
  reading: Pick<MileageReadingDraft, "readingMileage" | "readingDate">;
  existingReadings: MileageReadingDraft[];
  vehicleYear?: number | null;
  asOf?: Date | string;
}): MileageReadingValidationIssue[] {
  const issues: MileageReadingValidationIssue[] = [];
  const readingDate = dateKey(reading.readingDate);
  const parsedDate = parseDate(readingDate);
  const cutoffDate = parseDate(asOf);

  if (!readingDate || Number.isNaN(parsedDate.getTime())) {
    return [{
      code: "READING_DATE_REQUIRED",
      severity: "error",
      message: "Reading Date is required.",
    }];
  }

  if (parsedDate.getTime() > cutoffDate.getTime()) {
    issues.push({
      code: "READING_DATE_FUTURE",
      severity: "error",
      message: "Reading Date cannot be in the future.",
    });
  }

  if (vehicleYear && parsedDate.getTime() < parseDate(`${vehicleYear}-01-01`).getTime()) {
    issues.push({
      code: "READING_DATE_BEFORE_MODEL_YEAR",
      severity: "warning",
      message: "Reading Date is earlier than the vehicle model year.",
    });
  }

  for (const existing of existingReadings) {
    const existingDate = dateKey(existing.readingDate);
    const existingTime = parseDate(existingDate).getTime();
    if (Number.isNaN(existingTime)) continue;

    if (existingDate === readingDate && existing.readingMileage === reading.readingMileage) {
      issues.push({
        code: "DUPLICATE_READING",
        severity: "warning",
        message: "An identical reading already exists for this vehicle and Reading Date.",
      });
    }

    if (
      existing.verificationStatus === "VERIFIED" &&
      existingDate > readingDate &&
      existing.readingMileage < reading.readingMileage
    ) {
      issues.push({
        code: "ODOMETER_SEQUENCE_CONFLICT",
        severity: "warning",
        message: "This mileage is higher than a later verified reading.",
      });
    }

    if (existing.verificationStatus === "VERIFIED" && existingDate < readingDate && existing.readingMileage > reading.readingMileage) {
      issues.push({
        code: "ODOMETER_SEQUENCE_CONFLICT",
        severity: "warning",
        message: "This mileage is lower than an earlier verified reading.",
      });
    }
  }

  return issues;
}

export function resolveCurrentMileage(vehicle: Pick<Vehicle, "currentMileage">, readings: MileageReadingDraft[]) {
  const latest = sortMileageReadings(readings.filter((reading) => isUsableMileageReading(reading))).at(-1);
  return {
    currentMileage: latest?.readingMileage ?? vehicle.currentMileage,
    source: latest ? "Latest valid mileage reading" : "Legacy vehicle mileage",
    reading: latest,
  };
}

export function resolveLatestKnownMileage(readings: MileageReadingDraft[], asOf: Date | string = resolveForecastAsOfDate()) {
  return sortMileageReadings(readings.filter((reading) => isUsableMileageReading(reading, asOf))).at(-1);
}

export function calculateDrivingProfile({
  vehicleId,
  shopId,
  readings,
  shopDefaultAnnualMileage,
  customerReportedAnnualMileage,
  customerReportedAt,
  customerReportedByUserId,
  existingProfile,
  asOf,
  shopTimezone,
}: DrivingProfileCalculationInput): DrivingProfileCalculation {
  const asOfKey = resolveForecastAsOfDate({ shopTimezone, now: asOf });
  const shopDefault = cleanAnnualMileage(shopDefaultAnnualMileage) ?? DEFAULT_ANNUAL_MILEAGE;
  const manualOverride = cleanAnnualMileage(existingProfile?.manualAnnualMileageOverride);
  const verified = readingsByStatus(readings, ["VERIFIED"], asOfKey);
  const imported = readingsByStatus(readings, ["IMPORTED"], asOfKey);
  const usable = sortMileageReadings(readings.filter((reading) => isUsableMileageReading(reading, asOfKey)));
  let calculatedAnnualMileage = shopDefault;
  let estimateSource: DrivingProfileEstimateSource = "SHOP_DEFAULT";

  if (manualOverride) {
    calculatedAnnualMileage = manualOverride;
    estimateSource = "MANUAL_OVERRIDE";
  } else {
    const verifiedAnnualMileage = verified.length >= 2 ? annualizeStableSpan(verified) : null;
    const importedAnnualMileage = imported.length >= 2 ? annualizeStableSpan(imported) : null;
    if (verifiedAnnualMileage) {
      calculatedAnnualMileage = verifiedAnnualMileage;
      estimateSource = "SHOP_VERIFIED_READINGS";
    } else if (importedAnnualMileage) {
      calculatedAnnualMileage = importedAnnualMileage;
      estimateSource = "IMPORTED_READINGS";
    } else if (cleanAnnualMileage(customerReportedAnnualMileage)) {
      calculatedAnnualMileage = cleanAnnualMileage(customerReportedAnnualMileage) ?? shopDefault;
      estimateSource = "CUSTOMER_REPORTED";
    } else if (verified.length > 0 || imported.length > 0) {
      calculatedAnnualMileage = shopDefault;
      estimateSource = "VERIFIED_PLUS_DEFAULT";
    }
  }

  const confidence = manualOverride
    ? {
        confidence: "LOW" as DrivingProfileConfidence,
        reason: "Manual override is active; review before treating the estimate as learned behavior.",
      }
    : classifyConfidence({ readings, annualMileage: calculatedAnnualMileage, source: estimateSource, asOf: asOfKey });

  return {
    shopId,
    vehicleId,
    customerReportedAnnualMileage: customerReportedAnnualMileage ?? existingProfile?.customerReportedAnnualMileage ?? null,
    customerReportedAt: customerReportedAt ?? existingProfile?.customerReportedAt ?? null,
    customerReportedByUserId: customerReportedByUserId ?? existingProfile?.customerReportedByUserId ?? null,
    calculatedAnnualMileage,
    effectiveAnnualMileage: calculatedAnnualMileage,
    effectiveDailyMileage: calculatedAnnualMileage / 365,
    estimateSource,
    confidence: confidence.confidence,
    confidenceReason: confidence.reason,
    manualAnnualMileageOverride: existingProfile?.manualAnnualMileageOverride ?? null,
    manualOverrideReason: existingProfile?.manualOverrideReason ?? null,
    manualOverrideNotes: existingProfile?.manualOverrideNotes ?? null,
    manualOverrideSetAt: existingProfile?.manualOverrideSetAt ?? null,
    manualOverrideSetByUserId: existingProfile?.manualOverrideSetByUserId ?? null,
    lastCalculatedAt: parseDate(asOfKey).toISOString(),
    usableReadingCount: usable.length,
    latestMileageReading: usable.at(-1),
  };
}

export function resolveEffectiveForecastMileage(input: DrivingProfileCalculationInput): EffectiveForecastMileage {
  const asOfKey = resolveForecastAsOfDate({ shopTimezone: input.shopTimezone, now: input.asOf });
  const profile = calculateDrivingProfile({ ...input, asOf: asOfKey });
  const latest = resolveLatestKnownMileage(input.readings, asOfKey);

  if (!latest) {
    return {
      mileage: null,
      kind: "UNAVAILABLE",
      latestKnownMileage: null,
      latestKnownDate: null,
      annualMileage: null,
      dailyMileage: null,
      source: "NO_HISTORY",
      confidence: "NONE",
      confidenceReason: "No usable mileage history is available.",
      daysSinceLatestKnownReading: null,
      asOf: asOfKey,
    };
  }

  const daysSinceLatestKnownReading = Math.floor(daysBetween(latest.readingDate, asOfKey));
  const projectedMiles = Math.max(0, Math.round(profile.effectiveDailyMileage * daysSinceLatestKnownReading));
  const mileage = latest.readingMileage + projectedMiles;

  return {
    mileage,
    kind: daysSinceLatestKnownReading === 0 ? "ACTUAL" : "ESTIMATED",
    latestKnownMileage: latest.readingMileage,
    latestKnownDate: dateKey(latest.readingDate),
    latestKnownReading: latest,
    annualMileage: profile.effectiveAnnualMileage,
    dailyMileage: profile.effectiveDailyMileage,
    source: profile.estimateSource,
    confidence: profile.confidence,
    confidenceReason: profile.confidenceReason,
    daysSinceLatestKnownReading,
    asOf: asOfKey,
  };
}

export function estimateServiceDueDate({
  currentMileage,
  dailyMileage,
  effective,
  asOf,
}: {
  currentMileage: number;
  dailyMileage: number;
  effective: Pick<EffectiveMaintenanceInterval, "nextDueMileage" | "nextDueDate" | "mileageInterval">;
  asOf?: Date | string;
}) {
  const asOfKey = resolveForecastAsOfDate({ now: asOf });
  const mileageDate = effective.nextDueMileage && dailyMileage > 0
    ? addCalendarDays(asOfKey, Math.ceil(Math.max(0, effective.nextDueMileage - currentMileage) / dailyMileage))
    : null;
  const timeDate = effective.nextDueDate ? parseDate(effective.nextDueDate) : null;
  const firstDate = mileageDate && timeDate
    ? (parseDate(mileageDate).getTime() <= timeDate.getTime() ? mileageDate : dateKey(timeDate))
    : mileageDate ?? (timeDate ? dateKey(timeDate) : null);
  const firstTrigger = firstDate
    ? mileageDate && firstDate === mileageDate
      ? "mileage"
      : "time"
    : null;

  return {
    remainingMiles: effective.nextDueMileage ? effective.nextDueMileage - currentMileage : null,
    mileageBasedDueDate: mileageDate,
    timeBasedDueDate: timeDate ? timeDate.toISOString().slice(0, 10) : null,
    firstDueDate: firstDate,
    firstTrigger,
  };
}
