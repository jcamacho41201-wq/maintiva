import { describe, expect, it } from "vitest";
import { createInitialDemoState } from "@/lib/demo-data";
import {
  buildOutreachDraft,
  outreachTemplateVariables,
  templateReasonForGroup,
  unresolvedTemplateTokens,
  type OutreachTemplateReason,
} from "@/lib/outreach-templates";
import { buildRevenueOpportunities, groupRevenueOpportunities, type RevenueQueueGroup } from "@/lib/revenue-recovery";

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

  it("includes a real booking URL only when supplied", () => {
    const { variables } = context("DECLINED_WORK");
    const draft = buildOutreachDraft({
      channel: "EMAIL",
      reason: "DECLINED_WORK",
      variables: { ...variables, bookingUrl: "https://shop.example/book/secure-token" },
      includeBookingLink: true,
    });

    expect(draft.body).toContain("https://shop.example/book/secure-token");
    expect(unresolvedTemplateTokens(`${draft.subject}\n${draft.body}`)).toEqual([]);
  });

  it("reports unresolved placeholders before outreach is marked sent", () => {
    expect(unresolvedTemplateTokens("Hi {{customerFirstName}}, call {{shopPhone}}.")).toEqual([
      "{{customerFirstName}}",
      "{{shopPhone}}",
    ]);
  });
});
