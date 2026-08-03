import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANNUAL_MILEAGE,
  calculateDrivingProfile,
  detectMileageAnomalies,
  estimateServiceDueDate,
  resolveCurrentMileage,
  resolveEffectiveForecastMileage,
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

  it("requires at least 30 days before personalizing annual mileage from historical readings", () => {
    const result = profile([
      { ...baseReading, readingMileage: 10_000, readingDate: "2026-07-01" },
      { ...baseReading, readingMileage: 10_200, readingDate: "2026-07-15" },
    ]);

    expect(result.estimateSource).toBe("VERIFIED_PLUS_DEFAULT");
    expect(result.calculatedAnnualMileage).toBe(DEFAULT_ANNUAL_MILEAGE);
    expect(result.confidence).toBe("LOW");
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
    expect(result.calculatedAnnualMileage).toBe(6_000);
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

  it("separates latest known mileage from estimated current mileage", () => {
    const forecast = resolveEffectiveForecastMileage({
      shopId: "shop-1",
      vehicleId: "veh-1",
      readings: [
        { ...baseReading, readingMileage: 10_000, readingDate: "2026-01-01" },
        { ...baseReading, readingMileage: 20_000, readingDate: "2026-07-01" },
      ],
      shopDefaultAnnualMileage: DEFAULT_ANNUAL_MILEAGE,
      asOf: "2026-07-31",
    });

    expect(forecast.latestKnownMileage).toBe(20_000);
    expect(forecast.latestKnownDate).toBe("2026-07-01");
    expect(forecast.kind).toBe("ESTIMATED");
    expect(forecast.mileage).toBeGreaterThan(20_000);
  });

  it("estimates the QA historical service vehicle as of August 3", () => {
    const imported = {
      ...baseReading,
      source: "SERVICE_HISTORY_IMPORT" as const,
      verificationStatus: "IMPORTED" as const,
    };
    const forecast = resolveEffectiveForecastMileage({
      shopId: "shop-1",
      vehicleId: "veh-qa-mileage",
      readings: [
        { ...imported, readingMileage: 42_000, readingDate: "2025-01-10" },
        { ...imported, readingMileage: 49_500, readingDate: "2025-07-10" },
        { ...imported, readingMileage: 57_000, readingDate: "2026-01-10" },
      ],
      shopDefaultAnnualMileage: DEFAULT_ANNUAL_MILEAGE,
      asOf: "2026-08-03",
      shopTimezone: "America/New_York",
    });

    expect(forecast.latestKnownMileage).toBe(57_000);
    expect(forecast.latestKnownDate).toBe("2026-01-10");
    expect(forecast.annualMileage).toBeGreaterThanOrEqual(14_900);
    expect(forecast.annualMileage).toBeLessThanOrEqual(15_100);
    expect(forecast.mileage).toBeGreaterThanOrEqual(65_400);
    expect(forecast.mileage).toBeLessThanOrEqual(65_450);
    expect(forecast.kind).toBe("ESTIMATED");
    expect(forecast.asOf).toBe("2026-08-03");
  });

  it("treats a same-day reading as actual current mileage", () => {
    const forecast = resolveEffectiveForecastMileage({
      shopId: "shop-1",
      vehicleId: "veh-1",
      readings: [{ ...baseReading, readingMileage: 0, readingDate: "2026-07-29" }],
      shopDefaultAnnualMileage: DEFAULT_ANNUAL_MILEAGE,
      asOf: "2026-07-29",
    });

    expect(forecast.kind).toBe("ACTUAL");
    expect(forecast.mileage).toBe(0);
    expect(forecast.latestKnownMileage).toBe(0);
  });

  it("returns unavailable forecast mileage when no usable reading exists", () => {
    const forecast = resolveEffectiveForecastMileage({
      shopId: "shop-1",
      vehicleId: "veh-1",
      readings: [],
      shopDefaultAnnualMileage: DEFAULT_ANNUAL_MILEAGE,
      asOf: "2026-07-29",
    });

    expect(forecast.kind).toBe("UNAVAILABLE");
    expect(forecast.mileage).toBeNull();
    expect(forecast.confidence).toBe("NONE");
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
