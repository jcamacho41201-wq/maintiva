import type { DemoState } from "@/lib/demo-data";
import { readyForOutreach, retentionType } from "@/lib/retention";
import type { RevenueOpportunity } from "@/lib/revenue-recovery";

export function needsReviewOpportunities(state: DemoState) {
  return readyForOutreach(state).flatMap((group) => group.opportunities);
}

export function matchesCampaign(opportunity: RevenueOpportunity, category: string, capacityIds: Set<string>) {
  if (category === "maintenance") return retentionType(opportunity) === "Due Service";
  if (category === "deferred") return retentionType(opportunity) === "Deferred Work";
  if (category === "reactivation") return opportunity.source === "REACTIVATION" || opportunity.daysOverdue >= 30 && opportunity.forecastMileageConfidence !== "LOW";
  if (category === "capacity") return capacityIds.has(opportunity.id);
  return true;
}

export function campaignReviewUrl(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const key of ["campaign", "vehicle", "opportunity", "view"]) {
    const value = params[key];
    if (typeof value === "string" && value) query.set(key, value);
  }
  return `/campaigns${query.size ? `?${query}` : ""}`;
}
