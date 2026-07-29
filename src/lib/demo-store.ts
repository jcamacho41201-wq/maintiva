"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  createInitialDemoState,
  type Appointment,
  type Customer,
  type DemoState,
  type ImportHistoryRecord,
  type OutreachRecord,
  type Vehicle,
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
import {
  addMinutesToIso,
  dateKeyInTimeZone,
  minutesInZone,
  zonedDateTimeToIso,
} from "@/lib/calendar";

const storageKey = "maintiva-demo-state-v2";
const changeEvent = "maintiva-demo-state";
let cachedState: DemoState | undefined;
const serverSnapshot = createInitialDemoState();
export type MutationResult = { ok: boolean; message?: string };
export type RecommendationResult = MutationResult & { outreachId?: string };
export type BookAppointmentResult = MutationResult & { appointment?: Appointment };

export type CalendarAppointmentInput = {
  customerId: string;
  vehicleId: string;
  maintenanceRecordIds?: string[];
  declinedWorkRecordIds?: string[];
  serviceDefinitionIds?: string[];
  opportunityId?: string;
  outreachRecordId?: string;
  date: string;
  time: string;
  status: Appointment["status"];
  source: Appointment["source"];
  attributionSource: Appointment["attributionSource"];
  totalLaborHours: number;
  totalPriceCents: number;
  notes?: string;
};

export type CalendarAppointmentUpdateInput = {
  appointmentId: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  totalLaborHours?: number;
  totalPriceCents?: number;
  status?: Appointment["status"];
  notes?: string;
};

export type OpportunitySnoozeInput = {
  maintenanceRecordIds?: string[];
  declinedWorkRecordIds?: string[];
  followUpDate: string;
};

function getServerSnapshot() {
  return serverSnapshot;
}

