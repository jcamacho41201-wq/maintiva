"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarCheck, Clock3, Mail, MessageSquare, Phone, Send } from "lucide-react";
import { RecommendationModal } from "@/components/recommendation-modal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useDemoStore } from "@/lib/demo-store";
import {
  buildRevenueOpportunities,
  groupRevenueOpportunities,
  type RevenueQueueGroup,
} from "@/lib/revenue-recovery";
import { formatCurrency, formatDate } from "@/lib/utils";

type QueueFilter =
  | "ALL"
  | "HIGH"
  | "DUE"
  | "OVERDUE"
  | "DECLINED_WORK"
  | "NEEDS_OUTREACH"
  | "CONTACTED"
  | "RESPONDED"
  | "BOOKED"
  | "COMPLETED"
  | "DECLINED"
  | "SNOOZED";

type QueueSort = "PRIORITY" | "REVENUE" | "LABOR" | "OLDEST_DUE" | "MOST_OVERDUE" | "RECENT";

function priorityVariant(priority: string) {
  if (priority === "HIGH") return "red" as const;
  if (priority === "MEDIUM") return "orange" as const;
  return "neutral" as const;
}

function selectedRecordIds(group: RevenueQueueGroup) {
  return group.opportunities
    .map((opportunity) => opportunity.maintenanceRecordId)
    .filter((id): id is string => Boolean(id));
}

