import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitialDemoState } from "@/lib/demo-data";
import {
  buildOutreachDraft,
  formatGroupedServiceSummary,
  groupedServiceNamesForTemplate,
  outreachTemplateVariables,
  templateReasonForGroup,
  unresolvedTemplateTokens,
  type OutreachTemplateReason,
} from "@/lib/outreach-templates";
import { buildRevenueOpportunities, groupRevenueOpportunities, type RevenueOpportunity, type RevenueQueueGroup } from "@/lib/revenue-recovery";

function queueGroupFor(reason: OutreachTemplateReason): RevenueQueueGroup {
  const state = createInitialDemoState();
  const opportunities = buildRevenueOpportunities(state);
  const group = groupRevenueOpportunities(opportunities).find((item) => {
    const detected = templateReasonForGroup(item);
    return detected === reason;
  });
  if (group) return group;

  const fallback = groupRevenueOpportunities(opportunities)[0];
  return {
    ...fallback,
    sources: [reason],
    opportunities: fallback.opportunities.map((opportunity) => ({
      ...opportunity,
      source: reason === "DECLINED_WORK"
        ? "DECLINED_WORK"
        : reason === "OVERDUE"
          ? "OVERDUE_MAINTENANCE"
          : "DUE_MAINTENANCE",
      sourceLabel: reason === "INSPECTION_RECOMMENDATION" ? "Inspection recommendation" : opportunity.sourceLabel,
      explanation: reason === "INSPECTION_RECOMMENDATION" ? "Inspection recommendation found during visit." : opportunity.explanation,
    })),
  };
}

function context(reason: OutreachTemplateReason) {
  const state = createInitialDemoState();
  const group = queueGroupFor(reason);
  const customer = state.customers.find((item) => item.id === group.customerId)!;
  const vehicle = state.vehicles.find((item) => item.id === group.vehicleId)!;
  const variables = outreachTemplateVariables({
    customer,
    vehicle,
    shop: state.shop,
    group,
  });
  return { group, variables, shop: state.shop };
}

