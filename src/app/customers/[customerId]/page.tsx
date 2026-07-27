import Link from "next/link";
import { notFound } from "next/navigation";
import { Car, ClipboardCheck, Gauge, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  getCustomer,
  getCustomerVehicles,
  getVehicleMaintenance,
  mileageReadings,
  asOfDate,
  vehicleLookup,
} from "@/lib/demo-data";
import { estimateCurrentMileage } from "@/lib/maintenance-engine";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const customer = getCustomer(customerId);
  if (!customer) notFound();

  const vehicles = getCustomerVehicles(customer.id);
  const nextItem = vehicles
    .flatMap((vehicle) => getVehicleMaintenance(vehicle.id))
    .sort((a, b) => a.finalLife - b.finalLife)[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {customer.firstName} {customer.lastName}
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            {customer.phone} · {customer.email} · Prefers {customer.preferredContact}
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" />
          Add Vehicle
        </button>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["Customer score", customer.customerScore],
          ["Lifetime revenue", formatCurrency(customer.lifetimeRevenueCents)],
          ["Last visit", formatDate(customer.lastVisit)],
          ["Next predicted appointment", nextItem?.serviceName ?? "No service due"],
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
          <h2 className="text-lg font-semibold">Customer Information</h2>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-sm font-medium text-zinc-500">Consent settings</p>
            <div className="mt-2 flex gap-2">
              <Badge variant={customer.smsConsent ? "green" : "neutral"}>SMS</Badge>
              <Badge variant={customer.emailConsent ? "green" : "neutral"}>Email</Badge>
              <Badge variant={customer.callConsent ? "green" : "neutral"}>Call</Badge>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-500">Notes</p>
            <p className="mt-2 text-sm text-zinc-700">{customer.notes}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {vehicles.map((vehicle) => {
          const items = getVehicleMaintenance(vehicle.id);
          const mileage = estimateCurrentMileage(mileageReadings[vehicle.id] ?? [], asOfDate);
          return (
            <Card key={vehicle.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{vehicleLookup[vehicle.id].label}</h2>
                  <p className="mt-1 text-sm text-zinc-500">{vehicle.vin}</p>
                </div>
                <Badge variant={vehicle.overallHealth < 60 ? "orange" : "green"}>
                  {vehicle.overallHealth}% health
                </Badge>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <Gauge className="mb-2 h-4 w-4 text-violet-900" />
                    <p className="text-zinc-500">{mileage.label}</p>
                    <p className="font-semibold">{mileage.mileage.toLocaleString()} mi</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <ClipboardCheck className="mb-2 h-4 w-4 text-violet-900" />
                    <p className="text-zinc-500">Last verified</p>
                    <p className="font-semibold">{mileage.latestVerifiedMileage?.toLocaleString()} mi</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {items.slice(0, 3).map((item) => (
                    <div key={item.id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{item.serviceName}</span>
                        <span>{item.finalLife}% life</span>
                      </div>
                      <Progress value={item.finalLife} />
                    </div>
                  ))}
                </div>
                <Link
                  href={`/vehicles/${vehicle.id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-violet-200 px-3 py-2 text-sm font-semibold text-violet-950"
                >
                  <Car className="h-4 w-4" />
                  Open vehicle maintenance
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
