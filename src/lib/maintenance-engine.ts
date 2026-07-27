import { clamp } from "@/lib/utils";

export type MileageConfidence =
  | "VERIFIED"
  | "CUSTOMER_CONFIRMED"
  | "IMPORTED"
  | "ESTIMATED";

export type MileageReadingInput = {
  mileage: number;
  recordedAt: Date | string;
  source: string;
  confidence: MileageConfidence;
};

export type MaintenanceCalculationInput = {
  lastCompletedDate?: Date | string | null;
  lastCompletedMileage?: number | null;
  recommendedTimeIntervalMonths: number;
  recommendedMileageInterval: number;
  notificationThreshold: number;
  estimatedCurrentMileage: number;
  asOf?: Date | string;
  mechanicRemainingPercentage?: number | null;
  manualOverridePercentage?: number | null;
};

const trustedMileageConfidence = new Set<MileageConfidence>([
  "VERIFIED",
  "CUSTOMER_CONFIRMED",
  "IMPORTED",
]);

function daysBetween(start: Date, end: Date) {
  return Math.max(0, (end.getTime() - start.getTime()) / 86_400_000);
}

function monthsBetween(start: Date, end: Date) {
  return daysBetween(start, end) / 30.4375;
}

export function calculateMileageRate(readings: MileageReadingInput[]) {
  const trusted = readings
    .filter((reading) => trustedMileageConfidence.has(reading.confidence))
    .sort(
      (a, b) =>
        new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
    );

  if (trusted.length < 2) {
    return 0;
  }

  const first = trusted[0];
  const last = trusted[trusted.length - 1];
  const elapsedDays = daysBetween(
    new Date(first.recordedAt),
    new Date(last.recordedAt),
  );

  if (elapsedDays === 0 || last.mileage <= first.mileage) {
    return 0;
  }

  return (last.mileage - first.mileage) / elapsedDays;
}

export function estimateCurrentMileage(
  readings: MileageReadingInput[],
  asOf: Date | string = new Date(),
) {
  const trusted = readings
    .filter((reading) => trustedMileageConfidence.has(reading.confidence))
    .sort(
      (a, b) =>
        new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
    );

  if (trusted.length === 0) {
    return {
      mileage: 0,
      confidence: "ESTIMATED" as MileageConfidence,
      label: "Estimated mileage unavailable",
      milesPerDay: 0,
      estimated: true,
    };
  }

  const latest = trusted[trusted.length - 1];
  const milesPerDay = calculateMileageRate(trusted);
  const elapsedDays = daysBetween(new Date(latest.recordedAt), new Date(asOf));
  const projectedMileage = latest.mileage + milesPerDay * elapsedDays;

  return {
    mileage: Math.round(projectedMileage),
    confidence: latest.confidence,
    label: elapsedDays > 1 ? "Estimated current mileage" : "Latest mileage",
    milesPerDay,
    estimated: elapsedDays > 1,
    latestVerifiedMileage: latest.mileage,
    latestVerifiedAt: new Date(latest.recordedAt),
  };
}

export function calculateTimeLifeRemaining({
  lastCompletedDate,
  recommendedTimeIntervalMonths,
  asOf = new Date(),
}: Pick<
  MaintenanceCalculationInput,
  "lastCompletedDate" | "recommendedTimeIntervalMonths" | "asOf"
>) {
  if (!lastCompletedDate || recommendedTimeIntervalMonths <= 0) {
    return 100;
  }

  const elapsedMonths = monthsBetween(new Date(lastCompletedDate), new Date(asOf));
  return clamp(100 - (elapsedMonths / recommendedTimeIntervalMonths) * 100);
}

export function calculateMileageLifeRemaining({
  lastCompletedMileage,
  recommendedMileageInterval,
  estimatedCurrentMileage,
}: Pick<
  MaintenanceCalculationInput,
  "lastCompletedMileage" | "recommendedMileageInterval" | "estimatedCurrentMileage"
>) {
  if (!lastCompletedMileage || recommendedMileageInterval <= 0) {
    return 100;
  }

  const mileageUsed = Math.max(0, estimatedCurrentMileage - lastCompletedMileage);
  return clamp(100 - (mileageUsed / recommendedMileageInterval) * 100);
}

export function calculateFinalRemainingLife(input: MaintenanceCalculationInput) {
  const timeLife = calculateTimeLifeRemaining(input);
  const mileageLife = calculateMileageLifeRemaining(input);
  const calculatedLife = Math.min(timeLife, mileageLife);
  const influencedByInspection =
    input.mechanicRemainingPercentage === null ||
    input.mechanicRemainingPercentage === undefined
      ? calculatedLife
      : Math.min(calculatedLife, input.mechanicRemainingPercentage);
  const finalLife =
    input.manualOverridePercentage === null ||
    input.manualOverridePercentage === undefined
      ? influencedByInspection
      : input.manualOverridePercentage;

  return {
    timeLife,
    mileageLife,
    calculatedLife,
    finalLife: clamp(finalLife),
    label:
      input.manualOverridePercentage !== null &&
      input.manualOverridePercentage !== undefined
        ? "Manual override"
        : input.mechanicRemainingPercentage !== null &&
            input.mechanicRemainingPercentage !== undefined
          ? "Mechanic verified"
          : "Calculated",
  };
}

export function getMaintenanceStatus(remainingLife: number, threshold: number) {
  if (remainingLife <= 0) return "OVERDUE";
  if (remainingLife <= threshold) return "DUE_SOON";
  return "HEALTHY";
}

export function isEligibleForAutomation(input: MaintenanceCalculationInput) {
  const result = calculateFinalRemainingLife(input);
  return {
    eligible:
      result.finalLife <= input.notificationThreshold ||
      result.timeLife <= 0 ||
      result.mileageLife <= 0,
    remainingLife: result.finalLife,
    reason:
      result.finalLife <= 0
        ? "Overdue"
        : result.finalLife <= input.notificationThreshold
          ? "Within notification threshold"
          : "Not eligible",
  };
}
