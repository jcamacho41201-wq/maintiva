import { describe, expect, it } from "vitest";
import { buildRevenueOpportunities } from "@/lib/revenue-recovery";
import { getRecommendedRecords } from "@/lib/demo-calculations";
import { resolveMaintenanceInterval } from "@/lib/service-intervals";
import {
  type DemoState,
  type MaintenanceService,
  type Vehicle,
  type VehicleMaintenanceRecord,
} from "@/lib/demo-data";

const asOf = new Date("2026-07-29T12:00:00Z");

const vehicle: Vehicle = {
  id: "veh-a",
  shopId: "shop-a",
  customerId: "cust-a",
  year: 2020,
  make: "Toyota",
  model: "Camry",
  vin: "VIN-A",
  engine: "",
  trim: "",
  vehicleType: "Passenger vehicle",
  currentMileage: 14_700,
  estimatedAnnualMileage: 12_000,
  overallHealth: 80,
  lastServiceDate: "2026-01-01",
};

const service: MaintenanceService = {
  id: "svc-oil",
  shopId: "shop-a",
  name: "Oil Change",
  category: "Preventative Maintenance",
  defaultMileageInterval: 5_000,
  defaultTimeIntervalMonths: 6,
  defaultTimeIntervalValue: 6,
  defaultTimeIntervalUnit: "MONTHS",
  defaultNotificationThreshold: 10,
  estimatedLaborMinutes: 30,
  defaultPriceCents: 8_500,
  description: "",
  isActive: true,
};

function record(overrides: Partial<VehicleMaintenanceRecord> = {}): VehicleMaintenanceRecord {
  return {
    id: "item-oil",
    shopId: "shop-a",
    vehicleId: vehicle.id,
    serviceId: service.id,
    serviceName: service.name,
    lastCompletedDate: "2026-01-29",
    lastCompletedMileage: 10_000,
    recommendedMileageInterval: null,
    recommendedTimeIntervalMonths: null,
    mileageIntervalOverride: null,
    timeIntervalValueOverride: null,
    timeIntervalUnitOverride: null,
    priceCents: service.defaultPriceCents,
    laborHours: service.estimatedLaborMinutes / 60,
    priceOverrideCents: null,
    laborMinutesOverride: null,
    notificationThreshold: 10,
    outreachThresholdType: "MILES_BEFORE_DUE",
    outreachThresholdValue: 500,
    outreachStatus: "NEEDS_OUTREACH",
    isActive: true,
    ...overrides,
  };
}

function state(records: VehicleMaintenanceRecord[], services = [service]): DemoState {
  return {
    shop: {
      id: "shop-a",
      name: "Shop A",
      slug: "shop-a",
      phone: "",
      email: "",
      address: "",
      timezone: "America/New_York",
      dailyBayHours: 8,
      defaultAnnualMileage: 12_500,
      isDemo: false,
      onboardingCompletedAt: "2026-01-01T00:00:00Z",
    },
    users: [{ id: "user-a", shopId: "shop-a", email: "a@example.com", name: "A", role: "OWNER" }],
    customers: [{
      id: "cust-a",
      shopId: "shop-a",
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "",
      email: "ada@example.com",
      preferredContact: "EMAIL",
      smsConsent: false,
      emailConsent: true,
      callConsent: false,
      address: "",
      notes: "",
      status: "ACTIVE",
      customerScore: 80,
      lifetimeRevenueCents: 0,
      lastVisit: "2026-01-01",
    }],
    vehicles: [vehicle],
    services,
    maintenanceRecords: records,
    revenueOpportunities: [],
    mileageReadings: [],
    drivingProfiles: [],
    serviceRecords: [],
    outreachRecords: [],
    appointments: [],
    declinedWorkRecords: [],
    importHistory: [],
    seededAt: "2026-07-29T00:00:00Z",
  };
}

