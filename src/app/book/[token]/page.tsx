"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarCheck, Clock3, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BookingIntakeType, BookingMode } from "@/lib/demo-data";
import type { AvailabilitySlot, PublicBookingContext } from "@/lib/customer-booking";
import { isCustomerBookingEnabled } from "@/lib/feature-flags";
import { formatCurrency } from "@/lib/utils";

type BookingOutcome = {
  id: string;
  status: string;
  startsAt: string;
};

function intakeLabel(type: BookingIntakeType) {
  return type === "WAIT" ? "Wait appointment" : "Drop-off";
}

function modeLabel(mode: BookingMode) {
  return mode === "INSTANT" ? "Book instantly" : "Request an appointment";
}

export default function CustomerBookingPage() {
  const customerBookingEnabled = isCustomerBookingEnabled();
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [context, setContext] = useState<PublicBookingContext | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [intakeType, setIntakeType] = useState<BookingIntakeType>("DROP_OFF");
  const [extraMaintenanceRecordIds, setExtraMaintenanceRecordIds] = useState<string[]>([]);
  const [customerNotes, setCustomerNotes] = useState("");
  const [outcome, setOutcome] = useState<BookingOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadContext() {
      if (!customerBookingEnabled) {
        setError("Customer booking is not available.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      const response = await fetch(`/api/book/${token}/context`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message ?? "This booking link could not be loaded.");
        setLoading(false);
        return;
      }
      const loaded = data.context as PublicBookingContext;
      setContext(loaded);
      setIntakeType(loaded.allowedIntakeTypes[0] ?? "DROP_OFF");
      if (loaded.link.appointmentId) {
        setOutcome({
          id: loaded.link.appointmentId,
          status: loaded.link.status === "COMPLETED" ? "CONFIRMED" : "REQUESTED",
          startsAt: loaded.link.bookingCompletedAt ?? loaded.link.usedAt ?? "",
        });
      }
      setLoading(false);
    }
    void loadContext();
  }, [customerBookingEnabled, token]);

  useEffect(() => {
    async function loadAvailability() {
      if (!context || context.allowedIntakeTypes.length === 0) return;
      const query = new URLSearchParams({ intakeType });
      if (extraMaintenanceRecordIds.length > 0) {
        query.set("extraMaintenanceRecordIds", extraMaintenanceRecordIds.join(","));
      }
      const response = await fetch(`/api/book/${token}/availability?${query.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message ?? "Available times could not be loaded.");
        setSlots([]);
        return;
      }
      setSlots(data.slots as AvailabilitySlot[]);
      setSelectedSlot("");
    }
    void loadAvailability();
  }, [context, extraMaintenanceRecordIds, intakeType, token]);

  const total = useMemo(() => {
    const selectedOptional = context?.optionalServices.filter((service) =>
      service.maintenanceRecordId && extraMaintenanceRecordIds.includes(service.maintenanceRecordId),
    ) ?? [];
    const services = [...(context?.services ?? []), ...selectedOptional];
    return {
      priceCents: services.reduce((sum, service) => sum + service.priceCents, 0),
      laborMinutes: services.reduce((sum, service) => sum + service.laborMinutes, 0),
    };
  }, [context, extraMaintenanceRecordIds]);

  async function submitBooking() {
    if (!selectedSlot) {
      setError("Choose an available time.");
      return;
    }
    setSaving(true);
    setError("");
    const response = await fetch(`/api/book/${token}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startsAt: selectedSlot,
        intakeType,
        extraMaintenanceRecordIds,
        customerNotes,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(data.message ?? "The appointment could not be saved.");
      return;
    }
    setOutcome(data.appointment as BookingOutcome);
  }

  async function updateAppointment(action: "cancel" | "reschedule") {
    setSaving(true);
    setError("");
    const response = await fetch(`/api/book/${token}/appointments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "cancel"
        ? { action, reason: customerNotes }
        : { action, startsAt: selectedSlot, intakeType, customerNotes }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(data.message ?? "The appointment could not be updated.");
      return;
    }
    if (action === "cancel") {
      setOutcome((current) => current ? { ...current, status: "CANCELLED" } : current);
    } else {
      setOutcome((current) => current ? { ...current, startsAt: selectedSlot } : current);
    }
  }

  if (loading) {
    return <main className="mx-auto grid min-h-screen max-w-4xl place-items-center p-6 text-sm text-zinc-600">Loading booking options...</main>;
  }

  if (error && !context) {
    return (
      <main className="mx-auto grid min-h-screen max-w-2xl place-items-center p-6">
        <div className="rounded-lg border border-red-200 bg-white p-6 text-red-700 shadow-sm">
          <p className="font-semibold">Booking link unavailable</p>
          <p className="mt-2 text-sm">{error}</p>
        </div>
      </main>
    );
  }

  if (!context) return null;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-violet-700">{context.shop.name}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Schedule recommended service</h1>
            <p className="mt-2 text-sm text-zinc-600">
              {context.customer.firstName}, choose a time for your {context.vehicle.year} {context.vehicle.make} {context.vehicle.model}.
            </p>
          </div>
          <Badge variant={context.bookingMode === "INSTANT" ? "green" : "purple"}>{modeLabel(context.bookingMode)}</Badge>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {context.services.map((service) => (
            <div key={`${service.maintenanceRecordId ?? service.declinedWorkRecordId}-${service.name}`} className="rounded-lg border border-zinc-200 p-4">
              <p className="font-semibold">{service.name}</p>
              <p className="mt-1 text-sm text-zinc-500">{service.dueText}</p>
              <p className="mt-2 text-sm font-medium">{formatCurrency(service.priceCents)} · {Math.round(service.laborMinutes / 6) / 10} hr</p>
            </div>
          ))}
        </div>

        {context.optionalServices.length > 0 && (
          <div className="mt-6">
            <p className="text-sm font-semibold">Add to this visit</p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {context.optionalServices.map((service) => (
                <label key={service.maintenanceRecordId} className="flex items-start gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(service.maintenanceRecordId && extraMaintenanceRecordIds.includes(service.maintenanceRecordId))}
                    onChange={(event) => {
                      const id = service.maintenanceRecordId;
                      if (!id) return;
                      setExtraMaintenanceRecordIds((current) =>
                        event.target.checked ? [...current, id] : current.filter((item) => item !== id),
                      );
                    }}
                    className="mt-1 h-4 w-4 accent-violet-950"
                  />
                  <span>
                    <span className="block font-medium">{service.name}</span>
                    <span className="text-zinc-500">{formatCurrency(service.priceCents)} · {Math.round(service.laborMinutes / 6) / 10} hr</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold">Appointment type</p>
              <div className="mt-2 grid gap-2">
                {context.allowedIntakeTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => setIntakeType(type)}
                    className={`rounded-lg border p-3 text-left text-sm ${intakeType === type ? "border-violet-950 bg-violet-50" : "border-zinc-200"}`}
                  >
                    <span className="font-semibold">{intakeLabel(type)}</span>
                    <span className="mt-1 block text-zinc-600">
                      {type === "WAIT"
                        ? "Your vehicle is expected to enter service near this time."
                        : "This is your vehicle drop-off time. Completion time will be confirmed by the shop."}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <label className="block text-sm font-semibold">
              Notes for the shop
              <textarea
                value={customerNotes}
                onChange={(event) => setCustomerNotes(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 font-normal outline-none focus:border-violet-500"
              />
            </label>
            <div className="rounded-lg border border-zinc-200 p-4 text-sm">
              <p className="font-semibold">Visit estimate</p>
              <p className="mt-2 text-zinc-600">{formatCurrency(total.priceCents)} · {Math.round(total.laborMinutes / 6) / 10} hr</p>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Available times</p>
              <p className="text-xs text-zinc-500">{context.shop.timezone}</p>
            </div>
            {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
            <div className="grid max-h-[28rem] gap-2 overflow-auto rounded-lg border border-zinc-200 p-3 sm:grid-cols-2">
              {slots.map((slot) => (
                <button
                  key={slot.startsAt}
                  onClick={() => setSelectedSlot(slot.startsAt)}
                  className={`rounded-lg border px-3 py-3 text-left text-sm ${selectedSlot === slot.startsAt ? "border-violet-950 bg-violet-950 text-white" : "border-zinc-200 bg-white text-zinc-800"}`}
                >
                  <span className="block font-semibold">{slot.dateLabel}</span>
                  <span className="mt-1 flex items-center gap-2">
                    <Clock3 className="h-4 w-4" />
                    {slot.label}
                  </span>
                </button>
              ))}
              {slots.length === 0 && (
                <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 sm:col-span-2">
                  No valid times are available for this service and appointment type.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-5">
          <p className="text-sm text-zinc-500">
            {context.bookingMode === "INSTANT" ? "Your selected time will be confirmed immediately." : "The shop will confirm or adjust this request."}
          </p>
          <div className="flex flex-wrap gap-2">
            {outcome && outcome.status !== "CANCELLED" && (
              <>
                <button
                  onClick={() => void updateAppointment("cancel")}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-60"
                >
                  <XCircle className="h-4 w-4" />
                  Cancel
                </button>
                <button
                  onClick={() => void updateAppointment("reschedule")}
                  disabled={saving || !selectedSlot}
                  className="inline-flex items-center gap-2 rounded-lg border border-violet-200 px-4 py-2 text-sm font-semibold text-violet-950 disabled:opacity-60"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reschedule
                </button>
              </>
            )}
            <button
              onClick={submitBooking}
              disabled={saving || !selectedSlot || Boolean(outcome && outcome.status !== "CANCELLED")}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              <CalendarCheck className="h-4 w-4" />
              {saving ? "Saving..." : context.bookingMode === "INSTANT" ? "Confirm appointment" : "Submit request"}
            </button>
          </div>
        </div>

        {outcome && (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="font-semibold">
              {outcome.status === "REQUESTED"
                ? "Appointment request submitted"
                : outcome.status === "CANCELLED"
                  ? "Appointment cancelled"
                  : "Appointment confirmed"}
            </p>
            {outcome.startsAt && (
              <p className="mt-1">
                {new Intl.DateTimeFormat("en-US", {
                  timeZone: context.shop.timezone,
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }).format(new Date(outcome.startsAt))}
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
