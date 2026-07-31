"use client";

import { FormEvent, useMemo, useState } from "react";
import { ArchiveRestore, Plus, Power, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useDemoStore, type ServiceDefinitionInput } from "@/lib/demo-store";
import { type BookingMode, type MaintenanceService, type ServiceBookingIntakeOption, type TimeIntervalUnit } from "@/lib/demo-data";
import { isCustomerBookingEnabled } from "@/lib/feature-flags";
import { formatInterval } from "@/lib/service-intervals";
import { formatCurrency, formatHours } from "@/lib/utils";

type ServiceFormState = {
  name: string;
  category: string;
  defaultMileageInterval: string;
  defaultTimeIntervalValue: string;
  defaultTimeIntervalUnit: TimeIntervalUnit;
  defaultPrice: string;
  laborHours: string;
  description: string;
  isActive: boolean;
  bookingEnabled: boolean;
  bookingMode: BookingMode;
  allowedIntakeType: ServiceBookingIntakeOption;
  bookingDurationMinutes: string;
  bufferBeforeMinutes: string;
  bufferAfterMinutes: string;
  minimumNoticeMinutes: string;
  maximumSimultaneousBookings: string;
  bookingWeekdays: number[];
  bookingStartTime: string;
  bookingEndTime: string;
};

const blankForm: ServiceFormState = {
  name: "",
  category: "Preventative Maintenance",
  defaultMileageInterval: "",
  defaultTimeIntervalValue: "",
  defaultTimeIntervalUnit: "MONTHS",
  defaultPrice: "",
  laborHours: "",
  description: "",
  isActive: true,
  bookingEnabled: false,
  bookingMode: "REQUEST",
  allowedIntakeType: "EITHER",
  bookingDurationMinutes: "60",
  bufferBeforeMinutes: "0",
  bufferAfterMinutes: "15",
  minimumNoticeMinutes: "",
  maximumSimultaneousBookings: "",
  bookingWeekdays: [1, 2, 3, 4, 5],
  bookingStartTime: "08:00",
  bookingEndTime: "15:00",
};

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesToTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return Math.min(1440, Math.max(0, hours * 60 + minutes));
}

function serviceToForm(service: MaintenanceService): ServiceFormState {
  const rule = service.bookingRule;
  const firstWindow = rule?.windows.find((window) => window.isActive) ?? rule?.windows[0];
  return {
    name: service.name,
    category: service.category,
    defaultMileageInterval: service.defaultMileageInterval?.toString() ?? "",
    defaultTimeIntervalValue: service.defaultTimeIntervalValue?.toString() ?? "",
    defaultTimeIntervalUnit: service.defaultTimeIntervalUnit,
    defaultPrice: (service.defaultPriceCents / 100).toString(),
    laborHours: (service.estimatedLaborMinutes / 60).toString(),
    description: service.description,
    isActive: service.isActive,
    bookingEnabled: rule?.bookingEnabled ?? false,
    bookingMode: rule?.bookingMode ?? "REQUEST",
    allowedIntakeType: rule?.allowedIntakeType ?? "EITHER",
    bookingDurationMinutes: String((rule?.estimatedDurationMinutes ?? service.estimatedLaborMinutes) || 60),
    bufferBeforeMinutes: String(rule?.bufferBeforeMinutes ?? 0),
    bufferAfterMinutes: String(rule?.bufferAfterMinutes ?? 15),
    minimumNoticeMinutes: rule?.minimumNoticeMinutes?.toString() ?? "",
    maximumSimultaneousBookings: rule?.maximumSimultaneousBookings?.toString() ?? "",
    bookingWeekdays: rule?.windows.filter((window) => window.isActive).map((window) => window.dayOfWeek) ?? [1, 2, 3, 4, 5],
    bookingStartTime: minutesToTime(firstWindow?.startMinute ?? 8 * 60),
    bookingEndTime: minutesToTime(firstWindow?.endMinute ?? 15 * 60),
  };
}