export default function AutomationPage() {
  const store = useDemoStore();
  const { state, ready, loadError } = store;
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("ALL");
  const [sort, setSort] = useState<QueueSort>("PRIORITY");
  const groups = useMemo(
    () => groupRevenueOpportunities(buildRevenueOpportunities(state)),
    [state],
  );
  const filteredGroups = groups.filter((group) => {
    if (filter === "HIGH") return group.priority === "HIGH";
    if (filter === "DUE") return group.opportunities.some((item) => item.source === "DUE_MAINTENANCE");
    if (filter === "OVERDUE") return group.opportunities.some((item) => item.source === "OVERDUE_MAINTENANCE");
    if (filter === "DECLINED_WORK") return group.opportunities.some((item) => item.source === "DECLINED_WORK");
    if (filter === "NEEDS_OUTREACH") return group.outreachStatus === "Needs outreach";
    if (filter === "CONTACTED") return group.opportunities.some((item) => item.stage === "CONTACTED");
    if (filter === "RESPONDED") return group.opportunities.some((item) => item.stage === "RESPONDED");
    if (filter === "BOOKED") return group.appointmentStatus === "Booked";
    if (filter === "COMPLETED") return group.opportunities.some((item) => item.stage === "COMPLETED");
    if (filter === "DECLINED") return group.opportunities.some((item) => item.stage === "LOST");
    if (filter === "SNOOZED") return group.opportunities.some((item) => item.outreachStatus === "SNOOZED");
    return true;
  }).sort((a, b) => {
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    if (sort === "REVENUE") return b.estimatedRevenueCents - a.estimatedRevenueCents;
    if (sort === "LABOR") return b.estimatedLaborHours - a.estimatedLaborHours;
    if (sort === "OLDEST_DUE") return a.opportunities[0].daysOverdue - b.opportunities[0].daysOverdue;
    if (sort === "MOST_OVERDUE") {
      return Math.max(...b.opportunities.map((item) => item.daysOverdue)) - Math.max(...a.opportunities.map((item) => item.daysOverdue));
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Revenue Recovery Queue</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Prioritized maintenance and declined-work opportunities grouped by vehicle for advisor follow-up.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
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
            <option value="RECENT">Sort by most recently imported/contacted</option>
          </select>
          {[
            ["ALL", "All"],
            ["HIGH", "High priority"],
            ["DUE", "Due maintenance"],
            ["OVERDUE", "Overdue"],
            ["DECLINED_WORK", "Declined work"],
            ["NEEDS_OUTREACH", "Needs outreach"],
            ["CONTACTED", "Contacted"],
            ["RESPONDED", "Responded"],
            ["BOOKED", "Booked"],
            ["COMPLETED", "Completed"],
            ["DECLINED", "Declined"],
            ["SNOOZED", "Snoozed"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value as QueueFilter)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                filter === value
                  ? "border-violet-950 bg-violet-950 text-white"
                  : "border-zinc-200 bg-white text-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-wrap gap-2">
          {[
            "Declined work",
            "Due maintenance",
            "Overdue",
            "No response",
            "Record callback",
            "Snooze",
            "Appointment attribution",
          ].map((item) => (
            <Badge key={item} variant="neutral">{item}</Badge>
          ))}
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          {!ready && (
            <div className="rounded-lg border border-zinc-200 p-6 text-sm font-medium text-zinc-600 xl:col-span-2">
              Loading revenue opportunities…
            </div>
          )}
          {loadError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800 xl:col-span-2">
              <p className="font-semibold">Revenue opportunities could not be loaded.</p>
              <p className="mt-1">Refresh the page or try again after the shop data connection is restored.</p>
            </div>
          )}
          {ready && !loadError && filteredGroups.length === 0 && (
            <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 xl:col-span-2">
              <p className="font-semibold text-zinc-900">No open revenue opportunities yet.</p>
              <p className="mt-1">
                Opportunities are created from real declined-work records and due or overdue vehicle maintenance records.
              </p>
            </div>
          )}
          {filteredGroups.map((group) => {
            const lastContact = group.lastContactedAt;
            const canRecommend = selectedRecordIds(group).length > 0;
            return (
              <Card key={group.id} className="shadow-none">
                <CardContent className="space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/customers/${group.customerId}`} className="text-lg font-semibold hover:text-violet-900">
                        {group.customerName}
                      </Link>
                      <Link href={`/vehicles/${group.vehicleId}`} className="block text-sm text-zinc-500 hover:text-violet-900">
                        {group.vehicleLabel}
                      </Link>
                    </div>
                    <Badge variant={priorityVariant(group.priority)}>
                      {group.priority.toLowerCase()} priority
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {group.sources.map((source) => <Badge key={source} variant="purple">{source}</Badge>)}
                    <Badge>{group.outreachStatus}</Badge>
                    <Badge>{group.nextAction}</Badge>
                  </div>

                  <div className="space-y-2">
                    {group.opportunities.slice(0, 4).map((opportunity) => (
                      <div key={opportunity.id} className="space-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span>{opportunity.serviceNames.join(", ")}</span>
                          <span className="font-semibold">{formatCurrency(opportunity.estimatedRevenueCents)}</span>
                        </div>
                        <Progress value={opportunity.priority === "HIGH" ? 14 : opportunity.priority === "MEDIUM" ? 44 : 72} />
                        <p className="text-xs text-zinc-500">{opportunity.explanation}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <p className="text-zinc-500">Value</p>
                      <p className="font-semibold">{formatCurrency(group.estimatedRevenueCents)}</p>
                    </div>
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <p className="text-zinc-500">Labor</p>
                      <p className="font-semibold">{group.estimatedLaborHours} hr</p>
                    </div>
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <p className="text-zinc-500">Last touch</p>
                      <p className="font-semibold">{lastContact ? formatDate(lastContact) : "Never"}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-zinc-500">{group.priorityReason}</p>
                    <div className="flex flex-wrap gap-2">
                      <button className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200" title="Manual text draft">
                        <MessageSquare className="h-4 w-4" />
                      </button>
                      <button className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200" title="Manual email draft">
                        <Mail className="h-4 w-4" />
                      </button>
                      <button className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200" title="Call note">
                        <Phone className="h-4 w-4" />
                      </button>
                      <button className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200" title="Snooze follow-up">
                        <Clock3 className="h-4 w-4" />
                      </button>
                      {group.appointmentStatus === "Booked" ? (
                        <a href="/appointments" className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white">
                          <CalendarCheck className="h-4 w-4" />
                          View appointment
                        </a>
                      ) : (
                        <button
                          onClick={() => canRecommend && setSelectedVehicleId(group.vehicleId)}
                          disabled={!canRecommend}
                          className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Send className="h-4 w-4" />
                          Generate message
                        </button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </CardContent>
      </Card>

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
