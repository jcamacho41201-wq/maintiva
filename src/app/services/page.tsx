import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { serviceDefinitions } from "@/lib/demo-data";
import { formatCurrency, formatHours } from "@/lib/utils";

export default function ServicesPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Services Library</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Reusable shop defaults for intervals, notification thresholds, labor, and pricing.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" />
          Create Service
        </button>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Default Preventative Services</h2>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {serviceDefinitions.map((service) => (
            <div key={service.id} className="rounded-lg border border-zinc-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{service.name}</h3>
                  <p className="mt-1 text-sm text-zinc-500">{service.category}</p>
                </div>
                <Badge variant={service.isActive ? "green" : "neutral"}>
                  {service.isActive ? "Active" : "Disabled"}
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-zinc-500">Mileage interval</p>
                  <p className="font-semibold">{service.defaultMileageInterval.toLocaleString()} mi</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-zinc-500">Time interval</p>
                  <p className="font-semibold">{service.defaultTimeIntervalMonths} mo</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-zinc-500">Notify at</p>
                  <p className="font-semibold">{service.defaultNotificationThreshold}%</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-zinc-500">Labor</p>
                  <p className="font-semibold">{formatHours(service.estimatedLaborMinutes)}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="font-semibold text-violet-950">
                  {formatCurrency(service.defaultPriceCents)}
                </span>
                <button className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold">
                  Edit defaults
                </button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
