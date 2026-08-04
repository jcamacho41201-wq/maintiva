"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarClock, CheckCircle2, ShieldCheck } from "lucide-react";
import { isAppointmentRequestsEnabled } from "@/lib/feature-flags";

type RequestContext = {
  shop: { name: string };
  customer: { firstName: string };
  vehicle: { label: string };
  services: Array<{ id: string; name: string; laborMinutes: number; priceCents: number }>;
  slots: Array<{ startsAt: string; label: string; dateLabel: string }>;
  notice: string;
};

const requestNotice =
  "This is an appointment request. The shop will confirm the time after reviewing its schedule.";

export default function AppointmentRequestPage() {
  const enabled = isAppointmentRequestsEnabled();
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [context, setContext] = useState<RequestContext | null>(null);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadContext() {
      if (!enabled) {
        setError("Appointment requests are not available.");
        setLoading(false);
        return;
      }
      const response = await fetch(`/api/request/${token}/context`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message ?? "This appointment request link could not be loaded.");
        setLoading(false);
        return;
      }
      setContext(data.context as RequestContext);
      setLoading(false);
    }
    void loadContext();
  }, [enabled, token]);

  async function submitRequest() {
    if (!selectedSlot) {
      setError("Choose a time to request.");
      return;
    }
    setSaving(true);
    setError("");
    const response = await fetch(`/api/request/${token}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startsAt: selectedSlot,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(data.message ?? "This time is no longer available. Choose another time.");
      return;
    }
    setSubmitted(data.message ?? `Your request was sent to ${context?.shop.name ?? "the shop"}. The shop will confirm the appointment or offer another time.`);
  }

  const slotsByDate = context?.slots.reduce<Record<string, RequestContext["slots"]>>((groups, slot) => {
    groups[slot.dateLabel] = [...(groups[slot.dateLabel] ?? []), slot];
    return groups;
  }, {}) ?? {};

  if (loading) {
    return <main className="grid min-h-screen place-items-center p-6 text-sm text-zinc-600">Loading request options...</main>;
  }

  if (error && !context) {
    return (
      <main className="mx-auto grid min-h-screen max-w-2xl place-items-center p-6">
        <section className="w-full rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-violet-800" />
            <p className="font-semibold">Appointment request unavailable</p>
          </div>
          <p className="mt-3 text-sm text-zinc-600">{error}</p>
        </section>
      </main>
    );
  }

  if (!context) return null;

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-violet-800">{context.shop.name}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Request maintenance time</h1>
        <p className="mt-2 text-sm text-zinc-600">
          {context.customer.firstName}, choose a request time for {context.vehicle.label}.
        </p>

        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {context.notice || requestNotice}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {context.services.map((service) => (
            <div key={service.id} className="rounded-lg border border-zinc-200 p-4">
              <p className="font-semibold">{service.name}</p>
              <p className="mt-1 text-sm text-zinc-500">{Math.round(service.laborMinutes / 6) / 10} hr estimated duration</p>
            </div>
          ))}
        </div>

        <div className="mt-6 space-y-4">
          {Object.entries(slotsByDate).map(([dateLabel, slots]) => (
            <section key={dateLabel}>
              <h2 className="text-sm font-semibold">{dateLabel}</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {slots.map((slot) => (
                  <button
                    key={slot.startsAt}
                    onClick={() => setSelectedSlot(slot.startsAt)}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold ${selectedSlot === slot.startsAt ? "border-violet-950 bg-violet-950 text-white" : "border-zinc-200 text-zinc-800"}`}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {submitted && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4" />
            <p>{submitted}</p>
          </div>
        )}

        <button
          onClick={submitRequest}
          disabled={saving || Boolean(submitted)}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          <CalendarClock className="h-4 w-4" />
          {saving ? "Sending request..." : "Request This Time"}
        </button>
      </section>
    </main>
  );
}
