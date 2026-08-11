"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CalendarClock, CheckCircle2, ShieldCheck } from "lucide-react";

type RequestContext = {
  shop: { name: string };
  customer: { firstName: string };
  vehicle: { year: number; make: string; model: string };
  services: Array<{ name: string; laborMinutes: number }>;
  slots: Array<{ startsAt: string; label: string; dateLabel: string }>;
  notice: string;
};

type ResolvedRequestContext = {
  shop: { name: string };
  vehicle: { label: string };
  services: Array<{ name: string; laborMinutes: number }>;
  requested: { startsAt: string; endsAt: string; label: string; dateLabel: string };
  notice: string;
};

type RequestState =
  | { state: "available"; context: RequestContext }
  | { state: "pending"; context: ResolvedRequestContext }
  | { state: "confirmed"; context: ResolvedRequestContext }
  | { state: "declined" | "expired" | "revoked" | "unavailable"; message: string };

const requestNotice =
  "This is an appointment request. The shop will confirm the time after reviewing its schedule.";

export default function AppointmentRequestPage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const [context, setContext] = useState<RequestContext | null>(null);
  const [resolved, setResolved] = useState<{ title: string; context: ResolvedRequestContext } | null>(null);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState<{ message: string; context: ResolvedRequestContext } | null>(null);
  const [error, setError] = useState("");
  const [idempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  useEffect(() => {
    async function loadContext() {
      if (!token) {
        setError("Appointment request link is not available.");
        setLoading(false);
        return;
      }
      const response = await fetch(`/api/request/${encodeURIComponent(token.trim())}/context`);
      const data = await response.json().catch(() => ({})) as RequestState;
      if (!response.ok) {
        setError("message" in data ? data.message : "This appointment request link could not be loaded.");
        setLoading(false);
        return;
      }
      if (data.state === "available") {
        setContext(data.context);
      } else if (data.state === "pending") {
        setResolved({ title: "Request received", context: data.context });
      } else if (data.state === "confirmed") {
        setResolved({ title: "Appointment confirmed", context: data.context });
      } else {
        setError(data.message);
      }
      setLoading(false);
    }
    void loadContext();
  }, [token]);

  async function submitRequest() {
    if (!selectedSlot) {
      setError("Choose a time to request.");
      return;
    }
    setSaving(true);
    setError("");
    const response = await fetch(`/api/request/${encodeURIComponent(token.trim())}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startsAt: selectedSlot,
        idempotencyKey,
      }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(data.message ?? "This time is no longer available. Choose another time.");
      return;
    }
    setSubmitted({
      message: data.message ?? `Your request was sent to ${context?.shop.name ?? "the shop"}. The shop will confirm the appointment or offer another time.`,
      context: data.context,
    });
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

  if (resolved && !context) {
    return <ResolvedState title={resolved.title} context={resolved.context} />;
  }

  if (!context) return null;

  const vehicleLabel = `${context.vehicle.year} ${context.vehicle.make} ${context.vehicle.model}`;

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-violet-800">{context.shop.name}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Request maintenance time</h1>
        <p className="mt-2 text-sm text-zinc-600">
          {context.customer.firstName}, choose a request time for {vehicleLabel}.
        </p>

        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {context.notice || requestNotice}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {context.services.map((service) => (
            <div key={service.name} className="rounded-lg border border-zinc-200 p-4">
              <p className="font-semibold">{service.name}</p>
              <p className="mt-1 text-sm text-zinc-500">{service.laborMinutes} minutes estimated duration</p>
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

        {context.slots.length === 0 && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            This request link is valid, but no request times are currently available. Please contact the shop.
          </p>
        )}

        {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {submitted && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4" />
            <div>
              <p className="font-semibold">Request received</p>
              <p>{submitted.message}</p>
              <p className="mt-2">{submitted.context.vehicle.label} · {submitted.context.services.map((service) => service.name).join(", ")} · {submitted.context.requested.dateLabel}, {submitted.context.requested.label}</p>
            </div>
          </div>
        )}

        <button
          onClick={submitRequest}
          disabled={saving || Boolean(submitted) || context.slots.length === 0}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          <CalendarClock className="h-4 w-4" />
          {saving ? "Sending request..." : "Request This Time"}
        </button>
      </section>
    </main>
  );
}

function ResolvedState({ title, context }: { title: string; context: ResolvedRequestContext }) {
  return (
    <main className="mx-auto grid min-h-screen max-w-2xl place-items-center p-6">
      <section className="w-full rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-700" />
          <p className="font-semibold">{title}</p>
        </div>
        <p className="mt-3 text-sm font-semibold text-violet-800">{context.shop.name}</p>
        <p className="mt-2 text-sm text-zinc-700">{context.vehicle.label}</p>
        <p className="mt-1 text-sm text-zinc-600">{context.services.map((service) => service.name).join(", ")}</p>
        <p className="mt-3 text-sm text-zinc-800">{context.requested.dateLabel}, {context.requested.label}</p>
      </section>
    </main>
  );
}
