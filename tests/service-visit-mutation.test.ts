import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedShopContext } from "@/lib/auth";

const db = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { recordPilotServiceVisit } from "@/lib/pilot-state";

const context: AuthenticatedShopContext = { userId: "advisor", email: "qa@example.test", shopId: "shop", shopName: "QA", shopTimezone: "America/New_York", role: "SERVICE_ADVISOR", isDemo: false };
const input = { customerId: "customer", vehicleId: "vehicle", date: "2026-08-01", mileage: 50000, idempotencyKey: "00000000-0000-4000-8000-000000000001", services: [{ serviceDefinitionId: "oil", outcome: "COMPLETED", priceCents: 5000 }] };

function transaction() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ defaultAnnualMileage: 12000 }]),
    auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "audit" }) },
    vehicle: { findFirst: vi.fn().mockResolvedValue({ id: "vehicle", customerId: "customer", year: 2020, lastServiceDate: null, currentMileage: 49000 }), update: vi.fn().mockResolvedValue({ id: "vehicle" }) },
    customer: { findFirst: vi.fn().mockResolvedValue({ lastVisit: null }), update: vi.fn().mockResolvedValue({ id: "customer" }) },
    serviceDefinition: { findMany: vi.fn().mockResolvedValue([{ id: "oil", name: "Oil", estimatedLaborMinutes: 30, defaultPriceCents: 5000, defaultNotificationThreshold: 10 }]) },
    serviceHistoryRecord: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "history" }) },
    declinedWorkRecord: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: "deferred" }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    vehicleMaintenanceRecord: { findFirst: vi.fn().mockResolvedValue({ id: "maintenance", lastCompletedDate: null }), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({ id: "maintenance" }) },
    maintenanceRevenueOpportunity: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    vehicleMileageReading: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: "mileage" }) },
    vehicleDrivingProfile: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    appointment: { findFirst: vi.fn().mockResolvedValue(null) },
  };
}

let tx = transaction();
beforeEach(() => {
  tx = transaction();
  db.$transaction.mockReset().mockImplementation(async (callback) => callback(tx));
});

