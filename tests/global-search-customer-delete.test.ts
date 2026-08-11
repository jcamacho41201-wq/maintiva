import { describe, expect, it } from "vitest";
import type {
  AppointmentRequestRecord,
  AppointmentRequestLinkRecord,
  DemoState,
  RevenueOpportunityRecord,
} from "@/lib/demo-data";
import { createInitialDemoState } from "@/lib/demo-data";
import { appointmentRequestCommitments } from "@/lib/appointment-requests";
import {
  canPermanentlyDeleteCustomers,
  customerDeletionSummary,
  removeDeletedCustomerFromState,
} from "@/lib/customer-deletion";
import { searchDemoGlobal } from "@/lib/global-search";

function withDeleteQaRecords(state: DemoState): DemoState {
  const opportunity: RevenueOpportunityRecord = {
    id: "qa-opportunity-delete",
    shopId: state.shop.id,
    customerId: "cust-justin",
    vehicleId: "veh-jeep",
    maintenanceRecordId: "item-veh-jeep-oil-change",
    source: "OVERDUE_MAINTENANCE",
    stage: "IDENTIFIED",
    priority: "HIGH",
    explanation: "Oil Change is overdue",
    priorityReason: "High-value overdue maintenance",
    estimatedRevenueCents: 18900,
    estimatedLaborHours: 1,
    daysOverdue: 10,
    milesOverdue: 1200,
    createdAt: "2026-08-04T12:00:00.000Z",
  };
  const link: AppointmentRequestLinkRecord = {
    id: "qa-request-link-delete",
    shopId: state.shop.id,
    customerId: "cust-justin",
    vehicleId: "veh-jeep",
    opportunityId: opportunity.id,
    smartMaintenanceBlockId: "smart-block-quick-maintenance",
    status: "ACTIVE",
    expiresAt: "2026-08-20T12:00:00.000Z",
    requestAttemptCount: 1,
    services: [],
    createdAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:00:00.000Z",
  };
  const request: AppointmentRequestRecord = {
    id: "qa-request-delete",
    shopId: state.shop.id,
    customerId: "cust-justin",
    vehicleId: "veh-jeep",
    opportunityId: opportunity.id,
    smartMaintenanceBlockId: "smart-block-quick-maintenance",
    requestLinkId: link.id,
    requestedStart: "2026-08-11T12:00:00.000Z",
    requestedEnd: "2026-08-11T13:00:00.000Z",
    shopTimezone: state.shop.timezone,
    totalLaborMinutes: 60,
    estimatedRevenueCents: 18900,
    status: "PENDING",
    source: "MAINTENANCE_REQUEST_LINK",
    expiresAt: "2026-08-20T12:00:00.000Z",
    customerSubmittedAt: "2026-08-04T12:00:00.000Z",
    services: [],
    createdAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:00:00.000Z",
  };

  return {
    ...state,
    customers: state.customers.map((customer) =>
      customer.id === "cust-justin"
        ? { ...customer, phone: "(555) 010-2000" }
        : customer,
    ),
    revenueOpportunities: [...state.revenueOpportunities, opportunity],
    appointmentRequestLinks: [...state.appointmentRequestLinks, link],
    appointmentRequests: [...state.appointmentRequests, request],
  };
}

describe("global search", () => {
  it("finds active-shop customers by normalized phone, vehicles by VIN, and opportunities by service", () => {
    const state = withDeleteQaRecords(createInitialDemoState());

    expect(searchDemoGlobal(state, "5550102000").results.map((result) => result.id)).toContain("cust-justin");
    expect(searchDemoGlobal(state, "1J4FA49S03P123456").results.map((result) => result.id)).toContain("veh-jeep");
    expect(searchDemoGlobal(state, "oil change").results.map((result) => result.id)).toContain("qa-opportunity-delete");
  });

  it("does not return records from another shop", () => {
    const state = withDeleteQaRecords({
      ...createInitialDemoState(),
      customers: [
        ...createInitialDemoState().customers,
        {
          id: "cust-other-shop",
          shopId: "shop-other",
          firstName: "Other",
          lastName: "Tenant",
          phone: "555-777-0000",
          email: "other@example.com",
          preferredContact: "EMAIL",
          smsConsent: false,
          emailConsent: true,
          callConsent: false,
          address: "",
          notes: "",
          status: "ACTIVE",
          customerScore: 50,
          lifetimeRevenueCents: 0,
          lastVisit: "2026-08-01",
        },
      ],
    });

    expect(searchDemoGlobal(state, "Other Tenant").results).toEqual([]);
  });

  it("omits deleted customers and all customer-owned search records", () => {
    const state = withDeleteQaRecords(createInitialDemoState());
    const next = removeDeletedCustomerFromState(state, "cust-justin");

    expect(searchDemoGlobal(next, "Justin").results).toEqual([]);
    expect(searchDemoGlobal(next, "Oil Change").results.some((result) => result.id === "qa-opportunity-delete")).toBe(false);
  });
});

describe("customer deletion cleanup", () => {
  it("is available only to owners and managers", () => {
    expect(canPermanentlyDeleteCustomers("OWNER")).toBe(true);
    expect(canPermanentlyDeleteCustomers("MANAGER")).toBe(true);
    expect(canPermanentlyDeleteCustomers("SERVICE_ADVISOR")).toBe(false);
    expect(canPermanentlyDeleteCustomers("TECHNICIAN")).toBe(false);
  });

  it("removes active requests, confirmed appointments, and dependent customer records", () => {
    const state = withDeleteQaRecords(createInitialDemoState());
    const summary = customerDeletionSummary(state, "cust-justin");

    expect(summary.vehicles).toBeGreaterThan(0);
    expect(summary.appointmentRequests).toBe(1);
    expect(appointmentRequestCommitments(state.appointmentRequests, new Date("2026-08-04T12:00:00.000Z"))).toHaveLength(1);

    const next = removeDeletedCustomerFromState(state, "cust-justin");

    expect(next.customers.some((customer) => customer.id === "cust-justin")).toBe(false);
    expect(next.vehicles.some((vehicle) => vehicle.customerId === "cust-justin")).toBe(false);
    expect(next.appointments.some((appointment) => appointment.customerId === "cust-justin")).toBe(false);
    expect(next.revenueOpportunities.some((opportunity) => opportunity.customerId === "cust-justin")).toBe(false);
    expect(appointmentRequestCommitments(next.appointmentRequests, new Date("2026-08-04T12:00:00.000Z"))).toEqual([]);
  });
});
