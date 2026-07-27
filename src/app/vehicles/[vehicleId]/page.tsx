import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardPlus, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  asOfDate,
  customerLookup,
  getVehicle,
  getVehicleMaintenance,
  mileageReadings,
  vehicleLookup,
} from "@/lib/demo-data";
import { estimateCurrentMileage } from "@/lib/maintenance-engine";
import { formatCurrency, formatDate, formatHours } from "@/lib/utils";

export default async function VehicleMaintenancePage({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;
  const vehicle = getVehicle(vehicleId);
  if (!vehicle) notFound();

  const maintenance = getVehicleMaintenance(vehicle.id).sort(
    (a, b) => a.finalLife - b.finalLife,
  );
  const mileage = estimateCurrentMileage(mileageReadings[vehicle.id] ?? [], asOfDate);
  const predictedAnnualRevenue = maintenance.reduce(
    (sum, item) => sum + item.estimatedPriceCents,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-violet-700">
            {customerLookup[vehicle.customerId].name}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {vehicleLookup[vehicle.id].label}
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            VIN {vehicle.vin} · {vehicle.engine} · {vehicle.trim}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold">
            <ClipboardPlus className="h-4 w-4" />
            Record inspection
          </button>
          <button className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">
            <MessageSquare className="h-4 w-4" />
            Simulate outreach
          </button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["Estimated mileage", `${mileage.mileage.toLocaleString()} mi`],
          ["Mileage confidence", mileage.estimated ? "Estimated" : mileage.confidence],
          ["Vehicle health", `${vehicle.overallHealth}%`],
          ["Annual maintenance revenue", formatCurrency(predictedAnnualRevenue)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent>
              <p className="text-sm text-zinc-500">{label}</p>
              <p className="mt-2 text-xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Independent Maintenance Lifespans</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Time and mileage wear down independently. The displayed life uses the more urgent value and clearly labels mechanic-verified values.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {maintenance.map((item) => (
            <div key={item.id} className="rounded-lg border border-zinc-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{item.serviceName}</h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    Last completed {formatDate(item.lastCompletedDate)} at {item.lastCompletedMileage.toLocaleString()} mi
                  </p>
                </div>
                <Badge variant={statusVariant(item.status)}>{item.status.replace("_", " ")}</Badge>
              </div>
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span>{item.label}</span>
                  <span className="font-semibold">{item.finalLife}% remaining</span>
                </div>
                <Progress value={item.finalLife} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-zinc-500">Time life</p>
                  <p className="font-semibold">{item.timeLife}%</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-zinc-500">Mileage life</p>
                  <p className="font-semibold">{item.mileageLife}%</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-zinc-500">Remaining mileage</p>
                  <p className="font-semibold">{Math.max(0, item.remainingMileage).toLocaleString()} mi</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-zinc-500">Threshold</p>
                  <p className="font-semibold">{item.notificationThreshold}%</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="purple">{formatCurrency(item.estimatedPriceCents)}</Badge>
                <Badge>{formatHours(item.estimatedLaborMinutes)}</Badge>
                <button className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-semibold">
                  <Pencil className="h-3.5 w-3.5" />
                  Edit interval
                </button>
                <button className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-red-700">
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Link href={`/customers/${vehicle.customerId}`} className="text-sm font-semibold text-violet-950">
        Back to customer profile
      </Link>
    </div>
  );
}
