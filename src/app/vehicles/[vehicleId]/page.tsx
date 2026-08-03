"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import {
  Archive,
  Activity,
  ClipboardCheck,
  ClipboardPlus,
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
import { type MaintenanceService, type OutreachThresholdType, type TimeIntervalUnit, type User, type Vehicle, type VehicleDrivingProfile, type VehicleMaintenanceRecord, type VehicleMileageReading } from "@/lib/demo-data";
import { type MaintenanceItemInput, useDemoStore } from "@/lib/demo-store";
import { calculateDrivingProfile, estimateServiceDueDate, resolveEffectiveForecastMileage, resolveLatestKnownMileage, validateMileageReading } from "@/lib/adaptive-mileage";
import { buildRevenueOpportunities, isOpenRevenueStage } from "@/lib/revenue-recovery";
import { formatInterval, resolveMaintenanceInterval } from "@/lib/service-intervals";
import { currentDateInTimeZone, formatCurrency, formatDate, formatDateTime, formatHours, formatMileage, formatServiceMileage } from "@/lib/utils";

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

function compactLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function mileageReadingSourceLabel(reading: VehicleMileageReading) {
  if (reading.sourceReferenceType === "Inspection") return "Inspection";
  return compactLabel(reading.source);
}

function sourceLabel(value: VehicleDrivingProfile["estimateSource"]) {
  const labels: Record<VehicleDrivingProfile["estimateSource"], string> = {
    SHOP_VERIFIED_READINGS: "Based on verified readings",
    IMPORTED_READINGS: "Imported service history",
    CUSTOMER_REPORTED: "Customer reported",
    VERIFIED_PLUS_DEFAULT: "One verified reading + shop default",
    SHOP_DEFAULT: "Maintiva default",
    MANUAL_OVERRIDE: "Temporary shop estimate",
  };
  return labels[value];
}

function canManageDrivingEstimates(role?: User["role"]) {
  return role === "OWNER" || role === "MANAGER";
}

function readableReviewCondition(value: string) {
  const labels: Record<string, string> = {
    AFTER_2_VERIFIED_READINGS: "After two verified readings",
    NEXT_SERVICE_VISIT: "At next service visit",
    ON_REVIEW_DATE: "On review date",
  };
  return labels[value] ?? value;
}

function vehicleMileageDisplayValue(vehicle: Vehicle, readings: VehicleMileageReading[]) {
  const latestKnown = resolveLatestKnownMileage(readings.filter((reading) => reading.vehicleId === vehicle.id));
  return latestKnown?.readingMileage ?? (vehicle.currentMileage !== 0 ? vehicle.currentMileage : null);
}

function forecastBasisLabel(kind: string | undefined) {
  if (kind === "ACTUAL") return "Actual current";
  if (kind === "ESTIMATED") return "Estimated current";
  return "Mileage unavailable";
}

