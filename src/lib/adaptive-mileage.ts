import { asOfDate, type DrivingProfileConfidence, type DrivingProfileEstimateSource, type MileageAnomalyStatus, type MileageVerificationStatus, type Vehicle, type VehicleDrivingProfile, type VehicleMileageReading } from "@/lib/demo-data";
import type { EffectiveMaintenanceInterval } from "@/lib/service-intervals";

export const DEFAULT_ANNUAL_MILEAGE = 12_500;
export const DEFAULT_MONTHLY_MILEAGE = Math.round(DEFAULT_ANNUAL_MILEAGE / 12);
export const DEFAULT_DAILY_MILEAGE = DEFAULT_ANNUAL_MILEAGE / 365;

const dayMs = 86_400_000;
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
};

export type DrivingProfileCalculation = Omit<VehicleDrivingProfile, "id"> & {
  effectiveAnnualMileage: number;
  effectiveDailyMileage: number;
  effectiveMonthlyMileage: number;
  usableReadingCount: number;
  verifiedReadingCount: number;
  timeSpanDays: number;
  longTermPeriod?: MileagePacePeriod;
  recentTrend?: MileageTrend;
  latestMileageReading?: MileageReadingDraft;
};

export type MileagePacePeriod = {
  start: MileageReadingDraft;
  end: MileageReadingDraft;
  mileageDelta: number;
  days: number;
  annualMileage: number;
};

export type MileageTrend = MileagePacePeriod & {
  label: "CONSISTENT" | "HIGHER_THAN_USUAL" | "LOWER_THAN_USUAL";
  description: string;
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
  return value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
}

function dateKey(value: Date | string) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function daysBetween(start: Date | string, end: Date | string) {
  return Math.max(0, (parseDate(end).getTime() - parseDate(start).getTime()) / dayMs);
}

function annualizePeriod(first: MileageReadingDraft, last: MileageReadingDraft): MileagePacePeriod | null {
  const days = daysBetween(first.readingDate, last.readingDate);
  const mileageDelta = last.readingMileage - first.readingMileage;
  if (days < 30 || mileageDelta <= 0) return null;
  return {
    start: first,
    end: last,
    mileageDelta,
    days,
    annualMileage: Math.round((mileageDelta / days) * 365),
  };
}

function cleanAnnualMileage(value?: number | null) {
  if (!value || value <= 0) return null;
  return Math.round(value);
}

export function isUsableMileageReading(reading: MileageReadingDraft, asOf: Date | string = new Date()) {
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

function readingsByStatus(readings: MileageReadingDraft[], statuses: MileageVerificationStatus[], asOf: Date | string = new Date()) {
  return sortMileageReadings(
    readings.filter((reading) =>
      isUsableMileageReading(reading, asOf) && statuses.includes(reading.verificationStatus),
    ),
  );
}

function currentOdometerSegment(readings: MileageReadingDraft[]) {
  const sorted = sortMileageReadings(readings);
  let segmentStart = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].readingMileage < sorted[index - 1].readingMileage) {
      segmentStart = index;
    }
  }
  return sorted.slice(segmentStart);
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

function hasOdometerDiscontinuity(readings: MileageReadingDraft[]) {
  const sorted = sortMileageReadings(readings);
  return sorted.some((reading, index) => index > 0 && reading.readingMileage < sorted[index - 1].readingMileage);
}

function trendLabel(recentAnnualMileage: number, longTermAnnualMileage: number): MileageTrend["label"] {
  if (longTermAnnualMileage <= 0) return "CONSISTENT";
  const ratio = recentAnnualMileage / longTermAnnualMileage;
  if (ratio > 1.2) return "HIGHER_THAN_USUAL";
  if (ratio < 0.8) return "LOWER_THAN_USUAL";
  return "CONSISTENT";
}

export function trendDescription(label: MileageTrend["label"]) {
  const labels: Record<MileageTrend["label"], string> = {
    CONSISTENT: "Consistent with the long-term average",
    HIGHER_THAN_USUAL: "Higher than the long-term average",
    LOWER_THAN_USUAL: "Lower than the long-term average",
  };
  return labels[label];
}

