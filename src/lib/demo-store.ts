"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  createInitialDemoState,
  type Appointment,
  type Customer,
  type DemoState,
  type ImportHistoryRecord,
  type MaintenanceService,
  type OutreachRecord,
  type TimeIntervalUnit,
  type Vehicle,
  type VehicleMaintenanceRecord,
} from "@/lib/demo-data";
import { hasActiveVehicleAppointmentAt } from "@/lib/appointment";
import { createAppointmentFromRecords } from "@/lib/demo-calculations";
import {
  summarizeImport,
  type CsvRow,
  type DuplicateImportMode,
  type ImportPreviewRow,
  type ImportRowAction,
  type ImportType,
  type MaintivaField,
} from "@/lib/csv-import";

const storageKey = "maintiva-demo-state-v2";
const changeEvent = "maintiva-demo-state";
let cachedState: DemoState | undefined;
const serverSnapshot = createInitialDemoState();
const authenticatedLoadingSnapshot: DemoState = {
  ...serverSnapshot,
  shop: {
    ...serverSnapshot.shop,
    id: "",
    name: "Loading shop",
    slug: "",
    isDemo: false,
    onboardingCompletedAt: null,
  },
  users: [],
  customers: [],
  vehicles: [],
  services: [],
  maintenanceRecords: [],
  serviceRecords: [],
  declinedWorkRecords: [],
  importHistory: [],
  outreachRecords: [],
  appointments: [],
  seededAt: "",
};
export type MutationResult = { ok: boolean; message?: string };

export type ServiceDefinitionInput = Omit<MaintenanceService, "id" | "shopId">;
export type MaintenanceItemInput = {
  vehicleId: string;
  serviceDefinitionId?: string | null;
  customServiceName?: string;
  customCategory?: string;
  addToLibrary?: boolean;
  useShopDefaults?: boolean;
  allowDuplicate?: boolean;
  mileageIntervalOverride?: number | null;
  timeIntervalValueOverride?: number | null;
  timeIntervalUnitOverride?: TimeIntervalUnit | null;
  priceOverrideCents?: number | null;
  laborMinutesOverride?: number | null;
  lastCompletedDate?: string;
  lastCompletedMileage?: number | null;
  outreachThresholdType?: VehicleMaintenanceRecord["outreachThresholdType"];
  outreachThresholdValue?: number;
  notes?: string;
};

function getServerSnapshot() {
  return serverSnapshot;
}

function normalizeState(state: DemoState): DemoState {
  const baseline = createInitialDemoState();
  const services = (state.services ?? baseline.services).map((service) => ({
    ...service,
    defaultMileageInterval: service.defaultMileageInterval ?? null,
    defaultTimeIntervalValue: service.defaultTimeIntervalValue ?? service.defaultTimeIntervalMonths ?? null,
    defaultTimeIntervalUnit: service.defaultTimeIntervalUnit ?? "MONTHS",
    defaultTimeIntervalMonths: service.defaultTimeIntervalMonths ?? monthsFromTime(
      service.defaultTimeIntervalValue,
      service.defaultTimeIntervalUnit,
    ),
  }));
  return {
    ...baseline,
    ...state,
    services,
    maintenanceRecords: (state.maintenanceRecords ?? baseline.maintenanceRecords).map((record) => ({
      ...record,
      serviceId: record.serviceId ?? null,
      mileageIntervalOverride: record.mileageIntervalOverride ?? null,
      timeIntervalValueOverride: record.timeIntervalValueOverride ?? null,
      timeIntervalUnitOverride: record.timeIntervalUnitOverride ?? null,
      priceOverrideCents: record.priceOverrideCents ?? null,
      laborMinutesOverride: record.laborMinutesOverride ?? null,
      outreachThresholdType: record.outreachThresholdType ?? "MILES_BEFORE_DUE",
      outreachThresholdValue: record.outreachThresholdValue ?? 500,
      isActive: record.isActive ?? true,
    })),
    declinedWorkRecords: state.declinedWorkRecords ?? baseline.declinedWorkRecords,
    importHistory: state.importHistory ?? baseline.importHistory,
    outreachRecords: (state.outreachRecords ?? baseline.outreachRecords).map((record) => ({
      ...record,
      channel: String(record.channel) === "SMS" ? "TEXT" : record.channel,
      responseStatus: record.responseStatus ?? "NO_RESPONSE",
    })),
    appointments: (state.appointments ?? baseline.appointments).map((appointment) => ({
      ...appointment,
      attributionSource: appointment.attributionSource ?? (
        appointment.source === "AUTOMATION" ? "MAINTIVA_OUTREACH" : "MANUAL_SHOP_ENTRY"
      ),
    })),
  };
}