describe("editable vehicle service intervals", () => {
  it("inherits shop defaults until a vehicle override is present", () => {
    const inherited = resolveMaintenanceInterval({ record: record(), service, vehicle, asOf });
    const customized = resolveMaintenanceInterval({
      record: record({
        mileageIntervalOverride: 7_500,
        timeIntervalValueOverride: 9,
        timeIntervalUnitOverride: "MONTHS",
        priceOverrideCents: 11_000,
        laborMinutesOverride: 45,
      }),
      service,
      vehicle,
      asOf,
    });

    expect(inherited.sourceLabel).toBe("Shop default");
    expect(inherited.mileageInterval).toBe(5_000);
    expect(customized.sourceLabel).toBe("Custom for this vehicle");
    expect(customized.mileageInterval).toBe(7_500);
    expect(customized.priceCents).toBe(11_000);
    expect(customized.laborMinutes).toBe(45);
  });

  it("lets inherited vehicles pick up changed shop defaults while overrides remain vehicle-specific", () => {
    const changedDefault = { ...service, defaultMileageInterval: 6_000, defaultPriceCents: 9_500 };
    const inherited = resolveMaintenanceInterval({ record: record(), service: changedDefault, vehicle, asOf });
    const customized = resolveMaintenanceInterval({
      record: record({ mileageIntervalOverride: 7_500, priceOverrideCents: 11_000 }),
      service: changedDefault,
      vehicle,
      asOf,
    });

    expect(inherited.mileageInterval).toBe(6_000);
    expect(inherited.priceCents).toBe(9_500);
    expect(customized.mileageInterval).toBe(7_500);
    expect(customized.priceCents).toBe(11_000);
  });

  it("supports vehicle-only custom services without creating a shop default", () => {
    const custom = record({
      id: "item-custom",
      serviceId: null,
      serviceName: "Winch Inspection",
      customServiceName: "Winch Inspection",
      customCategory: "Accessory",
      mileageIntervalOverride: null,
      timeIntervalValueOverride: 12,
      timeIntervalUnitOverride: "MONTHS",
    });
    const effective = resolveMaintenanceInterval({ record: custom, vehicle, asOf });

    expect(effective.sourceLabel).toBe("Vehicle-only service");
    expect(effective.serviceName).toBe("Winch Inspection");
    expect(effective.nextDueDate).toBe("2027-01-29");
  });

  it("uses whichever mileage or time threshold is reached first", () => {
    const dueSoonByMileage = resolveMaintenanceInterval({ record: record(), service, vehicle, asOf });
    const overdueByTime = resolveMaintenanceInterval({
      record: record({
        lastCompletedDate: "2025-07-01",
        lastCompletedMileage: 14_000,
      }),
      service,
      vehicle,
      asOf,
    });
    const dueSoonByMileageOnly = resolveMaintenanceInterval({
      record: record({ lastCompletedDate: "2026-02-15" }),
      service,
      vehicle,
      asOf,
    });

    expect(dueSoonByMileage.status).toBe("DUE");
    expect(dueSoonByMileageOnly.status).toBe("DUE_SOON");
    expect(dueSoonByMileageOnly.thresholdCause).toBe("mileage");
    expect(overdueByTime.status).toBe("OVERDUE");
    expect(overdueByTime.thresholdCause).toBe("time");
  });

  it("uses <= for the configured mileage lead threshold without requiring the time threshold", () => {
    const wrx: Vehicle = {
      ...vehicle,
      id: "veh-wrx",
      year: 2018,
      make: "Subaru",
      model: "WRX Premium",
      currentMileage: 121_500,
    };
    const acDiagnostic: MaintenanceService = {
      ...service,
      id: "svc-ac",
      name: "A/C Diagnostic",
      defaultMileageInterval: 1_940,
      defaultTimeIntervalValue: 24,
      defaultTimeIntervalMonths: 24,
      defaultPriceCents: 14_900,
      estimatedLaborMinutes: 60,
    };
    const outside = resolveMaintenanceInterval({
      record: record({
        serviceId: acDiagnostic.id,
        serviceName: acDiagnostic.name,
        lastCompletedDate: "2026-07-01",
        lastCompletedMileage: 120_000,
        outreachThresholdValue: 500,
      }),
      service: acDiagnostic,
      vehicle: { ...wrx, currentMileage: 121_000 },
      asOf,
    });
    const inside = resolveMaintenanceInterval({
      record: record({
        serviceId: acDiagnostic.id,
        serviceName: acDiagnostic.name,
        lastCompletedDate: "2026-07-01",
        lastCompletedMileage: 120_000,
        outreachThresholdValue: 500,
      }),
      service: acDiagnostic,
      vehicle: wrx,
      asOf,
    });

    expect(outside.nextDueMileage).toBe(121_940);
    expect(outside.milesUntilDue).toBe(940);
    expect(outside.status).toBe("HEALTHY");
    expect(inside.nextDueMileage).toBe(121_940);
    expect(inside.milesUntilDue).toBe(440);
    expect(inside.status).toBe("DUE_SOON");
    expect(inside.thresholdCause).toBe("mileage");
  });

  it("uses estimated current mileage for mileage-based maintenance status", () => {
    const effective = resolveMaintenanceInterval({
      record: record({
        lastCompletedDate: "2026-01-01",
        lastCompletedMileage: 10_000,
      }),
      service: {
        ...service,
        defaultTimeIntervalMonths: null,
        defaultTimeIntervalValue: null,
        defaultTimeIntervalUnit: null,
      },
      vehicle: { ...vehicle, currentMileage: 10_000 },
      forecastMileage: {
        mileage: 14_700,
        kind: "ESTIMATED",
        latestKnownMileage: 14_000,
        latestKnownDate: "2026-07-01",
        annualMileage: 12_500,
        dailyMileage: 12_500 / 365,
        source: "SHOP_DEFAULT",
        confidence: "LOW",
        confidenceReason: "Using default annual mileage.",
        daysSinceLatestKnownReading: 28,
        asOf: "2026-07-29",
      },
      asOf,
    });

    expect(effective.status).toBe("DUE_SOON");
    expect(effective.milesUntilDue).toBe(300);
    expect(effective.forecastMileageKind).toBe("ESTIMATED");
    expect(effective.latestKnownMileage).toBe(14_000);
  });

  it("uses <= for the configured time lead threshold without requiring the mileage threshold", () => {
    const timeBased = resolveMaintenanceInterval({
      record: record({
        lastCompletedDate: "2026-02-28",
        lastCompletedMileage: 10_000,
        outreachThresholdType: "DAYS_BEFORE_DUE",
        outreachThresholdValue: 30,
      }),
      service,
      vehicle: { ...vehicle, currentMileage: 10_200 },
      asOf: new Date("2026-07-29T12:00:00Z"),
    });

    expect(timeBased.daysUntilDue).toBeLessThanOrEqual(30);
    expect(timeBased.milesUntilDue).toBeGreaterThan(500);
    expect(timeBased.status).toBe("DUE_SOON");
    expect(timeBased.thresholdCause).toBe("time");
  });

  it("does not invent due mileage or date when history is missing", () => {
    const missing = resolveMaintenanceInterval({
      record: record({ lastCompletedDate: null, lastCompletedMileage: null }),
      service,
      vehicle: { ...vehicle, currentMileage: 0 },
      asOf,
    });

    expect(missing.status).toBe("NOT_ENOUGH_HISTORY");
    expect(missing.nextDueMileage).toBeNull();
    expect(missing.nextDueDate).toBeNull();
  });

  it("excludes inactive records from derived opportunities", () => {
    const demoState = state([record({ isActive: false })]);
    expect(getRecommendedRecords(demoState)).toHaveLength(0);
    expect(buildRevenueOpportunities(demoState)).toHaveLength(0);
  });

  it("updates demo-derived opportunities from effective intervals and completion", () => {
    const dueRecord = record();
    const demoState = state([dueRecord]);
    demoState.shop.isDemo = true;
    demoState.mileageReadings.push({
      id: "reading-due-demo",
      shopId: "shop-a",
      vehicleId: vehicle.id,
      readingMileage: vehicle.currentMileage,
      readingDate: "2026-07-28",
      source: "SHOP_REPAIR_ORDER",
      verificationStatus: "VERIFIED",
      anomalyStatus: "NONE",
      includedInForecast: true,
      createdAt: "2026-07-29T00:00:00Z",
      updatedAt: "2026-07-29T00:00:00Z",
    });
    const opportunities = buildRevenueOpportunities(demoState);
    const completedRecord = record({
      lastCompletedDate: "2026-07-29",
      lastCompletedMileage: vehicle.currentMileage,
      outreachStatus: "NEEDS_OUTREACH",
    });
    const completedDemoState = state([completedRecord]);
    completedDemoState.shop.isDemo = true;

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].explanation).toContain("5,000 miles or 6 months");
    expect(buildRevenueOpportunities(completedDemoState)).toHaveLength(0);
    expect(buildRevenueOpportunities(state([dueRecord]))).toHaveLength(0);
  });

  it("labels low-confidence mileage-only revenue opportunities for advisor confirmation", () => {
    const mileageOnlyService = {
      ...service,
      defaultTimeIntervalMonths: null,
      defaultTimeIntervalValue: null,
      defaultTimeIntervalUnit: null,
    };
    const demoState = state([
      record({
        lastCompletedDate: "2026-01-01",
        lastCompletedMileage: 10_000,
      }),
    ], [mileageOnlyService]);
    demoState.shop.isDemo = true;
    demoState.mileageReadings.push({
      id: "reading-one-history",
      shopId: "shop-a",
      vehicleId: vehicle.id,
      readingMileage: 14_000,
      readingDate: "2026-07-01",
      source: "SERVICE_HISTORY_IMPORT",
      verificationStatus: "IMPORTED",
      anomalyStatus: "NONE",
      includedInForecast: true,
      sourceReferenceType: "ServiceHistoryRecord",
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z",
    });

    const [opportunity] = buildRevenueOpportunities(demoState);

    expect(opportunity.priority).toBe("LOW");
    expect(opportunity.priorityReason).toContain("advisor confirmation");
    expect(opportunity.explanation).toContain("Mileage is estimated");
    expect(opportunity.forecastMileageKind).toBe("ESTIMATED");
    expect(opportunity.forecastMileageConfidence).toBe("LOW");
  });
});
