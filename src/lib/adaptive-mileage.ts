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
  usableReadingCount: number;
  latestMileageReading?: MileageReadingDraft;
};

export type MileageAnomalyReview = {
  index: number;
  status: MileageAnomalyStatus;
  reason?: string;
};

function parseDate(value: Date | string) {
  return value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
}

function daysBetween(start: Date | string, end: Date | string) {
  return Math.max(0, (parseDate(end).getTime() - parseDate(start).getTime()) / dayMs);
}

function annualize(first: MileageReadingDraft, last: MileageReadingDraft) {
  const days = daysBetween(first.readingDate, last.readingDate);
  if (days <= 0 || last.readingMileage <= first.readingMileage) return null;
  return Math.round(((last.readingMileage - first.readingMileage) / days) * 365);
}

function cleanAnnualMileage(value?: number | null) {
  if (!value || value <= 0) return null;
  return Math.round(value);
}

export function isUsableMileageReading(reading: MileageReadingDraft) {
  return (
    reading.includedInForecast !== false &&
    reading.verificationStatus !== "EXCLUDED" &&
    reading.anomalyStatus !== "NEEDS_REVIEW" &&
    reading.readingMileage >= 0 &&
    !Number.isNaN(parseDate(reading.readingDate).getTime())
  );
}

export function sortMileageReadings<T extends MileageReadingDraft>(readings: T[]) {
  return [...readings].sort((a, b) =>
    parseDate(a.readingDate).getTime() - parseDate(b.readingDate).getTime() ||
    a.readingMileage - b.readingMileage,
  );
}

function readingsByStatus(readings: MileageReadingDraft[], statuses: MileageVerificationStatus[]) {
  return sortMileageReadings(
    readings.filter((reading) =>
      isUsableMileageReading(reading) && statuses.includes(reading.verificationStatus),
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
}: {
  readings: MileageReadingDraft[];
  annualMileage: number;
  source: DrivingProfileEstimateSource;
}): { confidence: DrivingProfileConfidence; reason: string } {
  const verified = readingsByStatus(readings, ["VERIFIED"]);
  const usable = sortMileageReadings(readings.filter(isUsableMileageReading));
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

export function resolveCurrentMileage(vehicle: Pick<Vehicle, "currentMileage">, readings: MileageReadingDraft[]) {
  const latest = sortMileageReadings(readings.filter(isUsableMileageReading)).at(-1);
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
  const verified = readingsByStatus(readings, ["VERIFIED"]);
  const imported = readingsByStatus(readings, ["IMPORTED"]);
  const usable = sortMileageReadings(readings.filter(isUsableMileageReading));
  let calculatedAnnualMileage = shopDefault;
  let estimateSource: DrivingProfileEstimateSource = "SHOP_DEFAULT";

  if (manualOverride) {
    calculatedAnnualMileage = manualOverride;
    estimateSource = "MANUAL_OVERRIDE";
  } else if (verified.length >= 2) {
    calculatedAnnualMileage = annualize(verified[0], verified[verified.length - 1]) ?? shopDefault;
    estimateSource = "SHOP_VERIFIED_READINGS";
  } else if (imported.length >= 2) {
    calculatedAnnualMileage = annualize(imported[0], imported[imported.length - 1]) ?? shopDefault;
    estimateSource = "IMPORTED_READINGS";
  } else if (cleanAnnualMileage(customerReportedAnnualMileage)) {
    calculatedAnnualMileage = cleanAnnualMileage(customerReportedAnnualMileage) ?? shopDefault;
    estimateSource = "CUSTOMER_REPORTED";
  } else if (verified.length === 1) {
    calculatedAnnualMileage = shopDefault;
    estimateSource = "VERIFIED_PLUS_DEFAULT";
  }

  const confidence = manualOverride
    ? {
        confidence: "LOW" as DrivingProfileConfidence,
        reason: "Manual override is active; review before treating the estimate as learned behavior.",
      }
    : classifyConfidence({ readings, annualMileage: calculatedAnnualMileage, source: estimateSource });

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
    lastCalculatedAt: parseDate(asOf).toISOString(),
    usableReadingCount: usable.length,
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
