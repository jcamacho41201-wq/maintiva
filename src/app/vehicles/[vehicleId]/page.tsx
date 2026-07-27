"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ClipboardPlus, MessageSquare, Pencil } from "lucide-react";
import { RecommendationModal } from "@/components/recommendation-modal";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  calculateMaintenanceStatus,
  getRecommendedRecords,
  getRecordStatus,
  vehicleLabel,
} from "@/lib/demo-calculations";
import { useDemoStore } from "@/lib/demo-store";
import { formatCurrency, formatDate } from "@/lib/utils";

function opportunityLabel(status: string) {
  return status.replace("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

export default function VehicleMaintenancePage() {
  const params = useParams<{ vehicleId: string }>();
  const store = useDemoStore();
  const { state } = store;
  const [modalOpen, setModalOpen] = useState(false);
  const vehicle = state.vehicles.find((item) => item.id === params.vehicleId);

  if (!vehicle) {
    return (
      <Card>
        <CardContent>
          <p className="font-semibold">Vehicle not found</p>
          <Link href="/customers" className="mt-2 inline-block text-sm font-semibold text-violet-950">
            Back to customers
          </Link>
        </CardContent>
      </Card>
    );
  }

  const customer = state.customers.find((item) => item.id === vehicle.customerId);
  const maintenance = state.maintenanceRecords
    .filter((item) => item.vehicleId === vehicle.id)
    .sort((a, b) => getRecordStatus(state, a).lifeRemaining - getRecordStatus(state, b).lifeRemaining);
  const recommended = getRecommendedRecords(state, vehicle.id).map(({ record }) => record);
  const openRecommended = recommended.filter((record) => record.outreachStatus !== "SCHEDULED");
  const predictedAnnualRevenue = recommended.reduce((sum, item) => sum + item.priceCents, 0);
  const opportunityStatus =
    recommended.length > 0 && recommended.every((record) => record.outreachStatus === "SCHEDULED")
      ? "SCHEDULED"
      : recommended.some((record) => record.outreachStatus === "MANUALLY_SENT")
        ? "MANUALLY_SENT"
        : recommended.some((record) => record.outreachStatus === "DRAFTED")
          ? "DRAFTED"
        : "NEEDS_OUTREACH";

  if (!customer) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-violet-700">
            {customer.firstName} {customer.lastName}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{vehicleLabel(vehicle)}</h1>
          <p className="mt-2 text-sm text-zinc-600">
            VIN {vehicle.vin} · {vehicle.engine} · {vehicle.trim}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold">
            <ClipboardPlus className="h-4 w-4" />
            Record inspection
          </button>
          <button
            onClick={() => setModalOpen(true)}
            disabled={openRecommended.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <MessageSquare className="h-4 w-4" />
            Recommend appointment
          </button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["Current mileage", `${vehicle.currentMileage.toLocaleString()} mi`],
          ["Mileage confidence", "Verified shop reading"],
          ["Vehicle health", `${vehicle.overallHealth}%`],
          ["Recommended revenue", formatCurrency(predictedAnnualRevenue)],
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
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Preventative Maintenance</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Simple due logic based on current mileage, last service, mileage interval, and time interval.
            </p>
          </div>
          <Badge variant={statusVariant(opportunityStatus)}>
            {opportunityLabel(opportunityStatus)}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          {maintenance.map((item) => {
            const status = calculateMaintenanceStatus(item, vehicle);
            return (
              <div key={item.id} className="rounded-lg border border-zinc-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{item.serviceName}</h3>
                    <p className="mt-1 text-sm text-zinc-500">
                      Last completed {formatDate(item.lastCompletedDate)} at {item.lastCompletedMileage.toLocaleString()} mi
                    </p>
                  </div>
                  <Badge variant={statusVariant(status.status)}>{status.status.replace("_", " ")}</Badge>
                </div>
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span>{status.dueText}</span>
                    <span className="font-semibold">{status.lifeRemaining}% life remaining</span>
                  </div>
                  <Progress value={status.lifeRemaining} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-zinc-50 p-3">
                    <p className="text-zinc-500">Mileage interval</p>
                    <p className="font-semibold">{item.recommendedMileageInterval.toLocaleString()} mi</p>
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-3">
                    <p className="text-zinc-500">Time interval</p>
                    <p className="font-semibold">{item.recommendedTimeIntervalMonths} mo</p>
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-3">
                    <p className="text-zinc-500">Price</p>
                    <p className="font-semibold">{formatCurrency(item.priceCents)}</p>
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-3">
                    <p className="text-zinc-500">Labor</p>
                    <p className="font-semibold">{item.laborHours} hr</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant={statusVariant(item.outreachStatus)}>
                    {opportunityLabel(item.outreachStatus)}
                  </Badge>
                  <button className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-semibold">
                    <Pencil className="h-3.5 w-3.5" />
                    Edit interval
                  </button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Link href={`/customers/${vehicle.customerId}`} className="text-sm font-semibold text-violet-950">
        Back to customer profile
      </Link>

      {modalOpen && (
        <RecommendationModal
          customer={customer}
          vehicle={vehicle}
          records={recommended}
          onClose={() => setModalOpen(false)}
          onSendRecommendation={store.sendRecommendation}
          onBookAppointment={store.bookAppointment}
        />
      )}
    </div>
  );
}
