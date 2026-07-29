"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import {
  Archive,
  ClipboardCheck,
  Gauge,
  History,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  Wrench,
  X,
} from "lucide-react";
import { RecommendationModal } from "@/components/recommendation-modal";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  getRecommendedRecords,
  vehicleLabel,
} from "@/lib/demo-calculations";
import { type MaintenanceService, type OutreachThresholdType, type TimeIntervalUnit, type Vehicle, type VehicleMaintenanceRecord } from "@/lib/demo-data";
import { type MaintenanceItemInput, useDemoStore } from "@/lib/demo-store";
import { formatInterval, resolveMaintenanceInterval } from "@/lib/service-intervals";
import { formatCurrency, formatDate, formatHours } from "@/lib/utils";

type PlanFormState = {
  serviceDefinitionId: string;
  customServiceName: string;
  customCategory: string;
  addToLibrary: boolean;
  useShopDefaults: boolean;
  mileageInterval: string;
  timeIntervalValue: string;
  timeIntervalUnit: TimeIntervalUnit;
  price: string;
  laborHours: string;
  lastCompletedDate: string;
  lastCompletedMileage: string;
  outreachThresholdType: OutreachThresholdType;
  outreachThresholdValue: string;
  notes: string;
  confirmDuplicate: boolean;
  updateShopDefault: boolean;
};