export function shouldUseLocalDemoPersistence() {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function readState() {
  if (typeof window === "undefined") {
    return getServerSnapshot();
  }

  if (!shouldUseLocalDemoPersistence()) {
    return cachedState ?? authenticatedLoadingSnapshot;
  }

  if (cachedState) {
    return cachedState;
  }

  try {
    const existing = window.localStorage.getItem(storageKey);
    cachedState = existing ? normalizeState(JSON.parse(existing) as DemoState) : createInitialDemoState();
  } catch {
    cachedState = createInitialDemoState();
  }

  window.localStorage.setItem(storageKey, JSON.stringify(cachedState));
  return cachedState;
}

function saveState(state: DemoState) {
  cachedState = state;
  if (shouldUseLocalDemoPersistence()) {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }
  window.dispatchEvent(new Event(changeEvent));
}

async function hydratePilotState() {
  if (shouldUseLocalDemoPersistence()) return;
  if (["/login", "/password-reset", "/onboarding", "/privacy", "/terms"].includes(window.location.pathname)) {
    return;
  }
  const response = await fetch("/api/pilot/state", { credentials: "include" });
  if (response.status === 409) {
    window.location.href = "/onboarding";
    return;
  }
  if (response.status === 401) {
    window.location.href = "/login";
    return;
  }
  if (!response.ok) return;
  const data = (await response.json()) as { state: DemoState };
  saveState(data.state);
}

export async function mutatePilotState(body: unknown): Promise<MutationResult> {
  if (shouldUseLocalDemoPersistence()) return { ok: true };

  try {
    const response = await fetch("/api/pilot/mutate", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as {
      code?: string;
      state?: DemoState;
      message?: string;
    };

    if (response.status === 409 && data.code === "ONBOARDING_REQUIRED") {
      window.location.href = "/onboarding";
      return { ok: false, message: data.message ?? "Shop onboarding is required." };
    }

    if (response.status === 401 && data.code === "AUTH_REQUIRED") {
      window.location.href = "/login";
      return { ok: false, message: data.message ?? "Authentication is required." };
    }

    if (!response.ok || !data.state) {
      return {
        ok: false,
        message: data.message ?? "Unable to save changes. Confirm the Supabase database schema has been applied.",
      };
    }

    saveState(data.state);
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Unable to reach the server. Check your connection and try the import again.",
    };
  }
}

function subscribe(callback: () => void) {
  function sync() {
    cachedState = undefined;
    callback();
  }

  window.addEventListener("storage", sync);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener("storage", sync);
    window.removeEventListener(changeEvent, callback);
  };
}

function text(value: string | number | undefined) {
  return String(value ?? "").trim();
}