function groupedOpportunity(serviceName: string, index: number, overrides: Partial<RevenueOpportunity> = {}): RevenueOpportunity {
  return {
    id: `opp-${index}`,
    shopId: "shop-1",
    customerId: "cust-1",
    vehicleId: "veh-1",
    customerName: "Demo Test",
    vehicleLabel: "2003 Jeep Wrangler",
    source: "OVERDUE_MAINTENANCE",
    sourceLabel: "Overdue maintenance",
    serviceNames: [serviceName],
    maintenanceRecordId: `record-${index}`,
    sourceRecordId: `record-${index}`,
    sourceType: "VehicleMaintenanceRecord",
    explanation: `${serviceName} is overdue.`,
    priority: "HIGH",
    priorityReason: "High urgency.",
    currentMileage: 65000,
    daysOverdue: 10 + index,
    milesOverdue: 500 + index,
    estimatedRevenueCents: 10000,
    estimatedLaborHours: 1,
    outreachStatus: "NEEDS_OUTREACH",
    appointmentStatus: "UNSCHEDULED",
    stage: "IDENTIFIED",
    createdAt: "2026-08-01T12:00:00.000Z",
    lastActivityAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function groupedSmsContext(serviceNames: string[]) {
  const opportunities = serviceNames.map((name, index) => groupedOpportunity(name, index));
  const group = groupRevenueOpportunities(opportunities)[0];
  const variables = outreachTemplateVariables({
    customer: {
      id: "cust-1",
      shopId: "shop-1",
      firstName: "Demo",
      lastName: "Test",
      phone: "9148064943",
      email: "demo@example.com",
      preferredContact: "SMS",
      smsConsent: true,
      smsConsentStatus: "OPTED_IN",
      emailConsent: true,
      callConsent: true,
      status: "ACTIVE",
      customerScore: 80,
      lifetimeRevenueCents: 0,
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
    },
    vehicle: {
      id: "veh-1",
      shopId: "shop-1",
      customerId: "cust-1",
      year: 2003,
      make: "Jeep",
      model: "Wrangler",
      currentMileage: 65000,
      estimatedAnnualMileage: 12000,
      overallHealth: 60,
      lastServiceDate: "2026-01-10",
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
    },
    shop: {
      name: "test shop 1",
      phone: "9148064943",
      email: "shop@example.com",
    },
    group,
  });
  return { group, variables };
}

describe("outreach templates", () => {
  it("uses the real shop identity instead of a product placeholder", () => {
    const { variables, shop } = context("DUE_SOON");
    const draft = buildOutreachDraft({
      channel: "TEXT",
      reason: "DUE_SOON",
      variables,
      includeBookingLink: false,
    });

    expect(draft.body).toContain(shop.name);
    expect(draft.body).not.toContain("Maintiva");
  });

  it("generates reason-specific customer messages", () => {
    for (const reason of ["DECLINED_WORK", "DUE_SOON", "OVERDUE", "INSPECTION_RECOMMENDATION"] as const) {
      const { variables } = context(reason);
      const draft = buildOutreachDraft({
        channel: "EMAIL",
        reason,
        variables,
        includeBookingLink: false,
      });

      expect(draft.subject.length).toBeGreaterThan(8);
      expect(draft.body).toContain(variables.customerFirstName);
      expect(unresolvedTemplateTokens(`${draft.subject}\n${draft.body}`)).toEqual([]);
    }
  });

  it("does not invent a booking URL when no secure link exists", () => {
    const { variables } = context("OVERDUE");
    const draft = buildOutreachDraft({
      channel: "TEXT",
      reason: "OVERDUE",
      variables,
      includeBookingLink: false,
    });

    expect(draft.body).not.toContain("{{bookingUrl}}");
    expect(draft.body).not.toMatch(/https?:\/\//);
  });

  it("includes a real request URL only when supplied", () => {
    const { variables } = context("DECLINED_WORK");
    const draft = buildOutreachDraft({
      channel: "EMAIL",
      reason: "DECLINED_WORK",
      variables: { ...variables, bookingUrl: "https://shop.example/request/secure-token" },
      includeBookingLink: true,
    });

    expect(draft.body).toContain("https://shop.example/request/secure-token");
    expect(draft.body).toContain("request a maintenance time");
    expect(draft.body).not.toContain("book here");
    expect(draft.body).not.toContain("Book here");
    expect(unresolvedTemplateTokens(`${draft.subject}\n${draft.body}`)).toEqual([]);
  });

  it("summarizes grouped SMS service context for one overdue service", () => {
    const { variables } = groupedSmsContext(["Oil Change"]);
    const draft = buildOutreachDraft({
      channel: "TEXT",
      reason: "OVERDUE",
      variables,
      includeBookingLink: false,
    });

    expect(draft.body).toBe("Hi Demo, this is test shop 1. Your 2003 Jeep Wrangler is overdue for Oil Change. Reply here or call 9148064943 and we can help you get it scheduled.");
  });

  it("summarizes grouped SMS service context for two overdue services", () => {
    const { variables } = groupedSmsContext(["Oil Change", "Tire Rotation"]);
    const draft = buildOutreachDraft({
      channel: "TEXT",
      reason: "OVERDUE",
      variables,
      includeBookingLink: false,
    });

    expect(draft.body).toContain("Oil Change and Tire Rotation");
    expect(draft.body).toContain("them scheduled");
    expect(draft.body).not.toContain("Oil Change, and Tire Rotation");
  });

  it("summarizes grouped SMS service context for three overdue services", () => {
    const { variables } = groupedSmsContext(["Oil Change", "Tire Rotation", "Brake Fluid Service"]);
    const draft = buildOutreachDraft({
      channel: "TEXT",
      reason: "OVERDUE",
      variables,
      includeBookingLink: false,
    });

    expect(draft.body).toContain("Oil Change, Tire Rotation, and Brake Fluid Service");
    expect(draft.body).toContain("them scheduled");
  });

  it("keeps long grouped SMS service context concise and deterministic", () => {
    const services = ["Oil Change", "Tire Rotation", "Brake Fluid Service", "Cabin Air Filter", "Differential Fluid"];
    const { group, variables } = groupedSmsContext(services);
    const draft = buildOutreachDraft({
      channel: "TEXT",
      reason: "OVERDUE",
      variables,
      includeBookingLink: false,
    });

    expect(groupedServiceNamesForTemplate(group)).toEqual(services);
    expect(formatGroupedServiceSummary(services)).toBe("Oil Change, Tire Rotation, Brake Fluid Service + 2 more");
    expect(draft.body).toContain("Oil Change, Tire Rotation, Brake Fluid Service + 2 more");
    expect(draft.body).not.toContain("Cabin Air Filter");
    expect(draft.body).not.toContain("+ 2 more services");
  });

  it("de-duplicates grouped SMS service names without changing queue order", () => {
    const { group } = groupedSmsContext(["Oil Change", "Tire Rotation", "oil change", "Brake Fluid Service"]);

    expect(groupedServiceNamesForTemplate(group)).toEqual(["Oil Change", "Tire Rotation", "Brake Fluid Service"]);
  });

  it("only uses services from the selected grouped customer vehicle and shop", () => {
    const group = groupRevenueOpportunities([
      groupedOpportunity("Oil Change", 0),
      groupedOpportunity("Tire Rotation", 1),
    ])[0];
    const mixedGroup: RevenueQueueGroup = {
      ...group,
      opportunities: [
        ...group.opportunities,
        groupedOpportunity("Other Vehicle Service", 2, { vehicleId: "veh-other" }),
        groupedOpportunity("Other Customer Service", 3, { customerId: "cust-other" }),
        groupedOpportunity("Other Shop Service", 4, { shopId: "shop-other" }),
      ],
      recommendedServices: ["Oil Change", "Tire Rotation", "Other Vehicle Service", "Other Customer Service", "Other Shop Service"],
    };

    expect(groupedServiceNamesForTemplate(mixedGroup)).toEqual(["Oil Change", "Tire Rotation"]);
  });

  it("keeps request-link SMS copy accurate without promising confirmation", () => {
    const { variables } = groupedSmsContext(["Oil Change", "Tire Rotation"]);
    const draft = buildOutreachDraft({
      channel: "TEXT",
      reason: "OVERDUE",
      variables: { ...variables, bookingUrl: "https://app.getmaintiva.com/request/secure-token" },
      includeBookingLink: true,
    });

    expect(draft.body).toBe("Hi Demo, this is test shop 1. Your 2003 Jeep Wrangler is overdue for Oil Change and Tire Rotation. You can request a maintenance time here: https://app.getmaintiva.com/request/secure-token. We'll confirm the appointment after reviewing our schedule.");
    expect(draft.body).not.toContain("Book here");
    expect(draft.body).not.toContain("Your appointment is confirmed");
  });

  it("does not overwrite manually edited drafts when request-link data refreshes", () => {
    const source = readFileSync(join(process.cwd(), "src/components/contact-customer-modal.tsx"), "utf8");
    const createLinkBlock = source.slice(source.indexOf("async function createLink"), source.indexOf("async function revokeLink"));

    expect(createLinkBlock).toContain("} else if (!draftEdited) {");
    expect(createLinkBlock).toContain("replaceDraft(channel, templateReason, true, result.bookingLink.url)");
  });

  it("reports unresolved placeholders before outreach is marked sent", () => {
    expect(unresolvedTemplateTokens("Hi {{customerFirstName}}, call {{shopPhone}}.")).toEqual([
      "{{customerFirstName}}",
      "{{shopPhone}}",
    ]);
  });
});