function opportunityLabel(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function parseOptionalInt(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function parseRequiredInt(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function serviceDefaults(service?: MaintenanceService) {
  return {
    mileageInterval: service?.defaultMileageInterval?.toString() ?? "",
    timeIntervalValue: service?.defaultTimeIntervalValue?.toString() ?? "",
    timeIntervalUnit: service?.defaultTimeIntervalUnit ?? "MONTHS" as TimeIntervalUnit,
    price: service ? (service.defaultPriceCents / 100).toString() : "",
    laborHours: service ? (service.estimatedLaborMinutes / 60).toString() : "",
  };
}

function maintenanceToForm(record: VehicleMaintenanceRecord, service?: MaintenanceService): PlanFormState {
  const defaults = serviceDefaults(service);
  return {
    serviceDefinitionId: record.serviceId ?? "",
    customServiceName: record.customServiceName ?? record.serviceName,
    customCategory: record.customCategory ?? service?.category ?? "Custom",
    addToLibrary: false,
    useShopDefaults: Boolean(service && record.mileageIntervalOverride == null && record.timeIntervalValueOverride == null && record.priceOverrideCents == null && record.laborMinutesOverride == null),
    mileageInterval: record.mileageIntervalOverride?.toString() ?? defaults.mileageInterval,
    timeIntervalValue: record.timeIntervalValueOverride?.toString() ?? defaults.timeIntervalValue,
    timeIntervalUnit: record.timeIntervalUnitOverride ?? defaults.timeIntervalUnit,
    price: ((record.priceOverrideCents ?? service?.defaultPriceCents ?? record.priceCents) / 100).toString(),
    laborHours: ((record.laborMinutesOverride ?? service?.estimatedLaborMinutes ?? Math.round(record.laborHours * 60)) / 60).toString(),
    lastCompletedDate: record.lastCompletedDate,
    lastCompletedMileage: record.lastCompletedMileage.toString(),
    outreachThresholdType: record.outreachThresholdType ?? "MILES_BEFORE_DUE",
    outreachThresholdValue: (record.outreachThresholdValue ?? 500).toString(),
    notes: record.notes ?? "",
    confirmDuplicate: false,
    updateShopDefault: false,
  };
}

function blankMaintenanceForm(services: MaintenanceService[]): PlanFormState {
  const service = services.find((item) => item.isActive) ?? services[0];
  const defaults = serviceDefaults(service);
  return {
    serviceDefinitionId: service?.id ?? "CUSTOM",
    customServiceName: "",
    customCategory: "Custom",
    addToLibrary: false,
    useShopDefaults: Boolean(service),
    mileageInterval: defaults.mileageInterval,
    timeIntervalValue: defaults.timeIntervalValue,
    timeIntervalUnit: defaults.timeIntervalUnit,
    price: defaults.price,
    laborHours: defaults.laborHours,
    lastCompletedDate: new Date().toISOString().slice(0, 10),
    lastCompletedMileage: "",
    outreachThresholdType: "MILES_BEFORE_DUE",
    outreachThresholdValue: "500",
    notes: "",
    confirmDuplicate: false,
    updateShopDefault: false,
  };
}

function formToMaintenanceInput(vehicleId: string, form: PlanFormState): MaintenanceItemInput {
  const selectedServiceId = form.serviceDefinitionId === "CUSTOM" ? null : form.serviceDefinitionId;
  const useDefaults = Boolean(selectedServiceId && form.useShopDefaults);
  return {
    vehicleId,
    serviceDefinitionId: selectedServiceId,
    customServiceName: selectedServiceId ? undefined : form.customServiceName.trim(),
    customCategory: selectedServiceId ? undefined : form.customCategory.trim(),
    addToLibrary: !selectedServiceId && form.addToLibrary,
    useShopDefaults: useDefaults,
    allowDuplicate: form.confirmDuplicate,
    mileageIntervalOverride: useDefaults ? null : parseOptionalInt(form.mileageInterval),
    timeIntervalValueOverride: useDefaults ? null : parseOptionalInt(form.timeIntervalValue),
    timeIntervalUnitOverride: useDefaults ? null : form.timeIntervalUnit,
    priceOverrideCents: useDefaults ? null : Math.round((Number(form.price) || 0) * 100),
    laborMinutesOverride: useDefaults ? null : Math.round((Number(form.laborHours) || 0) * 60),
    lastCompletedDate: form.lastCompletedDate,
    lastCompletedMileage: parseOptionalInt(form.lastCompletedMileage),
    outreachThresholdType: form.outreachThresholdType,
    outreachThresholdValue: parseRequiredInt(form.outreachThresholdValue) || 500,
    notes: form.notes.trim(),
  };
}

function DetailTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3 text-sm">
      <p className="text-zinc-500">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function MileageModal({
  vehicle,
  onClose,
}: {
  vehicle: Vehicle;
  onClose: () => void;
}) {
  const store = useDemoStore();
  const [mileage, setMileage] = useState(vehicle.currentMileage.toString());
  const [allowLower, setAllowLower] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentMileage = parseRequiredInt(mileage);
    if (currentMileage < vehicle.currentMileage && (!allowLower || !reason.trim())) {
      setError("Lower mileage requires a correction reason.");
      return;
    }
    const result = await store.updateVehicleMileage({
      vehicleId: vehicle.id,
      currentMileage,
      allowLowerCorrection: allowLower,
      correctionReason: reason.trim() || undefined,
    });
    if (!result.ok) {
      setError(result.message ?? "Unable to update mileage.");
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 p-5">
          <h2 className="text-lg font-semibold">Update mileage</h2>
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 p-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Current mileage</span>
            <input
              type="number"
              min="0"
              value={mileage}
              onChange={(event) => setMileage(event.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          {parseRequiredInt(mileage) < vehicle.currentMileage && (
            <div className="space-y-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm">
              <label className="flex items-center gap-2 font-medium text-yellow-900">
                <input
                  type="checkbox"
                  checked={allowLower}
                  onChange={(event) => setAllowLower(event.target.checked)}
                  className="h-4 w-4 accent-violet-950"
                />
                Confirm mileage correction
              </label>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Correction reason"
                className="min-h-20 w-full rounded-lg border border-yellow-200 px-3 py-2"
              />
            </div>
          )}
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-100 p-5">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold">
            Cancel
          </button>
          <button className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">
            <Save className="h-4 w-4" />
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function MaintenanceItemModal({
  vehicle,
  record,
  onClose,
}: {
  vehicle: Vehicle;
  record?: VehicleMaintenanceRecord;
  onClose: () => void;
}) {
  const store = useDemoStore();
  const services = store.state.services;
  const initialService = record ? services.find((item) => item.id === record.serviceId) : undefined;
  const [form, setForm] = useState<PlanFormState>(
    record ? maintenanceToForm(record, initialService) : blankMaintenanceForm(services),
  );
  const [error, setError] = useState("");
  const selectedService = services.find((item) => item.id === form.serviceDefinitionId);
  const selectedDuplicate = Boolean(
    selectedService &&
    !record &&
    store.state.maintenanceRecords.some((item) =>
      item.vehicleId === vehicle.id &&
      item.serviceId === selectedService.id &&
      item.isActive !== false,
    ),
  );

  function applyService(serviceId: string) {
    const service = services.find((item) => item.id === serviceId);
    const defaults = serviceDefaults(service);
    setForm((current) => ({
      ...current,
      serviceDefinitionId: serviceId,
      useShopDefaults: serviceId !== "CUSTOM",
      mileageInterval: defaults.mileageInterval,
      timeIntervalValue: defaults.timeIntervalValue,
      timeIntervalUnit: defaults.timeIntervalUnit,
      price: defaults.price,
      laborHours: defaults.laborHours,
      confirmDuplicate: false,
    }));
  }

  async function resetToDefaults() {
    if (!record) return;
    const result = await store.updateMaintenanceItem(record.id, { useShopDefaults: true });
    if (!result.ok) {
      setError(result.message ?? "Unable to reset interval.");
      return;
    }
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (form.serviceDefinitionId === "CUSTOM" && !form.customServiceName.trim()) {
      setError("Custom service name is required.");
      return;
    }
    if (selectedDuplicate && !form.confirmDuplicate) {
      setError("Confirm the duplicate active service before adding it.");
      return;
    }
    const input = formToMaintenanceInput(vehicle.id, form);
    if (record && form.updateShopDefault && selectedService) {
      await store.updateServiceDefinition(selectedService.id, {
        defaultMileageInterval: parseOptionalInt(form.mileageInterval),
        defaultTimeIntervalValue: parseOptionalInt(form.timeIntervalValue),
        defaultTimeIntervalUnit: form.timeIntervalUnit,
        defaultPriceCents: Math.round((Number(form.price) || 0) * 100),
        estimatedLaborMinutes: Math.round((Number(form.laborHours) || 0) * 60),
      });
    }
    const result = record
      ? await store.updateMaintenanceItem(record.id, input)
      : await store.addMaintenanceItem(input);
    if (!result.ok) {
      setError(result.message ?? "Unable to save maintenance item.");
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 p-5">
          <div>
            <h2 className="text-lg font-semibold">{record ? "Edit interval" : "Add maintenance item"}</h2>
            {record && <p className="mt-1 text-sm font-medium text-violet-700">This change applies only to this vehicle.</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 p-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-5 p-5">
          {!record && (
            <label className="space-y-1 text-sm">
              <span className="font-medium">Service</span>
              <select
                value={form.serviceDefinitionId}
                onChange={(event) => applyService(event.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
              >
                {services.filter((service) => service.isActive).map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} · {service.category}
                  </option>
                ))}
                <option value="CUSTOM">Custom vehicle service</option>
              </select>
            </label>
          )}

          {form.serviceDefinitionId === "CUSTOM" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Custom service name</span>
                <input
                  value={form.customServiceName}
                  onChange={(event) => setForm((current) => ({ ...current, customServiceName: event.target.value }))}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Category</span>
                <input
                  value={form.customCategory}
                  onChange={(event) => setForm((current) => ({ ...current, customCategory: event.target.value }))}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.addToLibrary}
                  onChange={(event) => setForm((current) => ({ ...current, addToLibrary: event.target.checked }))}
                  className="h-4 w-4 accent-violet-950"
                />
                <span>Also add this service to the Shop Service Library</span>
              </label>
            </div>
          )}

          {selectedService && (
            <div className="rounded-lg border border-zinc-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">Shop default</p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {formatInterval(
                      selectedService.defaultMileageInterval,
                      selectedService.defaultTimeIntervalValue,
                      selectedService.defaultTimeIntervalUnit,
                    )} · {formatCurrency(selectedService.defaultPriceCents)} · {formatHours(selectedService.estimatedLaborMinutes)}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={form.useShopDefaults}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      const defaults = serviceDefaults(selectedService);
                      setForm((current) => ({
                        ...current,
                        useShopDefaults: checked,
                        ...(checked ? defaults : {}),
                      }));
                    }}
                    className="h-4 w-4 accent-violet-950"
                  />
                  Keep shop defaults
                </label>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Mileage interval</span>
              <input
                type="number"
                min="1"
                value={form.mileageInterval}
                disabled={form.useShopDefaults}
                onChange={(event) => setForm((current) => ({ ...current, mileageInterval: event.target.value, useShopDefaults: false }))}
                placeholder="Blank"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-100"
              />
            </label>
            <div className="grid grid-cols-[1fr_120px] gap-2 text-sm">
              <label className="space-y-1">
                <span className="font-medium">Time interval</span>
                <input
                  type="number"
                  min="1"
                  value={form.timeIntervalValue}
                  disabled={form.useShopDefaults}
                  onChange={(event) => setForm((current) => ({ ...current, timeIntervalValue: event.target.value, useShopDefaults: false }))}
                  placeholder="Blank"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-100"
                />
              </label>
              <label className="space-y-1">
                <span className="font-medium">Unit</span>
                <select
                  value={form.timeIntervalUnit}
                  disabled={form.useShopDefaults}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    timeIntervalUnit: event.target.value as TimeIntervalUnit,
                    useShopDefaults: false,
                  }))}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-100"
                >
                  <option value="DAYS">Days</option>
                  <option value="MONTHS">Months</option>
                  <option value="YEARS">Years</option>
                </select>
              </label>
            </div>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Price</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                disabled={form.useShopDefaults}
                onChange={(event) => setForm((current) => ({ ...current, price: event.target.value, useShopDefaults: false }))}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-100"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Labor hours</span>
              <input
                type="number"
                min="0"
                step="0.25"
                value={form.laborHours}
                disabled={form.useShopDefaults}
                onChange={(event) => setForm((current) => ({ ...current, laborHours: event.target.value, useShopDefaults: false }))}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-100"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Last completed date</span>
              <input
                type="date"
                value={form.lastCompletedDate}
                onChange={(event) => setForm((current) => ({ ...current, lastCompletedDate: event.target.value }))}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Last completed mileage</span>
              <input
                type="number"
                min="0"
                value={form.lastCompletedMileage}
                onChange={(event) => setForm((current) => ({ ...current, lastCompletedMileage: event.target.value }))}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Outreach threshold</span>
              <select
                value={form.outreachThresholdType}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  outreachThresholdType: event.target.value as OutreachThresholdType,
                  outreachThresholdValue: event.target.value === "MILES_BEFORE_DUE" ? "500" : event.target.value === "DAYS_BEFORE_DUE" ? "30" : "10",
                }))}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
              >
                <option value="MILES_BEFORE_DUE">Miles before due</option>
                <option value="DAYS_BEFORE_DUE">Days before due</option>
                <option value="PERCENT_REMAINING">Percent remaining</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Threshold value</span>
              <input
                type="number"
                min="1"
                value={form.outreachThresholdValue}
                onChange={(event) => setForm((current) => ({ ...current, outreachThresholdValue: event.target.value }))}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-medium">Notes</span>
              <textarea
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                className="min-h-20 w-full rounded-lg border border-zinc-200 px-3 py-2"
              />
            </label>
          </div>

          {record && selectedService && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
              <label className="flex items-center gap-2 font-medium text-violet-900">
                <input
                  type="checkbox"
                  checked={form.updateShopDefault}
                  onChange={(event) => setForm((current) => ({ ...current, updateShopDefault: event.target.checked }))}
                  className="h-4 w-4 accent-violet-950"
                />
                Update shop default separately
              </label>
              <button
                type="button"
                onClick={() => void resetToDefaults()}
                className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 font-semibold text-violet-950"
              >
                <RotateCcw className="h-4 w-4" />
                Reset to default
              </button>
            </div>
          )}

          {selectedDuplicate && (
            <label className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm font-medium text-yellow-900">
              <input
                type="checkbox"
                checked={form.confirmDuplicate}
                onChange={(event) => setForm((current) => ({ ...current, confirmDuplicate: event.target.checked }))}
                className="h-4 w-4 accent-violet-950"
              />
              Confirm duplicate active service for this vehicle
            </label>
          )}

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-100 p-5">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold">
            Cancel
          </button>
          <button className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">
            Save item
          </button>
        </div>
      </form>
    </div>
  );
}

