import { describe, expect, it } from "vitest";
import {
  calculateAppointmentDuration,
  hasActiveVehicleAppointmentAt,
} from "@/lib/appointment";
import {
  buildBundledMaintenanceMessage,
  canContactCustomer,
  groupAutomationItems,
} from "@/lib/automation";
import {
  calculateFinalRemainingLife,
  calculateMileageLifeRemaining,
  calculateMileageRate,
  calculateTimeLifeRemaining,
  estimateCurrentMileage,
  isEligibleForAutomation,
} from "@/lib/maintenance-engine";

describe("mileage calculations", () => {
  it("calculates daily mileage rate from trusted readings", () => {
    const rate = calculateMileageRate([
      {
        mileage: 40_000,
        recordedAt: "2026-01-10",
        source: "SHOP_REPAIR_ORDER",
        confidence: "VERIFIED",
      },
      {
        mileage: 46_000,
        recordedAt: "2026-07-10",
        source: "CUSTOMER_SMS",
        confidence: "CUSTOMER_CONFIRMED",
      },
    ]);

    expect(rate).toBeCloseTo(33.15, 1);
  });

  it("estimates current mileage without presenting it as verified", () => {
    const estimate = estimateCurrentMileage(
      [
        {
          mileage: 40_000,
          recordedAt: "2026-01-10",
          source: "SHOP_REPAIR_ORDER",
          confidence: "VERIFIED",
        },
        {
          mileage: 46_000,
          recordedAt: "2026-07-10",
          source: "CUSTOMER_SMS",
          confidence: "CUSTOMER_CONFIRMED",
        },
      ],
      "2026-10-10",
    );

    expect(estimate.mileage).toBeGreaterThan(48_900);
    expect(estimate.label).toBe("Estimated current mileage");
    expect(estimate.latestVerifiedMileage).toBe(46_000);
  });
});

describe("maintenance lifespan engine", () => {
  it("calculates time-based lifespan", () => {
    expect(
      calculateTimeLifeRemaining({
        lastCompletedDate: "2026-01-01",
        recommendedTimeIntervalMonths: 12,
        asOf: "2026-07-01",
      }),
    ).toBe(50);
  });

  it("calculates mileage-based lifespan", () => {
    expect(
      calculateMileageLifeRemaining({
        lastCompletedMileage: 10_000,
        recommendedMileageInterval: 5_000,
        estimatedCurrentMileage: 14_500,
      }),
    ).toBe(10);
  });

  it("uses the more urgent life value as final calculated life", () => {
    const result = calculateFinalRemainingLife({
      lastCompletedDate: "2026-01-01",
      lastCompletedMileage: 10_000,
      recommendedTimeIntervalMonths: 12,
      recommendedMileageInterval: 5_000,
      estimatedCurrentMileage: 14_600,
      notificationThreshold: 10,
      asOf: "2026-07-01",
    });

    expect(result.timeLife).toBe(50);
    expect(result.mileageLife).toBe(8);
    expect(result.finalLife).toBe(8);
    expect(result.label).toBe("Calculated");
  });

  it("lets mechanic inspections lower displayed life", () => {
    const result = calculateFinalRemainingLife({
      lastCompletedDate: "2026-01-01",
      lastCompletedMileage: 10_000,
      recommendedTimeIntervalMonths: 12,
      recommendedMileageInterval: 10_000,
      estimatedCurrentMileage: 15_600,
      notificationThreshold: 20,
      mechanicRemainingPercentage: 25,
      asOf: "2026-03-01",
    });

    expect(result.calculatedLife).toBeGreaterThan(25);
    expect(result.finalLife).toBe(25);
    expect(result.label).toBe("Mechanic verified");
  });

  it("marks items eligible at or below their threshold", () => {
    const result = isEligibleForAutomation({
      lastCompletedDate: "2026-01-01",
      lastCompletedMileage: 10_000,
      recommendedTimeIntervalMonths: 12,
      recommendedMileageInterval: 5_000,
      estimatedCurrentMileage: 14_500,
      notificationThreshold: 10,
      asOf: "2026-07-01",
    });

    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("Within notification threshold");
  });
});