function numeric(value: string | number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function serviceSlug(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `service-${Date.now()}`;
}

function monthsFromTime(value?: number | null, unit?: TimeIntervalUnit | null) {
  if (!value || !unit) return null;
  if (unit === "DAYS") return Math.max(1, Math.round(value / 30.4375));
  if (unit === "YEARS") return value * 12;
  return value;
}

export function useDemoStore() {
  const state = useSyncExternalStore(subscribe, readState, getServerSnapshot);

  useEffect(() => {
    void hydratePilotState();
  }, []);

  return useMemo(() => {
    function update(mutator: (draft: DemoState) => DemoState) {
      if (!shouldUseLocalDemoPersistence()) return;
      const next = mutator(structuredClone(readState()));
      saveState(next);
    }

    return {
      state,
      ready: shouldUseLocalDemoPersistence() || Boolean(state.shop.id),
      resetDemoData() {
        if (!shouldUseLocalDemoPersistence()) return;
        saveState(createInitialDemoState());
      },
      addCustomer(input: Omit<Customer, "id" | "shopId" | "customerScore" | "lifetimeRevenueCents" | "lastVisit">) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "addCustomer", payload: input });
        }

        update((draft) => ({
          ...draft,
          customers: [
            ...draft.customers,
            {
              ...input,
              id: `cust-${Date.now()}`,
              shopId: draft.shop.id,
              customerScore: 70,
              lifetimeRevenueCents: 0,
              lastVisit: new Date().toISOString().slice(0, 10),
            },
          ],
        }));
        return Promise.resolve({ ok: true, message: undefined });
      },
      updateCustomer(customerId: string, input: Partial<Customer>) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "updateCustomer", id: customerId, payload: input });
        }

        update((draft) => ({
          ...draft,
          customers: draft.customers.map((customer) =>
            customer.id === customerId ? { ...customer, ...input } : customer,
          ),
        }));
        return Promise.resolve({ ok: true, message: undefined });
      },
      addVehicle(input: Omit<Vehicle, "id" | "shopId" | "overallHealth" | "lastServiceDate" | "vehicleType">) {
        void mutatePilotState({ action: "addVehicle", payload: input });
        update((draft) => ({
          ...draft,
          vehicles: [
            ...draft.vehicles,
            {
              ...input,
              id: `veh-${Date.now()}`,
              shopId: draft.shop.id,
              vehicleType: "Passenger vehicle",
              overallHealth: 80,
              lastServiceDate: new Date().toISOString().slice(0, 10),
            },
          ],
        }));
      },
      updateVehicle(vehicleId: string, input: Partial<Vehicle>) {
        void mutatePilotState({ action: "updateVehicle", id: vehicleId, payload: input });
        update((draft) => ({
          ...draft,
          vehicles: draft.vehicles.map((vehicle) =>
            vehicle.id === vehicleId ? { ...vehicle, ...input } : vehicle,
          ),
        }));
      },
      addServiceDefinition(input: ServiceDefinitionInput) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "addServiceDefinition", payload: input });
        }

        update((draft) => ({
          ...draft,
          services: [
            ...draft.services,
            {
              ...input,
              id: `svc-${serviceSlug(input.name)}-${Date.now()}`,
              shopId: draft.shop.id,
              defaultTimeIntervalMonths: monthsFromTime(input.defaultTimeIntervalValue, input.defaultTimeIntervalUnit),
            },
          ],
        }));
        return Promise.resolve({ ok: true, message: undefined });
      },
      updateServiceDefinition(serviceId: string, input: Partial<ServiceDefinitionInput>) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "updateServiceDefinition", id: serviceId, payload: input });
        }

        update((draft) => ({
          ...draft,
          services: draft.services.map((service) =>
            service.id === serviceId
              ? {
                  ...service,
                  ...input,
                  defaultTimeIntervalMonths: input.defaultTimeIntervalValue !== undefined || input.defaultTimeIntervalUnit !== undefined
                    ? monthsFromTime(
                      input.defaultTimeIntervalValue ?? service.defaultTimeIntervalValue,
                      input.defaultTimeIntervalUnit ?? service.defaultTimeIntervalUnit,
                    )
                    : service.defaultTimeIntervalMonths,
                }
              : service,
          ),
        }));
        return Promise.resolve({ ok: true, message: undefined });
      },
      addMaintenanceItem(input: MaintenanceItemInput) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "addMaintenanceItem", payload: input });
        }

        let blocked = "";
        update((draft) => {
          const service = input.serviceDefinitionId
            ? draft.services.find((item) => item.id === input.serviceDefinitionId)
            : undefined;
          if (
            service &&
            !input.allowDuplicate &&
            draft.maintenanceRecords.some((record) =>
              record.vehicleId === input.vehicleId &&
              record.serviceId === service.id &&
              record.isActive !== false,
            )
          ) {
            blocked = "This active service is already assigned to the vehicle.";
            return draft;
          }

          let serviceId = service?.id ?? null;
          let services = draft.services;
          if (!service && input.addToLibrary && input.customServiceName) {
            serviceId = `svc-${serviceSlug(input.customServiceName)}-${Date.now()}`;
            services = [
              ...services,
              {
                id: serviceId,
                shopId: draft.shop.id,
                name: input.customServiceName,
                category: input.customCategory || "Custom",
                defaultMileageInterval: input.mileageIntervalOverride ?? null,
                defaultTimeIntervalMonths: monthsFromTime(input.timeIntervalValueOverride, input.timeIntervalUnitOverride),
                defaultTimeIntervalValue: input.timeIntervalValueOverride ?? null,
                defaultTimeIntervalUnit: input.timeIntervalUnitOverride ?? "MONTHS",
                defaultNotificationThreshold: 10,
                estimatedLaborMinutes: input.laborMinutesOverride ?? 0,
                defaultPriceCents: input.priceOverrideCents ?? 0,
                description: input.notes ?? "",
                isActive: true,
              },
            ];
          }

          const useDefaults = Boolean(serviceId && input.useShopDefaults !== false);
          const selectedService = serviceId ? services.find((item) => item.id === serviceId) : undefined;
          const mileageOverride = useDefaults ? null : input.mileageIntervalOverride ?? null;
          const timeValueOverride = useDefaults ? null : input.timeIntervalValueOverride ?? null;
          const timeUnitOverride = useDefaults ? null : input.timeIntervalUnitOverride ?? null;
          const priceOverride = useDefaults ? null : input.priceOverrideCents ?? null;
          const laborOverride = useDefaults ? null : input.laborMinutesOverride ?? null;
          const serviceName = selectedService?.name ?? input.customServiceName ?? "Custom service";

          return {
            ...draft,
            services,
            maintenanceRecords: [
              ...draft.maintenanceRecords,
              {
                id: `item-${input.vehicleId}-${serviceSlug(serviceName)}-${Date.now()}`,
                shopId: draft.shop.id,
                vehicleId: input.vehicleId,
                serviceId,
                serviceName,
                customServiceName: serviceId ? undefined : input.customServiceName,
                customCategory: serviceId ? undefined : input.customCategory || "Custom",
                lastCompletedDate: input.lastCompletedDate || new Date().toISOString().slice(0, 10),
                lastCompletedMileage: input.lastCompletedMileage ?? 0,
                recommendedMileageInterval: mileageOverride,
                recommendedTimeIntervalMonths: monthsFromTime(timeValueOverride, timeUnitOverride),
                mileageIntervalOverride: mileageOverride,
                timeIntervalValueOverride: timeValueOverride,
                timeIntervalUnitOverride: timeUnitOverride,
                priceCents: priceOverride ?? selectedService?.defaultPriceCents ?? input.priceOverrideCents ?? 0,
                laborHours: (laborOverride ?? selectedService?.estimatedLaborMinutes ?? input.laborMinutesOverride ?? 0) / 60,
                priceOverrideCents: priceOverride,
                laborMinutesOverride: laborOverride,
                notificationThreshold: 10,
                outreachThresholdType: input.outreachThresholdType ?? "MILES_BEFORE_DUE",
                outreachThresholdValue: input.outreachThresholdValue ?? 500,
                outreachStatus: "NEEDS_OUTREACH",
                isActive: true,
                notes: input.notes,
                createdByUserId: draft.users[0]?.id,
                updatedByUserId: draft.users[0]?.id,
              },
            ],
          };
        });
        return Promise.resolve(blocked ? { ok: false, message: blocked } : { ok: true, message: undefined });
      },
      updateMaintenanceItem(recordId: string, input: Partial<MaintenanceItemInput>) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "updateMaintenanceItem", id: recordId, payload: input });
        }

        update((draft) => ({
          ...draft,
          maintenanceRecords: draft.maintenanceRecords.map((record) => {
            if (record.id !== recordId) return record;
            const reset = input.useShopDefaults === true;
            return {
              ...record,
              lastCompletedDate: input.lastCompletedDate ?? record.lastCompletedDate,
              lastCompletedMileage: input.lastCompletedMileage ?? record.lastCompletedMileage,
              mileageIntervalOverride: reset ? null : input.mileageIntervalOverride ?? record.mileageIntervalOverride,
              timeIntervalValueOverride: reset ? null : input.timeIntervalValueOverride ?? record.timeIntervalValueOverride,
              timeIntervalUnitOverride: reset ? null : input.timeIntervalUnitOverride ?? record.timeIntervalUnitOverride,
              recommendedMileageInterval: reset ? null : input.mileageIntervalOverride ?? record.recommendedMileageInterval,
              recommendedTimeIntervalMonths: reset
                ? null
                : input.timeIntervalValueOverride !== undefined || input.timeIntervalUnitOverride !== undefined
                  ? monthsFromTime(
                    input.timeIntervalValueOverride ?? record.timeIntervalValueOverride,
                    input.timeIntervalUnitOverride ?? record.timeIntervalUnitOverride,
                  )
                  : record.recommendedTimeIntervalMonths,
              priceOverrideCents: reset ? null : input.priceOverrideCents ?? record.priceOverrideCents,
              laborMinutesOverride: reset ? null : input.laborMinutesOverride ?? record.laborMinutesOverride,
              outreachThresholdType: input.outreachThresholdType ?? record.outreachThresholdType,
              outreachThresholdValue: input.outreachThresholdValue ?? record.outreachThresholdValue,
              notes: input.notes ?? record.notes,
              updatedByUserId: draft.users[0]?.id,
            };
          }),
        }));
        return Promise.resolve({ ok: true, message: undefined });
      },
      deactivateMaintenanceItem(recordId: string) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "deactivateMaintenanceItem", id: recordId });
        }

        update((draft) => ({
          ...draft,
          maintenanceRecords: draft.maintenanceRecords.map((record) =>
            record.id === recordId
              ? { ...record, isActive: false, outreachStatus: "STOPPED", updatedByUserId: draft.users[0]?.id }
              : record,
          ),
        }));
        return Promise.resolve({ ok: true, message: undefined });
      },
      markMaintenanceServiceComplete(input: {
        maintenanceRecordId: string;
        completedAt: string;
        completedMileage: number;
        finalPriceCents: number;
        finalLaborMinutes: number;
        notes?: string;
      }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "markMaintenanceServiceComplete", payload: input });
        }

        update((draft) => {
          const record = draft.maintenanceRecords.find((item) => item.id === input.maintenanceRecordId);
          const vehicle = record ? draft.vehicles.find((item) => item.id === record.vehicleId) : undefined;
          if (!record || !vehicle) return draft;
          return {
            ...draft,
            vehicles: draft.vehicles.map((item) =>
              item.id === vehicle.id
                ? { ...item, currentMileage: Math.max(item.currentMileage, input.completedMileage), lastServiceDate: input.completedAt }
                : item,
            ),
            serviceRecords: [
              {
                id: `hist-${record.id}-${Date.now()}`,
                shopId: draft.shop.id,
                customerId: vehicle.customerId,
                vehicleId: vehicle.id,
                serviceName: record.serviceName,
                completedAt: input.completedAt,
                mileage: input.completedMileage,
                priceCents: input.finalPriceCents,
                notes: input.notes ?? "",
              },
              ...draft.serviceRecords,
            ],
            maintenanceRecords: draft.maintenanceRecords.map((item) =>
              item.id === record.id
                ? {
                    ...item,
                    lastCompletedDate: input.completedAt,
                    lastCompletedMileage: input.completedMileage,
                    priceCents: input.finalPriceCents,
                    laborHours: input.finalLaborMinutes / 60,
                    outreachStatus: "NEEDS_OUTREACH",
                    appointmentId: undefined,
                    updatedByUserId: draft.users[0]?.id,
                  }
                : item,
            ),
          };
        });
        return Promise.resolve({ ok: true, message: undefined });
      },
      updateVehicleMileage(input: {
        vehicleId: string;
        currentMileage: number;
        allowLowerCorrection?: boolean;
        correctionReason?: string;
      }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "updateVehicleMileage", payload: input });
        }

        let blocked = "";
        update((draft) => ({
          ...draft,
          vehicles: draft.vehicles.map((vehicle) => {
            if (vehicle.id !== input.vehicleId) return vehicle;
            if (input.currentMileage < vehicle.currentMileage && !input.allowLowerCorrection) {
              blocked = "Confirm a mileage correction before lowering the current reading.";
              return vehicle;
            }
            return { ...vehicle, currentMileage: input.currentMileage };
          }),
        }));
        return Promise.resolve(blocked ? { ok: false, message: blocked } : { ok: true, message: undefined });
      },
      sendRecommendation(input: {
        customerId: string;
        vehicleId: string;
        maintenanceRecordIds: string[];
        message: string;
        channel?: OutreachRecord["channel"];
        responseStatus?: OutreachRecord["responseStatus"];
      }) {
        const outreachId = `outreach-${Date.now()}`;
        void mutatePilotState({
          action: "markOutreachManuallySent",
          payload: input,
        });
        update((draft) => {
          const selected = draft.maintenanceRecords.filter((record) =>
            input.maintenanceRecordIds.includes(record.id),
          );
          return {
            ...draft,
            outreachRecords: [
              ...draft.outreachRecords,
              {
                id: outreachId,
                shopId: draft.shop.id,
                customerId: input.customerId,
                vehicleId: input.vehicleId,
                maintenanceRecordIds: input.maintenanceRecordIds,
                serviceNames: selected.map((record) => record.serviceName),
                message: input.message,
                channel: input.channel ?? "TEXT",
                sentAt: new Date().toISOString(),
                copiedAt: new Date().toISOString(),
                manuallySentAt: new Date().toISOString(),
                responseStatus: input.responseStatus ?? "NO_RESPONSE",
                performedByUserId: draft.users[0]?.id,
                status: "MANUALLY_SENT",
              },
            ],
            maintenanceRecords: draft.maintenanceRecords.map((record) =>
              input.maintenanceRecordIds.includes(record.id)
                ? {
                    ...record,
                    outreachStatus: "MANUALLY_SENT",
                    outreachRecordId: outreachId,
                  }
                : record,
            ),
          };
        });
        return outreachId;
      },
      addImportHistory(input: Omit<ImportHistoryRecord, "id" | "shopId" | "userId" | "importedAt">) {
        update((draft) => ({
          ...draft,
          importHistory: [
            {
              ...input,
              id: `import-${Date.now()}`,
              shopId: draft.shop.id,
              userId: draft.users[0]?.id ?? "user-owner",
              importedAt: new Date().toISOString(),
            },
            ...draft.importHistory,
          ],
        }));
      },
      importCsvRows(input: {
        fileName: string;
        importType: ImportType;
        duplicateMode: DuplicateImportMode;
        rows: CsvRow[];
        mapping: Record<string, MaintivaField>;
        previewRows: ImportPreviewRow[];
        rowActions?: Record<number, ImportRowAction>;
      }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "importCsvRows", payload: input });
        }

        const summary = summarizeImport(input.previewRows, input.duplicateMode, input.rowActions);
        update((draft) => {
          function actionFor(row: ImportPreviewRow) {
            const override = input.rowActions?.[row.rowNumber];
            if (override) return override;
            if (row.status === "INVALID") return "HOLD" as const;
            if (row.entities.child.status === "DUPLICATE") {
              if (input.duplicateMode === "UPDATE") return "UPDATE" as const;
              if (input.duplicateMode === "IMPORT_AS_NEW") return "IMPORT_AS_NEW" as const;
              return "SKIP" as const;
            }
            return row.action;
          }
          const importedRows = input.previewRows.filter((row) =>
            ["IMPORT", "UPDATE", "IMPORT_AS_NEW"].includes(actionFor(row)),
          );
          const now = Date.now();
          const customers = [...draft.customers];
          const vehicles = [...draft.vehicles];
          const serviceRecords = [...draft.serviceRecords];
          const maintenanceRecords = [...draft.maintenanceRecords];
          const declinedWorkRecords = [...draft.declinedWorkRecords];
          const appointments = [...draft.appointments];
          const customerByKey = new Map<string, string>();
          const vehicleByKey = new Map<string, string>();

          importedRows.forEach((row, index) => {
            const normalized = row.normalized;
            let customerId = row.entities.customer.key ? customerByKey.get(row.entities.customer.key) : undefined;
            customerId ??= row.entities.customer.status === "MATCH"
              ? customers.find((customer) =>
                  customer.email.toLowerCase() === text(normalized.customerEmail).toLowerCase() ||
                  customer.phone.replace(/\D/g, "") === text(normalized.customerPhone).replace(/\D/g, "") ||
                  `${customer.firstName} ${customer.lastName}`.toLowerCase() === `${text(normalized.customerFirstName)} ${text(normalized.customerLastName)}`.toLowerCase(),
                )?.id
              : undefined;
            customerId ??= `cust-import-${now}-${index}`;
            let vehicleId = row.entities.vehicle.key ? vehicleByKey.get(row.entities.vehicle.key) : undefined;
            vehicleId ??= row.entities.vehicle.status === "MATCH"
              ? vehicles.find((vehicle) =>
                  vehicle.vin.toUpperCase() === text(normalized.vin).toUpperCase() ||
                  (
                    vehicle.customerId === customerId &&
                    vehicle.year === numeric(normalized.vehicleYear) &&
                    vehicle.make.toLowerCase() === text(normalized.vehicleMake).toLowerCase() &&
                    vehicle.model.toLowerCase() === text(normalized.vehicleModel).toLowerCase()
                  ),
                )?.id
              : undefined;
            const serviceName = text(normalized.serviceName) || text(normalized.services);
            const priceCents = numeric(normalized.price);
            const laborHours = numeric(normalized.laborHours);
            const customer = {
              id: customerId,
              shopId: draft.shop.id,
              firstName: text(normalized.customerFirstName),
              lastName: text(normalized.customerLastName),
              phone: text(normalized.customerPhone),
              email: text(normalized.customerEmail),
              preferredContact: "SMS" as const,
              smsConsent: Boolean(text(normalized.customerPhone)),
              emailConsent: Boolean(text(normalized.customerEmail)),
              callConsent: Boolean(text(normalized.customerPhone)),
              address: "",
              notes: row.status === "DUPLICATE" ? "Imported after duplicate review." : "Imported from CSV.",
              status: "ACTIVE" as const,
              customerScore: 70,
              lifetimeRevenueCents: 0,
              lastVisit: new Date().toISOString().slice(0, 10),
            };
            const vehicle = {
              id: vehicleId ?? `veh-import-${now}-${index}`,
              shopId: draft.shop.id,
              customerId,
              year: numeric(normalized.vehicleYear),
              make: text(normalized.vehicleMake),
              model: text(normalized.vehicleModel),
              vin: text(normalized.vin),
              licensePlate: text(normalized.licensePlate),
              engine: "",
              trim: "",
              vehicleType: "Passenger vehicle",
              currentMileage: numeric(normalized.currentMileage),
              estimatedAnnualMileage: 12_000,
              overallHealth: 76,
              lastServiceDate: text(normalized.serviceDate) || new Date().toISOString().slice(0, 10),
            };
            if (!customer.firstName || !customer.lastName || !vehicle.make || !vehicle.model || !serviceName) return;
            if (!customers.some((item) => item.id === customerId)) customers.push(customer);
            vehicleId = vehicle.id;
            if (!vehicles.some((item) => item.id === vehicleId)) vehicles.push(vehicle);
            if (row.entities.customer.key) customerByKey.set(row.entities.customer.key, customerId);
            if (row.entities.vehicle.key) vehicleByKey.set(row.entities.vehicle.key, vehicleId);

            const maintenanceRecordId = `item-import-${now}-${index}`;
            maintenanceRecords.push({
              id: maintenanceRecordId,
              shopId: draft.shop.id,
              vehicleId,
              serviceId: "svc-imported",
              serviceName,
              lastCompletedDate: text(normalized.serviceDate) || new Date().toISOString().slice(0, 10),
              lastCompletedMileage: numeric(normalized.serviceMileage) || vehicle.currentMileage,
              recommendedMileageInterval: 12_000,
              recommendedTimeIntervalMonths: 12,
              mileageIntervalOverride: null,
              timeIntervalValueOverride: null,
              timeIntervalUnitOverride: null,
              priceCents,
              laborHours,
              priceOverrideCents: priceCents,
              laborMinutesOverride: Math.round(laborHours * 60),
              notificationThreshold: 10,
              outreachThresholdType: "MILES_BEFORE_DUE",
              outreachThresholdValue: 500,
              outreachStatus: "NEEDS_OUTREACH",
              isActive: true,
              createdByUserId: draft.users[0]?.id,
              updatedByUserId: draft.users[0]?.id,
            });
            if (text(normalized.serviceDate)) {
              serviceRecords.push({
                id: `service-import-${now}-${index}`,
                shopId: draft.shop.id,
                customerId,
                vehicleId,
                serviceName,
                completedAt: text(normalized.serviceDate),
                mileage: numeric(normalized.serviceMileage),
                priceCents,
                notes: "Imported from CSV.",
              });
            }
            if (text(normalized.declinedDate) || text(normalized.status).toLowerCase().includes("declin")) {
              declinedWorkRecords.push({
                id: `declined-import-${now}-${index}`,
                shopId: draft.shop.id,
                customerId,
                vehicleId,
                serviceName,
                declinedAt: text(normalized.declinedDate) || new Date().toISOString().slice(0, 10),
                recommendedPriceCents: priceCents,
                laborHours,
                advisorNotes: text(normalized.advisorNotes),
                status: "OPEN",
                outreachStatus: "NEEDS_OUTREACH",
              });
            }
            if (text(normalized.appointmentDate) && text(normalized.appointmentTime)) {
              const scheduledStart = new Date(`${text(normalized.appointmentDate)}T${text(normalized.appointmentTime)}:00`);
              appointments.push({
                id: `appt-import-${now}-${index}`,
                shopId: draft.shop.id,
                customerId,
                vehicleId,
                maintenanceRecordIds: [maintenanceRecordId],
                serviceNames: [serviceName],
                scheduledStart: scheduledStart.toISOString(),
                scheduledEnd: new Date(scheduledStart.getTime() + laborHours * 60 * 60 * 1000).toISOString(),
                status: "CONFIRMED",
                totalPriceCents: priceCents,
                totalLaborHours: laborHours,
                source: "IMPORTED",
                attributionSource: "IMPORTED_APPOINTMENT",
                notes: "Imported from CSV.",
              });
            }
          });

          return {
            ...draft,
            customers,
            vehicles,
            serviceRecords,
            maintenanceRecords,
            declinedWorkRecords,
            appointments,
            importHistory: [
              {
                id: `import-${Date.now()}`,
                shopId: draft.shop.id,
                userId: draft.users[0]?.id ?? "user-owner",
                fileName: input.fileName,
                importType: input.importType,
                status: summary.failedRows > 0 ? "PARTIAL" : "COMPLETED",
                importedAt: new Date().toISOString(),
                totalRows: summary.totalRows,
                successfulRows: summary.successfulRows,
                duplicateRows: summary.duplicateRows,
                updatedRows: summary.updatedRows,
                skippedRows: summary.skippedRows,
                failedRows: summary.failedRows,
                errorReportUrl: summary.failedRows > 0 ? "downloadable-error-report" : undefined,
              },
              ...draft.importHistory,
            ],
          };
        });
        return Promise.resolve({ ok: true, message: undefined });
      },
      bookAppointment(input: {
        customerId: string;
        vehicleId: string;
        maintenanceRecordIds: string[];
        date: string;
        time: string;
        status: Appointment["status"];
        notes?: string;
      }) {
        let appointment: Appointment | undefined;
        void mutatePilotState({ action: "bookAppointment", payload: input });
        update((draft) => {
          const scheduledStart = new Date(`${input.date}T${input.time}:00`).toISOString();
          if (
            hasActiveVehicleAppointmentAt(draft.appointments, {
              vehicleId: input.vehicleId,
              scheduledStart,
            })
          ) {
            return draft;
          }

          appointment = createAppointmentFromRecords({ state: draft, ...input });
          return {
            ...draft,
            appointments: [...draft.appointments, appointment],
            maintenanceRecords: draft.maintenanceRecords.map((record) =>
              input.maintenanceRecordIds.includes(record.id)
                ? {
                    ...record,
                    outreachStatus: "SCHEDULED",
                    appointmentId: appointment?.id,
                  }
                : record,
            ),
          };
        });

        return appointment;
      },
      completeAppointment(input: {
        appointmentId: string;
        completedRevenueCents: number;
        completedLaborHours: number;
        completedAt: string;
        notes?: string;
      }) {
        void mutatePilotState({ action: "completeAppointment", payload: input });
        update((draft) => ({
          ...draft,
          appointments: draft.appointments.map((appointment) =>
            appointment.id === input.appointmentId
              ? {
                  ...appointment,
                  status: "COMPLETED",
                  completedRevenueCents: input.completedRevenueCents,
                  completedLaborHours: input.completedLaborHours,
                  completedAt: input.completedAt,
                  notes: input.notes ?? appointment.notes,
                }
              : appointment,
          ),
        }));
      },
    };
  }, [state]);
}