function normalizeState(state: DemoState): DemoState {
  const baseline = createInitialDemoState();
  return {
    ...baseline,
    ...state,
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
    return cachedState ?? getServerSnapshot();
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
      ready: true,
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
      async addVehicle(input: Omit<Vehicle, "id" | "shopId" | "overallHealth" | "lastServiceDate" | "vehicleType">): Promise<MutationResult> {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "addVehicle", payload: input });
        }

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
        return { ok: true };
      },
      async updateVehicle(vehicleId: string, input: Partial<Vehicle>): Promise<MutationResult> {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "updateVehicle", id: vehicleId, payload: input });
        }

        update((draft) => ({
          ...draft,
          vehicles: draft.vehicles.map((vehicle) =>
            vehicle.id === vehicleId ? { ...vehicle, ...input } : vehicle,
          ),
        }));
        return { ok: true };
      },
      async sendRecommendation(input: {
        customerId: string;
        vehicleId: string;
        maintenanceRecordIds: string[];
        message: string;
        channel?: OutreachRecord["channel"];
        responseStatus?: OutreachRecord["responseStatus"];
      }): Promise<RecommendationResult> {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({
            action: "markOutreachManuallySent",
            payload: input,
          });
        }

        const outreachId = `outreach-${Date.now()}`;
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
        return { ok: true, outreachId };
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
              priceCents,
              laborHours,
              notificationThreshold: 10,
              outreachStatus: "NEEDS_OUTREACH",
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
              const scheduledStart = zonedDateTimeToIso(
                text(normalized.appointmentDate),
                text(normalized.appointmentTime),
                draft.shop.timezone,
              );
              appointments.push({
                id: `appt-import-${now}-${index}`,
                shopId: draft.shop.id,
                customerId,
                vehicleId,
                maintenanceRecordIds: [maintenanceRecordId],
                serviceNames: [serviceName],
                scheduledStart,
                scheduledEnd: addMinutesToIso(scheduledStart, Math.round(laborHours * 60)),
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
      async bookAppointment(input: {
        customerId: string;
        vehicleId: string;
        maintenanceRecordIds: string[];
        date: string;
        time: string;
        status: Appointment["status"];
        notes?: string;
      }): Promise<BookAppointmentResult> {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "bookAppointment", payload: input });
        }

        let appointment: Appointment | undefined;
        update((draft) => {
          const scheduledStart = zonedDateTimeToIso(input.date, input.time, draft.shop.timezone);
          if (
            hasActiveVehicleAppointmentAt(draft.appointments, {
              vehicleId: input.vehicleId,
              scheduledStart,
            })
          ) {
            return draft;
          }

          appointment = createAppointmentFromRecords({ state: draft, ...input, scheduledStart });
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

        return appointment
          ? { ok: true, appointment }
          : { ok: false, message: "Appointment could not be saved. Check selected services and duplicate time." };
      },
      async createCalendarAppointment(input: CalendarAppointmentInput): Promise<MutationResult> {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "createCalendarAppointment", payload: input });
        }

        let saved = false;
        update((draft) => {
          const selectedServices = draft.services.filter((service) =>
            input.serviceDefinitionIds?.includes(service.id),
          );
          const maintenanceRecords = draft.maintenanceRecords.filter((record) =>
            input.maintenanceRecordIds?.includes(record.id),
          );
          const declinedWorkRecords = draft.declinedWorkRecords.filter((record) =>
            input.declinedWorkRecordIds?.includes(record.id),
          );
          const serviceNames = Array.from(new Set([
            ...selectedServices.map((service) => service.name),
            ...maintenanceRecords.map((record) => record.serviceName),
            ...declinedWorkRecords.map((record) => record.serviceName),
          ]));
          if (serviceNames.length === 0) return draft;

          const scheduledStart = zonedDateTimeToIso(input.date, input.time, draft.shop.timezone);
          if (
            hasActiveVehicleAppointmentAt(draft.appointments, {
              vehicleId: input.vehicleId,
              scheduledStart,
            })
          ) {
            return draft;
          }

          const appointmentId = `appt-${Date.now()}`;
          saved = true;
          return {
            ...draft,
            appointments: [
              ...draft.appointments,
              {
                id: appointmentId,
                shopId: draft.shop.id,
                customerId: input.customerId,
                vehicleId: input.vehicleId,
                maintenanceRecordIds: input.maintenanceRecordIds ?? [],
                serviceNames,
                scheduledStart,
                scheduledEnd: addMinutesToIso(scheduledStart, Math.round(input.totalLaborHours * 60)),
                status: input.status,
                totalPriceCents: input.totalPriceCents,
                totalLaborHours: input.totalLaborHours,
                source: input.source,
                attributionSource: input.attributionSource,
                opportunityId: input.opportunityId,
                outreachRecordId: input.outreachRecordId,
                notes: input.notes ?? "",
              },
            ],
            maintenanceRecords: draft.maintenanceRecords.map((record) =>
              input.maintenanceRecordIds?.includes(record.id)
                ? { ...record, outreachStatus: "SCHEDULED", appointmentId }
                : record,
            ),
            declinedWorkRecords: draft.declinedWorkRecords.map((record) =>
              input.declinedWorkRecordIds?.includes(record.id)
                ? { ...record, status: "BOOKED", outreachStatus: "SCHEDULED", appointmentId }
                : record,
            ),
            outreachRecords: draft.outreachRecords.map((record) =>
              record.id === input.outreachRecordId
                ? { ...record, status: "SCHEDULED", responseStatus: "BOOKED", appointmentId }
                : record,
            ),
          };
        });

        return {
          ok: saved,
          message: saved ? undefined : "Appointment could not be saved. Check selected services and duplicate time.",
        };
      },
      async updateAppointment(input: CalendarAppointmentUpdateInput): Promise<MutationResult> {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "updateAppointment", payload: input });
        }

        let saved = false;
        update((draft) => ({
          ...draft,
          appointments: draft.appointments.map((appointment) => {
            if (appointment.id !== input.appointmentId) return appointment;
            if (
              appointment.status === "COMPLETED" &&
              (input.date || input.time || input.durationMinutes || input.totalLaborHours)
            ) {
              return appointment;
            }
            const date = input.date ?? dateKeyInTimeZone(appointment.scheduledStart, draft.shop.timezone);
            const currentMinutes = minutesInZone(appointment.scheduledStart, draft.shop.timezone);
            const time = input.time ??
              `${String(Math.floor(currentMinutes / 60)).padStart(2, "0")}:${String(currentMinutes % 60).padStart(2, "0")}`;
            const scheduledStart = input.date || input.time
              ? zonedDateTimeToIso(date, time, draft.shop.timezone)
              : appointment.scheduledStart;
            const durationMinutes = input.durationMinutes ??
              Math.max(30, Math.round((new Date(appointment.scheduledEnd).getTime() - new Date(appointment.scheduledStart).getTime()) / 60_000));
            saved = true;
            return {
              ...appointment,
              scheduledStart,
              scheduledEnd: addMinutesToIso(scheduledStart, durationMinutes),
              totalLaborHours: input.totalLaborHours ?? (input.durationMinutes ? durationMinutes / 60 : appointment.totalLaborHours),
              totalPriceCents: input.totalPriceCents ?? appointment.totalPriceCents,
              status: input.status ?? appointment.status,
              notes: input.notes ?? appointment.notes,
            };
          }),
        }));

        return {
          ok: saved,
          message: saved ? undefined : "Appointment could not be updated.",
        };
      },
      async snoozeOpportunity(input: OpportunitySnoozeInput): Promise<MutationResult> {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "snoozeOpportunity", payload: input });
        }

        const maintenanceIds = input.maintenanceRecordIds ?? [];
        const declinedIds = input.declinedWorkRecordIds ?? [];
        let saved = false;
        update((draft) => {
          if (maintenanceIds.length === 0 && declinedIds.length === 0) return draft;
          saved = true;
          const snoozedOutreachIds = new Set(
            draft.maintenanceRecords
              .filter((record) => maintenanceIds.includes(record.id) && record.outreachRecordId)
              .map((record) => record.outreachRecordId),
          );
          return {
            ...draft,
            maintenanceRecords: draft.maintenanceRecords.map((record) =>
              maintenanceIds.includes(record.id)
                ? { ...record, outreachStatus: "SNOOZED" }
                : record,
            ),
            declinedWorkRecords: draft.declinedWorkRecords.map((record) =>
              declinedIds.includes(record.id)
                ? { ...record, status: "SNOOZED", outreachStatus: "SNOOZED" }
                : record,
            ),
            outreachRecords: draft.outreachRecords.map((record) =>
              snoozedOutreachIds.has(record.id)
                ? { ...record, status: "SNOOZED", followUpDate: input.followUpDate }
                : record,
            ),
          };
        });

        return {
          ok: saved,
          message: saved ? undefined : "Opportunity could not be snoozed.",
        };
      },
      async completeAppointment(input: {
        appointmentId: string;
        completedRevenueCents: number;
        completedLaborHours: number;
        completedAt: string;
        notes?: string;
      }): Promise<MutationResult> {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "completeAppointment", payload: input });
        }

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
          declinedWorkRecords: draft.declinedWorkRecords.map((record) =>
            record.appointmentId === input.appointmentId
              ? { ...record, status: "COMPLETED" }
              : record,
          ),
        }));
        return { ok: true };
      },
    };
  }, [state]);
}
