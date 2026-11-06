"use client";
import { useRef, useState } from "react";
import type React from "react";
import { CalendarCheck, X } from "lucide-react";
import type { Appointment, Customer, Vehicle, VehicleMaintenanceRecord } from "@/lib/demo-data";
import type { RevenueQueueGroup } from "@/lib/revenue-recovery";
import { formatCurrency, formatDate, formatLaborHours } from "@/lib/utils";

function selectedRecordIds(group: RevenueQueueGroup) {
  return group.opportunities
    .map((opportunity) => opportunity.maintenanceRecordId)
    .filter((id): id is string => Boolean(id));
}

function selectedDeclinedWorkIds(group: RevenueQueueGroup) {
  return group.opportunities
    .map((opportunity) => opportunity.declinedWorkRecordId)
    .filter((id): id is string => Boolean(id));
}

function selectedOpportunityIds(group: RevenueQueueGroup) {
  return group.opportunities.map((opportunity) => opportunity.id);
}

function ModalFrame({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 p-5">
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-200"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function queuePayload(group: RevenueQueueGroup) {
  return {
    customerId: group.customerId,
    vehicleId: group.vehicleId,
    opportunityIds: selectedOpportunityIds(group),
    maintenanceRecordIds: selectedRecordIds(group),
    declinedWorkRecordIds: selectedDeclinedWorkIds(group),
  };
}

function serviceRows(group: RevenueQueueGroup, records: VehicleMaintenanceRecord[]) {
  return group.opportunities.map((opportunity) => {
    const record = opportunity.maintenanceRecordId
      ? records.find((item) => item.id === opportunity.maintenanceRecordId)
      : undefined;
    return {
      id: opportunity.id,
      name: opportunity.serviceNames.join(", "),
      reason: opportunity.sourceLabel,
      priceCents: opportunity.estimatedRevenueCents,
      laborHours: record?.laborHours ?? opportunity.estimatedLaborHours,
      timing: opportunity.dueDate ? formatDate(opportunity.dueDate) : opportunity.dueMileage ? `${opportunity.dueMileage.toLocaleString()} mi` : "Timing not recorded",
    };
  });
}

export function BookAppointmentModal({
  group,
  customer,
  vehicle,
  records,
  onClose,
  onSave,
}: {
  group: RevenueQueueGroup;
  customer: Customer;
  vehicle: Vehicle;
  records: VehicleMaintenanceRecord[];
  onClose: () => void;
  onSave: (input: {
    customerId: string;
    vehicleId: string;
    opportunityIds: string[];
    maintenanceRecordIds: string[];
    declinedWorkRecordIds: string[];
    date: string;
    time: string;
    status: Appointment["status"];
    notes?: string;
    idempotencyKey?: string;
  }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const rows = serviceRows(group, records);
  const totalPrice = rows.reduce((sum, row) => sum + row.priceCents, 0);
  const totalLabor = rows.reduce((sum, row) => sum + row.laborHours, 0);
  const idempotencyKeyRef = useRef<string | null>(null);

  async function createAppointment() {
    if (!date || !time) {
      setError("Choose an appointment date and time.");
      return;
    }
    idempotencyKeyRef.current ??= typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setSaving(true);
    const result = await onSave({
      ...queuePayload(group),
      date,
      time,
      status: "CONFIRMED",
      notes,
      idempotencyKey: idempotencyKeyRef.current,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "Appointment could not be created.");
      return;
    }
    onClose();
  }

  return (
    <ModalFrame title="Book appointment" subtitle={`${customer.firstName} ${customer.lastName} · ${vehicle.year} ${vehicle.make} ${vehicle.model}`} onClose={onClose}>
      <div className="space-y-5 p-5">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
              <div>
                <p className="font-semibold">{row.name}</p>
                <p className="text-zinc-500">{row.reason} · {row.timing}</p>
              </div>
              <p className="font-semibold">{formatCurrency(row.priceCents)} · {formatLaborHours(row.laborHours)}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-zinc-500">Total price</p>
            <p className="mt-1 text-2xl font-semibold">{formatCurrency(totalPrice)}</p>
          </div>
          <div>
            <p className="text-sm text-zinc-500">Total labor</p>
            <p className="mt-1 text-2xl font-semibold">{formatLaborHours(totalLabor)}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
          <label className="text-sm font-medium">
            Start time
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
          <label className="text-sm font-medium">
            Duration
            <input value={formatLaborHours(totalLabor)} readOnly className="mt-2 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none" />
          </label>
          <label className="text-sm font-medium">
            Confirmation method
            <select className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" defaultValue={customer.preferredContact === "EMAIL" ? "EMAIL" : "TEXT"}>
              <option value="TEXT">Text</option>
              <option value="EMAIL">Email</option>
              <option value="CALL">Call</option>
            </select>
          </label>
        </div>
        <label className="block text-sm font-semibold">
          Customer notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500" />
        </label>
        <div className="flex justify-end gap-2 border-t border-zinc-100 pt-5">
          <button onClick={onClose} disabled={saving} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-60">Cancel</button>
          <button onClick={createAppointment} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            <CalendarCheck className="h-4 w-4" />
            {saving ? "Saving..." : "Create appointment"}
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
