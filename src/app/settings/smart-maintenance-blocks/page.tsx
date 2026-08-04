"use client";

import { useMemo, useState } from "react";
import { CalendarX, Copy, Plus, Save, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useDemoStore, type SmartMaintenanceBlockInput } from "@/lib/demo-store";
import type { SmartMaintenanceBlock } from "@/lib/demo-data";
import { isSmartMaintenanceBlocksEnabled } from "@/lib/feature-flags";
import { canManageShopSettings } from "@/lib/permissions";
import {
  calculateSmartMaintenanceBlockAvailability,
  minutesToTime,
  timeToMinutes,
  zonedTimeToUtcIso,
} from "@/lib/smart-maintenance-blocks";
import { currentDateInTimeZone, formatHours } from "@/lib/utils";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type FormState = {
  id?: string;
  name: string;
  description: string;
  isActive: boolean;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  serviceDefinitionIds: string[];
  maxVehicles: string;
  maxLaborMinutes: string;
  minimumNoticeHours: string;
  maximumHorizonDays: string;
  slotIntervalMinutes: "15" | "30" | "60";
  internalNotes: string;
};

function blankForm(shopTimezone: string, serviceDefinitionIds: string[] = []): FormState {
  void shopTimezone;
  return {
    name: "",
    description: "",
    isActive: true,
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "08:00",
    endTime: "12:00",
    serviceDefinitionIds,
    maxVehicles: "2",
    maxLaborMinutes: "180",
    minimumNoticeHours: "24",
    maximumHorizonDays: "30",
    slotIntervalMinutes: "30",
    internalNotes: "",
  };
}

