"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useDemoStore } from "@/lib/demo-store";
import { getCapacitySummary } from "@/lib/revenue-recovery";
import { formatCurrency } from "@/lib/utils";

export default function CapacityPage() {
  const { state } = useDemoStore();
  const [windowDays, setWindowDays] = useState<7 | 14 | 30>(14);
  const capacity = getCapacitySummary(state, windowDays);
  const utilization = Math.round((capacity.bookedLaborHours / capacity.totalAvailableLaborHours) * 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Capacity Planning</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Match open bay hours with maintenance and declined-work opportunities that can become scheduled revenue.
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30].map((days) => (
            <button
              key={days}
              onClick={() => setWindowDays(days as 7 | 14 | 30)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                windowDays === days
                  ? "border-violet-950 bg-violet-950 text-white"
                  : "border-zinc-200 bg-white text-zinc-700"
              }`}
            >
              {days} days
            </button>
          ))}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["Available labor", `${capacity.totalAvailableLaborHours} hrs`],
          ["Booked labor", `${capacity.bookedLaborHours} hrs`],
          ["Open capacity", `${capacity.openLaborHours} hrs`],
          ["Scheduled revenue", formatCurrency(capacity.scheduledRevenue)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent>
              <p className="text-sm text-zinc-500">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Utilization</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {capacity.matchingOpportunityCount} open opportunities can fill {Math.round(capacity.potentialLaborHours)} labor hours.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={utilization} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm text-zinc-500">Current utilization</p>
              <p className="mt-1 text-xl font-semibold">{utilization}%</p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm text-zinc-500">Revenue needed to fill</p>
              <p className="mt-1 text-xl font-semibold">{formatCurrency(capacity.estimatedRevenueNeeded)}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm text-zinc-500">Potential labor match</p>
              <p className="mt-1 text-xl font-semibold">{Math.round(capacity.potentialLaborHours)} hrs</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Capacity-Filling Opportunities</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          {capacity.matchingOpportunities.slice(0, 12).map((opportunity) => (
            <div key={opportunity.id} className="grid gap-3 rounded-lg border border-zinc-200 p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
              <div>
                <p className="font-semibold">{opportunity.customerName}</p>
                <p className="text-sm text-zinc-500">{opportunity.vehicleLabel} · {opportunity.serviceNames.join(", ")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={opportunity.priority === "HIGH" ? "red" : opportunity.priority === "MEDIUM" ? "orange" : "neutral"}>
                  {opportunity.priority}
                </Badge>
                <Badge variant="purple">{formatCurrency(opportunity.estimatedRevenueCents)}</Badge>
                <Badge>{opportunity.estimatedLaborHours} hr</Badge>
              </div>
              <Link href="/automation" className="inline-flex items-center justify-end gap-2 text-sm font-semibold text-violet-900">
                Queue
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ))}
          {capacity.matchingOpportunities.length === 0 && (
            <div className="rounded-lg border border-zinc-200 p-6 text-sm text-zinc-500">
              No open opportunities fit this window.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm font-medium text-violet-800">
        <CalendarClock className="mr-2 inline h-4 w-4" />
        Capacity planning uses shop-level daily bay hours from settings and scheduled appointment labor.
      </div>
    </div>
  );
}
