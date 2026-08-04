"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, FileUp, Save, ShieldCheck, SquareStack } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useDemoStore } from "@/lib/demo-store";
import { isCustomerBookingEnabled, isSmartMaintenanceBlocksEnabled } from "@/lib/feature-flags";
import { canManageShopSettings } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesToTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return Math.min(1440, Math.max(0, hours * 60 + minutes));
}

export default function SettingsPage() {
  const { state, saveBookingSettings } = useDemoStore();
  const customerBookingEnabled = isCustomerBookingEnabled();
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const smartMaintenanceBlocksEnabled = isSmartMaintenanceBlocksEnabled() && canManageShopSettings(currentUser?.role);
  const settings = state.bookingSettings!;
  const [form, setForm] = useState({
    onlineBookingEnabled: settings.onlineBookingEnabled,
    minimumNoticeMinutes: String(settings.minimumNoticeMinutes),
    maximumAdvanceDays: String(settings.maximumAdvanceDays),
    defaultBufferBeforeMinutes: String(settings.defaultBufferBeforeMinutes),
    defaultBufferAfterMinutes: String(settings.defaultBufferAfterMinutes),
    maximumSimultaneousAppointments: String(settings.maximumSimultaneousAppointments),
    cancellationCutoffMinutes: String(settings.cancellationCutoffMinutes),
    reschedulingCutoffMinutes: String(settings.reschedulingCutoffMinutes),
  });
  const firstWindow = state.bookingWindows.find((window) => window.isActive) ?? state.bookingWindows[0];
  const activeDays = new Set(state.bookingWindows.filter((window) => window.isActive).map((window) => window.dayOfWeek));
  const [startTime, setStartTime] = useState(minutesToTime(firstWindow?.startMinute ?? 8 * 60));
  const [endTime, setEndTime] = useState(minutesToTime(firstWindow?.endMinute ?? 17 * 60));
  const [weekdays, setWeekdays] = useState<number[]>([...activeDays].length ? [...activeDays] : [1, 2, 3, 4, 5]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const result = await saveBookingSettings({
      id: settings.id,
      shopId: state.shop.id,
      onlineBookingEnabled: form.onlineBookingEnabled,
      minimumNoticeMinutes: Number(form.minimumNoticeMinutes) || 0,
      maximumAdvanceDays: Number(form.maximumAdvanceDays) || 30,
      defaultBufferBeforeMinutes: Number(form.defaultBufferBeforeMinutes) || 0,
      defaultBufferAfterMinutes: Number(form.defaultBufferAfterMinutes) || 0,
      maximumSimultaneousAppointments: Number(form.maximumSimultaneousAppointments) || 1,
      cancellationCutoffMinutes: Number(form.cancellationCutoffMinutes) || 0,
      reschedulingCutoffMinutes: Number(form.reschedulingCutoffMinutes) || 0,
      windows: weekdays.map((dayOfWeek) => ({
        dayOfWeek,
        startMinute: timeToMinutes(startTime),
        endMinute: timeToMinutes(endTime),
        isActive: true,
      })),
    });
    setSaving(false);
    setMessage(result.ok ? "Booking settings saved." : result.message ?? "Booking settings could not be saved.");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600">
          Configure pilot data, communication controls, and shop capacity.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "Import Mappings",
            description: "Load customer, vehicle, service, declined-work, and appointment CSV files.",
            href: "/import",
            icon: FileUp,
          },
          {
            title: "Shop Capacity",
            description: "Set daily bay-hour assumptions used by capacity planning and revenue recovery.",
            href: "/capacity",
            icon: CalendarClock,
          },
          ...(smartMaintenanceBlocksEnabled ? [{
            title: "Smart Maintenance Blocks",
            description: "Control recurring request windows by service, vehicle count, and labor minutes.",
            href: "/settings/smart-maintenance-blocks",
            icon: SquareStack,
          }] : []),
          {
            title: "Tenant Controls",
            description: "Authenticated pilot data stays scoped to the current shop context.",
            href: "/privacy",
            icon: ShieldCheck,
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.title} href={item.href}>
              <Card className="h-full transition hover:border-violet-300 hover:bg-violet-50/40">
                <CardContent>
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-violet-50 text-violet-900">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 font-semibold">{item.title}</h2>
                  <p className="mt-2 text-sm text-zinc-600">{item.description}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>

      {customerBookingEnabled && (
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Customer Self-Scheduling</h2>
          <p className="mt-1 text-sm text-zinc-500">Shop-level guardrails for booking links generated from the Revenue Queue.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {message && <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium">{message}</p>}
          <label className="flex items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={form.onlineBookingEnabled}
              onChange={(event) => setForm((current) => ({ ...current, onlineBookingEnabled: event.target.checked }))}
              className="h-4 w-4 accent-violet-950"
            />
            Online booking enabled
          </label>

          <div className="grid gap-4 md:grid-cols-4">
            {[
              ["Minimum notice", "minimumNoticeMinutes", "minutes"],
              ["Book ahead", "maximumAdvanceDays", "days"],
              ["Buffer before", "defaultBufferBeforeMinutes", "minutes"],
              ["Buffer after", "defaultBufferAfterMinutes", "minutes"],
              ["Simultaneous appointments", "maximumSimultaneousAppointments", "count"],
              ["Cancellation cutoff", "cancellationCutoffMinutes", "minutes"],
              ["Rescheduling cutoff", "reschedulingCutoffMinutes", "minutes"],
            ].map(([label, key, suffix]) => (
              <label key={key} className="text-sm font-medium">
                {label}
                <div className="mt-2 grid grid-cols-[1fr_auto] overflow-hidden rounded-lg border border-zinc-200">
                  <input
                    type="number"
                    min="0"
                    value={form[key as keyof typeof form] as string}
                    onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                    className="h-10 min-w-0 px-3 outline-none"
                  />
                  <span className="grid place-items-center border-l border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-500">{suffix}</span>
                </div>
              </label>
            ))}
          </div>

          <div className="rounded-lg border border-zinc-200 p-4">
            <p className="text-sm font-semibold">Weekly availability</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {dayLabels.map((label, day) => (
                <button
                  key={label}
                  onClick={() => setWeekdays((current) =>
                    current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort(),
                  )}
                  className={`h-9 rounded-lg border px-3 text-sm font-semibold ${weekdays.includes(day) ? "border-violet-950 bg-violet-950 text-white" : "border-zinc-200 text-zinc-700"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Opens
                <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
              <label className="text-sm font-medium">
                Closes
                <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              These windows define when public booking links may show times. Dedicated blackout editing can build on the installed schema.
            </p>
            <input type="hidden" value={`${timeToMinutes(startTime)}-${timeToMinutes(endTime)}-${weekdays.join(",")}`} readOnly />
          </div>

          {state.bookingBlackouts.length > 0 && (
            <div className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm font-semibold">Blackouts</p>
              <div className="mt-3 grid gap-2">
                {state.bookingBlackouts.map((blackout) => (
                  <div key={blackout.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>{blackout.reason ?? "Shop unavailable"}</span>
                    <span className="text-zinc-500">{formatDate(blackout.startsAt)} - {formatDate(blackout.endsAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save booking settings"}
            </button>
          </div>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Pilot Configuration</h2>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {[
            ["Communication mode", "Manual copy, advisor confirmation, no live SMS/email delivery"],
            ["Revenue attribution", "Maintiva outreach source on booked and completed appointments"],
            ["Duplicate detection", "Customer email, phone, vehicle VIN, and exact customer name"],
            ["Security posture", "Server-side authenticated shop context, browser shop IDs rejected"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm text-zinc-500">{label}</p>
              <p className="mt-1 font-semibold">{value}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
