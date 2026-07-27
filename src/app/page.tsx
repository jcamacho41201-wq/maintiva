"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Bot, CalendarClock, Car, DollarSign, Users, Wrench } from "lucide-react";
import { RevenueForecastChart } from "@/components/charts/revenue-forecast-chart";
import { RecommendationModal } from "@/components/recommendation-modal";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useDemoStore } from "@/lib/demo-store";
import {
  buildForecast,
  getDashboardMetrics,
  getRecordStatus,
  getVehicleOpportunities,
  vehicleLabel,
} from "@/lib/demo-calculations";
import { type VehicleMaintenanceRecord } from "@/lib/demo-data";
import { formatCurrency } from "@/lib/utils";

function opportunityLabel(status: string) {
  return status.replace("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

export default function DashboardPage() {
  const router = useRouter();
  const store = useDemoStore();
  const { state } = store;
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const metrics = getDashboardMetrics(state);
  const opportunities = getVehicleOpportunities(state);
  const selectedOpportunity = opportunities.find(
    (opportunity) => opportunity.vehicle?.id === selectedVehicleId,
  );

  const stats = [
    { label: "Active customers", value: metrics.activeCustomers, icon: Users },
    { label: "Active vehicles", value: metrics.activeVehicles, icon: Car },
    { label: "Maintenance opportunities", value: metrics.maintenanceOpportunities, icon: Wrench },
    { label: "Ready for outreach", value: metrics.readyForOutreach, icon: Bot },
    { label: "Appointments today", value: metrics.appointmentsToday, icon: CalendarClock },
    { label: "Scheduled revenue", value: formatCurrency(metrics.scheduledRevenue), icon: DollarSign },
    { label: "Predicted revenue", value: formatCurrency(metrics.predictedRevenue), icon: DollarSign },
    { label: "Open bay capacity", value: `${metrics.openBayCapacityHours} hrs`, icon: CalendarClock },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-violet-700">
            Predict Maintenance. Drive Revenue.
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Today&apos;s maintenance command center
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Predictive maintenance, automated customer retention, and intelligent shop management for modern repair shops.
          </p>
        </div>
        <Link
          href="/automation"
          className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Work outreach queue
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Predictive Maintenance Queue</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Bundled opportunities ranked by earliest due service, revenue, and labor time.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {opportunities.map((opportunity) => {
              const customer = opportunity.customer;
              const vehicle = opportunity.vehicle;
              if (!customer || !vehicle) return null;

              return (
                <div
                  key={opportunity.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/vehicles/${vehicle.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") router.push(`/vehicles/${vehicle.id}`);
                  }}
                  className="grid cursor-pointer gap-4 rounded-lg border border-zinc-200 p-4 transition hover:border-violet-300 hover:bg-violet-50/40 lg:grid-cols-[1.2fr_1fr_auto]"
                >
                  <div>
                    <p className="font-semibold">{customer.firstName} {customer.lastName}</p>
                    <p className="text-sm text-zinc-500">{vehicleLabel(vehicle)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant={opportunity.urgency <= 0 ? "red" : "orange"}>
                        {opportunity.records.length} services recommended
                      </Badge>
                      <Badge variant={statusVariant(opportunity.opportunityStatus)}>
                        {opportunityLabel(opportunity.opportunityStatus)}
                      </Badge>
                      <Badge variant="purple">{formatCurrency(opportunity.totalPriceCents)}</Badge>
                      <Badge>{opportunity.recommendedHours} hr</Badge>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {opportunity.records.slice(0, 3).map((record: VehicleMaintenanceRecord) => {
                      const status = getRecordStatus(state, record);
                      return (
                        <div key={record.id}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span>{record.serviceName}</span>
                            <span>{status.dueText}</span>
                          </div>
                          <Progress value={status.lifeRemaining} />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-end">
                    {opportunity.opportunityStatus === "SCHEDULED" ? (
                      <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                        Scheduled
                      </span>
                    ) : (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedVehicleId(vehicle.id);
                        }}
                        className="rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white"
                      >
                        Recommend appointment
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
            <h2 className="text-lg font-semibold">Upcoming Appointments</h2>
            <p className="mt-1 text-sm text-zinc-500">
              One consolidated appointment per vehicle.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {state.appointments.length === 0 && (
              <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500">
                No appointments scheduled yet.
              </p>
            )}
            {state.appointments.map((appointment) => {
              const customer = state.customers.find((item) => item.id === appointment.customerId);
              const vehicle = state.vehicles.find((item) => item.id === appointment.vehicleId);
              if (!customer || !vehicle) return null;
              return (
                <Link
                  key={appointment.id}
                  href="/appointments"
                  className="block rounded-lg border border-zinc-200 p-4 transition hover:border-violet-300 hover:bg-violet-50/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {new Intl.DateTimeFormat("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(appointment.scheduledStart))}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {customer.firstName} {customer.lastName}
                      </p>
                      <p className="text-sm text-zinc-500">{vehicleLabel(vehicle)}</p>
                    </div>
                    <Badge variant={statusVariant(appointment.status)}>
                      {appointment.status}
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-zinc-500">Services</p>
                      <p className="font-semibold">{appointment.serviceNames.length}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Revenue</p>
                      <p className="font-semibold">{formatCurrency(appointment.totalPriceCents)}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Labor</p>
                      <p className="font-semibold">{appointment.totalLaborHours} hr</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-zinc-600">
                    {appointment.serviceNames[0]}
                    {appointment.serviceNames.length > 1 ? ` + ${appointment.serviceNames.length - 1} more` : ""}
                  </p>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Revenue Forecast</h2>
          </CardHeader>
          <CardContent>
            <RevenueForecastChart forecast={buildForecast(state)} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Automation Performance</h2>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {[
              ["Messages sent", state.outreachRecords.length],
              ["Customers contacted", new Set(state.outreachRecords.map((item) => item.customerId)).size],
              ["Response rate", "31%"],
              ["Appointments booked", state.appointments.length],
              ["Attributed revenue", formatCurrency(metrics.scheduledRevenue)],
              ["Duplicate sends blocked", opportunities.filter((item) => item.opportunityStatus === "SCHEDULED").length],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 p-4">
                <p className="text-sm text-zinc-500">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {selectedOpportunity?.customer && selectedOpportunity.vehicle && (
        <RecommendationModal
          customer={selectedOpportunity.customer}
          vehicle={selectedOpportunity.vehicle}
          records={selectedOpportunity.records}
          onClose={() => setSelectedVehicleId(null)}
          onSendRecommendation={store.sendRecommendation}
          onBookAppointment={store.bookAppointment}
        />
      )}
    </div>
  );
}
