"use client";

import { useMemo, useState } from "react";
import { CalendarCheck, CheckCircle2, Clipboard, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { appointmentStatusLabel, appointmentStatuses } from "@/lib/calendar";
import {
  calculateAppointmentTotals,
  type Appointment,
  type Customer,
  type CustomerResponseStatus,
  type OutreachChannel,
  type Vehicle,
  type VehicleMaintenanceRecord,
} from "@/lib/demo-data";
import { vehicleLabel } from "@/lib/demo-calculations";
import type { BookAppointmentResult, RecommendationResult } from "@/lib/demo-store";
import { formatCurrency } from "@/lib/utils";

type Props = {
  customer: Customer;
  vehicle: Vehicle;
  records: VehicleMaintenanceRecord[];
  onClose: () => void;
  onSendRecommendation: (input: {
    customerId: string;
    vehicleId: string;
    maintenanceRecordIds: string[];
    message: string;
    channel?: OutreachChannel;
    responseStatus?: CustomerResponseStatus;
  }) => Promise<RecommendationResult>;
  onBookAppointment: (input: {
    customerId: string;
    vehicleId: string;
    maintenanceRecordIds: string[];
    date: string;
    time: string;
    status: Appointment["status"];
    notes?: string;
  }) => Promise<BookAppointmentResult>;
};

export function RecommendationModal({
  customer,
  vehicle,
  records,
  onClose,
  onSendRecommendation,
  onBookAppointment,
}: Props) {
  const eligibleRecords = records.filter((record) => record.outreachStatus !== "SCHEDULED");
  const [selectedIds, setSelectedIds] = useState(
    eligibleRecords.map((record) => record.id),
  );
  const [message, setMessage] = useState(
    `Hi ${customer.firstName}, your ${vehicleLabel(vehicle)} is ready for ${eligibleRecords
      .map((record) => record.serviceName.toLowerCase())
      .join(", ")}. We can bundle these services into one visit. Use this link to choose a time that works for you: [Booking Link]`,
  );
  const [date, setDate] = useState("2026-07-28");
  const [time, setTime] = useState("09:00");
  const [status, setStatus] = useState<Appointment["status"]>("CONFIRMED");
  const [channel, setChannel] = useState<OutreachChannel>("TEXT");
  const [responseStatus, setResponseStatus] = useState<CustomerResponseStatus>("NO_RESPONSE");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [booked, setBooked] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedRecords = useMemo(
    () => eligibleRecords.filter((record) => selectedIds.includes(record.id)),
    [eligibleRecords, selectedIds],
  );
  const totals = calculateAppointmentTotals(selectedRecords);

  function toggleRecord(recordId: string) {
    setSelectedIds((current) =>
      current.includes(recordId)
        ? current.filter((id) => id !== recordId)
        : [...current, recordId],
    );
  }

  async function copyMessage() {
    if (selectedIds.length === 0) {
      setError("Select at least one recommended service.");
      return;
    }
    if (message.trim().length < 20) {
      setError("Add a clear message before copying the recommendation.");
      return;
    }

    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setError("");
    } catch {
      setError("Copy failed. Select the message text and copy it manually.");
    }
  }

  async function markManuallySent() {
    if (selectedIds.length === 0) {
      setError("Select at least one recommended service.");
      return;
    }
    if (message.trim().length < 20) {
      setError("Add a clear message before marking the recommendation manually sent.");
      return;
    }
    if (
      !window.confirm(
        "Confirm that you manually sent this message outside Maintiva. Copying alone will not mark outreach sent.",
      )
    ) {
      return;
    }

    setSaving(true);
    const result = await onSendRecommendation({
      customerId: customer.id,
      vehicleId: vehicle.id,
      maintenanceRecordIds: selectedIds,
      message,
      channel,
      responseStatus,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.message ?? "Outreach could not be saved. Check the database connection and try again.");
      return;
    }

    setSent(true);
    setError("");
  }

  async function bookAppointment() {
    if (!date || !time) {
      setError("Choose an appointment date and time.");
      return;
    }
    if (selectedIds.length === 0) {
      setError("Select at least one service before booking.");
      return;
    }

    setSaving(true);
    const result = await onBookAppointment({
      customerId: customer.id,
      vehicleId: vehicle.id,
      maintenanceRecordIds: selectedIds,
      date,
      time,
      status,
      notes: "Booked from demo recommendation workflow.",
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.message ?? "Appointment could not be created. Try again.");
      return;
    }

    setBooked(true);
    setError("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 p-5">
          <div>
            <h2 className="text-xl font-semibold">Recommend appointment</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {customer.firstName} {customer.lastName} · {vehicleLabel(vehicle)}
            </p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-200"
            onClick={onClose}
            aria-label="Close recommendation modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </div>
          )}
          {sent && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              Outreach marked manually sent. This does not represent a live SMS or email delivery.
            </div>
          )}
          {copied && !sent && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700">
              Message copied. Confirm manual send only after you send it from your phone, email, or shop system.
            </div>
          )}
          {booked && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              Appointment saved. Dashboard revenue, appointments, and capacity are updated.
            </div>
          )}

          <div className="space-y-3">
            <p className="text-sm font-semibold">Recommended services</p>
            {eligibleRecords.map((record) => (
              <label
                key={record.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm"
              >
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(record.id)}
                    onChange={() => toggleRecord(record.id)}
                    className="h-4 w-4 accent-violet-950"
                  />
                  <span>
                    <span className="font-semibold">{record.serviceName}</span>
                    <span className="block text-zinc-500">
                      {record.laborHours} hr · {record.recommendedMileageInterval.toLocaleString()} mi interval
                    </span>
                  </span>
                </span>
                <span className="font-semibold">{formatCurrency(record.priceCents)}</span>
              </label>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm text-zinc-500">Total selected price</p>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(totals.totalPriceCents)}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm text-zinc-500">Total selected labor</p>
              <p className="mt-1 text-2xl font-semibold">{totals.recommendedHours} hrs</p>
            </div>
          </div>

          <label className="block text-sm font-semibold">
            Editable message preview
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500"
            />
          </label>

          <div className="grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Manual outreach channel
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value as OutreachChannel)}
                className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
              >
                <option value="TEXT">Text sent manually</option>
                <option value="PHONE">Phone call</option>
                <option value="EMAIL">Email sent manually</option>
                <option value="IN_PERSON">In person</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              Customer response
              <select
                value={responseStatus}
                onChange={(event) => setResponseStatus(event.target.value as CustomerResponseStatus)}
                className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
              >
                <option value="NO_RESPONSE">No response yet</option>
                <option value="INTERESTED">Interested</option>
                <option value="WANTS_CALLBACK">Wants callback</option>
                <option value="BOOKED">Booked</option>
                <option value="DECLINED">Declined</option>
                <option value="NOT_NOW">Not now</option>
                <option value="WRONG_CONTACT">Wrong contact</option>
                <option value="DO_NOT_CONTACT">Do not contact</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-5">
            <div className="flex gap-2">
              <Badge variant="purple">Manual outreach</Badge>
              <Badge variant="neutral">No real message sent</Badge>
            </div>
            <button
              onClick={copyMessage}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Clipboard className="h-4 w-4" />
              {copied ? "Copied message" : "Copy message"}
            </button>
            <button
              onClick={markManuallySent}
              disabled={saving || sent}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" />
              {sent ? "Marked sent" : saving ? "Saving..." : "Mark manually sent"}
            </button>
          </div>

          {sent && (
            <div className="rounded-lg border border-zinc-200 p-4">
              <div className="mb-4">
                <h3 className="font-semibold">Book appointment</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Selected services stay bundled into one appointment.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-sm font-medium">
                  Appointment date
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
                  />
                </label>
                <label className="text-sm font-medium">
                  Appointment time
                  <input
                    type="time"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                    className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
                  />
                </label>
                <label className="text-sm font-medium">
                  Status
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value as Appointment["status"])}
                    className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
                  >
                    {appointmentStatuses
                      .filter((item) => !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(item))
                      .map((item) => (
                        <option key={item} value={item}>{appointmentStatusLabel(item)}</option>
                      ))}
                  </select>
                </label>
              </div>
              <button
                onClick={bookAppointment}
                disabled={saving || booked}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CalendarCheck className="h-4 w-4" />
                {booked ? "Appointment saved" : saving ? "Saving..." : "Save appointment"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
