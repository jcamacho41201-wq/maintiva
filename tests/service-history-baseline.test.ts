import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedShopContext } from "@/lib/auth";
import { detectColumnMapping, parseCsv } from "@/lib/csv-import";
import { serviceCompletionBaselineUpdate } from "@/lib/service-history";

const db = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findFirstOrThrow: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() });
  return {
    $transaction: vi.fn(), $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    shop: { findUniqueOrThrow: vi.fn() },
    customer: model(), vehicle: model(), serviceDefinition: model(),
    vehicleMaintenanceRecord: model(), vehicleMileageReading: model(), vehicleDrivingProfile: model(),
    serviceHistoryRecord: model(), outreachRecord: model(), maintenanceRevenueOpportunity: model(),
    smartMaintenanceBlock: model(), smartMaintenanceBlockBlackout: model(),
    appointmentRequestLink: model(), appointmentRequest: model(),
    importHistoryRecord: model(), importRowRecord: model(), auditLog: model(),
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { addPilotVehicle, importPilotCsvRows, markPilotMaintenanceServiceComplete } from "@/lib/pilot-state";

const context: AuthenticatedShopContext = { shopId: "shop", userId: "advisor", email: "qa@example.test", shopName: "QA", shopTimezone: "America/New_York", role: "SERVICE_ADVISOR", isDemo: false };
const date = (day: string) => new Date(`${day}T12:00:00Z`);
const service = { id: "oil", shopId: "shop", name: "Oil Change", defaultNotificationThreshold: 10, estimatedLaborMinutes: 30, defaultPriceCents: 8500 };
const vehicle = { id: "vehicle", shopId: "shop", customerId: "customer", year: 2020, make: "Toyota", model: "Camry", vin: null, currentMileage: 57000, licensePlate: null, lastServiceDate: date("2026-01-10") };
let baseline = { id: "maintenance", lastCompletedDate: date("2026-01-10"), lastCompletedMileage: 57000 };

beforeEach(() => {
  vi.resetAllMocks();
  baseline = { id: "maintenance", lastCompletedDate: date("2026-01-10"), lastCompletedMileage: 57000 };
  for (const value of Object.values(db)) {
    if (typeof value === "object" && "findMany" in value) value.findMany.mockResolvedValue([]);
  }
  db.$transaction.mockImplementation(async (callback) => callback(db));
  db.$queryRaw.mockResolvedValue([]);
  db.$executeRaw.mockResolvedValue(1);
  db.shop.findUniqueOrThrow.mockResolvedValue({ id: "shop", name: "QA", timezone: "America/New_York", isDemo: false, memberships: [], customers: [], vehicles: [], serviceHistoryRecords: [], declinedWorkRecords: [], revenueOpportunities: [], outreachRecords: [], importHistory: [], appointments: [] });
  db.customer.findFirst.mockResolvedValue({ id: "customer", firstName: "QA", lastName: "Vehicle", email: "qa@example.test", phone: null });
  db.customer.findUnique.mockResolvedValue({ id: "customer", shopId: "shop" });
  db.vehicle.findFirst.mockResolvedValue(vehicle);
  db.vehicle.update.mockResolvedValue(vehicle);
  db.vehicle.create.mockResolvedValue(vehicle);
  db.serviceDefinition.findFirst.mockResolvedValue(service);
  db.vehicleMaintenanceRecord.findFirst.mockImplementation(async () => ({ ...baseline, shopId: "shop", vehicleId: "vehicle", vehicle, serviceDefinitionId: "oil", serviceName: "Oil Change" }));
  db.vehicleMaintenanceRecord.findFirstOrThrow.mockImplementation(async () => ({ ...baseline }));
  db.vehicleMaintenanceRecord.update.mockImplementation(async ({ data }) => { baseline = { ...baseline, ...data }; return baseline; });
  db.serviceHistoryRecord.create.mockResolvedValue({ id: "history" });
  db.importHistoryRecord.create.mockResolvedValue({ id: "import" });
});

async function importHistory(entries: Array<[string, string]>) {
  const rows = parseCsv([
    "First Name,Last Name,Email,Year,Make,Model,Service Name,Service Date,Service Mileage,Price,Labor Hours,Status",
    ...entries.map(([day, mileage]) => `QA,Vehicle,qa@example.test,2020,Toyota,Camry,Oil Change,${day},${mileage},85,0.5,Completed`),
  ].join("\n"));
  await importPilotCsvRows(context, { fileName: "qa.csv", importType: "SERVICE_HISTORY", duplicateMode: "UPDATE", rows, mapping: detectColumnMapping(Object.keys(rows[0])) });
}

describe("completed-service baseline preservation", () => {
  it("keeps the newest completed service independent of CSV row order", async () => {
    await importHistory([["2026-06-10", "63000"], ["2025-07-10", "49500"]]);
    expect(baseline.lastCompletedDate).toEqual(date("2026-06-10"));
    expect(baseline.lastCompletedMileage).toBe(63000);
    expect(db.serviceHistoryRecord.create).toHaveBeenCalledTimes(2);
    expect(db.serviceHistoryRecord.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ maintenanceRecordId: "maintenance", completedAt: date("2025-07-10"), mileage: 49500 }) }));
  });

  it("does not attach older mileage to a newer service with missing mileage", async () => {
    await importHistory([["2026-06-10", ""]]);
    expect(baseline.lastCompletedDate).toEqual(date("2026-06-10"));
    expect(baseline.lastCompletedMileage).toBeNull();
    expect(db.vehicleMileageReading.create).not.toHaveBeenCalled();
  });

  it("does not erase mileage from a partial duplicate of the same dated service", async () => {
    await importHistory([["2026-01-10", ""]]);
    expect(baseline.lastCompletedMileage).toBe(57000);
  });

  it("preserves explicit zero mileage", () => {
    expect(serviceCompletionBaselineUpdate({ lastCompletedDate: null }, date("2026-01-10"), 0)?.lastCompletedMileage).toBe(0);
  });

  it("does not mark new-vehicle maintenance as completed based on intake mileage", async () => {
    db.serviceDefinition.findMany.mockResolvedValue([service]);
    await addPilotVehicle(context, { customerId: "customer", year: 2020, make: "Toyota", model: "Camry", currentMileage: 57000, initialMileageReadingDate: "2026-01-10" });
    expect(db.vehicleMaintenanceRecord.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ lastCompletedDate: null, lastCompletedMileage: null })] }));
    expect(db.vehicleMileageReading.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ readingMileage: 57000, readingDate: date("2026-01-10") }) }));
    expect(db.serviceHistoryRecord.create).not.toHaveBeenCalled();
  });

  it("records a backdated completion without resetting or closing the current service cycle", async () => {
    await markPilotMaintenanceServiceComplete(context, { maintenanceRecordId: "maintenance", completedAt: "2025-07-10", completedMileage: 49500, finalPriceCents: 8500, finalLaborMinutes: 30 });
    expect(db.serviceHistoryRecord.create).toHaveBeenCalledTimes(1);
    expect(db.vehicleMaintenanceRecord.update).not.toHaveBeenCalled();
    expect(db.maintenanceRevenueOpportunity.updateMany).not.toHaveBeenCalled();
    expect(db.vehicle.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ lastServiceDate: null }, { lastServiceDate: { lte: date("2025-07-10") } }] }) }));
  });

  it("allows a newer completion to reset the current baseline", async () => {
    await markPilotMaintenanceServiceComplete(context, { maintenanceRecordId: "maintenance", completedAt: "2026-06-10", completedMileage: 63000, finalPriceCents: 8500, finalLaborMinutes: 30 });
    expect(baseline.lastCompletedDate).toEqual(date("2026-06-10"));
    expect(baseline.lastCompletedMileage).toBe(63000);
    expect(db.maintenanceRevenueOpportunity.updateMany).toHaveBeenCalledTimes(1);
  });
});