function recentTrendFor(readings: MileageReadingDraft[], longTermAnnualMileage: number): MileageTrend | null {
  const segment = currentOdometerSegment(readings);
  if (segment.length < 3) return null;
  const period = annualizePeriod(segment[segment.length - 2], segment[segment.length - 1]);
  if (!period) return null;
  const label = trendLabel(period.annualMileage, longTermAnnualMileage);
  return {
    ...period,
    label,
    description: trendDescription(label),
  };
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
  const hasDiscontinuity = hasOdometerDiscontinuity(usable);

  if (
    verified.length >= 3 &&
    verifiedSpan >= 180 &&
    repeatedActivity(verified) &&
    reasonablePace &&
    !hasUnresolvedSeriousAnomaly(readings) &&
    !hasDiscontinuity
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
    !hasUnresolvedSeriousAnomaly(readings) &&
    !hasDiscontinuity
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
      reason: "Using one verified reading with the shop default annual mileage until more history exists.",
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
  const asOfDate = parseDate(asOf);

  if (!readingDate || Number.isNaN(parsedDate.getTime())) {
    return [{
      code: "READING_DATE_REQUIRED",
      severity: "error",
      message: "Reading Date is required.",
    }];
  }

  if (parsedDate.getTime() > asOfDate.getTime()) {
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

export function calculateDrivingProfile({
  vehicleId,
  shopId,
  readings,
  shopDefaultAnnualMileage,
  customerReportedAnnualMileage,
  customerReportedAt,
  customerReportedByUserId,
  existingProfile,
  asOf = asOfDate,
}: DrivingProfileCalculationInput): DrivingProfileCalculation {
  const shopDefault = cleanAnnualMileage(shopDefaultAnnualMileage) ?? DEFAULT_ANNUAL_MILEAGE;
  const manualOverride = cleanAnnualMileage(existingProfile?.manualAnnualMileageOverride);
  const verified = readingsByStatus(readings, ["VERIFIED"], asOf);
  const imported = readingsByStatus(readings, ["IMPORTED"], asOf);
  const usable = sortMileageReadings(readings.filter((reading) => isUsableMileageReading(reading, asOf)));
  const verifiedSegment = currentOdometerSegment(verified);
  const importedSegment = currentOdometerSegment(imported);
  const usableSegment = currentOdometerSegment(usable);
  const verifiedLongTerm = verifiedSegment.length >= 2
    ? annualizePeriod(verifiedSegment[0], verifiedSegment[verifiedSegment.length - 1])
    : null;
  const importedLongTerm = importedSegment.length >= 2
    ? annualizePeriod(importedSegment[0], importedSegment[importedSegment.length - 1])
    : null;
  let calculatedAnnualMileage = shopDefault;
  let calculatedSource: DrivingProfileEstimateSource = "SHOP_DEFAULT";
  let longTermPeriod: MileagePacePeriod | undefined;

  if (verifiedLongTerm) {
    calculatedAnnualMileage = verifiedLongTerm.annualMileage;
    calculatedSource = "SHOP_VERIFIED_READINGS";
    longTermPeriod = verifiedLongTerm;
  } else if (importedLongTerm) {
    calculatedAnnualMileage = importedLongTerm.annualMileage;
    calculatedSource = "IMPORTED_READINGS";
    longTermPeriod = importedLongTerm;
  } else if (cleanAnnualMileage(customerReportedAnnualMileage)) {
    calculatedAnnualMileage = cleanAnnualMileage(customerReportedAnnualMileage) ?? shopDefault;
    calculatedSource = "CUSTOMER_REPORTED";
  } else if (verified.length === 1) {
    calculatedAnnualMileage = shopDefault;
    calculatedSource = "VERIFIED_PLUS_DEFAULT";
  }

  const effectiveAnnualMileage = manualOverride ?? calculatedAnnualMileage;
  const effectiveSource: DrivingProfileEstimateSource = manualOverride ? "MANUAL_OVERRIDE" : calculatedSource;
  const confidence = manualOverride
    ? {
        confidence: "LOW" as DrivingProfileConfidence,
        reason: "Temporary shop estimate is active; Maintiva keeps calculating verified mileage history in the background.",
      }
    : classifyConfidence({ readings, annualMileage: calculatedAnnualMileage, source: calculatedSource, asOf });
  const recentTrend = longTermPeriod ? recentTrendFor(usableSegment, longTermPeriod.annualMileage) ?? undefined : undefined;

  return {
    shopId,
    vehicleId,
    customerReportedAnnualMileage: customerReportedAnnualMileage ?? existingProfile?.customerReportedAnnualMileage ?? null,
    customerReportedAt: customerReportedAt ?? existingProfile?.customerReportedAt ?? null,
    customerReportedByUserId: customerReportedByUserId ?? existingProfile?.customerReportedByUserId ?? null,
    calculatedAnnualMileage,
    effectiveAnnualMileage,
    effectiveDailyMileage: effectiveAnnualMileage / 365,
    effectiveMonthlyMileage: effectiveAnnualMileage / 12,
    estimateSource: effectiveSource,
    confidence: confidence.confidence,
    confidenceReason: confidence.reason,
    manualAnnualMileageOverride: existingProfile?.manualAnnualMileageOverride ?? null,
    manualOverrideReason: existingProfile?.manualOverrideReason ?? null,
    manualOverrideNotes: existingProfile?.manualOverrideNotes ?? null,
    manualOverrideSetAt: existingProfile?.manualOverrideSetAt ?? null,
    manualOverrideSetByUserId: existingProfile?.manualOverrideSetByUserId ?? null,
    lastCalculatedAt: parseDate(asOf).toISOString(),
    usableReadingCount: usable.length,
    verifiedReadingCount: verified.length,
    timeSpanDays: spanDays(usableSegment),
    longTermPeriod,
    recentTrend,
    latestMileageReading: usable.at(-1),
  };
}

export function estimateServiceDueDate({
  currentMileage,
  dailyMileage,
  effective,
  asOf = asOfDate,
}: {
  currentMileage: number;
  dailyMileage: number;
  effective: Pick<EffectiveMaintenanceInterval, "nextDueMileage" | "nextDueDate" | "mileageInterval">;
  asOf?: Date | string;
}) {
  const mileageDate = effective.nextDueMileage && dailyMileage > 0
    ? new Date(parseDate(asOf).getTime() + Math.max(0, effective.nextDueMileage - currentMileage) / dailyMileage * dayMs)
    : null;
  const timeDate = effective.nextDueDate ? parseDate(effective.nextDueDate) : null;
  const firstDate = mileageDate && timeDate
    ? (mileageDate.getTime() <= timeDate.getTime() ? mileageDate : timeDate)
    : mileageDate ?? timeDate;
  const firstTrigger = firstDate
    ? mileageDate && firstDate.getTime() === mileageDate.getTime()
      ? "mileage"
      : "time"
    : null;

  return {
    remainingMiles: effective.nextDueMileage ? effective.nextDueMileage - currentMileage : null,
    mileageBasedDueDate: mileageDate ? mileageDate.toISOString().slice(0, 10) : null,
    timeBasedDueDate: timeDate ? timeDate.toISOString().slice(0, 10) : null,
    firstDueDate: firstDate ? firstDate.toISOString().slice(0, 10) : null,
    firstTrigger,
  };
}
