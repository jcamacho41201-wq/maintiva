"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CalendarCheck,
  ChevronDown,
  Clock3,
  ExternalLink,
  Mail,
  MessageSquare,
  Phone,
  Send,
  SlidersHorizontal,
} from "lucide-react";
import { RecommendationModal } from "@/components/recommendation-modal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useDemoStore } from "@/lib/demo-store";
import {
  buildRevenueOpportunities,
  groupRevenueOpportunities,
  type RevenueQueueGroup,
} from "@/lib/revenue-recovery";
import { formatCurrency, formatDate } from "@/lib/utils";

type QueueTab = "NEEDS_ATTENTION" | "CONTACTED" | "BOOKED" | "CLOSED";
type QueueSort = "PRIORITY" | "REVENUE" | "LABOR" | "OLDEST_DUE" | "MOST_OVERDUE" | "RECENT";
type ReasonFilter = "ALL" | "DUE_MAINTENANCE" | "OVERDUE_MAINTENANCE" | "DECLINED_WORK";
type PriorityFilter = "ALL" | "HIGH" | "NORMAL";
type ContactFilter = "ALL" | "NEEDS_OUTREACH" | "CONTACTED" | "SNOOZED";

const workflowTabs: { value: QueueTab; label: string }[] = [
  { value: "NEEDS_ATTENTION", label: "Needs Attention" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "BOOKED", label: "Booked" },
  { value: "CLOSED", label: "Closed" },
];

function priorityVariant(priority: string) {
  if (priority === "HIGH") return "red" as const;
  return "neutral" as const;
}

function priorityLabel(priority: string) {
  return priority === "HIGH" ? "High" : "Normal";
}

function workflowTabFor(group: RevenueQueueGroup): QueueTab {
  if (group.opportunities.every((item) => item.stage === "COMPLETED" || item.stage === "LOST")) {
    return "CLOSED";
  }
  if (group.opportunities.some((item) => item.stage === "BOOKED") || group.appointmentStatus === "Booked") {
    return "BOOKED";
  }
  if (group.opportunities.some((item) => item.stage === "CONTACTED")) {
    return "CONTACTED";
  }
  return "NEEDS_ATTENTION";
}

function workflowLabel(group: RevenueQueueGroup) {
  return workflowTabs.find((tab) => tab.value === workflowTabFor(group))?.label ?? "Needs Attention";
}

function selectedRecordIds(group: RevenueQueueGroup) {
  return group.opportunities
    .map((opportunity) => opportunity.maintenanceRecordId)
    .filter((id): id is string => Boolean(id));
}

function mainReason(group: RevenueQueueGroup) {
  const source = group.opportunities.some((item) => item.source === "OVERDUE_MAINTENANCE")
    ? "Overdue"
    : group.opportunities.some((item) => item.source === "DECLINED_WORK")
      ? "Declined work"
      : "Due maintenance";
  return source;
}

function dueSummary(group: RevenueQueueGroup) {
  const due = group.opportunities.find((item) => item.dueMileage || item.dueDate);
  if (!due) return "Due details unavailable";
  const parts = [
    due.dueMileage ? `${due.dueMileage.toLocaleString()} mi` : "",
    due.dueDate ? formatDate(due.dueDate) : "",
  ].filter(Boolean);
  return parts.join(" or ");
}

