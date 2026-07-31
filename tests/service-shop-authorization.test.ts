import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
  serviceDefinition: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  vehicle: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  vehicleMaintenanceRecord: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  maintenanceRevenueOpportunity: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import {
  addPilotMaintenanceItem,
  addPilotServiceDefinition,
  canManageDrivingEstimates,
  resetPilotManualMileageOverride,
  reviewPilotMileageReading,
  setPilotCustomerReportedMileage,
  setPilotManualMileageOverride,
  updatePilotMaintenanceItem,
  updatePilotServiceDefinition,
  isMissingAdaptiveMileageSchema,
  isMissingServiceIntervalSchema,
} from "@/lib/pilot-state";
import { clientMutationError, safeDatabaseError, SafeActionError } from "@/lib/server-diagnostics";
import type { AuthenticatedShopContext } from "@/lib/auth";

const context: AuthenticatedShopContext = {
  userId: "user-shop-a",
  email: "owner@example.com",
  shopId: "shop-a",
  shopName: "Shop A",
  shopTimezone: "America/New_York",
  role: "OWNER",
  isDemo: false,
};

const advisorContext: AuthenticatedShopContext = {
  ...context,
  userId: "user-advisor",
  email: "advisor@example.com",
  role: "SERVICE_ADVISOR",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$executeRaw.mockResolvedValue(0);
  prismaMock.$transaction.mockImplementation((callback) => callback(prismaMock));
  prismaMock.vehicleMaintenanceRecord.findMany.mockResolvedValue([]);
});

