import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  customer: {
    findMany: vi.fn(),
  },
  vehicle: {
    findMany: vi.fn(),
  },
  appointment: {
    findMany: vi.fn(),
  },
  maintenanceRevenueOpportunity: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import type { AuthenticatedShopContext } from "@/lib/auth";
import { SearchServiceError, searchPilotGlobal } from "@/lib/global-search-server";

const context: AuthenticatedShopContext = {
  userId: "user-shop-a",
  email: "owner@example.com",
  shopId: "shop-a",
  shopName: "Shop A",
  shopTimezone: "America/New_York",
  role: "OWNER",
  isDemo: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.customer.findMany.mockResolvedValue([{
    id: "customer-a",
    firstName: "QA",
    lastName: "Delete",
    phone: "(555) 010-1000",
    email: "qa-delete@example.test",
    vehicles: [],
  }]);
  prismaMock.vehicle.findMany.mockResolvedValue([{
    id: "vehicle-a",
    year: 2020,
    make: "Toyota",
    model: "Camry",
    vin: "VINQA123",
    licensePlate: "QA1",
    customer: { firstName: "QA", lastName: "Delete" },
  }]);
  prismaMock.appointment.findMany.mockResolvedValue([{
    id: "appointment-a",
    scheduledStart: new Date("2026-08-11T12:00:00.000Z"),
    customer: { firstName: "QA", lastName: "Delete" },
    services: [{ serviceName: "Oil Change" }],
  }]);
  prismaMock.maintenanceRevenueOpportunity.findMany.mockResolvedValue([{
    id: "opportunity-a",
    stage: "IDENTIFIED",
    explanation: "Oil Change is due",
    customer: { firstName: "QA", lastName: "Delete" },
    maintenanceRecord: { serviceName: "Oil Change" },
    declinedWorkRecord: null,
  }]);
});

describe("global search server execution", () => {
  it("uses explicit migration-safe selects for all search categories", async () => {
    await searchPilotGlobal(context, "test");

    expect(prismaMock.customer.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ shopId: "shop-a" }),
      select: expect.objectContaining({
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
      }),
    }));
    expect(prismaMock.vehicle.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ shopId: "shop-a" }),
      select: expect.objectContaining({
        id: true,
        year: true,
        make: true,
        model: true,
        vin: true,
        licensePlate: true,
      }),
    }));
    expect(prismaMock.appointment.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ shopId: "shop-a" }),
      select: expect.objectContaining({
        id: true,
        scheduledStart: true,
      }),
    }));
    expect(prismaMock.appointment.findMany.mock.calls[0][0]).not.toHaveProperty("include");
    expect(prismaMock.maintenanceRevenueOpportunity.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({
      where: expect.objectContaining({ shopId: "shop-a" }),
      select: expect.objectContaining({
        id: true,
        stage: true,
        explanation: true,
      }),
    }));
  });

  it("still returns customer and vehicle results when an optional category has schema drift", async () => {
    prismaMock.appointment.findMany.mockRejectedValue(Object.assign(new Error("Column does not exist"), {
      code: "P2022",
      meta: { modelName: "Appointment", column: "bookingLinkId" },
    }));

    const result = await searchPilotGlobal(context, "test");

    expect(result.results.map((item) => item.type)).toEqual(expect.arrayContaining([
      "customer",
      "vehicle",
      "opportunity",
    ]));
    expect(result.results.map((item) => item.type)).not.toContain("appointment");
  });

  it("fails the service when mandatory customer search fails", async () => {
    prismaMock.customer.findMany.mockRejectedValue(Object.assign(new Error("Column does not exist"), {
      code: "P2022",
      meta: { modelName: "Customer", column: "firstName" },
    }));

    await expect(searchPilotGlobal(context, "test")).rejects.toBeInstanceOf(SearchServiceError);
  });
});
