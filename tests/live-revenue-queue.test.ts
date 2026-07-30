import { describe, expect, it } from "vitest";
import { createInitialDemoState, type DemoState, type RevenueOpportunityRecord } from "@/lib/demo-data";
import {
  buildRevenueOpportunities,
  getOpenRevenueOpportunitiesForCustomer,
  groupRevenueOpportunities,
} from "@/lib/revenue-recovery";

function asLiveShop(state: DemoState): DemoState {
  const shopId = "shop-live";
  return {
    ...state,
    shop: { ...state.shop, id: shopId, isDemo: false },
    users: state.users.map((user) => ({ ...user, shopId })),
    customers: state.customers.map((customer) => ({ ...customer, shopId })),
    vehicles: state.vehicles.map((vehicle) => ({ ...vehicle, shopId })),
    services: state.services.map((service) => ({ ...service, shopId })),
    maintenanceRecords: state.maintenanceRecords.map((record) => ({ ...record, shopId })),
    declinedWorkRecords: state.declinedWorkRecords.map((record) => ({ ...record, shopId })),
    serviceRecords: state.serviceRecords.map((record) => ({ ...record, shopId })),
    outreachRecords: state.outreachRecords.map((record) => ({ ...record, shopId })),
    appointments: state.appointments.map((appointment) => ({ ...appointment, shopId })),
    importHistory: state.importHistory.map((record) => ({ ...record, shopId })),
    revenueOpportunities: [],
  };
}

function opportunity(overrides: Partial<RevenueOpportunityRecord>): RevenueOpportunityRecord {
  return {
    id: "mro-1",
    shopId: "shop-live",
    customerId: "cust-justin",
    vehicleId: "veh-jeep",
    maintenanceRecordId: "item-veh-jeep-brake-pads",
    source: "OVERDUE_MAINTENANCE",
    stage: "IDENTIFIED",
    priority: "HIGH",
    explanation: "Brake Pads is overdue for this vehicle.",
    priorityReason: "High urgency or value based on overdue severity and estimated revenue.",
    estimatedRevenueCents: 36000,
    estimatedLaborHours: 1.5,
    dueDate: "2026-07-01T12:00:00.000Z",
    dueMileage: 101200,
    daysOverdue: 29,
    milesOverdue: 1200,
    createdAt: "2026-07-29T12:00:00.000Z",
    ...overrides,
  };
}

describe("live revenue queue data source", () => {
  it("does not display derived source-record opportunities for a non-demo shop with no persisted opportunities", () => {
    const state = asLiveShop(createInitialDemoState());

    expect(state.maintenanceRecords.length).toBeGreaterThan(0);
    expect(state.declinedWorkRecords.length).toBeGreaterThan(0);
    expect(buildRevenueOpportunities(state)).toEqual([]);
    expect(groupRevenueOpportunities(buildRevenueOpportunities(state))).toEqual([]);
  });

  it("uses persisted MaintenanceRevenueOpportunity rows and stable customer/vehicle/source ids", () => {
    const state = asLiveShop(createInitialDemoState());
    state.revenueOpportunities = [opportunity({})];

    const [item] = buildRevenueOpportunities(state);

    expect(item.id).toBe("mro-1");
    expect(item.customerId).toBe("cust-justin");
    expect(item.vehicleId).toBe("veh-jeep");
    expect(item.maintenanceRecordId).toBe("item-veh-jeep-brake-pads");
    expect(item.sourceRecordId).toBe("item-veh-jeep-brake-pads");
    expect(item.sourceType).toBe("VehicleMaintenanceRecord");
    expect(item.customerName).toBe("Justin Camacho");
    expect(item.vehicleLabel).toBe("2003 Jeep Wrangler");
    expect(item.serviceNames).toEqual(["Brake Pads"]);
  });

  it("skips cross-tenant or mismatched opportunity records", () => {
    const state = asLiveShop(createInitialDemoState());
    state.revenueOpportunities = [
      opportunity({ id: "wrong-shop", shopId: "shop-other" }),
      opportunity({ id: "wrong-customer", customerId: "cust-john" }),
    ];

    expect(buildRevenueOpportunities(state)).toEqual([]);
  });

  it("customer profile helper and queue grouping agree on open count and value", () => {
    const state = asLiveShop(createInitialDemoState());
    state.revenueOpportunities = [
      opportunity({ id: "mro-open" }),
      opportunity({
        id: "mro-completed",
        stage: "COMPLETED",
        maintenanceRecordId: "item-veh-jeep-oil-change",
        estimatedRevenueCents: 8500,
      }),
    ];

    const customerOpen = getOpenRevenueOpportunitiesForCustomer(state, "cust-justin");
    const queueGroups = groupRevenueOpportunities(customerOpen);

    expect(customerOpen).toHaveLength(1);
    expect(queueGroups).toHaveLength(1);
    expect(queueGroups[0].customerId).toBe("cust-justin");
    expect(queueGroups[0].vehicleId).toBe("veh-jeep");
    expect(queueGroups[0].estimatedRevenueCents).toBe(36000);
  });
});
