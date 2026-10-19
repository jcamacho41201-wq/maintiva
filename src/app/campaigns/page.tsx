"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { useDemoStore } from "@/lib/demo-store";
import { openCapacityOpportunityIds, retentionOpportunities, retentionType } from "@/lib/retention";
import { formatCurrency } from "@/lib/utils";

export default function CampaignsPage() {
  const { state, ready, loadError } = useDemoStore();
  const capacityIds = useMemo(() => ready && !loadError ? openCapacityOpportunityIds(state) : new Set<string>(), [state, ready, loadError]);
  if (!ready) return <p>Loading campaigns…</p>;
  if (loadError) return <p role="alert">Campaigns could not be loaded.</p>;
  const open = retentionOpportunities(state).filter((item) => ["IDENTIFIED", "CONTACTED", "RESPONDED"].includes(item.stage));
  const campaigns = [
    { name: "Upcoming Maintenance", key: "maintenance", description: "Service intervals and mileage forecasts identify the next visit.", matches: open.filter((item) => retentionType(item) === "Due Service"), settings: "/services", settingsLabel: "Configure intervals" },
    { name: "Deferred Service Recovery", key: "deferred", description: "Follow up on known recommendations that the customer deferred.", matches: open.filter((item) => retentionType(item) === "Deferred Work"), settings: "/customers", settingsLabel: "Review service history" },
    { name: "Customer Reactivation", key: "reactivation", description: "Review customers with overdue service evidence. Confirm timing with the customer before outreach.", matches: open.filter((item) => item.source === "REACTIVATION" || item.daysOverdue >= 30 && item.forecastMileageConfidence !== "LOW"), settings: "/services", settingsLabel: "Review thresholds" },
    { name: "Fill Open Capacity", key: "capacity", description: "Match due services to eligible maintenance windows with remaining capacity.", matches: open.filter((item) => capacityIds.has(item.id)), settings: "/settings/smart-maintenance-blocks", settingsLabel: "Configure blocks" },
  ];
  return <div className="space-y-6"><header><p className="text-sm font-medium text-violet-800">Retention campaigns</p><h1 className="mt-1 text-3xl font-semibold">The right reason to return.</h1><p className="mt-2 text-sm text-zinc-600">Human-reviewed worklists. No messages are sent automatically.</p></header><div className="divide-y divide-zinc-200 border-y border-zinc-200">{campaigns.map((campaign) => <section key={campaign.key} className="grid gap-4 py-6 md:grid-cols-[minmax(0,1fr)_auto]"><div><h2 className="text-lg font-semibold">{campaign.name}</h2><p className="mt-2 max-w-2xl text-sm text-zinc-600">{campaign.description}</p><p className="mt-3 text-sm font-medium">{new Set(campaign.matches.map((item) => item.customerId)).size} customers · {formatCurrency(campaign.matches.reduce((sum, item) => sum + item.estimatedRevenueCents, 0))} estimated opportunity</p><p className="mt-1 text-xs text-zinc-500">Advisor approval required</p></div><div className="flex flex-wrap items-center gap-4"><Link href={`/automation?campaign=${campaign.key}`} className="inline-flex items-center gap-2 text-sm font-semibold text-violet-900">Review opportunities <ArrowRight className="h-4 w-4" /></Link><Link href={campaign.settings} className="text-sm underline">{campaign.settingsLabel}</Link></div></section>)}<section className="py-6"><h2 className="text-lg font-semibold">Post-Service Retention</h2><p className="mt-2 text-sm text-zinc-600">A recorded service completion resets the applicable maintenance interval and starts the next forecast.</p><Link href="/visits/new" className="mt-3 inline-block text-sm font-semibold text-violet-900">Add Service Visit</Link></section></div></div>;
}