function CompleteServiceModal({
  record,
  vehicle,
  service,
  onClose,
}: {
  record: VehicleMaintenanceRecord;
  vehicle: Vehicle;
  service?: MaintenanceService;
  onClose: () => void;
}) {
  const store = useDemoStore();
  const effective = resolveMaintenanceInterval({ record, service, vehicle });
  const [completedAt, setCompletedAt] = useState(new Date().toISOString().slice(0, 10));
  const [completedMileage, setCompletedMileage] = useState(vehicle.currentMileage.toString());
  const [price, setPrice] = useState((effective.priceCents / 100).toString());
  const [laborHours, setLaborHours] = useState((effective.laborMinutes / 60).toString());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await store.markMaintenanceServiceComplete({
      maintenanceRecordId: record.id,
      completedAt,
      completedMileage: parseRequiredInt(completedMileage),
      finalPriceCents: Math.round((Number(price) || 0) * 100),
      finalLaborMinutes: Math.round((Number(laborHours) || 0) * 60),
      notes: notes.trim(),
    });
    if (!result.ok) {
      setError(result.message ?? "Unable to mark service complete.");
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 p-5">
          <h2 className="text-lg font-semibold">Mark service complete</h2>
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 p-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Completed date</span>
            <input type="date" value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Completed mileage</span>
            <input type="number" min="0" value={completedMileage} onChange={(event) => setCompletedMileage(event.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Final price</span>
            <input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Labor hours</span>
            <input type="number" min="0" step="0.25" value={laborHours} onChange={(event) => setLaborHours(event.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="font-medium">Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-20 w-full rounded-lg border border-zinc-200 px-3 py-2" />
          </label>
          {error && <p className="text-sm font-medium text-red-600 sm:col-span-2">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-100 p-5">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold">
            Cancel
          </button>
          <button className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">
            <ClipboardCheck className="h-4 w-4" />
            Complete
          </button>
        </div>
      </form>
    </div>
  );
}

export default function VehicleMaintenancePage() {
  const params = useParams<{ vehicleId: string }>();
  const store = useDemoStore();
  const { state } = store;
  const [recommendationOpen, setRecommendationOpen] = useState(false);
  const [mileageOpen, setMileageOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<VehicleMaintenanceRecord | null>(null);
  const [completeRecord, setCompleteRecord] = useState<VehicleMaintenanceRecord | null>(null);
  const [historyFilter, setHistoryFilter] = useState<string | null>(null);
  const vehicle = state.vehicles.find((item) => item.id === params.vehicleId);

  const servicesById = useMemo(() => new Map(state.services.map((service) => [service.id, service])), [state.services]);

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
  if (!customer) return null;

  const maintenance = state.maintenanceRecords
    .filter((item) => item.vehicleId === vehicle.id && item.isActive !== false)
    .map((record) => ({
      record,
      service: record.serviceId ? servicesById.get(record.serviceId) : undefined,
      effective: resolveMaintenanceInterval({
        record,
        service: record.serviceId ? servicesById.get(record.serviceId) : undefined,
        vehicle,
      }),
    }))
    .sort((a, b) => a.effective.lifeRemaining - b.effective.lifeRemaining);
  const recommended = getRecommendedRecords(state, vehicle.id).map(({ record }) => record);
  const openRecommended = recommended.filter((record) => record.outreachStatus !== "SCHEDULED");
  const predictedAnnualRevenue = maintenance
    .filter((item) => ["DUE_SOON", "DUE", "OVERDUE"].includes(item.effective.status))
    .reduce((sum, item) => sum + item.effective.priceCents, 0);
  const opportunityStatus =
    recommended.length > 0 && recommended.every((record) => record.outreachStatus === "SCHEDULED")
      ? "SCHEDULED"
      : recommended.some((record) => record.outreachStatus === "MANUALLY_SENT")
        ? "MANUALLY_SENT"
        : recommended.some((record) => record.outreachStatus === "DRAFTED")
          ? "DRAFTED"
          : "NEEDS_OUTREACH";
  const history = state.serviceRecords
    .filter((record) => record.vehicleId === vehicle.id)
    .filter((record) => !historyFilter || record.serviceName === historyFilter)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-violet-700">
            {customer.firstName} {customer.lastName}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{vehicleLabel(vehicle)}</h1>
          <p className="mt-2 text-sm text-zinc-600">
            VIN {vehicle.vin} · {vehicle.engine || "Engine not recorded"} · {vehicle.trim || "Trim not recorded"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setMileageOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold"
          >
            <Gauge className="h-4 w-4" />
            Update mileage
          </button>
          <button
            onClick={() => setRecommendationOpen(true)}
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
          ["Plan items", `${maintenance.length}`],
          ["Vehicle health", `${vehicle.overallHealth}%`],
          ["Open revenue", formatCurrency(predictedAnnualRevenue)],
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
            <h2 className="text-lg font-semibold">Maintenance Plan</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Vehicle-specific intervals inherit shop defaults until an advisor overrides them.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant(opportunityStatus)}>
              {opportunityLabel(opportunityStatus)}
            </Badge>
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              Add maintenance item
            </button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          {maintenance.map(({ record, service, effective }) => (
            <div key={record.id} className="rounded-lg border border-zinc-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{effective.serviceName}</h3>
                    <Badge variant={effective.usesShopDefault ? "purple" : "neutral"}>{effective.sourceLabel}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    Last completed {record.lastCompletedDate ? formatDate(record.lastCompletedDate) : "not recorded"} at {record.lastCompletedMileage?.toLocaleString() ?? "unknown"} mi
                  </p>
                </div>
                <Badge variant={statusVariant(effective.status)}>
                  {opportunityLabel(effective.status)}
                </Badge>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span>{effective.dueText}</span>
                  <span className="font-semibold">{effective.lifeRemaining}% interval remaining</span>
                </div>
                <Progress value={effective.lifeRemaining} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <DetailTile label="Effective interval" value={formatInterval(effective.mileageInterval, effective.timeIntervalValue, effective.timeIntervalUnit)} />
                <DetailTile label="Current mileage" value={`${vehicle.currentMileage.toLocaleString()} mi`} />
                <DetailTile label="Next due mileage" value={effective.nextDueMileage ? `${effective.nextDueMileage.toLocaleString()} mi` : "Not calculated"} />
                <DetailTile label="Next due date" value={effective.nextDueDate ? formatDate(effective.nextDueDate) : "Not calculated"} />
                <DetailTile label="Price" value={formatCurrency(effective.priceCents)} />
                <DetailTile label="Labor" value={formatHours(effective.laborMinutes)} />
              </div>

              <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600">
                <p>{effective.triggerText}</p>
                {effective.thresholdCause && <p className="mt-1 font-medium">Triggered by {effective.thresholdCause}.</p>}
                {service && !effective.usesShopDefault && (
                  <p className="mt-1">Shop default: {formatInterval(service.defaultMileageInterval, service.defaultTimeIntervalValue, service.defaultTimeIntervalUnit)}</p>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => setEditingRecord(record)}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold"
                >
                  <Wrench className="h-4 w-4" />
                  Edit interval
                </button>
                <button
                  onClick={() => setCompleteRecord(record)}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold"
                >
                  <ClipboardCheck className="h-4 w-4" />
                  Mark complete
                </button>
                <button
                  onClick={() => setHistoryFilter((current) => current === effective.serviceName ? null : effective.serviceName)}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold"
                >
                  <History className="h-4 w-4" />
                  View history
                </button>
                <button
                  onClick={() => void store.deactivateMaintenanceItem(record.id)}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-red-700"
                >
                  <Archive className="h-4 w-4" />
                  Deactivate
                </button>
              </div>
            </div>
          ))}
          {maintenance.length === 0 && (
            <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500">
              No active maintenance items for this vehicle.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Service History</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Completed work stays separate from the forward-looking maintenance plan.
            </p>
          </div>
          {historyFilter && (
            <button
              onClick={() => setHistoryFilter(null)}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold"
            >
              Show all history
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {history.map((record) => (
            <div key={record.id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{record.serviceName}</p>
                <p className="mt-1 text-sm text-zinc-500">
                  {formatDate(record.completedAt)} · {record.mileage.toLocaleString()} mi
                </p>
                {record.notes && <p className="mt-1 text-sm text-zinc-600">{record.notes}</p>}
              </div>
              <span className="font-semibold">{formatCurrency(record.priceCents)}</span>
            </div>
          ))}
          {history.length === 0 && (
            <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500">
              No completed service history found.
            </p>
          )}
        </CardContent>
      </Card>

      <Link href={`/customers/${vehicle.customerId}`} className="text-sm font-semibold text-violet-950">
        Back to customer profile
      </Link>

      {mileageOpen && <MileageModal vehicle={vehicle} onClose={() => setMileageOpen(false)} />}
      {addOpen && <MaintenanceItemModal vehicle={vehicle} onClose={() => setAddOpen(false)} />}
      {editingRecord && (
        <MaintenanceItemModal
          vehicle={vehicle}
          record={editingRecord}
          onClose={() => setEditingRecord(null)}
        />
      )}
      {completeRecord && (
        <CompleteServiceModal
          record={completeRecord}
          vehicle={vehicle}
          service={completeRecord.serviceId ? servicesById.get(completeRecord.serviceId) : undefined}
          onClose={() => setCompleteRecord(null)}
        />
      )}
      {recommendationOpen && (
        <RecommendationModal
          customer={customer}
          vehicle={vehicle}
          records={recommended}
          onClose={() => setRecommendationOpen(false)}
          onSendRecommendation={store.sendRecommendation}
          onBookAppointment={store.bookAppointment}
        />
      )}
    </div>
  );
}
