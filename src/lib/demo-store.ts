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

const storageKey = "maintiva-demo-state-v2";
const changeEvent = "maintiva-demo-state";
let cachedState: DemoState | undefined;
const serverSnapshot = createInitialDemoState();

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

function shouldUseLocalDemoPersistence() {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET === "true"
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

async function mutatePilotState(body: unknown) {
  if (shouldUseLocalDemoPersistence()) return;
  const response = await fetch("/api/pilot/mutate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return;
  const data = (await response.json()) as { state: DemoState };
  saveState(data.state);
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

export function useDemoStore() {
  const state = useSyncExternalStore(subscribe, readState, getServerSnapshot);

  useEffect(() => {
    void hydratePilotState();
  }, []);

  return useMemo(() => {
    function update(mutator: (draft: DemoState) => DemoState) {
      const next = mutator(structuredClone(readState()));
      saveState(next);
    }

    return {
      state,
      ready: true,
      resetDemoData() {
        saveState(createInitialDemoState());
      },
      addCustomer(input: Omit<Customer, "id" | "shopId" | "customerScore" | "lifetimeRevenueCents" | "lastVisit">) {
        void mutatePilotState({ action: "addCustomer", payload: input });
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
      },
      updateCustomer(customerId: string, input: Partial<Customer>) {
        void mutatePilotState({ action: "updateCustomer", id: customerId, payload: input });
        update((draft) => ({
          ...draft,
          customers: draft.customers.map((customer) =>
            customer.id === customerId ? { ...customer, ...input } : customer,
          ),
        }));
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
    };
  }, [state]);
}