function parseOptionalInt(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function formToInput(form: ServiceFormState): ServiceDefinitionInput {
  return {
    name: form.name.trim(),
    category: form.category.trim() || "General",
    defaultMileageInterval: parseOptionalInt(form.defaultMileageInterval),
    defaultTimeIntervalValue: parseOptionalInt(form.defaultTimeIntervalValue),
    defaultTimeIntervalUnit: form.defaultTimeIntervalUnit,
    defaultNotificationThreshold: 10,
    estimatedLaborMinutes: Math.round((Number(form.laborHours) || 0) * 60),
    defaultPriceCents: Math.round((Number(form.defaultPrice) || 0) * 100),
    description: form.description.trim(),
    isActive: form.isActive,
  };
}

function ServiceEditor({
  service,
  customerBookingEnabled,
  onClose,
}: {
  service?: MaintenanceService;
  customerBookingEnabled: boolean;
  onClose: () => void;
}) {
  const store = useDemoStore();
  const [form, setForm] = useState<ServiceFormState>(service ? serviceToForm(service) : blankForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const title = service ? "Edit service default" : "Add service default";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const input = formToInput(form);
    if (!input.name) {
      setError("Service name is required.");
      return;
    }
    setSaving(true);
    const result = service
      ? await store.updateServiceDefinition(service.id, input)
      : await store.addServiceDefinition(input);
    if (result.ok && service && customerBookingEnabled) {
      const ruleResult = await store.saveServiceBookingRule(service.id, {
        bookingEnabled: form.bookingEnabled,
        bookingMode: form.bookingMode,
        estimatedDurationMinutes: Number(form.bookingDurationMinutes) || input.estimatedLaborMinutes || 60,
        bufferBeforeMinutes: Number(form.bufferBeforeMinutes) || 0,
        bufferAfterMinutes: Number(form.bufferAfterMinutes) || 0,
        allowedIntakeType: form.allowedIntakeType,
        minimumNoticeMinutes: form.minimumNoticeMinutes ? Number(form.minimumNoticeMinutes) : null,
        maximumAdvanceDays: null,
        maximumSimultaneousBookings: form.maximumSimultaneousBookings ? Number(form.maximumSimultaneousBookings) : null,
        weekdays: form.bookingWeekdays,
        startMinute: timeToMinutes(form.bookingStartTime),
        endMinute: timeToMinutes(form.bookingEndTime),
      });
      if (!ruleResult.ok) {
        setSaving(false);
        setError(ruleResult.message ?? "Unable to save booking rule.");
        return;
      }
    }
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "Unable to save service.");
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 p-5">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-zinc-500">Shop defaults are inherited by vehicles without overrides.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 p-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Service name</span>
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Category</span>
            <input
              value={form.category}
              onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Mileage interval</span>
            <input
              type="number"
              min="1"
              value={form.defaultMileageInterval}
              onChange={(event) => setForm((current) => ({ ...current, defaultMileageInterval: event.target.value }))}
              placeholder="Blank"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-[1fr_120px] gap-2 text-sm">
            <label className="space-y-1">
              <span className="font-medium">Time interval</span>
              <input
                type="number"
                min="1"
                value={form.defaultTimeIntervalValue}
                onChange={(event) => setForm((current) => ({ ...current, defaultTimeIntervalValue: event.target.value }))}
                placeholder="Blank"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
              />
            </label>
            <label className="space-y-1">
              <span className="font-medium">Unit</span>
              <select
                value={form.defaultTimeIntervalUnit}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  defaultTimeIntervalUnit: event.target.value as TimeIntervalUnit,
                }))}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
              >
                <option value="DAYS">Days</option>
                <option value="MONTHS">Months</option>
                <option value="YEARS">Years</option>
              </select>
            </label>
          </div>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Default price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.defaultPrice}
              onChange={(event) => setForm((current) => ({ ...current, defaultPrice: event.target.value }))}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Labor hours</span>
            <input
              type="number"
              min="0"
              step="0.25"
              value={form.laborHours}
              onChange={(event) => setForm((current) => ({ ...current, laborHours: event.target.value }))}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          {service && customerBookingEnabled && (
            <div className="space-y-4 rounded-lg border border-zinc-200 p-4 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={form.bookingEnabled}
                  onChange={(event) => setForm((current) => ({ ...current, bookingEnabled: event.target.checked }))}
                  className="h-4 w-4 accent-violet-950"
                />
                Available through customer booking links
              </label>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Booking mode</span>
                  <select
                    value={form.bookingMode}
                    onChange={(event) => setForm((current) => ({ ...current, bookingMode: event.target.value as BookingMode }))}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                  >
                    <option value="INSTANT">Book instantly</option>
                    <option value="REQUEST">Request appointment</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Intake</span>
                  <select
                    value={form.allowedIntakeType}
                    onChange={(event) => setForm((current) => ({ ...current, allowedIntakeType: event.target.value as ServiceBookingIntakeOption }))}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                  >
                    <option value="EITHER">Wait or drop-off</option>
                    <option value="WAIT_ONLY">Wait only</option>
                    <option value="DROP_OFF_ONLY">Drop-off only</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Duration minutes</span>
                  <input
                    type="number"
                    min="15"
                    value={form.bookingDurationMinutes}
                    onChange={(event) => setForm((current) => ({ ...current, bookingDurationMinutes: event.target.value }))}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Buffer before</span>
                  <input
                    type="number"
                    min="0"
                    value={form.bufferBeforeMinutes}
                    onChange={(event) => setForm((current) => ({ ...current, bufferBeforeMinutes: event.target.value }))}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Buffer after</span>
                  <input
                    type="number"
                    min="0"
                    value={form.bufferAfterMinutes}
                    onChange={(event) => setForm((current) => ({ ...current, bufferAfterMinutes: event.target.value }))}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Max simultaneous</span>
                  <input
                    type="number"
                    min="1"
                    value={form.maximumSimultaneousBookings}
                    onChange={(event) => setForm((current) => ({ ...current, maximumSimultaneousBookings: event.target.value }))}
                    placeholder="Shop default"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Notice minutes</span>
                  <input
                    type="number"
                    min="0"
                    value={form.minimumNoticeMinutes}
                    onChange={(event) => setForm((current) => ({ ...current, minimumNoticeMinutes: event.target.value }))}
                    placeholder="Shop default"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Starts</span>
                  <input
                    type="time"
                    value={form.bookingStartTime}
                    onChange={(event) => setForm((current) => ({ ...current, bookingStartTime: event.target.value }))}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Ends</span>
                  <input
                    type="time"
                    value={form.bookingEndTime}
                    onChange={(event) => setForm((current) => ({ ...current, bookingEndTime: event.target.value }))}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {dayLabels.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setForm((current) => ({
                      ...current,
                      bookingWeekdays: current.bookingWeekdays.includes(day)
                        ? current.bookingWeekdays.filter((item) => item !== day)
                        : [...current.bookingWeekdays, day].sort(),
                    }))}
                    className={`h-9 rounded-lg border px-3 text-sm font-semibold ${form.bookingWeekdays.includes(day) ? "border-violet-950 bg-violet-950 text-white" : "border-zinc-200 text-zinc-700"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="font-medium">Description</span>
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              className="min-h-24 w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              className="h-4 w-4 accent-violet-950"
            />
            <span>Active in service library</span>
          </label>
        </div>
        {error && <p className="px-5 pb-3 text-sm font-medium text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-zinc-100 p-5">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold">
            Cancel
          </button>
          <button disabled={saving} className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "Saving" : "Save service"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ServicesPage() {
  const { state, updateServiceDefinition } = useDemoStore();
  const customerBookingEnabled = isCustomerBookingEnabled();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const [activeFilter, setActiveFilter] = useState<"active" | "all">("active");
  const [editing, setEditing] = useState<MaintenanceService | null>(null);
  const [adding, setAdding] = useState(false);
  const categories = useMemo(() => {
    return ["All categories", ...Array.from(new Set(state.services.map((service) => service.category))).sort()];
  }, [state.services]);
  const services = state.services.filter((service) => {
    const matchesQuery = `${service.name} ${service.category} ${service.description}`
      .toLowerCase()
      .includes(query.toLowerCase());
    const matchesCategory = category === "All categories" || service.category === category;
    const matchesActive = activeFilter === "all" || service.isActive;
    return matchesQuery && matchesCategory && matchesActive;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Services Library</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Reusable shop defaults for maintenance intervals, labor, and pricing.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          Add service
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 sm:flex-row">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search services"
            className="w-full rounded-lg border border-zinc-200 py-2 pl-9 pr-3 text-sm"
          />
        </label>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
        >
          {categories.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <div className="inline-flex rounded-lg border border-zinc-200 p-1">
          {(["active", "all"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setActiveFilter(mode)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                activeFilter === mode ? "bg-violet-950 text-white" : "text-zinc-600"
              }`}
            >
              {mode === "active" ? "Active" : "All"}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Default Services</h2>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {services.map((service) => (
            <div key={service.id} className="rounded-lg border border-zinc-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{service.name}</h3>
                  <p className="mt-1 text-sm text-zinc-500">{service.category}</p>
                </div>
                <Badge variant={service.isActive ? "green" : "neutral"}>
                  {service.isActive ? "Active" : "Inactive"}
                </Badge>
                {customerBookingEnabled && (
                  <Badge variant={service.bookingRule?.bookingEnabled ? "purple" : "neutral"}>
                    {service.bookingRule?.bookingEnabled ? "Bookable" : "Not bookable"}
                  </Badge>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-zinc-500">Interval</p>
                  <p className="font-semibold">
                    {formatInterval(
                      service.defaultMileageInterval,
                      service.defaultTimeIntervalValue,
                      service.defaultTimeIntervalUnit,
                    )}
                  </p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-zinc-500">Type</p>
                  <p className="font-semibold">
                    {service.defaultMileageInterval || service.defaultTimeIntervalValue ? "Recurring" : "Non-recurring"}
                  </p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-zinc-500">Labor</p>
                  <p className="font-semibold">{formatHours(service.estimatedLaborMinutes)}</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <p className="text-zinc-500">Price</p>
                  <p className="font-semibold">{formatCurrency(service.defaultPriceCents)}</p>
                </div>
              </div>
              {service.description && <p className="mt-4 text-sm text-zinc-600">{service.description}</p>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={() => setEditing(service)}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold"
                >
                  Edit
                </button>
                <button
                  onClick={() => void updateServiceDefinition(service.id, { isActive: !service.isActive })}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold"
                >
                  {service.isActive ? <Power className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
                  {service.isActive ? "Deactivate" : "Restore"}
                </button>
              </div>
            </div>
          ))}
          {services.length === 0 && (
            <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500">
              No services match the current filters.
            </div>
          )}
        </CardContent>
      </Card>

      {adding && <ServiceEditor customerBookingEnabled={customerBookingEnabled} onClose={() => setAdding(false)} />}
      {editing && (
        <ServiceEditor
          service={editing}
          customerBookingEnabled={customerBookingEnabled}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