function mileageHistoryStats(readings: VehicleMileageReading[]) {
  const usable = readings
    .filter((reading) =>
      reading.includedInForecast &&
      reading.anomalyStatus !== "NEEDS_REVIEW" &&
      reading.verificationStatus !== "EXCLUDED",
    )
    .sort((a, b) => a.readingDate.localeCompare(b.readingDate));
  const verified = usable.filter((reading) => reading.verificationStatus === "VERIFIED");
  const first = usable[0];
  const latest = usable.at(-1);
  const daysCovered = first && latest
    ? Math.max(0, (new Date(`${latest.readingDate}T12:00:00Z`).getTime() - new Date(`${first.readingDate}T12:00:00Z`).getTime()) / 86_400_000)
    : 0;
  const recent = usable.slice(-3);
  const trend = recent.length >= 2
    ? Math.round(((recent.at(-1)!.readingMileage - recent[0].readingMileage) / Math.max(1, (new Date(`${recent.at(-1)!.readingDate}T12:00:00Z`).getTime() - new Date(`${recent[0].readingDate}T12:00:00Z`).getTime()) / 86_400_000)) * 365)
    : null;

  return {
    latest,
    verifiedCount: verified.length,
    daysCovered,
    trend,
    periodLabel: daysCovered > 0 ? `${Math.round(daysCovered).toLocaleString()} days` : "Not enough history",
  };
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
    lastCompletedDate: record.lastCompletedDate ?? "",
    lastCompletedMileage: record.lastCompletedMileage?.toString() ?? "",
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
  readings,
  shopTimezone,
  initialMileage,
  initialReadingDate,
  onClose,
}: {
  vehicle: Vehicle;
  readings: VehicleMileageReading[];
  shopTimezone: string;
  initialMileage?: number;
  initialReadingDate?: string;
  onClose: () => void;
}) {
  const store = useDemoStore();
  const today = currentDateInTimeZone(shopTimezone);
  const [mileage, setMileage] = useState((initialMileage ?? vehicle.currentMileage).toString());
  const [readingDate, setReadingDate] = useState(initialReadingDate ?? today);
  const [source, setSource] = useState<VehicleMileageReading["source"]>(initialMileage ? "CORRECTION" : "SHOP_MANUAL_ENTRY");
  const [verificationStatus, setVerificationStatus] = useState<VehicleMileageReading["verificationStatus"]>("VERIFIED");
  const [notes, setNotes] = useState("");
  const [allowLower, setAllowLower] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const issues = validateMileageReading({
    reading: {
      readingMileage: parseRequiredInt(mileage),
      readingDate,
    },
    existingReadings: readings,
    vehicleYear: vehicle.year,
    asOf: today,
  });
  const warnings = issues.filter((issue) => issue.severity === "warning");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentMileage = parseRequiredInt(mileage);
    const blockingIssue = issues.find((issue) => issue.severity === "error");
    if (blockingIssue) {
      setError(blockingIssue.message);
      return;
    }
    if (currentMileage < vehicle.currentMileage && (!allowLower || !reason.trim())) {
      setError("Lower mileage requires a correction reason.");
      return;
    }
    const result = await store.updateVehicleMileage({
      vehicleId: vehicle.id,
      currentMileage,
      readingDate,
      source,
      verificationStatus,
      notes: notes.trim() || undefined,
      allowLowerCorrection: allowLower,
      correctionReason: reason.trim() || undefined,
    });
    if (!result.ok) {
      setError(result.message ?? "Unable to add odometer reading.");
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 p-5">
          <div>
            <h2 className="text-lg font-semibold">Add Odometer Reading</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Records a dated odometer reading and updates the vehicle&apos;s driving profile.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 p-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Mileage</span>
            <input
              type="number"
              min="0"
              value={mileage}
              onChange={(event) => setMileage(event.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Reading Date</span>
            <input
              type="date"
              required
              max={today}
              value={readingDate}
              onChange={(event) => setReadingDate(event.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
            <span className="block text-xs text-zinc-500">The date this odometer reading was observed.</span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Source</span>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as VehicleMileageReading["source"])}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            >
              <option value="SHOP_MANUAL_ENTRY">Shop manual entry</option>
              <option value="SHOP_REPAIR_ORDER">Shop repair order</option>
              <option value="APPOINTMENT_INTAKE">Appointment intake</option>
              <option value="CUSTOMER_REPORTED">Customer reported</option>
              <option value="CORRECTION">Correction</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Verification status</span>
            <select
              value={verificationStatus}
              onChange={(event) => setVerificationStatus(event.target.value as VehicleMileageReading["verificationStatus"])}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            >
              <option value="VERIFIED">Verified</option>
              <option value="CUSTOMER_REPORTED">Customer reported</option>
              <option value="UNVERIFIED">Unverified</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Optional notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="min-h-20 w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          {warnings.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
              {warnings.map((warning) => (
                <p key={`${warning.code}-${warning.message}`}>{warning.message}</p>
              ))}
            </div>
          )}
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
            Add Odometer Reading
          </button>
        </div>
      </form>
    </div>
  );
}

