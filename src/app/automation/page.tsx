"use client";

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

function priorityVariant(priority: string) {
  if (priority === "HIGH") return "red" as const;
  if (priority === "MEDIUM") return "orange" as const;
  return "neutral" as const;
}

function selectedRecordIds(group: RevenueQueueGroup) {
  return group.opportunities
    .map((opportunity) => opportunity.id.replace(/^opp-/, ""))
    .filter((id) => !id.startsWith("declined-"));
}

export default function AutomationPage() {
  const store = useDemoStore();
  const { state } = store;
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "HIGH" | "UNCONTACTED" | "BOOKED">("ALL");
  const groups = useMemo(
    () => groupRevenueOpportunities(buildRevenueOpportunities(state)),
    [state],
  );
  const filteredGroups = groups.filter((group) => {
    if (filter === "HIGH") return group.priority === "HIGH";
    if (filter === "UNCONTACTED") return group.outreachStatus === "Needs outreach";
    if (filter === "BOOKED") return group.appointmentStatus === "Booked";
    return true;
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
        <div className="flex flex-wrap gap-2">
          {[
            ["ALL", "All"],
            ["HIGH", "High priority"],
            ["UNCONTACTED", "Needs outreach"],
            ["BOOKED", "Booked"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value as typeof filter)}
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
          {filteredGroups.map((group) => {
            const lastContact = group.lastContactedAt;
            const canRecommend = selectedRecordIds(group).length > 0;
            return (
              <Card key={group.id} className="shadow-none">
                <CardContent className="space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">{group.customerName}</h2>
                      <p className="text-sm text-zinc-500">{group.vehicleLabel}</p>
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
