import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("revenue queue synchronization guardrails", () => {
  const pilotStateSource = readFileSync(join(process.cwd(), "src/lib/pilot-state.ts"), "utf8");
  const automationPageSource = readFileSync(join(process.cwd(), "src/app/automation/page.tsx"), "utf8");
  const vehiclePageSource = readFileSync(join(process.cwd(), "src/app/vehicles/[vehicleId]/page.tsx"), "utf8");

  it("recalculates persisted maintenance opportunities from effective intervals", () => {
    expect(pilotStateSource).toContain("resolveMaintenanceInterval({");
    expect(pilotStateSource).toContain("serviceDefinition: true");
    expect(pilotStateSource).toContain("isMaintenanceOpportunityEligible(effective.status)");
    expect(pilotStateSource).toContain("effective.nextDueMileage");
    expect(pilotStateSource).toContain("effective.milesUntilDue");
  });

  it("syncs opportunities after mileage, inspection, interval edit, completion, and CSV import paths", () => {
    expect(pilotStateSource).toMatch(/export async function updatePilotVehicleMileage[\s\S]+syncMaintenanceRevenueOpportunities/);
    expect(pilotStateSource).toMatch(/export async function recordPilotInspection[\s\S]+syncMaintenanceRevenueOpportunities/);
    expect(pilotStateSource).toMatch(/export async function updatePilotMaintenanceItem[\s\S]+syncMaintenanceRevenueOpportunities/);
    expect(pilotStateSource).toMatch(/export async function markPilotMaintenanceServiceComplete[\s\S]+syncMaintenanceRevenueOpportunities/);
    expect(pilotStateSource).toMatch(/export async function importPilotCsvRows[\s\S]+touchedVehicleMaintenanceRecords[\s\S]+syncMaintenanceRevenueOpportunities/);
  });

  it("keeps the main queue to four workflow tabs with advanced filters", () => {
    expect(automationPageSource).toContain("Needs Attention");
    expect(automationPageSource).toContain("Contacted");
    expect(automationPageSource).toContain("Booked");
    expect(automationPageSource).toContain("Closed");
    expect(automationPageSource).toContain("Advanced Filters");
    expect(automationPageSource).toContain("Any reason");
    expect(automationPageSource).toContain("Any priority");
    expect(automationPageSource).toContain("Any contact state");
    expect(automationPageSource).not.toContain("[\"ALL\", \"All\"]");
    expect(automationPageSource).not.toContain("Appointment attribution");
  });

  it("uses distinct queue action modals instead of the recommendation workflow", () => {
    expect(automationPageSource).not.toContain("RecommendationModal");
    expect(automationPageSource).not.toContain("Generate message");
    expect(automationPageSource).toContain("ContactCustomerModal");
    expect(automationPageSource).toContain('title="Contact customer"');
    expect(automationPageSource).toContain("Mark ${channel.toLowerCase()} as sent");
    expect(automationPageSource).toContain("BookAppointmentModal");
    expect(automationPageSource).toContain('title="Book appointment"');
    expect(automationPageSource).toContain("Create appointment");
    expect(automationPageSource).toContain("SnoozeOpportunityModal");
    expect(automationPageSource).toContain('title="Snooze opportunity"');
    expect(automationPageSource).toContain("End snooze now");
  });

  it("adds queue-specific server mutations for contact, booking, snooze, and unsnooze", () => {
    const mutateRouteSource = readFileSync(join(process.cwd(), "src/app/api/pilot/mutate/route.ts"), "utf8");

    expect(mutateRouteSource).toContain('action: z.literal("recordOpportunityContact")');
    expect(mutateRouteSource).toContain("recordPilotOpportunityContact(context, body.payload)");
    expect(mutateRouteSource).toContain('action: z.literal("snoozeOpportunity")');
    expect(mutateRouteSource).toContain("snoozePilotOpportunity(context, body.payload)");
    expect(mutateRouteSource).toContain('action: z.literal("endOpportunitySnooze")');
    expect(mutateRouteSource).toContain("endPilotOpportunitySnooze(context, body.payload)");
    expect(mutateRouteSource).toContain("opportunityIds: z.array");
  });

  it("persists snooze state as outreach history and expires it back to Needs Attention", () => {
    expect(pilotStateSource).toContain("export async function snoozePilotOpportunity");
    expect(pilotStateSource).toContain('status: "SNOOZED"');
    expect(pilotStateSource).toContain("followUpDate: snoozedUntil");
    expect(pilotStateSource).toContain('stage: "CONTACTED"');
    expect(pilotStateSource).toContain("expirePastQueueSnoozes(context)");
    expect(pilotStateSource).toContain('outreachStatus: "NEEDS_OUTREACH"');
    expect(pilotStateSource).toContain("export async function endPilotOpportunitySnooze");
  });

  it("keeps contact and booking separate in persisted workflows", () => {
    expect(pilotStateSource).toContain("export async function recordPilotOpportunityContact");
    expect(pilotStateSource).toContain("await tx.outreachRecord.create");
    expect(pilotStateSource).toContain("responseOpportunityStage");
    expect(pilotStateSource).toContain("export async function bookPilotAppointment");
    expect(pilotStateSource).toContain("opportunityId: targets?.opportunityIds[0]");
    expect(pilotStateSource).toContain('stage: "BOOKED"');
  });

  it("keeps missing last-completed mileage null in the client and shows explicit copy", () => {
    expect(pilotStateSource).toContain("lastCompletedMileage: record.lastCompletedMileage");
    expect(vehiclePageSource).toContain("Last completed mileage not entered");
    expect(vehiclePageSource).not.toContain("lastCompletedMileage: record.lastCompletedMileage ?? 0");
  });
});