function DrivingProfilePanel({
  vehicle,
  profile,
  readings,
  users,
  currentUserId,
  shopTimezone,
  shopDefaultAnnualMileage,
}: {
  vehicle: Vehicle;
  profile: VehicleDrivingProfile;
  readings: VehicleMileageReading[];
  users: User[];
  currentUserId?: string;
  shopTimezone: string;
  shopDefaultAnnualMileage: number;
}) {
  const store = useDemoStore();
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const currentUser = usersById.get(currentUserId ?? "") ?? users[0];
  const canEditDrivingEstimates = canManageDrivingEstimates(currentUser?.role);
  const sortedReadings = [...readings].sort((a, b) =>
    b.readingDate.localeCompare(a.readingDate) ||
    String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
  );
  const [reportedMileage, setReportedMileage] = useState((profile.customerReportedAnnualMileage ?? vehicle.estimatedAnnualMileage).toString());
  const [overrideMileage, setOverrideMileage] = useState((profile.manualAnnualMileageOverride ?? "").toString());
  const [overrideReason, setOverrideReason] = useState(profile.manualOverrideReason ?? "");
  const [overrideNotes, setOverrideNotes] = useState(profile.manualOverrideNotes ?? "");
  const [reviewCondition, setReviewCondition] = useState("AFTER_2_VERIFIED_READINGS");
  const [reviewDate, setReviewDate] = useState("");
  const [correctingReading, setCorrectingReading] = useState<VehicleMileageReading | null>(null);
  const [error, setError] = useState("");
  const dailyMileage = Math.round(profile.calculatedAnnualMileage / 365);
  const monthlyMileage = Math.round(profile.calculatedAnnualMileage / 12);
  const stats = mileageHistoryStats(readings);
  const latestReading = stats.latest;
  const forecastMileage = resolveEffectiveForecastMileage({
    shopId: vehicle.shopId,
    vehicleId: vehicle.id,
    readings,
    shopDefaultAnnualMileage,
    customerReportedAnnualMileage: profile.customerReportedAnnualMileage ?? vehicle.estimatedAnnualMileage,
    customerReportedAt: profile.customerReportedAt ?? null,
    customerReportedByUserId: profile.customerReportedByUserId ?? null,
    existingProfile: profile,
    asOf: currentDateInTimeZone(shopTimezone),
  });
  const maintivaCalculatedProfile = calculateDrivingProfile({
    shopId: vehicle.shopId,
    vehicleId: vehicle.id,
    readings,
    shopDefaultAnnualMileage,
    customerReportedAnnualMileage: profile.customerReportedAnnualMileage ?? vehicle.estimatedAnnualMileage,
    customerReportedAt: profile.customerReportedAt ?? null,
    customerReportedByUserId: profile.customerReportedByUserId ?? null,
    existingProfile: {
      ...profile,
      manualAnnualMileageOverride: null,
      manualOverrideReason: null,
      manualOverrideNotes: null,
      manualOverrideSetAt: null,
      manualOverrideSetByUserId: null,
    },
  });

  async function saveReported() {
    const annualMileage = parseRequiredInt(reportedMileage);
    if (annualMileage <= 0) {
      setError("Annual mileage must be greater than zero.");
      return;
    }
    const result = await store.setCustomerReportedMileage({ vehicleId: vehicle.id, annualMileage });
    if (!result.ok) {
      setError(result.message ?? "Unable to save customer driving estimate.");
      return;
    }
    setError("");
  }

  async function saveOverride() {
    const annualMileage = parseRequiredInt(overrideMileage);
    if (annualMileage <= 0 || overrideReason.trim().length < 3) {
      setError("Set Temporary Driving Estimate requires annual mileage and a reason.");
      return;
    }
    if (reviewCondition === "ON_REVIEW_DATE" && !reviewDate) {
      setError("Choose a review date or a different review condition.");
      return;
    }
    const result = await store.setManualMileageOverride({
      vehicleId: vehicle.id,
      annualMileage,
      reason: overrideReason.trim(),
      notes: overrideNotes.trim() || undefined,
      reviewCondition,
      reviewDate: reviewDate || undefined,
    });
    if (!result.ok) {
      setError(result.message ?? "Unable to save temporary driving estimate.");
      return;
    }
    setError("");
  }

  async function resetOverride() {
    const result = await store.resetManualMileageOverride({ vehicleId: vehicle.id });
    if (!result.ok) {
      setError(result.message ?? "Unable to use Maintiva calculation.");
      return;
    }
    setOverrideMileage("");
    setOverrideReason("");
    setOverrideNotes("");
    setError("");
  }

  async function toggleReading(reading: VehicleMileageReading) {
    const result = await store.reviewMileageReading({
      id: reading.id,
      includedInForecast: !reading.includedInForecast,
      anomalyStatus: reading.anomalyStatus === "NEEDS_REVIEW" && !reading.includedInForecast ? "RESOLVED" : reading.anomalyStatus,
      reviewNotes: !reading.includedInForecast ? "Restored to forecast." : "Excluded from forecast.",
    });
    if (!result.ok) setError(result.message ?? "Unable to review mileage reading.");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,480px)_1fr]">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-violet-900" />
            <h2 className="text-lg font-semibold">Driving Profile</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <DetailTile label="Latest known mileage" value={formatMileage(forecastMileage.latestKnownMileage)} />
            <DetailTile label="Latest known date" value={forecastMileage.latestKnownDate ? formatDate(forecastMileage.latestKnownDate) : "Not recorded"} />
            <DetailTile label={forecastBasisLabel(forecastMileage.kind)} value={formatMileage(forecastMileage.mileage)} />
            <DetailTile label="Estimated annual mileage" value={`${profile.calculatedAnnualMileage.toLocaleString()} mi`} />
            <DetailTile label="Confidence" value={profile.confidence} />
            <DetailTile label="Source" value={sourceLabel(profile.estimateSource)} />
            <DetailTile label="Verified readings" value={stats.verifiedCount.toLocaleString()} />
            <DetailTile label="Time period covered" value={stats.periodLabel} />
            <DetailTile label="Recent trend" value={stats.trend ? `${stats.trend.toLocaleString()} mi/yr` : "Not enough history"} />
          </div>
          <div className="rounded-lg border border-zinc-200 p-3 text-sm">
            <p className="font-semibold">{sourceLabel(profile.estimateSource)}</p>
            <p className="mt-1 text-zinc-600">{profile.confidenceReason}</p>
            <p className="mt-2 text-zinc-500">
              Latest fact: {latestReading ? `${latestReading.readingMileage.toLocaleString()} mi on ${formatDate(latestReading.readingDate)}` : "unknown"}
            </p>
            {forecastMileage.kind === "ESTIMATED" && forecastMileage.daysSinceLatestKnownReading !== null && (
              <p className="mt-1 text-zinc-500">
                Estimated current: {formatMileage(forecastMileage.mileage)} projected {forecastMileage.daysSinceLatestKnownReading.toLocaleString()} days from the latest fact.
              </p>
            )}
            <p className="mt-1 text-zinc-500">
              Pace: {dailyMileage.toLocaleString()} mi/day · {monthlyMileage.toLocaleString()} mi/month
            </p>
          </div>
          {profile.manualAnnualMileageOverride && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
              <p className="font-semibold">Temporary Driving Estimate is active</p>
              <p className="mt-1">Maintiva calculation: {maintivaCalculatedProfile.calculatedAnnualMileage.toLocaleString()} mi/yr</p>
              {profile.manualOverrideSetAt && (
                <p className="mt-1 text-violet-800">
                  Set {formatDate(profile.manualOverrideSetAt)} by {usersById.get(profile.manualOverrideSetByUserId ?? "")?.name ?? "Shop user"}.
                </p>
              )}
            </div>
          )}
          <details className="rounded-lg border border-zinc-200 p-3 text-sm">
            <summary className="cursor-pointer font-semibold">Estimate Details</summary>
            <div className="mt-3 space-y-4">
              <div className="rounded-lg bg-zinc-50 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <label className="flex-1 font-medium">
                    Customer&apos;s Driving Estimate
                    <input
                      type="number"
                      min="1"
                      disabled={!canEditDrivingEstimates}
                      value={reportedMileage}
                      onChange={(event) => setReportedMileage(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-100"
                    />
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      Optional intake answer, stored separately from odometer readings.
                    </span>
                  </label>
                  {canEditDrivingEstimates && (
                    <button onClick={() => void saveReported()} className="rounded-lg border border-violet-200 bg-white px-3 py-2 font-semibold text-violet-950">
                      Save Customer Estimate
                    </button>
                  )}
                </div>
              </div>
              <details className="rounded-lg border border-zinc-200 bg-white p-3">
                <summary className="cursor-pointer font-semibold">More</summary>
                <div className="mt-3 space-y-3">
                  <div className="rounded-lg bg-zinc-50 p-3 text-zinc-600">
                    <p className="font-medium text-zinc-900">Set Temporary Driving Estimate</p>
                    <p className="mt-1">
                      Owners and managers can use a temporary estimate while Maintiva keeps calculating from verified odometer history.
                    </p>
                  </div>
                  <label className="font-medium">
                    Annual estimate
                    <input
                      type="number"
                      min="1"
                      disabled={!canEditDrivingEstimates}
                      value={overrideMileage}
                      onChange={(event) => setOverrideMileage(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-100"
                    />
                  </label>
                  <label className="font-medium">
                    Reason
                    <input
                      value={overrideReason}
                      disabled={!canEditDrivingEstimates}
                      onChange={(event) => setOverrideReason(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-100"
                    />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="font-medium">
                      Review option
                      <select
                        value={reviewCondition}
                        disabled={!canEditDrivingEstimates}
                        onChange={(event) => setReviewCondition(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-100"
                      >
                        <option value="AFTER_2_VERIFIED_READINGS">{readableReviewCondition("AFTER_2_VERIFIED_READINGS")}</option>
                        <option value="NEXT_SERVICE_VISIT">{readableReviewCondition("NEXT_SERVICE_VISIT")}</option>
                        <option value="ON_REVIEW_DATE">{readableReviewCondition("ON_REVIEW_DATE")}</option>
                      </select>
                    </label>
                    <label className="font-medium">
                      Review date
                      <input
                        type="date"
                        value={reviewDate}
                        disabled={!canEditDrivingEstimates}
                        onChange={(event) => setReviewDate(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-100"
                      />
                    </label>
                  </div>
                  <label className="font-medium">
                    Notes
                    <textarea
                      value={overrideNotes}
                      disabled={!canEditDrivingEstimates}
                      onChange={(event) => setOverrideNotes(event.target.value)}
                      className="mt-1 min-h-16 w-full rounded-lg border border-zinc-200 px-3 py-2 disabled:bg-zinc-100"
                    />
                  </label>
                  {profile.manualOverrideReason && (
                    <div className="rounded-lg border border-zinc-200 p-3 text-zinc-600">
                      <p><span className="font-medium text-zinc-900">Reason:</span> {profile.manualOverrideReason}</p>
                      {profile.manualOverrideNotes && <p className="mt-1 whitespace-pre-line">{profile.manualOverrideNotes}</p>}
                    </div>
                  )}
                  {canEditDrivingEstimates ? (
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => void saveOverride()} className="rounded-lg bg-violet-950 px-3 py-2 font-semibold text-white">
                        Set Temporary Driving Estimate
                      </button>
                      <button onClick={() => void resetOverride()} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 font-semibold">
                        <RotateCcw className="h-4 w-4" />
                        Use Maintiva Calculation
                      </button>
                    </div>
                  ) : (
                    <p className="text-zinc-500">Owners and managers can edit driving estimates.</p>
                  )}
                </div>
              </details>
            </div>
          </details>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Mileage History</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedReadings.map((reading) => (
            <div key={reading.id} className="grid gap-3 rounded-lg border border-zinc-200 p-3 text-sm md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{reading.readingMileage.toLocaleString()} mi</p>
                  <Badge variant={reading.includedInForecast ? "green" : "neutral"}>
                    {reading.includedInForecast ? "Included" : "Excluded"}
                  </Badge>
                  <Badge variant={reading.anomalyStatus === "NEEDS_REVIEW" ? "orange" : "neutral"}>
                    {compactLabel(reading.anomalyStatus)}
                  </Badge>
                </div>
                <dl className="mt-2 grid gap-2 text-zinc-600 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase text-zinc-400">Reading Date</dt>
                    <dd className="font-medium text-zinc-900">{formatDate(reading.readingDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-zinc-400">Source</dt>
                    <dd>{mileageReadingSourceLabel(reading)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-zinc-400">Verification</dt>
                    <dd>{compactLabel(reading.verificationStatus)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-zinc-400">Date entered</dt>
                    <dd>{reading.createdAt ? formatDateTime(reading.createdAt) : "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-zinc-400">Entered by</dt>
                    <dd>{reading.recordedByUserId ? usersById.get(reading.recordedByUserId)?.name ?? "Shop user" : "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-zinc-400">Included in forecast</dt>
                    <dd>{reading.includedInForecast ? "Yes" : "No"}</dd>
                  </div>
                </dl>
                {reading.correctionReason && <p className="mt-1 text-zinc-600">{reading.correctionReason}</p>}
                {reading.reviewNotes && <p className="mt-1 text-zinc-600">{reading.reviewNotes}</p>}
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <button
                  onClick={() => setCorrectingReading(reading)}
                  className="rounded-lg border border-zinc-200 px-3 py-2 font-semibold"
                >
                  Correct
                </button>
                {canEditDrivingEstimates && (
                  <button
                    onClick={() => void toggleReading(reading)}
                    className="rounded-lg border border-zinc-200 px-3 py-2 font-semibold"
                  >
                    {reading.includedInForecast ? "Exclude" : "Include"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {sortedReadings.length === 0 && (
            <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500">
              Unknown mileage history.
            </p>
          )}
        </CardContent>
      </Card>
      {correctingReading && (
        <MileageModal
          vehicle={vehicle}
          readings={readings}
          shopTimezone={shopTimezone}
          initialMileage={correctingReading.readingMileage}
          initialReadingDate={correctingReading.readingDate}
          onClose={() => setCorrectingReading(null)}
        />
      )}
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
  shopTimezone,
  onClose,
}: {
  record: VehicleMaintenanceRecord;
  vehicle: Vehicle;
  service?: MaintenanceService;
  shopTimezone: string;
  onClose: () => void;
}) {
  const store = useDemoStore();
  const effective = resolveMaintenanceInterval({ record, service, vehicle });
  const today = currentDateInTimeZone(shopTimezone);
  const [completedAt, setCompletedAt] = useState(today);
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
            <input type="date" max={today} value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2" />
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

function RecordInspectionModal({
  vehicle,
  shopTimezone,
  onClose,
}: {
  vehicle: Vehicle;
  shopTimezone: string;
  onClose: () => void;
}) {
  const store = useDemoStore();
  const today = currentDateInTimeZone(shopTimezone);
  const [inspectionDate, setInspectionDate] = useState(today);
  const [mileage, setMileage] = useState("");
  const [technician, setTechnician] = useState("");
  const [condition, setCondition] = useState<"PASS" | "MONITOR" | "REQUIRES_ATTENTION" | "FAIL">("MONITOR");
  const [componentsInspected, setComponentsInspected] = useState("");
  const [notes, setNotes] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [recommendationStatus, setRecommendationStatus] = useState<"UNDECIDED" | "ACCEPTED" | "DECLINED">("UNDECIDED");
  const [urgency, setUrgency] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  const [price, setPrice] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [recommendationNotes, setRecommendationNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (inspectionDate > today) {
      setError("Inspection date cannot be in the future.");
      return;
    }
    const parsedMileage = parseOptionalInt(mileage);
    if (parsedMileage !== null && parsedMileage < vehicle.currentMileage) {
      setError("Inspection mileage is below the current vehicle mileage. Add an odometer correction first.");
      return;
    }
    const recommendation = serviceName.trim()
      ? [{
          serviceName: serviceName.trim(),
          result: recommendationStatus,
          urgency,
          priceCents: Math.round((Number(price) || 0) * 100),
          laborMinutes: Math.round((Number(laborHours) || 0) * 60),
          notes: recommendationNotes.trim() || undefined,
        }]
      : [];
    setSaving(true);
    const result = await store.recordInspection({
      vehicleId: vehicle.id,
      inspectionDate,
      mileage: parsedMileage,
      technician: technician.trim() || undefined,
      condition,
      componentsInspected: componentsInspected.trim() || undefined,
      notes: notes.trim() || undefined,
      recommendations: recommendation,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "The inspection could not be recorded.");
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 p-5">
          <div>
            <h2 className="text-lg font-semibold">Record Inspection</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Save inspection notes, optional odometer reading, and explicit recommendations.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 p-2">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Inspection date</span>
            <input
              type="date"
              required
              max={today}
              value={inspectionDate}
              onChange={(event) => setInspectionDate(event.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Odometer reading</span>
            <input
              type="number"
              min={vehicle.currentMileage}
              value={mileage}
              onChange={(event) => setMileage(event.target.value)}
              placeholder={vehicle.currentMileage.toString()}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Technician</span>
            <input
              value={technician}
              onChange={(event) => setTechnician(event.target.value)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Condition</span>
            <select
              value={condition}
              onChange={(event) => setCondition(event.target.value as typeof condition)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2"
            >
              <option value="PASS">Pass</option>
              <option value="MONITOR">Monitor</option>
              <option value="REQUIRES_ATTENTION">Requires attention</option>
              <option value="FAIL">Fail</option>
            </select>
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="font-medium">Services or components inspected</span>
            <textarea
              value={componentsInspected}
              onChange={(event) => setComponentsInspected(event.target.value)}
              className="min-h-16 w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="font-medium">Inspection notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="min-h-20 w-full rounded-lg border border-zinc-200 px-3 py-2"
            />
          </label>
          <div className="space-y-3 rounded-lg border border-zinc-200 p-4 sm:col-span-2">
            <p className="font-semibold">Recommended work</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Service or component</span>
                <input
                  value={serviceName}
                  onChange={(event) => setServiceName(event.target.value)}
                  placeholder="Front Brake Pads"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Decision</span>
                <select
                  value={recommendationStatus}
                  onChange={(event) => setRecommendationStatus(event.target.value as typeof recommendationStatus)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                >
                  <option value="UNDECIDED">Undecided</option>
                  <option value="ACCEPTED">Accepted</option>
                  <option value="DECLINED">Declined</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Urgency</span>
                <select
                  value={urgency}
                  onChange={(event) => setUrgency(event.target.value as typeof urgency)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Estimate</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Labor hours</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={laborHours}
                    onChange={(event) => setLaborHours(event.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2"
                  />
                </label>
              </div>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="font-medium">Recommendation notes</span>
                <textarea
                  value={recommendationNotes}
                  onChange={(event) => setRecommendationNotes(event.target.value)}
                  className="min-h-16 w-full rounded-lg border border-zinc-200 px-3 py-2"
                />
              </label>
            </div>
          </div>
          {error && <p className="text-sm font-medium text-red-600 sm:col-span-2">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-100 p-5">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold">
            Cancel
          </button>
          <button
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ClipboardPlus className="h-4 w-4" />
            {saving ? "Recording…" : "Record Inspection"}
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
  const [inspectionOpen, setInspectionOpen] = useState(false);
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

  const mileageReadings = state.mileageReadings.filter((reading) => reading.vehicleId === vehicle.id);
  const persistedProfile = state.drivingProfiles.find((profile) => profile.vehicleId === vehicle.id);
  const vehicleForecastMileage = resolveEffectiveForecastMileage({
    shopId: state.shop.id,
    vehicleId: vehicle.id,
    readings: mileageReadings,
    shopDefaultAnnualMileage: state.shop.defaultAnnualMileage,
    customerReportedAnnualMileage: persistedProfile?.customerReportedAnnualMileage ?? vehicle.estimatedAnnualMileage,
    customerReportedAt: persistedProfile?.customerReportedAt ?? null,
    customerReportedByUserId: persistedProfile?.customerReportedByUserId ?? null,
    existingProfile: persistedProfile,
    asOf: currentDateInTimeZone(state.shop.timezone),
  });
  const maintenance = state.maintenanceRecords
    .filter((item) => item.vehicleId === vehicle.id && item.isActive !== false)
    .map((record) => ({
      record,
      service: record.serviceId ? servicesById.get(record.serviceId) : undefined,
      effective: resolveMaintenanceInterval({
        record,
        service: record.serviceId ? servicesById.get(record.serviceId) : undefined,
        vehicle,
        forecastMileage: vehicleForecastMileage,
      }),
    }))
    .sort((a, b) => a.effective.lifeRemaining - b.effective.lifeRemaining);
  const recommended = getRecommendedRecords(state, vehicle.id).map(({ record }) => record);
  const openRecommended = recommended.filter((record) => record.outreachStatus !== "SCHEDULED");
  const openVehicleOpportunities = buildRevenueOpportunities(state).filter((opportunity) =>
    opportunity.vehicleId === vehicle.id && isOpenRevenueStage(opportunity.stage),
  );
  const openMaintenanceOpportunities = openVehicleOpportunities.filter((opportunity) => opportunity.source !== "DECLINED_WORK");
  const openDeclinedFollowUps = openVehicleOpportunities.filter((opportunity) => opportunity.source === "DECLINED_WORK");
  const opportunityStatus =
    openMaintenanceOpportunities.length === 0
      ? "HEALTHY"
      : recommended.length > 0 && recommended.every((record) => record.outreachStatus === "SCHEDULED")
      ? "SCHEDULED"
      : recommended.some((record) => record.outreachStatus === "MANUALLY_SENT")
        ? "MANUALLY_SENT"
        : recommended.some((record) => record.outreachStatus === "DRAFTED")
          ? "DRAFTED"
          : "NEEDS_OUTREACH";
  const inspectionHistory = state.serviceRecords
    .filter((record) => record.vehicleId === vehicle.id)
    .filter((record) => record.notes?.startsWith("[Inspection]"))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const history = state.serviceRecords
    .filter((record) => record.vehicleId === vehicle.id)
    .filter((record) => !record.notes?.startsWith("[Inspection]"))
    .filter((record) => !historyFilter || record.serviceName === historyFilter)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const displayedLatestKnownMileage = vehicleMileageDisplayValue(vehicle, mileageReadings);
  const calculatedProfile = calculateDrivingProfile({
    shopId: state.shop.id,
    vehicleId: vehicle.id,
    readings: mileageReadings,
    shopDefaultAnnualMileage: state.shop.defaultAnnualMileage,
    customerReportedAnnualMileage: persistedProfile?.customerReportedAnnualMileage ?? vehicle.estimatedAnnualMileage,
    customerReportedAt: persistedProfile?.customerReportedAt ?? null,
    customerReportedByUserId: persistedProfile?.customerReportedByUserId ?? null,
    existingProfile: persistedProfile,
  });
  const drivingProfile: VehicleDrivingProfile = persistedProfile ?? {
    id: `profile-${vehicle.id}`,
    shopId: state.shop.id,
    vehicleId: vehicle.id,
    customerReportedAnnualMileage: calculatedProfile.customerReportedAnnualMileage,
    customerReportedAt: calculatedProfile.customerReportedAt,
    customerReportedByUserId: calculatedProfile.customerReportedByUserId,
    calculatedAnnualMileage: calculatedProfile.calculatedAnnualMileage,
    estimateSource: calculatedProfile.estimateSource,
    confidence: calculatedProfile.confidence,
    confidenceReason: calculatedProfile.confidenceReason,
    manualAnnualMileageOverride: calculatedProfile.manualAnnualMileageOverride,
    manualOverrideReason: calculatedProfile.manualOverrideReason,
    manualOverrideNotes: calculatedProfile.manualOverrideNotes,
    manualOverrideSetAt: calculatedProfile.manualOverrideSetAt,
    manualOverrideSetByUserId: calculatedProfile.manualOverrideSetByUserId,
    lastCalculatedAt: calculatedProfile.lastCalculatedAt,
  };

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
            className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"
          >
            <Gauge className="h-4 w-4" />
            Add Odometer Reading
          </button>
          <button
            onClick={() => setInspectionOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold"
          >
            <ClipboardPlus className="h-4 w-4" />
            Record Inspection
          </button>
          <button
            onClick={() => setRecommendationOpen(true)}
            disabled={openRecommended.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <MessageSquare className="h-4 w-4" />
            Recommend appointment
          </button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["Latest known mileage", formatMileage(displayedLatestKnownMileage)],
          [forecastBasisLabel(vehicleForecastMileage.kind), formatMileage(vehicleForecastMileage.mileage)],
          ["Plan items", `${maintenance.length}`],
          ["Open follow-ups", `${openRecommended.length + openDeclinedFollowUps.length}`],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent>
              <p className="text-sm text-zinc-500">{label}</p>
              <p className="mt-2 text-xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <DrivingProfilePanel
        vehicle={vehicle}
        profile={drivingProfile}
        readings={mileageReadings}
        users={state.users}
        currentUserId={state.currentUserId}
        shopTimezone={state.shop.timezone}
        shopDefaultAnnualMileage={state.shop.defaultAnnualMileage}
      />

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
              Maintenance condition: {opportunityLabel(opportunityStatus)}
            </Badge>
            {openDeclinedFollowUps.length > 0 && (
              <Badge variant="purple">Open declined-work follow-up</Badge>
            )}
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
                    Last completed {record.lastCompletedDate ? formatDate(record.lastCompletedDate) : "not recorded"} · {record.lastCompletedMileage === null ? "Last completed mileage not entered" : formatMileage(record.lastCompletedMileage)}
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
                <DetailTile label={forecastBasisLabel(effective.forecastMileageKind)} value={formatMileage(effective.forecastMileage)} />
                <DetailTile label="Latest known mileage" value={formatMileage(effective.latestKnownMileage)} />
                <DetailTile label="Next due mileage" value={effective.nextDueMileage !== null ? formatMileage(effective.nextDueMileage) : "Not calculated"} />
                <DetailTile label="Next due date" value={effective.nextDueDate ? formatDate(effective.nextDueDate) : "Not calculated"} />
                <DetailTile label="Price" value={formatCurrency(effective.priceCents)} />
                <DetailTile label="Labor" value={formatHours(effective.laborMinutes)} />
              </div>

              {(() => {
                if (effective.forecastMileage === null || effective.forecastMileage === undefined) {
                  return (
                    <div className="mt-4 rounded-lg border border-zinc-200 p-3 text-sm">
                      <p className="font-semibold">Forecast preview</p>
                      <p className="mt-1 text-zinc-500">Add a dated odometer reading to calculate mileage-based due dates.</p>
                    </div>
                  );
                }
                const preview = estimateServiceDueDate({
                  currentMileage: effective.forecastMileage,
                  dailyMileage: vehicleForecastMileage.dailyMileage ?? drivingProfile.calculatedAnnualMileage / 365,
                  effective,
                });
                return (
                  <div className="mt-4 rounded-lg border border-zinc-200 p-3 text-sm">
                    <p className="font-semibold">Forecast preview</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <DetailTile label="Remaining miles" value={preview.remainingMiles === null ? "Unknown" : formatMileage(preview.remainingMiles)} />
                      <DetailTile label="Mileage date" value={preview.mileageBasedDueDate ? formatDate(preview.mileageBasedDueDate) : "Unknown"} />
                      <DetailTile label="First due" value={preview.firstDueDate ? `${formatDate(preview.firstDueDate)} by ${preview.firstTrigger}` : "Unknown"} />
                    </div>
                  </div>
                );
              })()}

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
        <CardHeader>
          <h2 className="text-lg font-semibold">Inspection History</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          {inspectionHistory.map((record) => (
            <div key={record.id} className="rounded-lg border border-zinc-200 p-4 text-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-semibold">{formatDate(record.completedAt)}</p>
                <Badge>{formatServiceMileage(record.mileage)}</Badge>
              </div>
              {record.notes && (
                <p className="mt-2 whitespace-pre-line text-zinc-600">
                  {record.notes.replace(/^\[Inspection\]\n?/, "")}
                </p>
              )}
            </div>
          ))}
          {inspectionHistory.length === 0 && (
            <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500">
              No inspections recorded yet.
            </p>
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
                  {formatDate(record.completedAt)} · {formatServiceMileage(record.mileage)}
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

      {mileageOpen && (
        <MileageModal
          vehicle={vehicle}
          readings={mileageReadings}
          shopTimezone={state.shop.timezone}
          onClose={() => setMileageOpen(false)}
        />
      )}
      {inspectionOpen && (
        <RecordInspectionModal
          vehicle={vehicle}
          shopTimezone={state.shop.timezone}
          onClose={() => setInspectionOpen(false)}
        />
      )}
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
          shopTimezone={state.shop.timezone}
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