describe("manual service visit transaction", () => {
  it("writes service, dated mileage, baseline and source audit in one transaction", async () => {
    await recordPilotServiceVisit(context, input);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.vehicle.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ shopId: "shop", customerId: "customer", id: "vehicle", archivedAt: null }) }));
    expect(tx.serviceHistoryRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shopId: "shop", maintenanceRecordId: "maintenance", mileage: 50000, completedAt: new Date("2026-08-01T12:00:00Z") }) }));
    expect(tx.vehicleMileageReading.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ readingMileage: 50000, readingDate: new Date("2026-08-01T12:00:00Z"), sourceReferenceType: "ManualServiceVisit" }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ source: "MANUAL", payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/) }) }) }));
    expect(tx.vehicle.update.mock.calls[0][0].data).not.toHaveProperty("currentMileage");
  });

  it("replays the exact committed request without duplicate writes", async () => {
    tx.auditLog.findFirst.mockResolvedValue({ id: "audit", metadata: { payloadHash: createHash("sha256").update(JSON.stringify(input)).digest("hex") } });
    await recordPilotServiceVisit(context, input);
    expect(tx.serviceHistoryRecord.create).not.toHaveBeenCalled();
    expect(tx.vehicleMileageReading.create).not.toHaveBeenCalled();
  });

  it("rejects a changed payload with a committed key", async () => {
    tx.auditLog.findFirst.mockResolvedValue({ id: "audit", metadata: { payloadHash: "different" } });
    await expect(recordPilotServiceVisit(context, input)).rejects.toMatchObject({ code: "VISIT_RETRY_CHANGED" });
    expect(tx.serviceHistoryRecord.create).not.toHaveBeenCalled();
  });

  it("rejects unavailable tenant targets and unavailable services", async () => {
    tx.vehicle.findFirst.mockResolvedValue(null);
    await expect(recordPilotServiceVisit(context, input)).rejects.toMatchObject({ code: "VISIT_TARGET_UNAVAILABLE" });
    expect(tx.serviceDefinition.findMany).not.toHaveBeenCalled();
    tx.vehicle.findFirst.mockResolvedValue({ id: "vehicle", customerId: "customer", year: 2020 });
    tx.serviceDefinition.findMany.mockResolvedValue([]);
    await expect(recordPilotServiceVisit(context, input)).rejects.toMatchObject({ code: "VISIT_SERVICE_UNAVAILABLE" });
    expect(tx.serviceHistoryRecord.create).not.toHaveBeenCalled();
  });

  it("does not bypass an active appointment or duplicate service history", async () => {
    tx.appointment.findFirst.mockResolvedValue({ id: "booked" });
    await expect(recordPilotServiceVisit(context, input)).rejects.toMatchObject({ code: "VISIT_SERVICE_BOOKED" });
    tx.appointment.findFirst.mockResolvedValue(null);
    tx.serviceHistoryRecord.findFirst.mockResolvedValue({ id: "existing" });
    await expect(recordPilotServiceVisit(context, input)).rejects.toMatchObject({ code: "VISIT_ALREADY_RECORDED" });
    expect(tx.serviceHistoryRecord.create).not.toHaveBeenCalled();
  });

  it("preserves a newer completed-service baseline when adding history", async () => {
    tx.vehicleMaintenanceRecord.findFirst.mockResolvedValue({ id: "maintenance", lastCompletedDate: new Date("2026-08-10T12:00:00Z") });
    await recordPilotServiceVisit(context, input);
    expect(tx.serviceHistoryRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.vehicleMaintenanceRecord.update).not.toHaveBeenCalled();
  });

  it("keeps a mileage-only deferred target free of an immediately due date", async () => {
    await recordPilotServiceVisit(context, { ...input, services: [{ ...input.services[0], outcome: "DEFERRED", dueMileage: 55000 }] });
    expect(tx.maintenanceRevenueOpportunity.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { shopId: "shop", declinedWorkRecordId: "deferred" }, data: { dueDate: null, dueMileage: 55000 } }));
    expect(tx.serviceHistoryRecord.create).not.toHaveBeenCalled();
    expect(tx.vehicleMaintenanceRecord.update).not.toHaveBeenCalled();
  });

  it("denies technicians and future-dated visits before opening a transaction", async () => {
    await expect(recordPilotServiceVisit({ ...context, role: "TECHNICIAN" }, input)).rejects.toMatchObject({ code: "VISIT_PERMISSION_REQUIRED" });
    await expect(recordPilotServiceVisit(context, { ...input, date: "2999-01-01" })).rejects.toMatchObject({ code: "VISIT_DATE_FUTURE" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("does not reset service baselines from conflicting mileage", async () => {
    tx.vehicleMileageReading.findMany.mockResolvedValue([{ readingMileage: 60000, readingDate: new Date("2026-07-01T12:00:00Z"), verificationStatus: "VERIFIED", source: "SHOP_MANUAL_ENTRY", includedInForecast: true, anomalyStatus: "NONE" }]);
    await expect(recordPilotServiceVisit(context, input)).rejects.toMatchObject({ code: "VISIT_MILEAGE_REVIEW_REQUIRED" });
    expect(tx.serviceHistoryRecord.create).not.toHaveBeenCalled();
    expect(tx.vehicleMaintenanceRecord.update).not.toHaveBeenCalled();
  });

  it("reuses an identical dated odometer reading", async () => {
    tx.vehicleMileageReading.findMany.mockResolvedValue([{ readingMileage: 50000, readingDate: new Date("2026-08-01T12:00:00Z"), verificationStatus: "VERIFIED", source: "SHOP_MANUAL_ENTRY", includedInForecast: true, anomalyStatus: "NONE" }]);
    await recordPilotServiceVisit(context, input);
    expect(tx.serviceHistoryRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.vehicleMileageReading.create).not.toHaveBeenCalled();
  });
});