function formFromBlock(block: SmartMaintenanceBlock): FormState {
  return {
    id: block.id,
    name: block.name,
    description: block.description,
    isActive: block.isActive,
    daysOfWeek: block.daysOfWeek,
    startTime: minutesToTime(block.startMinute),
    endTime: minutesToTime(block.endMinute),
    serviceDefinitionIds: block.serviceDefinitionIds,
    maxVehicles: String(block.maxVehicles),
    maxLaborMinutes: String(block.maxLaborMinutes),
    minimumNoticeHours: String(Math.round(block.minimumNoticeMinutes / 60)),
    maximumHorizonDays: String(block.maximumHorizonDays),
    slotIntervalMinutes: String(block.slotIntervalMinutes) as "15" | "30" | "60",
    internalNotes: block.internalNotes,
  };
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function formToInput(form: FormState, timezone: string): SmartMaintenanceBlockInput {
  return {
    id: form.id,
    name: form.name,
    description: form.description,
    isActive: form.isActive,
    timezone,
    daysOfWeek: form.daysOfWeek,
    startMinute: timeToMinutes(form.startTime),
    endMinute: timeToMinutes(form.endTime),
    serviceDefinitionIds: form.serviceDefinitionIds,
    maxVehicles: Number(form.maxVehicles) || 1,
    maxLaborMinutes: Number(form.maxLaborMinutes) || 15,
    minimumNoticeMinutes: (Number(form.minimumNoticeHours) || 0) * 60,
    maximumHorizonDays: Number(form.maximumHorizonDays) || 1,
    slotIntervalMinutes: Number(form.slotIntervalMinutes) as 15 | 30 | 60,
    internalNotes: form.internalNotes,
  };
}

export default function SmartMaintenanceBlocksPage() {
  const store = useDemoStore();
  const { state, ready } = store;
  const enabled = isSmartMaintenanceBlocksEnabled();
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const canManageSettings = canManageShopSettings(currentUser?.role);
  const activeServices = useMemo(
    () => state.services.filter((service) => service.isActive),
    [state.services],
  );
  const activeBlocks = useMemo(
    () => state.smartMaintenanceBlocks.filter((block) => !block.archivedAt),
    [state.smartMaintenanceBlocks],
  );
  const archivedBlocks = useMemo(
    () => state.smartMaintenanceBlocks.filter((block) => block.archivedAt),
    [state.smartMaintenanceBlocks],
  );
  const firstServiceIds = useMemo(
    () => activeServices.slice(0, 2).map((service) => service.id),
    [activeServices],
  );
  const [form, setForm] = useState<FormState>(() => {
    const firstBlock = state.smartMaintenanceBlocks.find((block) => !block.archivedAt);
    return firstBlock ? formFromBlock(firstBlock) : blankForm(state.shop.timezone, firstServiceIds);
  });
  const [selectedBlockId, setSelectedBlockId] = useState(form.id ?? "");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const today = currentDateInTimeZone(state.shop.timezone);
  const [blackout, setBlackout] = useState({
    blockId: selectedBlockId || "",
    date: today,
    startsAt: "08:00",
    endsAt: "17:00",
    reason: "",
    isFullDay: false,
  });

  const selectedServices = activeServices.filter((service) => form.serviceDefinitionIds.includes(service.id));
  const selectedBlock: SmartMaintenanceBlock = useMemo(() => ({
    id: form.id ?? "preview-smart-maintenance-block",
    shopId: state.shop.id,
    name: form.name || "Preview block",
    description: form.description,
    isActive: form.isActive,
    timezone: state.shop.timezone,
    daysOfWeek: form.daysOfWeek,
    startMinute: timeToMinutes(form.startTime),
    endMinute: timeToMinutes(form.endTime),
    serviceDefinitionIds: form.serviceDefinitionIds,
    maxVehicles: Number(form.maxVehicles) || 1,
    maxLaborMinutes: Number(form.maxLaborMinutes) || 15,
    minimumNoticeMinutes: (Number(form.minimumNoticeHours) || 0) * 60,
    maximumHorizonDays: Number(form.maximumHorizonDays) || 1,
    slotIntervalMinutes: Number(form.slotIntervalMinutes) as 15 | 30 | 60,
    approvalRequired: true,
    internalNotes: form.internalNotes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), [
    form.daysOfWeek,
    form.description,
    form.endTime,
    form.id,
    form.internalNotes,
    form.isActive,
    form.maximumHorizonDays,
    form.maxLaborMinutes,
    form.maxVehicles,
    form.minimumNoticeHours,
    form.name,
    form.serviceDefinitionIds,
    form.slotIntervalMinutes,
    form.startTime,
    state.shop.id,
    state.shop.timezone,
  ]);

  const previewSlots = useMemo(() => calculateSmartMaintenanceBlockAvailability({
    shop: { id: state.shop.id, timezone: state.shop.timezone },
    blocks: [selectedBlock],
    services: activeServices,
    selectedServiceIds: form.serviceDefinitionIds,
    appointments: state.appointments,
    blackouts: state.smartMaintenanceBlockBlackouts,
    dateFrom: today,
    dateTo: addDays(today, Math.min(Number(form.maximumHorizonDays) || 1, 45)),
  }).slice(0, 18), [
    activeServices,
    form.maximumHorizonDays,
    form.serviceDefinitionIds,
    selectedBlock,
    state.appointments,
    state.shop.id,
    state.shop.timezone,
    state.smartMaintenanceBlockBlackouts,
    today,
  ]);

  function editBlock(block: SmartMaintenanceBlock) {
    setSelectedBlockId(block.id);
    setForm(formFromBlock(block));
    setBlackout((current) => ({ ...current, blockId: block.id }));
    setMessage("");
  }

  function newBlock() {
    setSelectedBlockId("");
    setForm(blankForm(state.shop.timezone, firstServiceIds));
    setBlackout((current) => ({ ...current, blockId: "" }));
    setMessage("");
  }

  function toggleDay(day: number) {
    setForm((current) => ({
      ...current,
      daysOfWeek: current.daysOfWeek.includes(day)
        ? current.daysOfWeek.filter((value) => value !== day)
        : [...current.daysOfWeek, day].sort(),
    }));
  }

  function toggleService(serviceId: string) {
    setForm((current) => ({
      ...current,
      serviceDefinitionIds: current.serviceDefinitionIds.includes(serviceId)
        ? current.serviceDefinitionIds.filter((id) => id !== serviceId)
        : [...current.serviceDefinitionIds, serviceId],
    }));
  }

  async function saveBlock() {
    setSaving(true);
    const result = await store.saveSmartMaintenanceBlock(formToInput(form, state.shop.timezone));
    setSaving(false);
    setMessage(result.ok ? "Smart maintenance block saved." : result.message ?? "Unable to save block.");
  }

  async function saveBlackout() {
    const startMinute = timeToMinutes(blackout.isFullDay ? "00:00" : blackout.startsAt);
    const endMinute = timeToMinutes(blackout.isFullDay ? "23:59" : blackout.endsAt);
    const result = await store.saveSmartMaintenanceBlockBlackout({
      blockId: blackout.blockId || null,
      startsAt: zonedTimeToUtcIso(
        blackout.date,
        startMinute,
        state.shop.timezone,
      ),
      endsAt: zonedTimeToUtcIso(
        blackout.date,
        endMinute,
        state.shop.timezone,
      ),
      localDate: blackout.date,
      startMinute,
      endMinute,
      reason: blackout.reason,
      isFullDay: blackout.isFullDay,
    });
    setMessage(result.ok ? "Blackout saved." : result.message ?? "Unable to save blackout.");
  }

  if (!enabled) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Smart Maintenance Blocks</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">Controlled Capacity is disabled for this environment.</p>
        </div>
        <Card>
          <CardContent>
            <p className="text-sm font-semibold">This internal settings feature is currently unavailable.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Smart Maintenance Blocks</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">Loading authenticated shop settings.</p>
        </div>
      </div>
    );
  }

  if (!canManageSettings) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Smart Maintenance Blocks</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">Only owners and managers can manage recurring request windows.</p>
        </div>
        <Card>
          <CardContent>
            <p className="text-sm font-semibold">You do not have permission to manage shop settings.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Smart Maintenance Blocks</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">Controlled recurring request windows for {state.shop.name}.</p>
        </div>
        <button onClick={newBlock} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-800 hover:border-violet-300">
          <Plus className="h-4 w-4" />
          New block
        </button>
      </div>

      {message && <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium">{message}</p>}

      <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Blocks</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeBlocks.map((block) => (
              <button
                key={block.id}
                onClick={() => editBlock(block)}
                className={`w-full rounded-lg border p-3 text-left ${selectedBlockId === block.id ? "border-violet-950 bg-violet-50" : "border-zinc-200 bg-white"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{block.name}</p>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${block.isActive ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
                    {block.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-zinc-500">{block.serviceDefinitionIds.length} services · {block.maxVehicles} vehicles · {formatHours(block.maxLaborMinutes)}</p>
              </button>
            ))}
            {activeBlocks.length === 0 && (
              <p className="text-sm text-zinc-500">No blocks configured.</p>
            )}
            {archivedBlocks.length > 0 && (
              <div className="border-t border-zinc-100 pt-3">
                <p className="mb-2 text-xs font-semibold uppercase text-zinc-500">Archived</p>
                <div className="space-y-2">
                  {archivedBlocks.map((block) => (
                    <button
                      key={block.id}
                      onClick={() => editBlock(block)}
                      className={`w-full rounded-lg border p-3 text-left ${selectedBlockId === block.id ? "border-violet-950 bg-violet-50" : "border-zinc-200 bg-white"}`}
                    >
                      <p className="font-semibold">{block.name}</p>
                      <p className="mt-1 text-sm text-zinc-500">{block.serviceDefinitionIds.length} services · archived</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">{form.id ? "Edit Block" : "Create Block"}</h2>
              <p className="mt-1 text-sm text-zinc-500">Approval is required for every request in this MVP.</p>
            </div>
            {form.id && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => store.duplicateSmartMaintenanceBlock(form.id!)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold">
                  <Copy className="h-4 w-4" />
                  Duplicate
                </button>
                <button onClick={() => store.deleteSmartMaintenanceBlock(form.id!)} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700">
                  <Trash2 className="h-4 w-4" />
                  Archive
                </button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="text-sm font-medium">
                Name
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
              <label className="text-sm font-medium">
                Status
                <select value={form.isActive ? "active" : "inactive"} onChange={(event) => setForm({ ...form, isActive: event.target.value === "active" })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>

            <label className="block text-sm font-medium">
              Description
              <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={2} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-violet-500" />
            </label>

            <div className="grid gap-4 lg:grid-cols-4">
              <label className="text-sm font-medium">
                Starts
                <input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
              <label className="text-sm font-medium">
                Ends
                <input type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
              <label className="text-sm font-medium">
                Slot interval
                <select value={form.slotIntervalMinutes} onChange={(event) => setForm({ ...form, slotIntervalMinutes: event.target.value as "15" | "30" | "60" })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500">
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">60 minutes</option>
                </select>
              </label>
              <label className="text-sm font-medium">
                Horizon
                <input type="number" min="1" value={form.maximumHorizonDays} onChange={(event) => setForm({ ...form, maximumHorizonDays: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              {dayLabels.map((label, day) => (
                <button key={label} onClick={() => toggleDay(day)} className={`h-9 rounded-lg border px-3 text-sm font-semibold ${form.daysOfWeek.includes(day) ? "border-violet-950 bg-violet-950 text-white" : "border-zinc-200 text-zinc-700"}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <label className="text-sm font-medium">
                Max vehicles
                <input type="number" min="1" value={form.maxVehicles} onChange={(event) => setForm({ ...form, maxVehicles: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
              <label className="text-sm font-medium">
                Max labor minutes
                <input type="number" min="15" step="15" value={form.maxLaborMinutes} onChange={(event) => setForm({ ...form, maxLaborMinutes: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
              <label className="text-sm font-medium">
                Min notice hours
                <input type="number" min="0" value={form.minimumNoticeHours} onChange={(event) => setForm({ ...form, minimumNoticeHours: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
            </div>

            <div>
              <p className="text-sm font-semibold">Eligible services</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {activeServices.map((service) => (
                  <label key={service.id} className="flex items-start gap-2 rounded-lg border border-zinc-200 p-3 text-sm">
                    <input type="checkbox" checked={form.serviceDefinitionIds.includes(service.id)} onChange={() => toggleService(service.id)} className="mt-1 h-4 w-4 accent-violet-950" />
                    <span>
                      <span className="font-semibold">{service.name}</span>
                      <span className="block text-xs text-zinc-500">{service.category} · {formatHours(service.estimatedLaborMinutes)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <label className="block text-sm font-medium">
              Internal notes
              <textarea value={form.internalNotes} onChange={(event) => setForm({ ...form, internalNotes: event.target.value })} rows={2} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-violet-500" />
            </label>

            <label className="flex items-center gap-3 text-sm font-semibold text-zinc-700">
              <input type="checkbox" checked readOnly className="h-4 w-4 accent-violet-950" />
              Approval required
            </label>

            <div className="flex justify-end">
              <button onClick={saveBlock} disabled={saving || !form.name || form.serviceDefinitionIds.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save block"}
              </button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Preview</h2>
            <p className="mt-1 text-sm text-zinc-500">{selectedServices.length} selected services · {state.shop.timezone}</p>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {previewSlots.map((slot) => (
              <div key={slot.startsAt} className="rounded-lg border border-zinc-200 p-3">
                <p className="font-semibold">{slot.dateLabel}</p>
                <p className="mt-1 text-sm text-zinc-500">{slot.label} · {slot.blockName}</p>
                <p className="mt-2 text-xs text-zinc-500">{slot.remainingVehicles} vehicles and {formatHours(slot.remainingLaborMinutes)} left</p>
              </div>
            ))}
            {previewSlots.length === 0 && <p className="text-sm text-zinc-500">No available request times match this block.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Blackouts</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              <label className="text-sm font-medium">
                Scope
                <select value={blackout.blockId} onChange={(event) => setBlackout({ ...blackout, blockId: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500">
                  <option value="">All smart blocks</option>
                  {activeBlocks.map((block) => (
                    <option key={block.id} value={block.id}>{block.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                Date
                <input type="date" value={blackout.date} onChange={(event) => setBlackout({ ...blackout, date: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <input type="time" value={blackout.startsAt} onChange={(event) => setBlackout({ ...blackout, startsAt: event.target.value })} disabled={blackout.isFullDay} className="h-10 rounded-lg border border-zinc-200 px-3 outline-none disabled:bg-zinc-50" />
                <input type="time" value={blackout.endsAt} onChange={(event) => setBlackout({ ...blackout, endsAt: event.target.value })} disabled={blackout.isFullDay} className="h-10 rounded-lg border border-zinc-200 px-3 outline-none disabled:bg-zinc-50" />
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={blackout.isFullDay} onChange={(event) => setBlackout({ ...blackout, isFullDay: event.target.checked })} className="h-4 w-4 accent-violet-950" />
                Full day
              </label>
              <input value={blackout.reason} onChange={(event) => setBlackout({ ...blackout, reason: event.target.value })} placeholder="Reason" className="h-10 rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:border-violet-500" />
              <button onClick={saveBlackout} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold">
                <CalendarX className="h-4 w-4" />
                Add blackout
              </button>
            </div>

            <div className="space-y-2">
              {state.smartMaintenanceBlockBlackouts.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
                  <div>
                    <p className="font-semibold">{item.reason || "Unavailable"}</p>
                    <p className="mt-1 text-xs text-zinc-500">{new Date(item.startsAt).toLocaleString()} - {new Date(item.endsAt).toLocaleString()}</p>
                  </div>
                  <button onClick={() => store.deleteSmartMaintenanceBlockBlackout(item.id)} className="rounded-lg border border-zinc-200 p-2 text-zinc-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
