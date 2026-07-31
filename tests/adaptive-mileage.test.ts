import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANNUAL_MILEAGE,
  calculateDrivingProfile,
  detectMileageAnomalies,
  estimateServiceDueDate,
  resolveCurrentMileage,
  validateMileageReading,
  type MileageReadingDraft,
} from "@/lib/adaptive-mileage";

const baseReading = {
  source: "SHOP_REPAIR_ORDER",
  verificationStatus: "VERIFIED",
  anomalyStatus: "NONE",
  includedInForecast: true,
} satisfies Omit<MileageReadingDraft, "readingMileage" | "readingDate">;

function profile(readings: MileageReadingDraft[], extras: Partial<Parameters<typeof calculateDrivingProfile>[0]> = {}) {
  return calculateDrivingProfile({
    shopId: "shop-1",
    vehicleId: "veh-1",
    readings,
    shopDefaultAnnualMileage: DEFAULT_ANNUAL_MILEAGE,
    asOf: "2026-07-29",
    ...extras,
  });
}

describe("adaptive mileage profile calculation", () => {
  it("uses earliest-to-latest verified readings for long-term mileage and latest pair for recent trend", () => {
    const result = profile([
      { ...baseReading, readingMileage: 40_000, readingDate: "2026-07-31" },
      { ...baseReading, readingMileage: 30_000, readingDate: "2026-01-01" },
      {
        ...baseReading,
        readingMileage: 35_000,
        readingDate: "2026-03-01",
        anomalyStatus: "RESOLVED",
        source: "CORRECTION",
      },
    ], { asOf: "2026-07-31" });

    expect(result.estimateSource).toBe("SHOP_VERIFIED_READINGS");
    expect(result.calculatedAnnualMileage).toBe(17_299);
    expect(result.effectiveAnnualMileage).toBe(17_299);
    expect(Math.round(result.effectiveDailyMileage)).toBe(47);
    expect(Math.round(result.effectiveMonthlyMileage)).toBe(1_442);
    expect(result.verifiedReadingCount).toBe(3);
    expect(Math.round(result.timeSpanDays)).toBe(211);
    expect(result.confidence).toBe("HIGH");
    expect(result.longTermPeriod).toMatchObject({
      mileageDelta: 10_000,
      annualMileage: 17_299,
    });
    expect(Math.round(result.longTermPeriod?.days ?? 0)).toBe(211);
    expect(result.recentTrend).toMatchObject({
      mileageDelta: 5_000,
      annualMileage: 12_007,
      label: "LOWER_THAN_USUAL",
      description: "Lower than the long-term average",
    });
    expect(Math.round(result.recentTrend?.days ?? 0)).toBe(152);
  });

  it("uses multiple verified shop readings before customer-reported mileage", () => {
    const result = profile(
      [
        { ...baseReading, readingMileage: 10_000, readingDate: "2026-01-01" },
        { ...baseReading, readingMileage: 20_000, readingDate: "2026-07-01" },
      ],
      { customerReportedAnnualMileage: 5_000 },
    );

    expect(result.estimateSource).toBe("SHOP_VERIFIED_READINGS");
    expect(result.calculatedAnnualMileage).toBeGreaterThan(19_000);
    expect(result.confidence).toBe("MEDIUM");
  });

  it("can reach high confidence with three verified readings spanning 180 days", () => {
    const result = profile([
      { ...baseReading, readingMileage: 10_000, readingDate: "2026-01-01" },
      { ...baseReading, readingMileage: 14_500, readingDate: "2026-04-01" },
      { ...baseReading, readingMileage: 19_000, readingDate: "2026-07-02" },
    ]);

    expect(result.confidence).toBe("HIGH");
  });

  it("uses imported readings before customer-reported mileage when no verified set exists", () => {
    const imported = {
      ...baseReading,
      source: "SERVICE_HISTORY_IMPORT" as const,
      verificationStatus: "IMPORTED" as const,
    };
    const result = profile(
      [
        { ...imported, readingMileage: 30_000, readingDate: "2026-01-01" },
        { ...imported, readingMileage: 35_000, readingDate: "2026-06-01" },
      ],
      { customerReportedAnnualMileage: 8_000 },
    );

    expect(result.estimateSource).toBe("IMPORTED_READINGS");
    expect(result.confidence).toBe("MEDIUM");
  });

  it("uses customer-reported mileage ahead of one verified reading plus default", () => {
    const result = profile(
      [{ ...baseReading, readingMileage: 42_000, readingDate: "2026-07-01" }],
      { customerReportedAnnualMileage: 9_000 },
    );

    expect(result.estimateSource).toBe("CUSTOMER_REPORTED");
    expect(result.calculatedAnnualMileage).toBe(9_000);
    expect(result.confidence).toBe("LOW");
  });

  it("lets manual override temporarily take priority until reset", () => {
    const result = profile(
      [
        { ...baseReading, readingMileage: 10_000, readingDate: "2026-01-01" },
        { ...baseReading, readingMileage: 20_000, readingDate: "2026-07-01" },
      ],
      {
        existingProfile: {
          manualAnnualMileageOverride: 6_000,
          manualOverrideReason: "Seasonal storage",
        },
      },
    );

    expect(result.estimateSource).toBe("MANUAL_OVERRIDE");
    expect(result.calculatedAnnualMileage).toBeGreaterThan(19_000);
    expect(result.effectiveAnnualMileage).toBe(6_000);
    expect(result.confidence).toBe("LOW");
  });

  it("does not show a separate recent trend when only two valid readings are available", () => {
    const result = profile([
      { ...baseReading, readingMileage: 52_000, readingDate: "2026-01-01" },
      { ...baseReading, readingMileage: 58_000, readingDate: "2026-04-03" },
    ], { asOf: "2026-04-03" });

    expect(result.calculatedAnnualMileage).toBe(23_804);
    expect(result.confidence).toBe("MEDIUM");
    expect(result.recentTrend).toBeUndefined();
  });

  it("does not calculate annual pace from same-day readings", () => {
    const result = profile([
      { ...baseReading, readingMileage: 58_000, readingDate: "2026-04-03" },
      { ...baseReading, readingMileage: 58_100, readingDate: "2026-04-03" },
    ], { asOf: "2026-04-03" });

    expect(result.estimateSource).toBe("SHOP_DEFAULT");
    expect(result.calculatedAnnualMileage).toBe(DEFAULT_ANNUAL_MILEAGE);
    expect(result.longTermPeriod).toBeUndefined();
  });

  it("excludes unresolved anomalies while restored resolved readings participate normally", () => {
    const excluded = profile([
      { ...baseReading, readingMileage: 30_000, readingDate: "2026-01-01" },
      { ...baseReading, readingMileage: 35_000, readingDate: "2026-03-01", anomalyStatus: "NEEDS_REVIEW" },
      { ...baseReading, readingMileage: 40_000, readingDate: "2026-07-31" },
    ], { asOf: "2026-07-31" });
    const restored = profile([
      { ...baseReading, readingMileage: 30_000, readingDate: "2026-01-01" },
      { ...baseReading, readingMileage: 35_000, readingDate: "2026-03-01", anomalyStatus: "RESOLVED" },
      { ...baseReading, readingMileage: 40_000, readingDate: "2026-07-31" },
    ], { asOf: "2026-07-31" });

    expect(excluded.calculatedAnnualMileage).toBe(17_299);
    expect(excluded.verifiedReadingCount).toBe(2);
    expect(excluded.recentTrend).toBeUndefined();
    expect(restored.verifiedReadingCount).toBe(3);
    expect(restored.recentTrend?.annualMileage).toBe(12_007);
    expect(restored.confidence).toBe("HIGH");
  });

  it("ignores explicitly excluded and future-dated readings", () => {
    const result = profile([
      { ...baseReading, readingMileage: 30_000, readingDate: "2026-01-01" },
      { ...baseReading, readingMileage: 35_000, readingDate: "2026-03-01", includedInForecast: false },
      { ...baseReading, readingMileage: 40_000, readingDate: "2026-07-31" },
      { ...baseReading, readingMileage: 99_000, readingDate: "2026-08-01" },
    ], { asOf: "2026-07-31" });

    expect(result.calculatedAnnualMileage).toBe(17_299);
    expect(result.verifiedReadingCount).toBe(2);
    expect(result.recentTrend).toBeUndefined();
  });

  it("does not calculate across an odometer discontinuity", () => {
    const result = profile([
      { ...baseReading, readingMileage: 90_000, readingDate: "2026-01-01" },
      { ...baseReading, readingMileage: 5_000, readingDate: "2026-03-01", anomalyStatus: "RESOLVED" },
      { ...baseReading, readingMileage: 8_000, readingDate: "2026-07-31" },
    ], { asOf: "2026-07-31" });

    expect(result.calculatedAnnualMileage).toBe(7_204);
    expect(result.longTermPeriod?.start.readingMileage).toBe(5_000);
    expect(result.confidence).toBe("LOW");
  });

  it("excludes readings marked out of forecast from canonical current mileage", () => {
    const current = resolveCurrentMileage(
      { currentMileage: 40_000 },
      [
        { ...baseReading, readingMileage: 44_000, readingDate: "2026-07-01" },
        { ...baseReading, readingMileage: 99_000, readingDate: "2026-07-20", includedInForecast: false },
      ],
    );

    expect(current.currentMileage).toBe(44_000);
    expect(current.source).toBe("Latest valid mileage reading");
  });

  it("flags reversals for review", () => {
    const anomalies = detectMileageAnomalies([
      { ...baseReading, readingMileage: 50_000, readingDate: "2026-05-01" },
      { ...baseReading, readingMileage: 48_000, readingDate: "2026-06-01" },
    ]);

    expect(anomalies[1]).toMatchObject({
      status: "NEEDS_REVIEW",
      reason: "Mileage is lower than the prior dated reading.",
    });
  });

  it("blocks future reading dates and warns about dated odometer conflicts", () => {
    const issues = validateMileageReading({
      reading: { readingMileage: 60_000, readingDate: "2026-07-30" },
      existingReadings: [
        { ...baseReading, readingMileage: 55_000, readingDate: "2026-07-20" },
        { ...baseReading, readingMileage: 60_000, readingDate: "2026-07-30" },
      ],
      vehicleYear: 2020,
      asOf: "2026-07-29",
    });

    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "READING_DATE_FUTURE",
      "DUPLICATE_READING",
    ]));
  });

  it("does not personalize annual mileage from future-dated readings", () => {
    const result = profile(
      [
        { ...baseReading, readingMileage: 10_000, readingDate: "2026-01-01" },
        { ...baseReading, readingMileage: 40_000, readingDate: "2026-12-01" },
      ],
      { asOf: "2026-07-29" },
    );

    expect(result.estimateSource).toBe("VERIFIED_PLUS_DEFAULT");
    expect(result.calculatedAnnualMileage).toBe(DEFAULT_ANNUAL_MILEAGE);
  });

  it("previews mileage due date without changing opportunities", () => {
    const preview = estimateServiceDueDate({
      currentMileage: 14_000,
      dailyMileage: 50,
      asOf: "2026-07-01",
      effective: {
        nextDueMileage: 15_000,
        nextDueDate: "2026-08-15",
        mileageInterval: 5_000,
      },
    });

    expect(preview.remainingMiles).toBe(1_000);
    expect(preview.mileageBasedDueDate).toBe("2026-07-21");
    expect(preview.firstTrigger).toBe("mileage");
  });
});
