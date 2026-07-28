"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getDashboardMetrics, vehicleLabel } from "@/lib/demo-calculations";
import { useDemoStore } from "@/lib/demo-store";
import { formatCurrency } from "@/lib/utils";

export default function AppointmentsPage() {
  const { state, completeAppointment } = useDemoStore();
  const [completion, setCompletion] = useState<{
    appointmentId: string;
    revenue: string;
    laborHours: string;
    completedAt: string;
    notes: string;
  } | null>(null);
  const metrics = getDashboardMetrics(state);
  const committedHours = state.shop.dailyBayHours - metrics.openBayCapacityHours;

  function submitCompletion() {
    if (!completion) return;
    const revenue = Math.round(Number(completion.revenue) * 100);
    const laborHours = Number(completion.laborHours);
    if (!Number.isFinite(revenue) || revenue < 0 || !Number.isFinite(laborHours) || laborHours <= 0) {
      return;
    }
    completeAppointment({
      appointmentId: completion.appointmentId,
      completedRevenueCents: revenue,
      completedLaborHours: laborHours,
      completedAt: completion.completedAt,
      notes: completion.notes,
    });
    setCompletion(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Appointments</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Schedule consolidated visits based on total selected service labor.
          </p>
        </div>
        <Link href="/automation" className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">
          <CalendarPlus className="h-4 w-4" />
          Book from queue
        </Link>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Schedule</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            {state.appointments.length === 0 && (
              <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500">
                No appointments have been booked yet. Send a recommendation from the queue to create one.
              </p>
            )}
            {state.appointments.map((appointment) => {
              const customer = state.customers.find((item) => item.id === appointment.customerId);
              const vehicle = state.vehicles.find((item) => item.id === appointment.vehicleId);
              if (!customer || !vehicle) return null;
              return (
                <div key={appointment.id} className="rounded-lg border border-zinc-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {new Intl.DateTimeFormat("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(appointment.scheduledStart))}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {customer.firstName} {customer.lastName} · {vehicleLabel(vehicle)}
                      </p>
                    </div>
                    <Badge variant={statusVariant(appointment.status)}>{appointment.status}</Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {appointment.serviceNames.map((service) => (
                      <Badge key={service} variant="purple">{service}</Badge>
                    ))}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-zinc-500">Labor</p>
                      <p className="font-semibold">{appointment.totalLaborHours} hr</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Revenue</p>
                      <p className="font-semibold">{formatCurrency(appointment.totalPriceCents)}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Source</p>
                      <p className="font-semibold">{appointment.attributionSource.replaceAll("_", " ")}</p>
                    </div>
                  </div>
                  {appointment.status === "COMPLETED" ? (
                    <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      Completed revenue: {formatCurrency(appointment.completedRevenueCents ?? appointment.totalPriceCents)}
                    </div>
                  ) : (
                    <button
                      onClick={() => setCompletion({
                        appointmentId: appointment.id,
                        revenue: String((appointment.totalPriceCents / 100).toFixed(2)),
                        laborHours: String(appointment.totalLaborHours),
                        completedAt: new Date().toISOString().slice(0, 10),
                        notes: appointment.notes,
                      })}
                      className="mt-4 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800"
                    >
                      Complete appointment
                    </button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Bay Capacity</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              ["Today committed", `${committedHours} hrs`],
              ["Today open", `${metrics.openBayCapacityHours} hrs`],
              ["Scheduled revenue", formatCurrency(metrics.scheduledRevenue)],
              ["Appointments today", String(metrics.appointmentsToday)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-lg border border-zinc-200 p-4">
                <span className="text-sm text-zinc-500">{label}</span>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {completion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">Complete appointment</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Enter final revenue and labor so Maintiva can report recovered revenue.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Final revenue
                <input
                  value={completion.revenue}
                  onChange={(event) => setCompletion({ ...completion, revenue: event.target.value })}
                  type="number"
                  min="0"
                  step="0.01"
                  className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
                />
              </label>
              <label className="text-sm font-medium">
                Final labor hours
                <input
                  value={completion.laborHours}
                  onChange={(event) => setCompletion({ ...completion, laborHours: event.target.value })}
                  type="number"
                  min="0.1"
                  step="0.1"
                  className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
                />
              </label>
              <label className="text-sm font-medium">
                Completion date
                <input
                  value={completion.completedAt}
                  onChange={(event) => setCompletion({ ...completion, completedAt: event.target.value })}
                  type="date"
                  className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
                />
              </label>
              <label className="text-sm font-medium sm:col-span-2">
                Notes
                <textarea
                  value={completion.notes}
                  onChange={(event) => setCompletion({ ...completion, notes: event.target.value })}
                  rows={3}
                  className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-violet-500"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setCompletion(null)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={submitCompletion}
                className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"
              >
                Save completion
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
