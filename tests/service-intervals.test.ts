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

  it("does not invent due mileage or date when history is missing", () => {
    const missing = resolveMaintenanceInterval({
      record: record({ lastCompletedDate: "", lastCompletedMileage: 0 }),
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
});
