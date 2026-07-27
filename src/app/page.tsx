import Link from "next/link";
import { ArrowRight, Bot, CalendarClock, Car, DollarSign, Users, Wrench } from "lucide-react";
import { RevenueForecastChart } from "@/components/charts/revenue-forecast-chart";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  appointments,
  customerLookup,
  customers,
  maintenanceItems,
  revenueForecast,
  vehicleLookup,
  vehicles,
} from "@/lib/demo-data";
import { groupAutomationItems } from "@/lib/automation";
import { formatCurrency, formatHours } from "@/lib/utils";

const automationGroups = groupAutomationItems(
  maintenanceItems.map((item) => ({
    id: item.id,
    name: item.serviceName,
    customerId: item.customerId,
    vehicleId: item.vehicleId,
    remainingLife: item.finalLife,
    threshold: item.notificationThreshold,
    estimatedRevenueCents: item.estimatedPriceCents,
    estimatedLaborMinutes: item.estimatedLaborMinutes,
    status: item.status as "HEALTHY" | "DUE_SOON" | "OVERDUE",
  })),
  customerLookup,
  vehicleLookup,
);

const scheduledRevenue = appointments.reduce(
  (sum, appointment) => sum + appointment.estimatedRevenueCents,
  0,
);
const predictedRevenue = revenueForecast[1].predicted;
const dueServices = maintenanceItems.filter((item) => item.status !== "HEALTHY");
const todayAppointments = appointments.filter((appointment) =>
  appointment.scheduledStart.startsWith("2026-07-27"),
);

const stats = [
  { label: "Active customers", value: customers.filter((item) => item.status === "ACTIVE").length, icon: Users },
  { label: "Active vehicles", value: vehicles.length, icon: Car },
  { label: "Maintenance opportunities", value: dueServices.length, icon: Wrench },
  { label: "Ready for outreach", value: automationGroups.length, icon: Bot },
  { label: "Appointments today", value: todayAppointments.length, icon: CalendarClock },
  { label: "Scheduled revenue", value: formatCurrency(scheduledRevenue), icon: DollarSign },
  { label: "Predicted revenue", value: formatCurrency(predictedRevenue), icon: DollarSign },
  { label: "Open bay capacity", value: "41 hrs", icon: CalendarClock },
];

export default function DashboardPage() {
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
            {automationGroups.map((group) => (
              <Link
                key={group.id}
                href={`/vehicles/${group.vehicleId}`}
                className="grid gap-4 rounded-lg border border-zinc-200 p-4 transition hover:border-violet-300 hover:bg-violet-50/40 lg:grid-cols-[1.2fr_1fr_auto]"
              >
                <div>
                  <p className="font-semibold">{group.customerName}</p>
                  <p className="text-sm text-zinc-500">{group.vehicleLabel}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant={group.urgency <= 0 ? "red" : "orange"}>
                      {group.services.length} services recommended
                    </Badge>
                    <Badge variant="purple">{formatCurrency(group.estimatedRevenueCents)}</Badge>
                    <Badge>{formatHours(group.recommendedMinutes)}</Badge>
                  </div>
                </div>
                <div className="space-y-2">
                  {group.services.slice(0, 3).map((service) => (
                    <div key={service.id}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span>{service.name}</span>
                        <span>{service.remainingLife}%</span>
                      </div>
                      <Progress value={service.remainingLife} />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-end">
                  <span className="rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white">
                    Recommend appointment
                  </span>
                </div>
              </Link>
            ))}
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
            {appointments.map((appointment) => (
              <div key={appointment.id} className="rounded-lg border border-zinc-200 p-4">
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
                      {customerLookup[appointment.customerId].name}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {vehicleLookup[appointment.vehicleId].label}
                    </p>
                  </div>
                  <Badge variant={statusVariant(appointment.status)}>
                    {appointment.status}
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-zinc-500">Services</p>
                    <p className="font-semibold">{appointment.services.length}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Revenue</p>
                    <p className="font-semibold">
                      {formatCurrency(appointment.estimatedRevenueCents)}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Labor</p>
                    <p className="font-semibold">
                      {formatHours(appointment.estimatedLaborMinutes)}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-zinc-600">
                  {appointment.services[0]} + {appointment.services.length - 1} more
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Revenue Forecast</h2>
          </CardHeader>
          <CardContent>
            <RevenueForecastChart />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Automation Performance</h2>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {[
              ["Messages sent", "143"],
              ["Customers contacted", "91"],
              ["Response rate", "31%"],
              ["Appointments booked", "18"],
              ["Attributed revenue", "$28.4k"],
              ["Duplicate sends blocked", "12"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 p-4">
                <p className="text-sm text-zinc-500">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
