"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  createInitialDemoState,
  type Appointment,
  type BookingMode,
  type Customer,
  type CustomerBookingLink,
  type DemoState,
  type ImportHistoryRecord,
  type MaintenanceService,
  type ServiceBookingIntakeOption,
  type ServiceBookingRule,
  type ShopBookingSettings,
  type VehicleDrivingProfile,
  type VehicleMileageReading,
  type OutreachRecord,
  type TimeIntervalUnit,
  type Vehicle,
  type VehicleMaintenanceRecord,
  defaultBookingSettings,
  defaultBookingWindows,
} from "@/lib/demo-data";
import { hasActiveVehicleAppointmentAt } from "@/lib/appointment";
import { createAppointmentFromRecords } from "@/lib/demo-calculations";
import {
  classifyImportRowEvent,
  effectiveImportRowAction,
  summarizeImport,
  type CsvRow,
  type DuplicateImportMode,
  type ImportPreviewRow,
  type ImportRowAction,
  type ImportType,
  type MaintivaField,
  type NormalizedCsvValue,
} from "@/lib/csv-import";
import { calculateDrivingProfile } from "@/lib/adaptive-mileage";
import { resolveForecastAsOfDate } from "@/lib/forecast-dates";
import { currentDateInTimeZone } from "@/lib/utils";

const storageKey = "maintiva-demo-state-v2";
const changeEvent = "maintiva-demo-state";
let cachedState: DemoState | undefined;
let pilotStateLoadFailed = false;
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
  forecastAsOfDate: undefined,
  currentUserId: undefined,
  users: [],
  customers: [],
  vehicles: [],
  services: [],
  maintenanceRecords: [],
  revenueOpportunities: [],
  mileageReadings: [],
  drivingProfiles: [],
  serviceRecords: [],
  declinedWorkRecords: [],
  importHistory: [],
  outreachRecords: [],
  appointments: [],
  seededAt: "",
};
export type BookingLinkResult = {
  id: string;
  url: string;
  expiresAt: string;
  message?: string;
};
export type MutationResult = { ok: boolean; message?: string; bookingLink?: BookingLinkResult };

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

export type ServiceBookingRuleInput = {
  bookingEnabled: boolean;
  bookingMode: BookingMode;
  estimatedDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  allowedIntakeType: ServiceBookingIntakeOption;
  minimumNoticeMinutes?: number | null;
  maximumAdvanceDays?: number | null;
  maximumSimultaneousBookings?: number | null;
  weekdays: number[];
  startMinute: number;
  endMinute: number;
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
    bookingRule: service.bookingRule ?? baseline.services.find((item) => item.name === service.name)?.bookingRule,
  }));
  return {
    ...baseline,
    ...state,
    revenueOpportunities: state.revenueOpportunities ?? [],
    currentUserId: state.currentUserId ?? state.users?.[0]?.id ?? baseline.currentUserId,
    services,
    mileageReadings: state.mileageReadings ?? baseline.mileageReadings,
    drivingProfiles: state.drivingProfiles ?? baseline.drivingProfiles,
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
    bookingSettings: state.bookingSettings ?? baseline.bookingSettings ?? defaultBookingSettings,
    bookingWindows: state.bookingWindows ?? baseline.bookingWindows ?? defaultBookingWindows,
    bookingBlackouts: state.bookingBlackouts ?? baseline.bookingBlackouts ?? [],
    customerBookingLinks: state.customerBookingLinks ?? baseline.customerBookingLinks ?? [],
  };
}

function actorUserId(draft: DemoState) {
  return draft.currentUserId ?? draft.users[0]?.id;
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
  if (["/login", "/password-reset", "/onboarding", "/privacy", "/terms"].includes(window.location.pathname) || window.location.pathname.startsWith("/book/")) {
    return;
  }
  try {
    const response = await fetch("/api/pilot/state", { credentials: "include" });
    if (response.status === 409) {
      window.location.href = "/onboarding";
      return;
    }
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!response.ok) {
      pilotStateLoadFailed = true;
      saveState({
        ...authenticatedLoadingSnapshot,
        seededAt: new Date().toISOString(),
      });
      return;
    }
    const data = (await response.json()) as { state: DemoState };
    pilotStateLoadFailed = false;
    saveState(data.state);
  } catch {
    pilotStateLoadFailed = true;
    saveState({
      ...authenticatedLoadingSnapshot,
      seededAt: new Date().toISOString(),
    });
  }
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
      bookingLink?: BookingLinkResult;
      committed?: boolean;
    };

    if (response.status === 409 && data.code === "ONBOARDING_REQUIRED") {
      window.location.href = "/onboarding";
      return { ok: false, message: data.message ?? "Shop onboarding is required." };
    }

    if (response.status === 401 && data.code === "AUTH_REQUIRED") {
      window.location.href = "/login";
      return { ok: false, message: data.message ?? "Authentication is required." };
    }

    if (response.ok && data.committed) {
      return { ok: true, message: data.message };
    }

    if (!response.ok || !data.state) {
      return {
        ok: false,
        message: data.message ?? "Unable to save changes. Confirm the Supabase database schema has been applied.",
      };
    }

    saveState(data.state);
    return { ok: true, bookingLink: data.bookingLink };
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

function text(value: NormalizedCsvValue | undefined) {
  return String(value ?? "").trim();
}

