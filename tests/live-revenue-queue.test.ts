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

  it("links persisted declined-work opportunities only to declined source records", () => {
    const state = asLiveShop(createInitialDemoState());
    state.revenueOpportunities = [
      opportunity({
        id: "mro-declined",
        maintenanceRecordId: undefined,
        declinedWorkRecordId: "declined-jeep-brake-service",
        source: "DECLINED_WORK",
        explanation: "Brake Fluid was declined.",
      }),
    ];

    const [item] = buildRevenueOpportunities(state);

    expect(item.source).toBe("DECLINED_WORK");
    expect(item.sourceRecordId).toBe("declined-jeep-brake-service");
    expect(item.sourceType).toBe("DeclinedWorkRecord");
    expect(item.maintenanceRecordId).toBeUndefined();
    expect(item.declinedWorkRecordId).toBe("declined-jeep-brake-service");
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
  const dashboardPageSource = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
  const contactModalSource = readFileSync(join(process.cwd(), "src/components/contact-customer-modal.tsx"), "utf8");
  const contactWorkflowSource = readFileSync(join(process.cwd(), "src/lib/contact-workflow.ts"), "utf8");
  const vehiclePageSource = readFileSync(join(process.cwd(), "src/app/vehicles/[vehicleId]/page.tsx"), "utf8");
  const customerPageSource = readFileSync(join(process.cwd(), "src/app/customers/[customerId]/page.tsx"), "utf8");
  const importPageSource = readFileSync(join(process.cwd(), "src/app/import/page.tsx"), "utf8");

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
    expect(pilotStateSource).toMatch(/export async function importPilotCsvRows[\s\S]+classifyImportRowEvent[\s\S]+importsCompletedService[\s\S]+importsDeclinedWork/);
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

  it("uses the canonical contact workflow instead of the recommendation workflow", () => {
    expect(automationPageSource).not.toContain("RecommendationModal");
    expect(automationPageSource).not.toContain("Generate message");
    expect(automationPageSource).toContain("ContactCustomerModal");
    expect(automationPageSource).not.toContain("function ContactCustomerModal");
    expect(dashboardPageSource).not.toContain("RecommendationModal");
    expect(dashboardPageSource).not.toContain("Generate message");
    expect(dashboardPageSource).not.toContain("canRecommend");
    expect(dashboardPageSource).toContain("canContactCustomerForDraft(customer)");
    expect(dashboardPageSource).toContain("ContactCustomerModal");
    expect(contactModalSource).toContain('title="Contact customer"');
    expect(contactModalSource).toContain("defaultContactChannel(customer)");
    expect(contactModalSource).toContain("Mark ${channel.toLowerCase()} as sent");
    expect(automationPageSource).toContain("BookAppointmentModal");
    expect(automationPageSource).toContain('title="Book appointment"');
    expect(automationPageSource).toContain("Create appointment");
    expect(automationPageSource).toContain("SnoozeOpportunityModal");
    expect(automationPageSource).toContain('title="Snooze opportunity"');
    expect(automationPageSource).toContain("End snooze now");
  });

  it("keeps drafting separate from recorded outreach", () => {
    const copyBlock = contactModalSource.slice(
      contactModalSource.indexOf("async function copyText"),
      contactModalSource.indexOf("async function saveContact"),
    );
    const saveBlock = contactModalSource.slice(contactModalSource.indexOf("async function saveContact"));

    expect(copyBlock).not.toContain("onSave");
    expect(copyBlock).not.toContain("recordOpportunityContact");
    expect(saveBlock).toContain("onSave({");
    expect(contactWorkflowSource).not.toContain("lastContact");
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
    expect(pilotStateSource).toContain("select: baselineOutreachRecordSelect");
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

  it("keeps mixed CSV imports available when some rows need review", () => {
    expect(importPageSource).toContain("Some rows need attention. Ready rows can still be imported.");
    expect(importPageSource).toContain("Import ${readyRows} rows and hold ${heldRows} for review");
    expect(importPageSource).toContain("Save ${heldRows} rows for review");
    expect(importPageSource).toContain("Needs review");
    expect(pilotStateSource).toMatch(/row.status === "INVALID" \|\| row.status === "HELD"[\s\S]+return override === "SKIP"/);
    expect(pilotStateSource).toMatch(/row.status !== "INVALID" &&[\s\S]+row.status !== "HELD"/);
  });

  it("uses shared missing-mileage display helpers for customer and vehicle pages", () => {
    expect(customerPageSource).toContain("formatMileage(vehicleMileageDisplayValue(state, vehicle))");
    expect(customerPageSource).toContain("formatServiceMileage(record.mileage)");
    expect(vehiclePageSource).toContain("formatMileage(displayedCurrentMileage)");
    expect(vehiclePageSource).toContain("formatServiceMileage(record.mileage)");
    expect(vehiclePageSource).toContain("Last completed mileage not entered");
  });
});

describe("revenue queue contact timestamps", () => {
  it("does not use imported opportunity activity as last contact", () => {
    const state = asLiveShop(createInitialDemoState());
    state.outreachRecords = [];
    state.revenueOpportunities = [
      opportunity({
        id: "imported-activity",
        lastActivityAt: "2026-07-31T15:00:00.000Z",
        createdAt: "2026-07-31T15:00:00.000Z",
      }),
    ];

    const [group] = groupRevenueOpportunities(buildRevenueOpportunities(state));

    expect(group.lastContactedAt).toBeUndefined();
  });

  it("preserves real outreach as last contact", () => {
    const state = asLiveShop(createInitialDemoState());
    state.outreachRecords = [
      {
        id: "outreach-real",
        shopId: "shop-live",
        customerId: "cust-justin",
        vehicleId: "veh-jeep",
        maintenanceRecordIds: ["item-veh-jeep-brake-pads"],
        serviceNames: ["Brake Pads"],
        message: "Brake pads are ready to schedule.",
        channel: "EMAIL",
        sentAt: "2026-07-30T16:00:00.000Z",
        manuallySentAt: "2026-07-30T16:05:00.000Z",
        responseStatus: "NO_RESPONSE",
        status: "MANUALLY_SENT",
      },
    ];
    state.revenueOpportunities = [opportunity({ id: "with-outreach" })];

    const [group] = groupRevenueOpportunities(buildRevenueOpportunities(state));

    expect(group.lastContactedAt).toBe("2026-07-30T16:05:00.000Z");
  });
});
