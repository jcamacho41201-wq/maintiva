"use client";

import Link from "next/link";
import { useState } from "react";
import { Mail, MessageSquare, Phone, Send } from "lucide-react";
import { RecommendationModal } from "@/components/recommendation-modal";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  getRecordStatus,
  getVehicleOpportunities,
  vehicleLabel,
} from "@/lib/demo-calculations";
import { useDemoStore } from "@/lib/demo-store";
import { formatCurrency, formatDate } from "@/lib/utils";

function statusLabel(status: string) {
  return status.replace("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

export default function AutomationPage() {
  const store = useDemoStore();
  const { state } = store;
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const groups = getVehicleOpportunities(state);
  const selected = groups.find((group) => group.vehicle?.id === selectedVehicleId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Automation Queue</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Eligible services are grouped by customer and vehicle so outreach recommends one bundled appointment.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-wrap gap-2">
          {[
            "Due soon",
            "Overdue",
            "Never contacted",
            "Drafted",
            "Manually sent",
            "Appointment booked",
            "No response",
            "Highest revenue",
            "Highest urgency",
          ].map((filter) => (
            <Badge key={filter} variant="neutral">{filter}</Badge>
          ))}
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          {groups.map((group) => {
            const customer = group.customer;
            const vehicle = group.vehicle;
            if (!customer || !vehicle) return null;
            const lastContact = state.outreachRecords
              .filter((record) => record.vehicleId === vehicle.id)
              .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())[0];

            return (
              <Card key={group.id} className="shadow-none">
                <CardContent className="space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">{customer.firstName} {customer.lastName}</h2>
                      <p className="text-sm text-zinc-500">{vehicleLabel(vehicle)}</p>
                    </div>
                    <Badge variant={statusVariant(group.opportunityStatus)}>
                      {statusLabel(group.opportunityStatus)}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    {group.records.map((record) => {
                      const status = getRecordStatus(state, record);
                      return (
                        <div key={record.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                          <span>{record.serviceName}</span>
                          <span className="font-semibold">{status.dueText}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <p className="text-zinc-500">Revenue</p>
                      <p className="font-semibold">{formatCurrency(group.totalPriceCents)}</p>
                    </div>
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <p className="text-zinc-500">Labor</p>
                      <p className="font-semibold">{group.totalLaborHours} hr</p>
                    </div>
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <p className="text-zinc-500">Appointment</p>
                      <p className="font-semibold">{group.recommendedHours} hr</p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
                    {lastContact
                      ? lastContact.message
                      : `Ready to send a bundled recommendation for ${group.records.map((record) => record.serviceName.toLowerCase()).join(", ")}.`}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-zinc-500">
                      Last contact: {lastContact ? formatDate(lastContact.sentAt) : "Never"} · {statusLabel(group.opportunityStatus)}
                    </div>
                    <div className="flex gap-2">
                      <button className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200" title="Manual SMS draft">
                        <MessageSquare className="h-4 w-4" />
                      </button>
                      <button className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200" title="Manual email draft">
                        <Mail className="h-4 w-4" />
                      </button>
                      <button className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200" title="Manual call note">
                        <Phone className="h-4 w-4" />
                      </button>
                      {group.opportunityStatus === "SCHEDULED" ? (
                        <Link href="/appointments" className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white">
                          View appointment
                        </Link>
                      ) : (
                        <button
                          onClick={() => setSelectedVehicleId(vehicle.id)}
                          className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white"
                        >
                          <Send className="h-4 w-4" />
                          Recommend
                        </button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </CardContent>
      </Card>

      {selected?.customer && selected.vehicle && (
        <RecommendationModal
          customer={selected.customer}
          vehicle={selected.vehicle}
          records={selected.records}
          onClose={() => setSelectedVehicleId(null)}
          onSendRecommendation={store.sendRecommendation}
          onBookAppointment={store.bookAppointment}
        />
      )}
    </div>
  );
}