function numeric(value: NormalizedCsvValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumeric(value: NormalizedCsvValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function bookingMessage(draft: DemoState, link: BookingLinkResult, input: {
  customerId: string;
  vehicleId: string;
  opportunityIds: string[];
}) {
  const customer = draft.customers.find((item) => item.id === input.customerId);
  const vehicle = draft.vehicles.find((item) => item.id === input.vehicleId);
  const opportunities = draft.revenueOpportunities.filter((item) => input.opportunityIds.includes(item.id));
  const serviceNames = Array.from(new Set(opportunities.flatMap((item) => {
    const maintenance = item.maintenanceRecordId ? draft.maintenanceRecords.find((record) => record.id === item.maintenanceRecordId) : undefined;
    const declined = item.declinedWorkRecordId ? draft.declinedWorkRecords.find((record) => record.id === item.declinedWorkRecordId) : undefined;
    return [maintenance?.serviceName ?? declined?.serviceName ?? ""].filter(Boolean);
  })));
  return `Hi ${customer?.firstName ?? "there"}, this is ${draft.shop.name}. Based on your ${vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "vehicle"} service history, ${serviceNames.join(", ") || "recommended maintenance"} is ready to schedule. You can view available times and schedule here: ${link.url}`;
}

function upsertLocalDrivingProfile(
  draft: DemoState,
  vehicleId: string,
  patch: Partial<VehicleDrivingProfile> = {},
) {
  const vehicle = draft.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) return draft;
  const existing = draft.drivingProfiles.find((profile) => profile.vehicleId === vehicleId);
  const calculated = calculateDrivingProfile({
    shopId: draft.shop.id,
    vehicleId,
    readings: draft.mileageReadings
      .filter((reading) => reading.vehicleId === vehicleId)
      .map((reading) => ({
        readingMileage: reading.readingMileage,
        readingDate: reading.readingDate,
        source: reading.source,
        verificationStatus: reading.verificationStatus,
        anomalyStatus: reading.anomalyStatus,
        includedInForecast: reading.includedInForecast,
      })),
    shopDefaultAnnualMileage: draft.shop.defaultAnnualMileage,
    customerReportedAnnualMileage: patch.customerReportedAnnualMileage ?? existing?.customerReportedAnnualMileage ?? vehicle.estimatedAnnualMileage,
    customerReportedAt: patch.customerReportedAt ?? existing?.customerReportedAt ?? null,
    customerReportedByUserId: patch.customerReportedByUserId ?? existing?.customerReportedByUserId ?? null,
    existingProfile: {
      ...existing,
      ...patch,
    },
    asOf: resolveForecastAsOfDate({ shopTimezone: draft.shop.timezone, now: draft.forecastAsOfDate }),
    shopTimezone: draft.shop.timezone,
  });
  const profile: VehicleDrivingProfile = {
    id: existing?.id ?? `profile-${vehicleId}`,
    shopId: draft.shop.id,
    vehicleId,
    customerReportedAnnualMileage: calculated.customerReportedAnnualMileage,
    customerReportedAt: calculated.customerReportedAt,
    customerReportedByUserId: calculated.customerReportedByUserId,
    calculatedAnnualMileage: calculated.calculatedAnnualMileage,
    estimateSource: calculated.estimateSource,
    confidence: calculated.confidence,
    confidenceReason: calculated.confidenceReason,
    manualAnnualMileageOverride: calculated.manualAnnualMileageOverride,
    manualOverrideReason: calculated.manualOverrideReason,
    manualOverrideNotes: calculated.manualOverrideNotes,
    manualOverrideSetAt: calculated.manualOverrideSetAt,
    manualOverrideSetByUserId: calculated.manualOverrideSetByUserId,
    lastCalculatedAt: calculated.lastCalculatedAt,
  };

  return {
    ...draft,
    drivingProfiles: existing
      ? draft.drivingProfiles.map((item) => item.vehicleId === vehicleId ? profile : item)
      : [...draft.drivingProfiles, profile],
  };
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
      loadError: pilotStateLoadFailed,
      ready: shouldUseLocalDemoPersistence() || Boolean(state.shop.id) || pilotStateLoadFailed,
      resetDemoData() {
        if (!shouldUseLocalDemoPersistence()) return;
        saveState(createInitialDemoState());
      },
      createBookingLink(input: {
        customerId: string;
        vehicleId: string;
        opportunityIds: string[];
      }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "createBookingLink", payload: input });
        }

        let result: BookingLinkResult | undefined;
        update((draft) => {
          const opportunities = draft.revenueOpportunities.filter((item) => input.opportunityIds.includes(item.id));
          const linkId = `booklink-${Date.now()}`;
          result = {
            id: linkId,
            url: `${window.location.origin}/book/demo-${linkId}`,
            expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
          };
          const link: CustomerBookingLink = {
            id: linkId,
            shopId: draft.shop.id,
            customerId: input.customerId,
            vehicleId: input.vehicleId,
            opportunityId: opportunities[0]?.id,
            maintenanceRecordIds: opportunities
              .map((opportunity) => opportunity.maintenanceRecordId)
              .filter((id): id is string => Boolean(id)),
            declinedWorkRecordIds: opportunities
              .map((opportunity) => opportunity.declinedWorkRecordId)
              .filter((id): id is string => Boolean(id)),
            status: "ACTIVE",
            url: result!.url,
            expiresAt: result!.expiresAt,
            createdAt: new Date().toISOString(),
          };
          result!.message = bookingMessage(draft, result!, input);
          return {
            ...draft,
            customerBookingLinks: [...draft.customerBookingLinks, link],
          };
        });
        return Promise.resolve({ ok: true, bookingLink: result, message: undefined });
      },
      saveBookingSettings(input: ShopBookingSettings & {
        windows?: Array<{ dayOfWeek: number; startMinute: number; endMinute: number; isActive: boolean }>;
      }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "saveBookingSettings", payload: input });
        }

        update((draft) => {
          const { windows, ...settingsInput } = input;
          return {
            ...draft,
            bookingSettings: {
              ...settingsInput,
              id: draft.bookingSettings?.id ?? input.id ?? `settings-${draft.shop.id}`,
              shopId: draft.shop.id,
            },
            bookingWindows: windows
              ? windows.map((window) => ({
                  id: `booking-window-${draft.shop.id}-${window.dayOfWeek}`,
                  shopId: draft.shop.id,
                  dayOfWeek: window.dayOfWeek,
                  startMinute: window.startMinute,
                  endMinute: window.endMinute,
                  isActive: window.isActive,
                }))
              : draft.bookingWindows,
          };
        });
        return Promise.resolve({ ok: true, message: undefined });
      },
      saveServiceBookingRule(serviceId: string, input: ServiceBookingRuleInput) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "saveServiceBookingRule", id: serviceId, payload: input });
        }

        update((draft) => ({
          ...draft,
          services: draft.services.map((service) => {
            if (service.id !== serviceId) return service;
            const rule: ServiceBookingRule = {
              id: service.bookingRule?.id ?? `booking-rule-${serviceId}`,
              shopId: draft.shop.id,
              serviceDefinitionId: serviceId,
              bookingEnabled: input.bookingEnabled,
              bookingMode: input.bookingMode,
              estimatedDurationMinutes: input.estimatedDurationMinutes,
              bufferBeforeMinutes: input.bufferBeforeMinutes,
              bufferAfterMinutes: input.bufferAfterMinutes,
              allowedIntakeType: input.allowedIntakeType,
              minimumNoticeMinutes: input.minimumNoticeMinutes ?? null,
              maximumAdvanceDays: input.maximumAdvanceDays ?? null,
              maximumSimultaneousBookings: input.maximumSimultaneousBookings ?? null,
              windows: input.weekdays.map((dayOfWeek) => ({
                id: `booking-window-${serviceId}-${dayOfWeek}`,
                shopId: draft.shop.id,
                dayOfWeek,
                startMinute: input.startMinute,
                endMinute: input.endMinute,
                isActive: true,
              })),
            };
            return { ...service, bookingRule: rule };
          }),
        }));
        return Promise.resolve({ ok: true, message: undefined });
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
      addVehicle(input: Omit<Vehicle, "id" | "shopId" | "overallHealth" | "lastServiceDate" | "vehicleType"> & { initialMileageReadingDate?: string }) {
        void mutatePilotState({ action: "addVehicle", payload: input });
        update((draft) => {
          const now = Date.now();
          const vehicleId = `veh-${now}`;
          const readingDate = input.initialMileageReadingDate ?? currentDateInTimeZone(draft.shop.timezone);
          const vehicleInput = { ...input };
          delete vehicleInput.initialMileageReadingDate;
          const next = {
            ...draft,
            vehicles: [
              ...draft.vehicles,
              {
                ...vehicleInput,
                id: vehicleId,
                shopId: draft.shop.id,
                vehicleType: "Passenger vehicle",
                overallHealth: 80,
                lastServiceDate: readingDate,
              },
            ],
            mileageReadings: [
              ...draft.mileageReadings,
              {
                id: `mile-${now}`,
                shopId: draft.shop.id,
                vehicleId,
                readingMileage: input.currentMileage,
                readingDate,
                source: "SHOP_MANUAL_ENTRY" as const,
                verificationStatus: "VERIFIED" as const,
                anomalyStatus: "NONE" as const,
                includedInForecast: true,
                recordedByUserId: actorUserId(draft),
                createdAt: new Date().toISOString(),
              },
            ],
          };
          return upsertLocalDrivingProfile(next, vehicleId);
        });
      },
      updateVehicle(vehicleId: string, input: Partial<Vehicle> & { mileageReadingDate?: string }) {
        void mutatePilotState({ action: "updateVehicle", id: vehicleId, payload: input });
        update((draft) => ({
          ...upsertLocalDrivingProfile(
            {
              ...draft,
              vehicles: draft.vehicles.map((vehicle) => {
                const vehicleInput = { ...input };
                delete vehicleInput.mileageReadingDate;
                return vehicle.id === vehicleId ? { ...vehicle, ...vehicleInput } : vehicle;
              }),
              mileageReadings: input.currentMileage === undefined
                ? draft.mileageReadings
                : [
                    ...draft.mileageReadings,
                    {
                      id: `mile-${Date.now()}`,
                      shopId: draft.shop.id,
                      vehicleId,
                      readingMileage: input.currentMileage,
                      readingDate: input.mileageReadingDate ?? currentDateInTimeZone(draft.shop.timezone),
                      source: "SHOP_MANUAL_ENTRY",
                      verificationStatus: "VERIFIED",
                      anomalyStatus: "NONE",
                      includedInForecast: true,
                      recordedByUserId: actorUserId(draft),
                      createdAt: new Date().toISOString(),
                    },
                  ],
            },
            vehicleId,
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
                createdByUserId: actorUserId(draft),
                updatedByUserId: actorUserId(draft),
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
              updatedByUserId: actorUserId(draft),
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
              ? { ...record, isActive: false, outreachStatus: "STOPPED", updatedByUserId: actorUserId(draft) }
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
          const next = {
            ...draft,
            vehicles: draft.vehicles.map((item) =>
              item.id === vehicle.id
                ? { ...item, currentMileage: Math.max(item.currentMileage, input.completedMileage), lastServiceDate: input.completedAt }
                : item,
            ),
            mileageReadings: [
              ...draft.mileageReadings,
              {
                id: `mile-complete-${record.id}-${Date.now()}`,
                shopId: draft.shop.id,
                vehicleId: vehicle.id,
                readingMileage: input.completedMileage,
                readingDate: input.completedAt,
                source: "SHOP_REPAIR_ORDER" as const,
                verificationStatus: "VERIFIED" as const,
                anomalyStatus: "NONE" as const,
                includedInForecast: true,
                sourceReferenceType: "ServiceHistoryRecord",
                recordedByUserId: actorUserId(draft),
              },
            ],
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
                    outreachStatus: "NEEDS_OUTREACH" as const,
                    appointmentId: undefined,
                    updatedByUserId: actorUserId(draft),
                  }
                : item,
            ),
          };
          return upsertLocalDrivingProfile(next, vehicle.id);
        });
        return Promise.resolve({ ok: true, message: undefined });
      },
      updateVehicleMileage(input: {
        vehicleId: string;
        currentMileage: number;
        readingDate: string;
        source?: VehicleMileageReading["source"];
        verificationStatus?: VehicleMileageReading["verificationStatus"];
        notes?: string;
        allowLowerCorrection?: boolean;
        correctionReason?: string;
      }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "updateVehicleMileage", payload: input });
        }

        let blocked = "";
        update((draft) => {
          const now = Date.now();
          let changed = false;
          const vehicles = draft.vehicles.map((vehicle) => {
            if (vehicle.id !== input.vehicleId) return vehicle;
            if (input.currentMileage < vehicle.currentMileage && !input.allowLowerCorrection) {
              blocked = "Confirm a mileage correction before lowering the current reading.";
              return vehicle;
            }
            changed = true;
            return { ...vehicle, currentMileage: input.currentMileage };
          });
          if (!changed || blocked) return { ...draft, vehicles };
          const source = input.allowLowerCorrection ? "CORRECTION" as const : input.source ?? "SHOP_MANUAL_ENTRY" as const;
          const duplicate = draft.mileageReadings.some((reading) =>
            reading.vehicleId === input.vehicleId &&
            reading.readingDate === input.readingDate &&
            reading.readingMileage === input.currentMileage &&
            reading.source === source,
          );
          if (duplicate) {
            return upsertLocalDrivingProfile({ ...draft, vehicles }, input.vehicleId);
          }
          const next = {
            ...draft,
            vehicles,
            mileageReadings: [
              ...draft.mileageReadings,
              {
                id: `mile-${now}`,
                shopId: draft.shop.id,
                vehicleId: input.vehicleId,
                readingMileage: input.currentMileage,
                readingDate: input.readingDate,
                source,
                verificationStatus: input.verificationStatus ?? "VERIFIED" as const,
                anomalyStatus: input.allowLowerCorrection ? "RESOLVED" as const : "NONE" as const,
                includedInForecast: true,
                correctionReason: input.correctionReason,
                reviewNotes: input.notes,
                recordedByUserId: actorUserId(draft),
                createdAt: new Date().toISOString(),
              },
            ],
          };
          return upsertLocalDrivingProfile(next, input.vehicleId);
        });
        return Promise.resolve(blocked ? { ok: false, message: blocked } : { ok: true, message: undefined });
      },
      recordInspection(input: {
        vehicleId: string;
        inspectionDate: string;
        mileage?: number | null;
        technician?: string;
        condition: "PASS" | "MONITOR" | "REQUIRES_ATTENTION" | "FAIL";
        componentsInspected?: string;
        notes?: string;
        recommendations: Array<{
          serviceName?: string;
          result: "ACCEPTED" | "DECLINED" | "UNDECIDED";
          urgency: "LOW" | "MEDIUM" | "HIGH";
          priceCents: number;
          laborMinutes: number;
          notes?: string;
        }>;
      }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "recordInspection", payload: input });
        }

        let blocked = "";
        update((draft) => {
          const vehicle = draft.vehicles.find((item) => item.id === input.vehicleId);
          if (!vehicle) {
            blocked = "This vehicle could not be found for the active shop.";
            return draft;
          }
          const mileage = input.mileage ?? null;
          if (input.inspectionDate > currentDateInTimeZone(draft.shop.timezone)) {
            blocked = "Inspection date cannot be in the future.";
            return draft;
          }
          if (mileage !== null && mileage < vehicle.currentMileage) {
            blocked = "Inspection mileage is below the current vehicle mileage. Add an odometer correction first.";
            return draft;
          }
          const now = Date.now();
          const inspectionId = `inspection-${now}`;
          const recommendations = input.recommendations.filter((recommendation) => recommendation.serviceName?.trim());
          const serviceRecords = [
            {
              id: inspectionId,
              shopId: draft.shop.id,
              customerId: vehicle.customerId,
              vehicleId: vehicle.id,
              serviceName: "Vehicle Inspection",
              completedAt: input.inspectionDate,
              mileage: mileage ?? vehicle.currentMileage,
              priceCents: 0,
              notes: [
                "[Inspection]",
                input.technician?.trim() ? `Recorded by: ${input.technician.trim()}` : "",
                `Condition: ${input.condition.replaceAll("_", " ").toLowerCase()}`,
                input.componentsInspected?.trim() ? `Components inspected: ${input.componentsInspected.trim()}` : "",
                input.notes?.trim() ? `Notes: ${input.notes.trim()}` : "",
                recommendations.length > 0 ? `Recommendations: ${recommendations.map((item) => `${item.serviceName} (${item.result.toLowerCase()})`).join("; ")}` : "",
              ].filter(Boolean).join("\n"),
            },
            ...draft.serviceRecords,
          ];
          const mileageReadings = mileage === null || draft.mileageReadings.some((reading) =>
            reading.vehicleId === vehicle.id &&
            reading.readingDate === input.inspectionDate &&
            reading.readingMileage === mileage &&
            reading.sourceReferenceType === "Inspection"
          )
            ? draft.mileageReadings
            : [
                ...draft.mileageReadings,
                {
                  id: `mile-inspection-${now}`,
                  shopId: draft.shop.id,
                  vehicleId: vehicle.id,
                  readingMileage: mileage,
                  readingDate: input.inspectionDate,
                  source: "OTHER" as const,
                  verificationStatus: "VERIFIED" as const,
                  anomalyStatus: "NONE" as const,
                  includedInForecast: true,
                  sourceReferenceType: "Inspection",
                  sourceReferenceId: inspectionId,
                  reviewNotes: input.notes,
                  recordedByUserId: actorUserId(draft),
                  createdAt: new Date().toISOString(),
                },
              ];
          const maintenanceRecords = [...draft.maintenanceRecords];
          const declinedWorkRecords = [...draft.declinedWorkRecords];
          for (const [index, recommendation] of recommendations.entries()) {
            const serviceName = recommendation.serviceName!.trim();
            const service = draft.services.find((item) => item.name.toLowerCase() === serviceName.toLowerCase());
            const serviceId = service?.id ?? `svc-inspection-${now}-${index}`;
            if (!service) {
              draft.services.push({
                id: serviceId,
                shopId: draft.shop.id,
                name: serviceName,
                category: "Inspection Recommendation",
                defaultMileageInterval: null,
                defaultTimeIntervalMonths: null,
                defaultTimeIntervalValue: null,
                defaultTimeIntervalUnit: "MONTHS",
                defaultNotificationThreshold: 10,
                estimatedLaborMinutes: recommendation.laborMinutes,
                defaultPriceCents: recommendation.priceCents,
                description: "Created from a recorded inspection recommendation.",
                isActive: true,
              });
            }
            const existing = maintenanceRecords.find((record) =>
              record.vehicleId === vehicle.id &&
              record.serviceId === serviceId &&
              record.isActive !== false,
            );
            if (existing) {
              Object.assign(existing, {
                priceCents: recommendation.priceCents,
                laborHours: recommendation.laborMinutes / 60,
                priceOverrideCents: recommendation.priceCents,
                laborMinutesOverride: recommendation.laborMinutes,
                outreachStatus: "NEEDS_OUTREACH" as const,
                notes: recommendation.notes ?? input.notes,
                updatedByUserId: actorUserId(draft),
              });
            } else {
              maintenanceRecords.push({
                id: `item-inspection-${now}-${index}`,
                shopId: draft.shop.id,
                vehicleId: vehicle.id,
                serviceId,
                serviceName,
                lastCompletedDate: input.inspectionDate,
                lastCompletedMileage: mileage ?? vehicle.currentMileage,
                recommendedMileageInterval: null,
                recommendedTimeIntervalMonths: null,
                mileageIntervalOverride: null,
                timeIntervalValueOverride: null,
                timeIntervalUnitOverride: null,
                notificationThreshold: 10,
                outreachThresholdType: "MILES_BEFORE_DUE",
                outreachThresholdValue: 500,
                priceCents: recommendation.priceCents,
                laborHours: recommendation.laborMinutes / 60,
                priceOverrideCents: recommendation.priceCents,
                laborMinutesOverride: recommendation.laborMinutes,
                outreachStatus: "NEEDS_OUTREACH",
                isActive: true,
                notes: recommendation.notes ?? input.notes,
                createdByUserId: actorUserId(draft),
                updatedByUserId: actorUserId(draft),
              });
            }
            if (recommendation.result === "DECLINED") {
              declinedWorkRecords.push({
                id: `declined-inspection-${now}-${index}`,
                shopId: draft.shop.id,
                customerId: vehicle.customerId,
                vehicleId: vehicle.id,
                serviceName,
                declinedAt: input.inspectionDate,
                recommendedPriceCents: recommendation.priceCents,
                laborHours: recommendation.laborMinutes / 60,
                advisorNotes: recommendation.notes ?? input.notes ?? "",
                status: "OPEN",
                outreachStatus: "NEEDS_OUTREACH",
              });
            }
          }
          const next = {
            ...draft,
            vehicles: draft.vehicles.map((item) =>
              item.id === vehicle.id
                ? {
                    ...item,
                    currentMileage: mileage ?? item.currentMileage,
                    lastServiceDate: input.inspectionDate,
                  }
                : item,
            ),
            serviceRecords,
            mileageReadings,
            maintenanceRecords,
            declinedWorkRecords,
          };
          return mileage === null ? next : upsertLocalDrivingProfile(next, vehicle.id);
        });
        return Promise.resolve(blocked ? { ok: false, message: blocked } : { ok: true, message: undefined });
      },
      setCustomerReportedMileage(input: { vehicleId: string; annualMileage: number }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "setCustomerReportedMileage", payload: input });
        }

        update((draft) => upsertLocalDrivingProfile({
          ...draft,
          vehicles: draft.vehicles.map((vehicle) =>
            vehicle.id === input.vehicleId
              ? { ...vehicle, estimatedAnnualMileage: input.annualMileage }
              : vehicle,
          ),
        }, input.vehicleId, {
          customerReportedAnnualMileage: input.annualMileage,
          customerReportedAt: new Date().toISOString(),
          customerReportedByUserId: actorUserId(draft),
        }));
        return Promise.resolve({ ok: true, message: undefined });
      },
      setManualMileageOverride(input: {
        vehicleId: string;
        annualMileage: number;
        reason: string;
        notes?: string;
        reviewCondition?: string;
        reviewDate?: string;
      }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "setManualMileageOverride", payload: input });
        }

        update((draft) => upsertLocalDrivingProfile(draft, input.vehicleId, {
          manualAnnualMileageOverride: input.annualMileage,
          manualOverrideReason: input.reason,
          manualOverrideNotes: [input.notes, input.reviewCondition ? `Review: ${input.reviewCondition}` : "", input.reviewDate ? `Review date: ${input.reviewDate}` : ""]
            .filter(Boolean)
            .join("\n") || null,
          manualOverrideSetAt: new Date().toISOString(),
          manualOverrideSetByUserId: actorUserId(draft),
        }));
        return Promise.resolve({ ok: true, message: undefined });
      },
      resetManualMileageOverride(input: { vehicleId: string }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "resetManualMileageOverride", payload: input });
        }

        update((draft) => upsertLocalDrivingProfile(draft, input.vehicleId, {
          manualAnnualMileageOverride: null,
          manualOverrideReason: null,
          manualOverrideNotes: null,
          manualOverrideSetAt: null,
          manualOverrideSetByUserId: null,
        }));
        return Promise.resolve({ ok: true, message: undefined });
      },
      reviewMileageReading(input: Pick<VehicleMileageReading, "id" | "includedInForecast" | "anomalyStatus"> & { reviewNotes?: string }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "reviewMileageReading", payload: {
            readingId: input.id,
            includedInForecast: input.includedInForecast,
            anomalyStatus: input.anomalyStatus,
            reviewNotes: input.reviewNotes,
          } });
        }

        update((draft) => {
          const reading = draft.mileageReadings.find((item) => item.id === input.id);
          if (!reading) return draft;
          const next = {
            ...draft,
            mileageReadings: draft.mileageReadings.map((item) =>
              item.id === input.id
                ? {
                    ...item,
                    includedInForecast: input.includedInForecast,
                    anomalyStatus: input.anomalyStatus,
                    reviewNotes: input.reviewNotes,
                  }
                : item,
            ),
          };
          return upsertLocalDrivingProfile(next, reading.vehicleId);
        });
        return Promise.resolve({ ok: true, message: undefined });
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
                performedByUserId: actorUserId(draft),
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
      async recordOpportunityContact(input: {
        customerId: string;
        vehicleId: string;
        opportunityIds: string[];
        maintenanceRecordIds: string[];
        declinedWorkRecordIds: string[];
        message: string;
        channel: OutreachRecord["channel"];
        responseStatus: OutreachRecord["responseStatus"];
        followUpDate?: string;
        bookingLinkId?: string;
        idempotencyKey?: string;
      }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "recordOpportunityContact", payload: input });
        }

        const outreachId = input.idempotencyKey ? `outreach-${input.idempotencyKey}` : `outreach-${Date.now()}`;
        const sourceStatus = input.responseStatus === "DECLINED" || input.responseStatus === "DO_NOT_CONTACT"
          ? "DECLINED"
          : input.responseStatus !== "NO_RESPONSE"
            ? "RESPONDED"
            : "MANUALLY_SENT";
        const stage = input.responseStatus === "DECLINED" || input.responseStatus === "DO_NOT_CONTACT"
          ? "LOST"
          : input.responseStatus !== "NO_RESPONSE"
            ? "RESPONDED"
            : "CONTACTED";

        update((draft) => {
          const selected = draft.maintenanceRecords.filter((record) =>
            input.maintenanceRecordIds.includes(record.id),
          );
          const declined = draft.declinedWorkRecords.filter((record) =>
            input.declinedWorkRecordIds.includes(record.id),
          );
          return {
            ...draft,
            outreachRecords: [
              ...draft.outreachRecords.filter((record) => record.id !== outreachId),
              {
                id: outreachId,
                shopId: draft.shop.id,
                customerId: input.customerId,
                vehicleId: input.vehicleId,
                maintenanceRecordIds: input.maintenanceRecordIds,
                serviceNames: [
                  ...selected.map((record) => record.serviceName),
                  ...declined.map((record) => record.serviceName),
                ],
                message: input.message,
                channel: input.channel,
                sentAt: new Date().toISOString(),
                copiedAt: ["TEXT", "EMAIL"].includes(input.channel) ? new Date().toISOString() : undefined,
                manuallySentAt: new Date().toISOString(),
                responseStatus: input.responseStatus,
                followUpDate: input.followUpDate ? new Date(`${input.followUpDate}T12:00:00`).toISOString() : undefined,
                bookingLinkId: input.bookingLinkId,
                performedByUserId: actorUserId(draft),
                status: "MANUALLY_SENT",
              },
            ],
            maintenanceRecords: draft.maintenanceRecords.map((record) =>
              input.maintenanceRecordIds.includes(record.id)
                ? {
                    ...record,
                    outreachStatus: sourceStatus,
                    outreachRecordId: outreachId,
                  }
                : record,
            ),
            declinedWorkRecords: draft.declinedWorkRecords.map((record) =>
              input.declinedWorkRecordIds.includes(record.id)
                ? { ...record, outreachStatus: sourceStatus }
                : record,
            ),
            revenueOpportunities: draft.revenueOpportunities.map((opportunity) =>
              input.opportunityIds.includes(opportunity.id)
                ? {
                    ...opportunity,
                    stage,
                    lastActivityAt: new Date().toISOString(),
                  }
                : opportunity,
            ),
            customerBookingLinks: draft.customerBookingLinks.map((link) =>
              link.id === input.bookingLinkId ? { ...link, outreachRecordId: outreachId } : link,
            ),
          };
        });
        return { ok: true, message: undefined };
      },
      async snoozeOpportunity(input: {
        customerId: string;
        vehicleId: string;
        opportunityIds: string[];
        maintenanceRecordIds: string[];
        declinedWorkRecordIds: string[];
        snoozedUntil: string;
        reason: string;
        notes?: string;
      }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "snoozeOpportunity", payload: input });
        }

        const selectedDate = new Date(`${input.snoozedUntil}T00:00:00`);
        const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`);
        if (Number.isNaN(selectedDate.getTime()) || selectedDate <= today) {
          return { ok: false, message: "Choose a future snooze date." };
        }

        const outreachId = `outreach-snooze-${Date.now()}`;
        update((draft) => {
          const selected = draft.maintenanceRecords.filter((record) =>
            input.maintenanceRecordIds.includes(record.id),
          );
          const declined = draft.declinedWorkRecords.filter((record) =>
            input.declinedWorkRecordIds.includes(record.id),
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
                serviceNames: [
                  ...selected.map((record) => record.serviceName),
                  ...declined.map((record) => record.serviceName),
                ],
                message: [
                  `Snoozed until ${input.snoozedUntil}.`,
                  `Reason: ${input.reason}.`,
                  input.notes?.trim() ? `Notes: ${input.notes.trim()}` : "",
                ].filter(Boolean).join("\n"),
                channel: "OTHER",
                sentAt: new Date().toISOString(),
                responseStatus: "NOT_NOW",
                followUpDate: new Date(`${input.snoozedUntil}T12:00:00`).toISOString(),
                performedByUserId: actorUserId(draft),
                status: "SNOOZED",
              },
            ],
            maintenanceRecords: draft.maintenanceRecords.map((record) =>
              input.maintenanceRecordIds.includes(record.id)
                ? {
                    ...record,
                    outreachStatus: "SNOOZED",
                    outreachRecordId: outreachId,
                  }
                : record,
            ),
            declinedWorkRecords: draft.declinedWorkRecords.map((record) =>
              input.declinedWorkRecordIds.includes(record.id)
                ? { ...record, status: "SNOOZED", outreachStatus: "SNOOZED" }
                : record,
            ),
            revenueOpportunities: draft.revenueOpportunities.map((opportunity) =>
              input.opportunityIds.includes(opportunity.id)
                ? {
                    ...opportunity,
                    stage: "CONTACTED",
                    lastActivityAt: new Date().toISOString(),
                  }
                : opportunity,
            ),
          };
        });
        return { ok: true, message: undefined };
      },
      async endOpportunitySnooze(input: {
        customerId: string;
        vehicleId: string;
        opportunityIds: string[];
        maintenanceRecordIds: string[];
        declinedWorkRecordIds: string[];
      }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "endOpportunitySnooze", payload: input });
        }

        const outreachId = `outreach-unsnooze-${Date.now()}`;
        update((draft) => ({
          ...draft,
          outreachRecords: [
            ...draft.outreachRecords,
            {
              id: outreachId,
              shopId: draft.shop.id,
              customerId: input.customerId,
              vehicleId: input.vehicleId,
              maintenanceRecordIds: input.maintenanceRecordIds,
              serviceNames: draft.maintenanceRecords
                .filter((record) => input.maintenanceRecordIds.includes(record.id))
                .map((record) => record.serviceName),
              message: "Snooze ended now. Opportunity returned to Needs Attention.",
              channel: "OTHER",
              sentAt: new Date().toISOString(),
              responseStatus: "NO_RESPONSE",
              performedByUserId: actorUserId(draft),
              status: "NEEDS_OUTREACH",
            },
          ],
          maintenanceRecords: draft.maintenanceRecords.map((record) =>
            input.maintenanceRecordIds.includes(record.id)
              ? { ...record, outreachStatus: "NEEDS_OUTREACH", outreachRecordId: outreachId }
              : record,
          ),
          declinedWorkRecords: draft.declinedWorkRecords.map((record) =>
            input.declinedWorkRecordIds.includes(record.id)
              ? { ...record, status: "OPEN", outreachStatus: "NEEDS_OUTREACH" }
              : record,
          ),
          revenueOpportunities: draft.revenueOpportunities.map((opportunity) =>
            input.opportunityIds.includes(opportunity.id)
              ? {
                  ...opportunity,
                  stage: "IDENTIFIED",
                  lastActivityAt: new Date().toISOString(),
                }
              : opportunity,
          ),
        }));
        return { ok: true, message: undefined };
      },
      async bookQueueAppointment(input: {
        customerId: string;
        vehicleId: string;
        opportunityIds: string[];
        maintenanceRecordIds: string[];
        declinedWorkRecordIds: string[];
        date: string;
        time: string;
        status: Appointment["status"];
        notes?: string;
        idempotencyKey?: string;
      }) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "bookAppointment", payload: input });
        }

        let blocked = "";
        update((draft) => {
          const scheduledStart = new Date(`${input.date}T${input.time}:00`).toISOString();
          if (
            hasActiveVehicleAppointmentAt(draft.appointments, {
              vehicleId: input.vehicleId,
              scheduledStart,
            })
          ) {
            blocked = "This vehicle already has an appointment at that time.";
            return draft;
          }

          const records = draft.maintenanceRecords.filter((record) =>
            input.maintenanceRecordIds.includes(record.id),
          );
          const declined = draft.declinedWorkRecords.filter((record) =>
            input.declinedWorkRecordIds.includes(record.id),
          );
          const totalLaborHours = records.reduce((sum, record) => sum + record.laborHours, 0) +
            declined.reduce((sum, record) => sum + record.laborHours, 0);
          const totalPriceCents = records.reduce((sum, record) => sum + record.priceCents, 0) +
            declined.reduce((sum, record) => sum + record.recommendedPriceCents, 0);
          const appointmentId = input.idempotencyKey ? `appt-${input.idempotencyKey}` : `appt-${Date.now()}`;
          const appointment: Appointment = {
            id: appointmentId,
            shopId: draft.shop.id,
            customerId: input.customerId,
            vehicleId: input.vehicleId,
            maintenanceRecordIds: input.maintenanceRecordIds,
            serviceNames: [
              ...records.map((record) => record.serviceName),
              ...declined.map((record) => record.serviceName),
            ],
            scheduledStart,
            scheduledEnd: new Date(new Date(scheduledStart).getTime() + Math.max(totalLaborHours, 0.5) * 60 * 60 * 1000).toISOString(),
            status: input.status,
            totalPriceCents,
            totalLaborHours,
            source: "AUTOMATION",
            attributionSource: "MAINTIVA_OUTREACH",
            opportunityId: input.opportunityIds[0],
            notes: input.notes ?? "",
          };

          return {
            ...draft,
            appointments: [...draft.appointments, appointment],
            maintenanceRecords: draft.maintenanceRecords.map((record) =>
              input.maintenanceRecordIds.includes(record.id)
                ? {
                    ...record,
                    outreachStatus: "SCHEDULED",
                    appointmentId: appointment.id,
                  }
                : record,
            ),
            declinedWorkRecords: draft.declinedWorkRecords.map((record) =>
              input.declinedWorkRecordIds.includes(record.id)
                ? {
                    ...record,
                    status: "BOOKED",
                    outreachStatus: "SCHEDULED",
                    appointmentId: appointment.id,
                  }
                : record,
            ),
            revenueOpportunities: draft.revenueOpportunities.map((opportunity) =>
              input.opportunityIds.includes(opportunity.id)
                ? {
                    ...opportunity,
                    stage: "BOOKED",
                    lastActivityAt: new Date().toISOString(),
                  }
                : opportunity,
            ),
          };
        });
        return blocked ? { ok: false, message: blocked } : { ok: true, message: undefined };
      },
      addImportHistory(input: Omit<ImportHistoryRecord, "id" | "shopId" | "userId" | "importedAt">) {
        update((draft) => ({
          ...draft,
          importHistory: [
            {
              ...input,
              id: `import-${Date.now()}`,
              shopId: draft.shop.id,
              userId: actorUserId(draft) ?? "user-owner",
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
          const actionFor = (row: ImportPreviewRow) => effectiveImportRowAction(row, input.rowActions, input.duplicateMode);
          const importedRows = input.previewRows.filter((row) =>
            row.status !== "INVALID" &&
            row.status !== "HELD" &&
            ["IMPORT", "UPDATE", "IMPORT_AS_NEW"].includes(actionFor(row)),
          );
          const now = Date.now();
          const customers = [...draft.customers];
          const vehicles = [...draft.vehicles];
          const serviceRecords = [...draft.serviceRecords];
          const mileageReadings = [...draft.mileageReadings];
          const maintenanceRecords = [...draft.maintenanceRecords];
          const declinedWorkRecords = [...draft.declinedWorkRecords];
          const appointments = [...draft.appointments];
          const customerByKey = new Map<string, string>();
          const vehicleByKey = new Map<string, string>();
          const importedMileageKeys = new Set(
            mileageReadings.map((reading) => `${reading.vehicleId}|${reading.readingDate}|${reading.readingMileage}`),
          );

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
            const currentMileage = nullableNumeric(normalized.currentMileage);
            const serviceMileage = nullableNumeric(normalized.serviceMileage);
            const importEvent = classifyImportRowEvent(input.importType, normalized);
            if (importEvent.ambiguousConflict) return;
            const importsCompletedService = importEvent.importsCompletedService;
            const importsDeclinedWork = importEvent.importsDeclinedWork;
            const serviceDate = text(normalized.serviceDate);
            const actualCurrentMileage = importsCompletedService && serviceDate ? null : currentMileage;
            const historicalServiceMileage = importsCompletedService && serviceDate && serviceMileage === null
              ? currentMileage
              : serviceMileage;
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
              currentMileage: actualCurrentMileage ?? 0,
              estimatedAnnualMileage: 12_000,
              overallHealth: 76,
              lastServiceDate: serviceDate || new Date().toISOString().slice(0, 10),
            };
            if (!customer.firstName || !customer.lastName || !vehicle.make || !vehicle.model || !serviceName) return;
            if (!customers.some((item) => item.id === customerId)) customers.push(customer);
            vehicleId = vehicle.id;
            if (!vehicles.some((item) => item.id === vehicleId)) vehicles.push(vehicle);
            if (actualCurrentMileage !== null) {
              const readingDate = new Date().toISOString().slice(0, 10);
              const mileageKey = `${vehicleId}|${readingDate}|${actualCurrentMileage}`;
              if (!importedMileageKeys.has(mileageKey)) {
                importedMileageKeys.add(mileageKey);
                mileageReadings.push({
                  id: `mile-import-current-${now}-${index}`,
                  shopId: draft.shop.id,
                  vehicleId,
                  readingMileage: actualCurrentMileage,
                  readingDate,
                  source: "SHOP_MANUAL_ENTRY",
                  verificationStatus: "IMPORTED",
                  anomalyStatus: "NONE",
                  includedInForecast: true,
                  sourceReferenceType: "ImportRowRecord",
                });
              }
            }
            if (row.entities.customer.key) customerByKey.set(row.entities.customer.key, customerId);
            if (row.entities.vehicle.key) vehicleByKey.set(row.entities.vehicle.key, vehicleId);

            const maintenanceRecordId = `item-import-${now}-${index}`;
            maintenanceRecords.push({
              id: maintenanceRecordId,
              shopId: draft.shop.id,
              vehicleId,
              serviceId: "svc-imported",
              serviceName,
              lastCompletedDate: importsCompletedService ? serviceDate || new Date().toISOString().slice(0, 10) : null,
              lastCompletedMileage: importsCompletedService ? historicalServiceMileage : null,
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
              createdByUserId: actorUserId(draft),
              updatedByUserId: actorUserId(draft),
            });
            if (importsCompletedService && serviceDate) {
              const mileageKey = `${vehicleId}|${serviceDate}|${historicalServiceMileage ?? "missing"}`;
              if (historicalServiceMileage !== null && !importedMileageKeys.has(mileageKey)) {
                importedMileageKeys.add(mileageKey);
                mileageReadings.push({
                  id: `mile-import-service-${now}-${index}`,
                  shopId: draft.shop.id,
                  vehicleId,
                  readingMileage: historicalServiceMileage,
                  readingDate: serviceDate,
                  source: "SERVICE_HISTORY_IMPORT",
                  verificationStatus: "IMPORTED",
                  anomalyStatus: "NONE",
                  includedInForecast: true,
                  sourceReferenceType: "ServiceHistoryRecord",
                });
              }
              serviceRecords.push({
                id: `service-import-${now}-${index}`,
                shopId: draft.shop.id,
                customerId,
                vehicleId,
                serviceName,
                completedAt: serviceDate,
                mileage: historicalServiceMileage,
                priceCents,
                notes: "Imported from CSV.",
              });
            }
            if (importsDeclinedWork) {
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
            mileageReadings,
            drivingProfiles: vehicles.reduce((profiles, vehicle) =>
              upsertLocalDrivingProfile({ ...draft, vehicles, mileageReadings, drivingProfiles: profiles }, vehicle.id).drivingProfiles,
            draft.drivingProfiles),
            serviceRecords,
            maintenanceRecords,
            declinedWorkRecords,
            appointments,
            importHistory: [
              {
                id: `import-${Date.now()}`,
                shopId: draft.shop.id,
                userId: actorUserId(draft) ?? "user-owner",
                fileName: input.fileName,
                importType: input.importType,
                status: summary.heldRows > 0 ? "PARTIAL" : "COMPLETED",
                displayStatus: summary.successfulRows + summary.updatedRows > 0
                  ? summary.heldRows > 0
                    ? "COMPLETED_WITH_REVIEW"
                    : "COMPLETED"
                  : summary.heldRows > 0
                    ? "REVIEW_REQUIRED"
                    : "COMPLETED",
                importedAt: new Date().toISOString(),
                totalRows: summary.totalRows,
                successfulRows: summary.importedRows,
                duplicateRows: summary.duplicateSkippedRows,
                updatedRows: summary.updatedRows,
                skippedRows: summary.skippedRows,
                failedRows: 0,
                heldRows: summary.heldRows,
                invalidRows: summary.invalidRows,
                resultMessage: summary.resultMessage,
                errorReportUrl: summary.heldRows > 0 || summary.skippedRows > 0 ? "downloadable-result-report" : undefined,
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
      approveAppointmentRequest(appointmentId: string) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "approveAppointmentRequest", id: appointmentId });
        }

        update((draft) => {
          const appointment = draft.appointments.find((item) => item.id === appointmentId);
          if (!appointment) return draft;
          return {
            ...draft,
            appointments: draft.appointments.map((item) =>
              item.id === appointmentId
                ? { ...item, status: "CONFIRMED", approvedAt: new Date().toISOString() }
                : item,
            ),
            maintenanceRecords: draft.maintenanceRecords.map((record) =>
              appointment.maintenanceRecordIds.includes(record.id)
                ? { ...record, outreachStatus: "SCHEDULED", appointmentId }
                : record,
            ),
            revenueOpportunities: draft.revenueOpportunities.map((opportunity) =>
              opportunity.id === appointment.opportunityId
                ? { ...opportunity, stage: "BOOKED", lastActivityAt: new Date().toISOString() }
                : opportunity,
            ),
            customerBookingLinks: draft.customerBookingLinks.map((link) =>
              link.id === appointment.bookingLinkId
                ? { ...link, status: "COMPLETED", bookingCompletedAt: new Date().toISOString(), appointmentId }
                : link,
            ),
          };
        });
        return Promise.resolve({ ok: true, message: undefined });
      },
      declineAppointmentRequest(appointmentId: string, reason?: string) {
        if (!shouldUseLocalDemoPersistence()) {
          return mutatePilotState({ action: "declineAppointmentRequest", id: appointmentId, payload: { reason } });
        }

        update((draft) => {
          const appointment = draft.appointments.find((item) => item.id === appointmentId);
          if (!appointment) return draft;
          return {
            ...draft,
            appointments: draft.appointments.map((item) =>
              item.id === appointmentId
                ? {
                    ...item,
                    status: "CANCELLED",
                    declinedAt: new Date().toISOString(),
                    internalNotes: reason ?? item.internalNotes,
                  }
                : item,
            ),
            revenueOpportunities: draft.revenueOpportunities.map((opportunity) =>
              opportunity.id === appointment.opportunityId
                ? { ...opportunity, stage: "RESPONDED", lastActivityAt: new Date().toISOString() }
                : opportunity,
            ),
          };
        });
        return Promise.resolve({ ok: true, message: undefined });
      },
    };
  }, [state]);
}
