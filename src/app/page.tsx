"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Bot, CalendarClock, Car, DollarSign, FileUp, Users, Wrench } from "lucide-react";
import { ContactCustomerModal } from "@/components/contact-customer-modal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { canContactCustomerForDraft } from "@/lib/contact-workflow";
import { useDemoStore } from "@/lib/demo-store";
import { isCustomerBookingEnabled } from "@/lib/feature-flags";
import {
  getDashboardMetrics,
} from "@/lib/demo-calculations";
import {
  getCapacitySummary,
  getRevenueFunnel,
  getRevenueRecoveryMetrics,
  groupRevenueOpportunities,
  buildRevenueOpportunities,
  opportunityTimingLabel,
} from "@/lib/revenue-recovery";
import { formatCurrency, formatLaborHours } from "@/lib/utils";

export default function DashboardPage() {
  const router = useRouter();
  const store = useDemoStore();
  const { state, ready, loadError } = store;
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  if (!ready) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm font-medium text-zinc-600">
        Loading shop…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        <p className="font-semibold">We could not load your shop.</p>
        <p className="mt-1">Refresh the page or sign in again.</p>
      </div>
    );
  }

  const legacyMetrics = getDashboardMetrics(state);
  const metrics = getRevenueRecoveryMetrics(state);
  const opportunities = groupRevenueOpportunities(buildRevenueOpportunities(state));
  const funnel = getRevenueFunnel(state);
  const capacity14 = getCapacitySummary(state, 14);
  const secondaryStats = [
    { label: "Active customers", value: legacyMetrics.activeCustomers, icon: Users },
    { label: "Active vehicles", value: legacyMetrics.activeVehicles, icon: Car },
    { label: "Recoverable opportunities", value: metrics.openOpportunityCount, icon: Wrench },
    { label: "Customers contacted", value: metrics.contactedCount, icon: Bot },
  ];
  const selectedOpportunity = opportunities.find(
    (opportunity) => opportunity.vehicleId === selectedVehicleId,
  );
  const selectedCustomer = selectedOpportunity
    ? state.customers.find((item) => item.id === selectedOpportunity.customerId)
    : undefined;
  const selectedVehicle = selectedOpportunity
    ? state.vehicles.find((item) => item.id === selectedOpportunity.vehicleId)
    : undefined;
  const selectedRecords = selectedOpportunity
    ? state.maintenanceRecords.filter((record) =>
        selectedOpportunity.opportunities.some((item) => item.maintenanceRecordId === record.id),
      )
    : [];

  const stats = [
    { label: "Recovered revenue this month", value: formatCurrency(metrics.recoveredRevenueThisMonth), icon: DollarSign },
    { label: "Maintiva revenue booked", value: formatCurrency(metrics.bookedMaintivaRevenue), icon: CalendarClock },
    { label: "Open opportunity value", value: formatCurrency(metrics.openOpportunityValue), icon: Wrench },
    { label: "Unfilled labor hours, next 14 days", value: `${capacity14.openLaborHours} hrs`, icon: CalendarClock },
    { label: "Appointments booked through Maintiva", value: metrics.appointmentsBookedThroughMaintiva, icon: Bot },
    { label: "Outreach-to-booking conversion", value: `${metrics.outreachToBookingConversionRate}%`, icon: Users },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-violet-700">
            Maintenance Revenue Recovery
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Revenue recovery command center
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Maintiva turns existing customer and service data into scheduled maintenance revenue.
          </p>
        </div>
        <Link
          href="/automation"
          className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Work recovery queue
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-zinc-500">{stat.label}</p>
                  <p className="mt-2 text-2xl font-semibold">{stat.value}</p>
                </div>
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-violet-50 text-violet-900">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {secondaryStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label}>
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-zinc-500">{stat.label}</p>
                  <p className="mt-2 text-xl font-semibold">{stat.value}</p>
                </div>
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-violet-50 text-violet-900">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Revenue Recovery Queue</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Due maintenance, overdue maintenance, and declined work grouped by vehicle.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {opportunities.map((opportunity) => {
              const customer = state.customers.find((item) => item.id === opportunity.customerId);
              const contactEligibility = customer
                ? canContactCustomerForDraft(customer)
                : { enabled: false, reason: "Customer record is not available." };
              return (
                <div
                  key={opportunity.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/vehicles/${opportunity.vehicleId}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") router.push(`/vehicles/${opportunity.vehicleId}`);
                  }}
                  className="grid cursor-pointer gap-4 rounded-lg border border-zinc-200 p-4 transition hover:border-violet-300 hover:bg-violet-50/40 2xl:grid-cols-[minmax(15rem,1.1fr)_minmax(16rem,1fr)_auto]"
                >
                  <div>
                    <p className="font-semibold">{opportunity.customerName}</p>
                    <p className="text-sm text-zinc-500">{opportunity.vehicleLabel}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant={opportunity.priority === "HIGH" ? "red" : opportunity.priority === "MEDIUM" ? "orange" : "neutral"}>
                        {opportunity.priority.toLowerCase()} priority
                      </Badge>
                      {opportunity.sources.map((source) => <Badge key={source} variant="purple">{source}</Badge>)}
                      <Badge>{opportunity.outreachStatus}</Badge>
                      <Badge variant="purple">{formatCurrency(opportunity.estimatedRevenueCents)}</Badge>
                      <Badge>{formatLaborHours(opportunity.estimatedLaborHours)}</Badge>
                    </div>
                    <p className="mt-3 text-sm text-zinc-600">{opportunity.explanation}</p>
                    <p className="mt-1 text-xs font-medium text-zinc-500">{opportunity.priorityReason}</p>
                  </div>
                  <div className="space-y-2">
                    {opportunity.opportunities.slice(0, 3).map((item) => (
                      <div key={item.id}>
                        <div className="mb-1 grid grid-cols-[minmax(0,1fr)_max-content] items-start gap-3 text-xs">
                          <span className="min-w-0 leading-snug">{item.serviceNames.join(", ")}</span>
                          <span className="max-w-36 text-right leading-snug">{opportunityTimingLabel(item)}</span>
                        </div>
                        <Progress value={item.priority === "HIGH" ? 12 : item.priority === "MEDIUM" ? 38 : 70} />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-end">
                    {opportunity.appointmentStatus === "Booked" ? (
                      <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                        Scheduled
                      </span>
                    ) : (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          if (contactEligibility.enabled) setSelectedVehicleId(opportunity.vehicleId);
                        }}
                        disabled={!contactEligibility.enabled}
                        title={contactEligibility.reason ?? "Contact customer"}
                        className="rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Contact
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Capacity Summary</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Next 7, 14, and 30 days of shop-level labor capacity.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {[7, 14, 30].map((days) => {
              const capacity = getCapacitySummary(state, days as 7 | 14 | 30);
              return (
                <Link key={days} href="/capacity" className="block rounded-lg border border-zinc-200 p-4 transition hover:border-violet-300 hover:bg-violet-50/40">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">Next {days} days</p>
                    <Badge variant="purple">{capacity.openLaborHours} open hrs</Badge>
                  </div>
                  <p className="mt-2 text-sm text-zinc-600">
                    {capacity.matchingOpportunityCount} matching opportunities can fill {Math.round(capacity.potentialLaborHours)} labor hrs.
                  </p>
                </Link>
              );
            })}
            <p className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm font-medium text-violet-800">
              Wednesday has 11 open labor hours. Maintiva found {capacity14.matchingOpportunityCount} matching opportunities.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Revenue Funnel</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            {funnel.map((item) => (
              <div key={item.stage} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
                <span className="font-medium">{item.label}</span>
                <Progress value={Math.min(100, item.count * 18)} />
                <span className="text-right font-semibold">{item.count} · {formatCurrency(item.valueCents)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Import and ROI</h2>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {[
              ["Imported files", state.importHistory.length],
              ["Rows imported", state.importHistory.reduce((sum, item) => sum + item.successfulRows, 0)],
              ["Open value", formatCurrency(metrics.openOpportunityValue)],
              ["Completed revenue", formatCurrency(metrics.completedMaintivaRevenue)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 p-4">
                <p className="text-sm text-zinc-500">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{value}</p>
              </div>
            ))}
            <Link href="/import" className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">
              <FileUp className="h-4 w-4" />
              Import data
            </Link>
          </CardContent>
        </Card>
      </div>

      {selectedOpportunity && selectedCustomer && selectedVehicle && (
        <ContactCustomerModal
          group={selectedOpportunity}
          customer={selectedCustomer}
          vehicle={selectedVehicle}
          shop={state.shop}
          records={selectedRecords}
          onClose={() => setSelectedVehicleId(null)}
          onBook={() => router.push("/automation")}
          onSave={store.recordOpportunityContact}
          onCreateBookingLink={store.createBookingLink}
          customerBookingEnabled={isCustomerBookingEnabled()}
        />
      )}
    </div>
  );
}