describe("automation and scheduling", () => {
  const services = [
    {
      id: "oil",
      name: "Oil Change",
      customerId: "cust-1",
      vehicleId: "veh-1",
      remainingLife: 8,
      threshold: 10,
      estimatedRevenueCents: 8500,
      estimatedLaborMinutes: 30,
      status: "DUE_SOON" as const,
    },
    {
      id: "brakes",
      name: "Brake Pads",
      customerId: "cust-1",
      vehicleId: "veh-1",
      remainingLife: 4,
      threshold: 20,
      estimatedRevenueCents: 36000,
      estimatedLaborMinutes: 90,
      status: "DUE_SOON" as const,
    },
    {
      id: "tires",
      name: "Tires",
      customerId: "cust-1",
      vehicleId: "veh-2",
      remainingLife: 80,
      threshold: 20,
      estimatedRevenueCents: 82000,
      estimatedLaborMinutes: 90,
      status: "HEALTHY" as const,
    },
  ];

  it("groups automation by customer and vehicle instead of individual service", () => {
    const groups = groupAutomationItems(
      services,
      { "cust-1": { name: "John Doe", preferredContact: "SMS" } },
      { "veh-1": { label: "2019 Honda Accord" } },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].services.map((service) => service.name)).toEqual([
      "Brake Pads",
      "Oil Change",
    ]);
    expect(groups[0].estimatedRevenueCents).toBe(44_500);
  });

  it("prevents duplicate outreach inside cooldown windows", () => {
    const result = canContactCustomer({
      customerId: "cust-1",
      vehicleId: "veh-1",
      minDaysBetweenContacts: 14,
      asOf: "2026-07-10",
      history: [
        {
          customerId: "cust-1",
          vehicleId: "veh-1",
          sentAt: "2026-07-01",
          responseStatus: "NO_RESPONSE",
        },
      ],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Recently contacted");
  });

  it("stops outreach after appointment booking", () => {
    const result = canContactCustomer({
      customerId: "cust-1",
      vehicleId: "veh-1",
      minDaysBetweenContacts: 14,
      asOf: "2026-08-01",
      history: [
        {
          customerId: "cust-1",
          vehicleId: "veh-1",
          sentAt: "2026-07-01",
          responseStatus: "BOOKED",
        },
      ],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Appointment already booked");
  });

  it("calculates appointment duration and revenue from all services", () => {
    const result = calculateAppointmentDuration([
      { name: "Oil Change", laborMinutes: 30, priceCents: 8500 },
      { name: "Brake Pads", laborMinutes: 90, priceCents: 36000 },
      { name: "Brake Fluid", laborMinutes: 45, priceCents: 15000 },
    ]);

    expect(result.estimatedLaborMinutes).toBe(165);
    expect(result.recommendedMinutes).toBe(180);
    expect(result.estimatedRevenueCents).toBe(59_500);
  });

  it("prevents duplicate active appointments for the same vehicle and start time", () => {
    expect(
      hasActiveVehicleAppointmentAt(
        [
          {
            vehicleId: "veh-1",
            scheduledStart: "2026-07-28T13:30:00.000Z",
            status: "CONFIRMED",
          },
        ],
        {
          vehicleId: "veh-1",
          scheduledStart: "2026-07-28T13:30:00.000Z",
        },
      ),
    ).toBe(true);
    expect(
      hasActiveVehicleAppointmentAt(
        [
          {
            vehicleId: "veh-1",
            scheduledStart: "2026-07-28T13:30:00.000Z",
            status: "CANCELLED",
          },
        ],
        {
          vehicleId: "veh-1",
          scheduledStart: "2026-07-28T13:30:00.000Z",
        },
      ),
    ).toBe(false);
  });

  it("bundles multiple services into one message", () => {
    const message = buildBundledMaintenanceMessage({
      firstName: "John",
      vehicleLabel: "2019 Honda Accord",
      services: ["oil change", "brake-fluid service", "cabin-filter replacement"],
    });

    expect(message).toContain("oil change, brake-fluid service, and cabin-filter replacement");
    expect(message.match(/Booking Link/g)).toHaveLength(1);
  });
});

describe("tenant isolation", () => {
  it("requires all simulated records to carry the active shop id", async () => {
    const { customers, demoShop, maintenanceItems, vehicles } = await import(
      "@/lib/demo-data"
    );

    expect(customers.every((customer) => customer.shopId === demoShop.id)).toBe(true);
    expect(vehicles.every((vehicle) => vehicle.shopId === demoShop.id)).toBe(true);
    expect(maintenanceItems.every((item) => item.shopId === demoShop.id)).toBe(true);
  });
});
