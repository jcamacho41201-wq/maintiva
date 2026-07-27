import { CalendarPlus } from "lucide-react";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { appointments, customerLookup, vehicleLookup } from "@/lib/demo-data";
import { formatCurrency, formatHours } from "@/lib/utils";

export default function AppointmentsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Appointments</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Schedule consolidated visits based on total selected service labor.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">
          <CalendarPlus className="h-4 w-4" />
          New Appointment
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Schedule</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            {appointments.map((appointment) => (
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
                      {customerLookup[appointment.customerId].name} · {vehicleLookup[appointment.vehicleId].label}
                    </p>
                  </div>
                  <Badge variant={statusVariant(appointment.status)}>{appointment.status}</Badge>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {appointment.services.map((service) => (
                    <Badge key={service} variant="purple">{service}</Badge>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-zinc-500">Labor</p>
                    <p className="font-semibold">{formatHours(appointment.estimatedLaborMinutes)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Revenue</p>
                    <p className="font-semibold">{formatCurrency(appointment.estimatedRevenueCents)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Source</p>
                    <p className="font-semibold">{appointment.source.replace("_", " ")}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Bay Capacity</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              ["Today committed", "23 hrs"],
              ["Today open", "41 hrs"],
              ["Next 7 days committed", "118 hrs"],
              ["Forecasted due labor", "72 hrs"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-lg border border-zinc-200 p-4">
                <span className="text-sm text-zinc-500">{label}</span>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