describe("service shop authorization", () => {
  it("creates a shop service using the verified active shop id", async () => {
    prismaMock.serviceDefinition.findUnique.mockResolvedValue(null);
    prismaMock.serviceDefinition.create.mockResolvedValue({ id: "cmservice000000000000000001", shopId: "shop-a" });

    await addPilotServiceDefinition(context, {
      name: "Oil Change",
      category: "Preventative Maintenance",
      defaultMileageInterval: 5_000,
      defaultTimeIntervalValue: 6,
      defaultTimeIntervalUnit: "MONTHS",
      estimatedLaborMinutes: 30,
      defaultPriceCents: 8_900,
      isActive: true,
    });

    expect(prismaMock.serviceDefinition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        shopId: "shop-a",
        name: "Oil Change",
        defaultMileageInterval: 5_000,
        defaultTimeIntervalValue: 6,
        defaultTimeIntervalUnit: "MONTHS",
        defaultPriceCents: 8_900,
      }),
    }));
  });

  it("updates a shop service only after selecting it by active shop", async () => {
    prismaMock.serviceDefinition.findFirst.mockResolvedValue({
      id: "cmservice000000000000000001",
      shopId: "shop-a",
      defaultTimeIntervalValue: 6,
      defaultTimeIntervalUnit: "MONTHS",
    });
    prismaMock.serviceDefinition.update.mockResolvedValue({ id: "cmservice000000000000000001", shopId: "shop-a" });

    await updatePilotServiceDefinition(context, "cmservice000000000000000001", {
      defaultMileageInterval: 6_000,
      defaultTimeIntervalValue: 9,
    });

    expect(prismaMock.serviceDefinition.findFirst).toHaveBeenCalledWith({
      where: { id: "cmservice000000000000000001", shopId: "shop-a" },
    });
    expect(prismaMock.serviceDefinition.update).toHaveBeenCalled();
  });

  it("rejects duplicate shop services before reporting success", async () => {
    prismaMock.serviceDefinition.findUnique.mockResolvedValue({ id: "cmserviceexisting000000001", shopId: "shop-a" });

    await expect(addPilotServiceDefinition(context, {
      name: "Oil Change",
      category: "Preventative Maintenance",
      defaultMileageInterval: 5_000,
      defaultTimeIntervalValue: 6,
      defaultTimeIntervalUnit: "MONTHS",
      estimatedLaborMinutes: 30,
      defaultPriceCents: 8_900,
      isActive: true,
    })).rejects.toMatchObject({ code: "DUPLICATE_SERVICE_DEFINITION" });
    expect(prismaMock.serviceDefinition.create).not.toHaveBeenCalled();
  });

  it("assigns a service only when the vehicle and service both belong to the active shop", async () => {
    prismaMock.vehicle.findFirst.mockResolvedValue({ id: "cmvehicle00000000000000001", shopId: "shop-a" });
    prismaMock.serviceDefinition.findFirst.mockResolvedValue({
      id: "cmservice000000000000000001",
      shopId: "shop-a",
      name: "Oil Change",
      defaultPriceCents: 8_900,
      estimatedLaborMinutes: 30,
      defaultNotificationThreshold: 10,
    });
    prismaMock.vehicleMaintenanceRecord.findFirst.mockResolvedValue(null);
    prismaMock.vehicleMaintenanceRecord.create.mockResolvedValue({ id: "cmitem00000000000000000001", shopId: "shop-a" });

    await addPilotMaintenanceItem(context, {
      vehicleId: "cmvehicle00000000000000001",
      serviceDefinitionId: "cmservice000000000000000001",
      useShopDefaults: true,
      lastCompletedDate: "2026-07-29",
      lastCompletedMileage: 10_000,
    });

    expect(prismaMock.vehicle.findFirst).toHaveBeenCalledWith({
      where: { id: "cmvehicle00000000000000001", shopId: "shop-a", archivedAt: null },
    });
    expect(prismaMock.serviceDefinition.findFirst).toHaveBeenCalledWith({
      where: { id: "cmservice000000000000000001", shopId: "shop-a" },
    });
    expect(prismaMock.vehicleMaintenanceRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        shopId: "shop-a",
        vehicleId: "cmvehicle00000000000000001",
        serviceDefinitionId: "cmservice000000000000000001",
      }),
    }));
  });

  it("rejects assigning a service to another shop's vehicle", async () => {
    prismaMock.vehicle.findFirst.mockResolvedValue(null);
    prismaMock.vehicle.findUnique.mockResolvedValue({ shopId: "shop-b" });

    await expect(addPilotMaintenanceItem(context, {
      vehicleId: "cmvehicleb000000000000001",
      serviceDefinitionId: "cmservice000000000000000001",
      useShopDefaults: true,
    })).rejects.toMatchObject({
      code: "VEHICLE_NOT_IN_ACTIVE_SHOP",
      status: 403,
    });
    expect(prismaMock.vehicleMaintenanceRecord.create).not.toHaveBeenCalled();
  });

  it("rejects assigning another shop's service to an active-shop vehicle", async () => {
    prismaMock.vehicle.findFirst.mockResolvedValue({ id: "cmvehicle00000000000000001", shopId: "shop-a" });
    prismaMock.serviceDefinition.findFirst.mockResolvedValue(null);
    prismaMock.serviceDefinition.findUnique.mockResolvedValue({ shopId: "shop-b" });

    await expect(addPilotMaintenanceItem(context, {
      vehicleId: "cmvehicle00000000000000001",
      serviceDefinitionId: "cmserviceb000000000000001",
      useShopDefaults: true,
    })).rejects.toMatchObject({
      code: "SERVICE_NOT_IN_ACTIVE_SHOP",
      status: 403,
    });
    expect(prismaMock.vehicleMaintenanceRecord.create).not.toHaveBeenCalled();
  });

  it("rejects demo ids in production mutation payloads", async () => {
    await expect(addPilotMaintenanceItem(context, {
      vehicleId: "veh-jeep",
      serviceDefinitionId: "cmservice000000000000000001",
      useShopDefaults: true,
    })).rejects.toMatchObject({ code: "DEMO_ID_NOT_PERSISTED" });
    expect(prismaMock.vehicle.findFirst).not.toHaveBeenCalled();
  });

  it("persists vehicle overrides only after selecting the maintenance item by active shop", async () => {
    prismaMock.vehicleMaintenanceRecord.findFirst.mockResolvedValue({
      id: "cmitem00000000000000000001",
      shopId: "shop-a",
      timeIntervalValueOverride: null,
      timeIntervalUnitOverride: null,
    });
    prismaMock.vehicleMaintenanceRecord.update.mockResolvedValue({ id: "cmitem00000000000000000001", shopId: "shop-a" });

    await updatePilotMaintenanceItem(context, "cmitem00000000000000000001", {
      useShopDefaults: false,
      mileageIntervalOverride: 7_500,
      timeIntervalValueOverride: 9,
      timeIntervalUnitOverride: "MONTHS",
    });

    expect(prismaMock.vehicleMaintenanceRecord.findFirst).toHaveBeenCalledWith({
      where: { id: "cmitem00000000000000000001", shopId: "shop-a", archivedAt: null },
    });
    expect(prismaMock.vehicleMaintenanceRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        mileageIntervalOverride: 7_500,
        timeIntervalValueOverride: 9,
        timeIntervalUnitOverride: "MONTHS",
      }),
    }));
  });

  it("maps missing service-interval database columns to an actionable client error", () => {
    const error = clientMutationError(
      { code: "P2022", message: "Column does not exist." },
      { action: "addServiceDefinition", table: "ServiceDefinition", operation: "INSERT" },
    );

    expect(error).toEqual({
      code: "SERVICE_INTERVAL_SCHEMA_MISSING",
      message: "The database update for service intervals has not been installed.",
      status: 500,
    });
  });

  it("loads state with the legacy maintenance-record columns when the interval migration is missing", () => {
    expect(isMissingServiceIntervalSchema({
      code: "P2022",
      message: "The column `VehicleMaintenanceRecord.customServiceName` does not exist in the current database.",
    })).toBe(true);
  });

  it("detects missing adaptive-mileage columns from Prisma raw-query metadata", () => {
    const error = {
      code: "P2010",
      message: "Raw query failed.",
      meta: {
        code: "42703",
        message: "column Shop.defaultAnnualMileage does not exist",
      },
    };

    expect(safeDatabaseError(error)).toMatchObject({ code: "P2010" });
    expect(isMissingAdaptiveMileageSchema(error)).toBe(true);
  });

  it("keeps safe action errors out of successful UI paths", () => {
    const error = new SafeActionError({
      code: "VEHICLE_NOT_IN_ACTIVE_SHOP",
      message: "The selected vehicle does not belong to your active shop.",
      status: 403,
    });

    expect(clientMutationError(error, { action: "addMaintenanceItem" })).toMatchObject({
      code: "VEHICLE_NOT_IN_ACTIVE_SHOP",
      status: 403,
    });
  });

  it("limits driving-estimate edits to owners and managers", async () => {
    expect(canManageDrivingEstimates("OWNER")).toBe(true);
    expect(canManageDrivingEstimates("MANAGER")).toBe(true);
    expect(canManageDrivingEstimates("SERVICE_ADVISOR")).toBe(false);
    expect(canManageDrivingEstimates("TECHNICIAN")).toBe(false);

    await expect(setPilotCustomerReportedMileage(advisorContext, {
      vehicleId: "cmvehicle00000000000000001",
      annualMileage: 12_000,
    })).rejects.toMatchObject({
      code: "DRIVING_ESTIMATE_MANAGER_REQUIRED",
      status: 403,
    });
    await expect(setPilotManualMileageOverride(advisorContext, {
      vehicleId: "cmvehicle00000000000000001",
      annualMileage: 9_000,
      reason: "Temporary seasonal estimate",
      reviewCondition: "NEXT_SERVICE_VISIT",
    })).rejects.toMatchObject({
      code: "DRIVING_ESTIMATE_MANAGER_REQUIRED",
      status: 403,
    });
    await expect(resetPilotManualMileageOverride(advisorContext, {
      vehicleId: "cmvehicle00000000000000001",
    })).rejects.toMatchObject({
      code: "DRIVING_ESTIMATE_MANAGER_REQUIRED",
      status: 403,
    });
    await expect(reviewPilotMileageReading(advisorContext, {
      readingId: "cmmileage000000000000001",
      includedInForecast: false,
      anomalyStatus: "RESOLVED",
    })).rejects.toMatchObject({
      code: "DRIVING_ESTIMATE_MANAGER_REQUIRED",
      status: 403,
    });
  });
});
