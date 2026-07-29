import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANNUAL_MILEAGE,
  calculateDrivingProfile,
  detectMileageAnomalies,
  estimateServiceDueDate,
  resolveCurrentMileage,
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