export default function AutomationPage() {
  const store = useDemoStore();
  const { state, ready, loadError } = store;
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [contactMenuVehicleId, setContactMenuVehicleId] = useState<string | null>(null);
  const [tab, setTab] = useState<QueueTab>("NEEDS_ATTENTION");
  const [sort, setSort] = useState<QueueSort>("PRIORITY");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("ALL");
  const [contactFilter, setContactFilter] = useState<ContactFilter>("ALL");
  const [search, setSearch] = useState("");

  const groups = useMemo(
    () => groupRevenueOpportunities(buildRevenueOpportunities(state)),
    [state],
  );
  const counts = useMemo(
    () => Object.fromEntries(
      workflowTabs.map((item) => [
        item.value,
        groups.filter((group) => workflowTabFor(group) === item.value).length,
      ]),
    ) as Record<QueueTab, number>,
    [groups],
  );
  const filteredGroups = groups.filter((group) => {
    const query = search.trim().toLowerCase();
    if (workflowTabFor(group) !== tab) return false;
    if (reasonFilter !== "ALL" && !group.opportunities.some((item) => item.source === reasonFilter)) return false;
    if (priorityFilter === "HIGH" && group.priority !== "HIGH") return false;
    if (priorityFilter === "NORMAL" && group.priority === "HIGH") return false;
    if (contactFilter === "NEEDS_OUTREACH" && group.outreachStatus !== "Needs outreach") return false;
    if (contactFilter === "CONTACTED" && !group.opportunities.some((item) => ["CONTACTED", "RESPONDED"].includes(item.stage))) return false;
    if (contactFilter === "SNOOZED" && !group.opportunities.some((item) => item.outreachStatus === "SNOOZED")) return false;
    if (query) {
      const searchable = [
        group.customerName,
        group.vehicleLabel,
        ...group.recommendedServices,
      ].join(" ").toLowerCase();
      if (!searchable.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => {
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    if (sort === "REVENUE") return b.estimatedRevenueCents - a.estimatedRevenueCents;
    if (sort === "LABOR") return b.estimatedLaborHours - a.estimatedLaborHours;
    if (sort === "OLDEST_DUE") return a.opportunities[0].daysOverdue - b.opportunities[0].daysOverdue;
    if (sort === "MOST_OVERDUE") {
      return Math.max(...b.opportunities.map((item) => item.daysOverdue)) -
        Math.max(...a.opportunities.map((item) => item.daysOverdue));
    }
    if (sort === "RECENT") {
      return new Date(b.lastContactedAt ?? 0).getTime() - new Date(a.lastContactedAt ?? 0).getTime();
    }
    return rank[a.priority] - rank[b.priority] || b.estimatedRevenueCents - a.estimatedRevenueCents;
  });
  const selected = groups.find((group) => group.vehicleId === selectedVehicleId);
  const selectedRecords = selected
    ? state.maintenanceRecords.filter((record) => selectedRecordIds(selected).includes(record.id))
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Revenue Recovery Queue</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Live maintenance and declined-work opportunities grouped by customer vehicle.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as QueueSort)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold outline-none focus:border-violet-500"
          >
            <option value="PRIORITY">Sort by priority</option>
            <option value="REVENUE">Sort by estimated revenue</option>
            <option value="LABOR">Sort by labor hours</option>
            <option value="OLDEST_DUE">Sort by oldest due date</option>
            <option value="MOST_OVERDUE">Sort by most overdue</option>
            <option value="RECENT">Sort by recent activity</option>
          </select>
          <button
            onClick={() => setAdvancedOpen((open) => !open)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Advanced Filters
            <ChevronDown className={`h-4 w-4 transition ${advancedOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {workflowTabs.map((item) => (
          <button
            key={item.value}
            onClick={() => setTab(item.value)}
            className={`flex min-h-12 items-center justify-between rounded-lg border px-4 py-3 text-left text-sm font-semibold ${
              tab === item.value
                ? "border-violet-950 bg-violet-950 text-white"
                : "border-zinc-200 bg-white text-zinc-700"
            }`}
          >
            <span>{item.label}</span>
            <span className={tab === item.value ? "text-violet-100" : "text-zinc-400"}>{counts[item.value]}</span>
          </button>
        ))}
      </div>

      {advancedOpen && (
        <div className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Customer, vehicle, or service"
            className="h-10 rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:border-violet-500"
          />
          <select
            value={reasonFilter}
            onChange={(event) => setReasonFilter(event.target.value as ReasonFilter)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-violet-500"
          >
            <option value="ALL">Any reason</option>
            <option value="DUE_MAINTENANCE">Due maintenance</option>
            <option value="OVERDUE_MAINTENANCE">Overdue</option>
            <option value="DECLINED_WORK">Declined work</option>
          </select>
          <select
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-violet-500"
          >
            <option value="ALL">Any priority</option>
            <option value="HIGH">High</option>
            <option value="NORMAL">Normal</option>
          </select>
          <select
            value={contactFilter}
            onChange={(event) => setContactFilter(event.target.value as ContactFilter)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-violet-500"
          >
            <option value="ALL">Any contact state</option>
            <option value="NEEDS_OUTREACH">Needs outreach</option>
            <option value="CONTACTED">Contacted or responded</option>
            <option value="SNOOZED">Snoozed</option>
          </select>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {!ready && (
          <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm font-medium text-zinc-600 xl:col-span-2">
            Loading revenue opportunities…
          </div>
        )}
        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800 xl:col-span-2">
            <p className="font-semibold">Revenue opportunities could not be loaded.</p>
          </div>
        )}
        {ready && !loadError && filteredGroups.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-600 xl:col-span-2">
            <p className="font-semibold text-zinc-900">No customers currently need outreach.</p>
            <p className="mt-1">
              Maintiva will add customers here when maintenance becomes due, overdue, or previously recommended work is declined.
            </p>
          </div>
        )}
        {ready && !loadError && filteredGroups.map((group) => {
          const lastContact = group.lastContactedAt;
          const canRecommend = selectedRecordIds(group).length > 0;
          const contactMenuOpen = contactMenuVehicleId === group.vehicleId;
          return (
            <Card key={group.id} className="shadow-none">
              <CardContent className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link href={`/customers/${group.customerId}`} className="text-lg font-semibold hover:text-violet-900">
                      {group.customerName}
                    </Link>
                    <Link href={`/vehicles/${group.vehicleId}`} className="block truncate text-sm text-zinc-500 hover:text-violet-900">
                      {group.vehicleLabel}
                    </Link>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Badge variant={priorityVariant(group.priority)}>{priorityLabel(group.priority)}</Badge>
                    <Badge variant="neutral">{workflowLabel(group)}</Badge>
                  </div>
                </div>

                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reason</p>
                    <p className="mt-1 font-semibold">{mainReason(group)}</p>
                    <p className="mt-1 text-zinc-600">{dueSummary(group)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Action</p>
                    <p className="mt-1 font-semibold">{group.nextAction}</p>
                    <p className="mt-1 text-zinc-600">{lastContact ? `Last touch ${formatDate(lastContact)}` : "No prior contact logged"}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {group.opportunities.slice(0, 4).map((opportunity) => (
                    <div key={opportunity.id} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{opportunity.serviceNames.join(", ")}</p>
                          <p className="mt-1 text-xs text-zinc-500">{opportunity.explanation}</p>
                        </div>
                        <Badge variant={opportunity.source === "OVERDUE_MAINTENANCE" ? "red" : "purple"}>
                          {opportunity.sourceLabel}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <p className="text-zinc-500">Value</p>
                    <p className="font-semibold">{formatCurrency(group.estimatedRevenueCents)}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <p className="text-zinc-500">Labor</p>
                    <p className="font-semibold">{group.estimatedLaborHours} hr</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <p className="text-zinc-500">Services</p>
                    <p className="font-semibold">{group.recommendedServices.length}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link
                    href={`/customers/${group.customerId}`}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open customer
                  </Link>
                  <div className="relative flex flex-wrap gap-2">
                    <button
                      onClick={() => setContactMenuVehicleId(contactMenuOpen ? null : group.vehicleId)}
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700"
                    >
                      <Phone className="h-4 w-4" />
                      Contact
                    </button>
                    {contactMenuOpen && (
                      <div className="absolute bottom-12 right-0 z-10 w-56 rounded-lg border border-zinc-200 bg-white p-2 text-sm shadow-lg">
                        <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-zinc-50">
                          <Phone className="h-4 w-4" />
                          Record call
                        </button>
                        <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-zinc-50">
                          <Mail className="h-4 w-4" />
                          Record email
                        </button>
                        <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-zinc-50">
                          <MessageSquare className="h-4 w-4" />
                          Record text
                        </button>
                        <button
                          onClick={() => canRecommend && setSelectedVehicleId(group.vehicleId)}
                          disabled={!canRecommend}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Send className="h-4 w-4" />
                          Generate message
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => canRecommend && setSelectedVehicleId(group.vehicleId)}
                      disabled={!canRecommend || workflowTabFor(group) === "BOOKED"}
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-950 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CalendarCheck className="h-4 w-4" />
                      Book
                    </button>
                    <button
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700"
                      title="Snooze follow-up"
                    >
                      <Clock3 className="h-4 w-4" />
                      Snooze
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {selected && selectedRecords.length > 0 && (
        <RecommendationModal
          customer={state.customers.find((customer) => customer.id === selected.customerId)!}
          vehicle={state.vehicles.find((vehicle) => vehicle.id === selected.vehicleId)!}
          records={selectedRecords}
          onClose={() => setSelectedVehicleId(null)}
          onSendRecommendation={store.sendRecommendation}
          onBookAppointment={store.bookAppointment}
        />
      )}
    </div>
  );
}
