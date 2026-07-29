"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  PanelRightOpen,
  Play,
  Search,
  X,
} from "lucide-react";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  addMinutesToIso,
  appointmentDurationMinutes,
  appointmentStatusClasses,
  appointmentStatusLabel,
  appointmentStatuses,
  calendarDays,
  calendarIncrementMinutes,
  dateHeading,
  dateKeyInTimeZone,
  findWorkForDay,
  getCalendarWarnings,
  getDayCapacity,
  getOpportunityRecordIds,
  getReadyToScheduleGroups,
  minutesInZone,
  nextDateKey,
  shopBusinessStartHour,
  slotTimes,
  timeInZone,
  weekDateKeys,
  zonedDateTimeToIso,
} from "@/lib/calendar";
import { vehicleLabel } from "@/lib/demo-calculations";
import {
  asOfDate,
  type Appointment,
  type AppointmentStatus,
} from "@/lib/demo-data";
import {
  type CalendarAppointmentInput,
  type CalendarAppointmentUpdateInput,
  useDemoStore,
} from "@/lib/demo-store";
import { type RevenueQueueGroup } from "@/lib/revenue-recovery";
import { formatCurrency, formatDate } from "@/lib/utils";

type CalendarView = "day" | "week";
type OpportunityFilter = "ALL" | "HIGH" | "DUE" | "DECLINED" | "INTERESTED" | "FOLLOW_UP" | "SHORT" | "LONG";
type DraftMode = "new" | "edit" | "complete";

type AppointmentDraft = CalendarAppointmentInput & {
  mode: DraftMode;
  appointmentId?: string;
  completionRevenue?: string;
  completionLaborHours?: string;
  completedAt?: string;
  allowWarnings?: boolean;
};

const slotHeight = 52;

function emptyDraft(input: {
  date: string;
  time: string;
  customerId: string;
  vehicleId: string;
}): AppointmentDraft {
  return {
    mode: "new",
    customerId: input.customerId,
    vehicleId: input.vehicleId,
    serviceDefinitionIds: [],
    maintenanceRecordIds: [],
    declinedWorkRecordIds: [],
    date: input.date,
    time: input.time,
    status: "SCHEDULED",
    source: "MANUAL",
    attributionSource: "MANUAL_SHOP_ENTRY",
    totalLaborHours: 1,
    totalPriceCents: 0,
    notes: "",
    allowWarnings: false,
  };
}

function hhmmFromMinutes(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function normalizeTimeForInput(value: string) {
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  if (!match) return "09:00";
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (match[3].toUpperCase() === "PM" && hour < 12) hour += 12;
  if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
  return hhmmFromMinutes(hour * 60 + minute);
}

function readableAttribution(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function appointmentPrimaryService(appointment: Appointment) {
  const [first, ...rest] = appointment.serviceNames;
  return `${first ?? "Service"}${rest.length > 0 ? ` + ${rest.length} more` : ""}`;
}

export default function AppointmentsPage() {
  const store = useDemoStore();
  const { state } = store;
  const todayKey = dateKeyInTimeZone(asOfDate, state.shop.timezone);
  const [view, setView] = useState<CalendarView>("week");
  const [anchorDate, setAnchorDate] = useState(todayKey);
  const [opportunityPanelOpen, setOpportunityPanelOpen] = useState(true);
  const [opportunityQuery, setOpportunityQuery] = useState("");
  const [opportunityFilter, setOpportunityFilter] = useState<OpportunityFilter>("ALL");
  const [draft, setDraft] = useState<AppointmentDraft | null>(null);
  const [findWorkDate, setFindWorkDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const days = calendarDays(anchorDate, view);
  const slots = slotTimes();
  const readyGroups = useMemo(() => getReadyToScheduleGroups(state), [state]);
  const filteredReadyGroups = readyGroups.filter((group) => {
    const haystack = `${group.customerName} ${group.vehicleLabel} ${group.recommendedServices.join(" ")} ${group.sources.join(" ")}`.toLowerCase();
    const queryMatch = !opportunityQuery.trim() || haystack.includes(opportunityQuery.toLowerCase());
    if (!queryMatch) return false;
    if (opportunityFilter === "HIGH") return group.priority === "HIGH";
    if (opportunityFilter === "DUE") return group.opportunities.some((item) => item.source.includes("MAINTENANCE"));
    if (opportunityFilter === "DECLINED") return group.opportunities.some((item) => item.source === "DECLINED_WORK");
    if (opportunityFilter === "INTERESTED") return group.opportunities.some((item) => item.stage === "RESPONDED");
    if (opportunityFilter === "FOLLOW_UP") return Boolean(group.lastContactedAt);
    if (opportunityFilter === "SHORT") return group.estimatedLaborHours <= 1.5;
    if (opportunityFilter === "LONG") return group.estimatedLaborHours > 1.5;
    return true;
  });

  function customerFor(customerId: string) {
    return state.customers.find((customer) => customer.id === customerId);
  }

  function vehicleFor(vehicleId: string) {
    return state.vehicles.find((vehicle) => vehicle.id === vehicleId);
  }

  function vehiclesForCustomer(customerId: string) {
    return state.vehicles.filter((vehicle) => vehicle.customerId === customerId);
  }

  function draftServices(current: AppointmentDraft) {
    const serviceDefinitions = state.services.filter((service) =>
      current.serviceDefinitionIds?.includes(service.id),
    );
    const maintenanceRecords = state.maintenanceRecords.filter((record) =>
      current.maintenanceRecordIds?.includes(record.id),
    );
    const declinedWorkRecords = state.declinedWorkRecords.filter((record) =>
      current.declinedWorkRecordIds?.includes(record.id),
    );
    return {
      names: Array.from(new Set([
        ...serviceDefinitions.map((service) => service.name),
        ...maintenanceRecords.map((record) => record.serviceName),
        ...declinedWorkRecords.map((record) => record.serviceName),
      ])),
      laborHours: [
        ...serviceDefinitions.map((service) => service.estimatedLaborMinutes / 60),
        ...maintenanceRecords.map((record) => record.laborHours),
        ...declinedWorkRecords.map((record) => record.laborHours),
      ].reduce((sum, value) => sum + value, 0),
      priceCents: [
        ...serviceDefinitions.map((service) => service.defaultPriceCents),
        ...maintenanceRecords.map((record) => record.priceCents),
        ...declinedWorkRecords.map((record) => record.recommendedPriceCents),
      ].reduce((sum, value) => sum + value, 0),
    };
  }

  function openManualDraft(date: string, time: string) {
    const customer = state.customers.find((item) => item.status !== "ARCHIVED");
    const vehicle = customer ? vehiclesForCustomer(customer.id)[0] : undefined;
    if (!customer || !vehicle) {
      setError("Add a customer and vehicle before creating a calendar appointment.");
      return;
    }
    setDraft(emptyDraft({ date, time, customerId: customer.id, vehicleId: vehicle.id }));
    setError("");
  }

  function openOpportunityDraft(group: RevenueQueueGroup, date: string, time: string) {
    const { maintenanceRecordIds, declinedWorkRecordIds } = getOpportunityRecordIds(group);
    setDraft({
      ...emptyDraft({ date, time, customerId: group.customerId, vehicleId: group.vehicleId }),
      maintenanceRecordIds,
      declinedWorkRecordIds,
      opportunityId: group.opportunities[0]?.id,
      outreachRecordId: state.outreachRecords.find((record) => record.vehicleId === group.vehicleId)?.id,
      status: "TENTATIVE",
      source: "AUTOMATION",
      attributionSource: "MAINTIVA_OUTREACH",
      totalLaborHours: group.estimatedLaborHours,
      totalPriceCents: group.estimatedRevenueCents,
      notes: `Scheduled from Ready to Schedule: ${group.recommendedServices.join(", ")}.`,
    });
    setError("");
  }

  function openEditDraft(appointment: Appointment, mode: DraftMode = "edit") {
    const startMinutes = minutesInZone(appointment.scheduledStart, state.shop.timezone);
    setDraft({
      mode,
      appointmentId: appointment.id,
      customerId: appointment.customerId,
      vehicleId: appointment.vehicleId,
      maintenanceRecordIds: appointment.maintenanceRecordIds,
      declinedWorkRecordIds: state.declinedWorkRecords
        .filter((record) => record.appointmentId === appointment.id)
        .map((record) => record.id),
      serviceDefinitionIds: [],
      opportunityId: appointment.opportunityId,
      outreachRecordId: appointment.outreachRecordId,
      date: dateKeyInTimeZone(appointment.scheduledStart, state.shop.timezone),
      time: hhmmFromMinutes(startMinutes),
      status: appointment.status,
      source: appointment.source,
      attributionSource: appointment.attributionSource,
      totalLaborHours: appointment.totalLaborHours,
      totalPriceCents: appointment.totalPriceCents,
      notes: appointment.notes,
      completionRevenue: String(((appointment.completedRevenueCents ?? appointment.totalPriceCents) / 100).toFixed(2)),
      completionLaborHours: String(appointment.completedLaborHours ?? appointment.totalLaborHours),
      completedAt: dateKeyInTimeZone(appointment.completedAt ?? asOfDate, state.shop.timezone),
      allowWarnings: false,
    });
    setError("");
  }

  async function updateAppointment(input: CalendarAppointmentUpdateInput) {
    setSaving(true);
    setError("");
    const result = await store.updateAppointment(input);
    setSaving(false);
    if (!result.ok) setError(result.message ?? "Appointment could not be saved.");
    else setDraft(null);
  }

  async function snoozeGroup(group: RevenueQueueGroup, baseDate = anchorDate) {
    const recordIds = getOpportunityRecordIds(group);
    setSaving(true);
    setError("");
    const result = await store.snoozeOpportunity({
      ...recordIds,
      followUpDate: nextDateKey(baseDate, 1, "week"),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "Opportunity could not be snoozed.");
    }
  }

  async function handleDrop(event: React.DragEvent, date: string, time: string) {
    event.preventDefault();
    const payload = event.dataTransfer.getData("application/json");
    if (!payload) return;
    const data = JSON.parse(payload) as { type: "appointment" | "opportunity" | "resize"; id: string };
    if (data.type === "opportunity") {
      const group = readyGroups.find((item) => item.id === data.id);
      if (group) openOpportunityDraft(group, date, time);
      return;
    }
    const appointment = state.appointments.find((item) => item.id === data.id);
    if (!appointment || ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status)) return;
    if (data.type === "resize") {
      const startDate = dateKeyInTimeZone(appointment.scheduledStart, state.shop.timezone);
      if (startDate !== date) return;
      const endIso = zonedDateTimeToIso(date, time, state.shop.timezone);
      const durationMinutes = Math.max(
        calendarIncrementMinutes,
        Math.ceil((new Date(endIso).getTime() - new Date(appointment.scheduledStart).getTime()) / 60_000 / calendarIncrementMinutes) * calendarIncrementMinutes,
      );
      await updateAppointment({
        appointmentId: appointment.id,
        durationMinutes,
        totalLaborHours: durationMinutes / 60,
      });
      return;
    }
    await updateAppointment({ appointmentId: appointment.id, date, time });
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const services = draftServices(draft);
    if (draft.mode !== "complete" && services.names.length === 0) {
      setError("Select at least one service.");
      return;
    }

    const scheduledStart = zonedDateTimeToIso(draft.date, draft.time, state.shop.timezone);
    const scheduledEnd = addMinutesToIso(scheduledStart, Math.round(draft.totalLaborHours * 60));
    const warnings = getCalendarWarnings(
      state,
      {
        customerId: draft.customerId,
        vehicleId: draft.vehicleId,
        scheduledStart,
        scheduledEnd,
        totalLaborHours: draft.totalLaborHours,
        totalPriceCents: draft.totalPriceCents,
      },
      { excludeAppointmentId: draft.appointmentId },
    );

    if (warnings.length > 0 && !draft.allowWarnings && draft.mode !== "complete") {
      setError("Review the calendar warnings, then choose Save anyway if this overbooking is intentional.");
      return;
    }

    setSaving(true);
    setError("");
    if (draft.mode === "complete" && draft.appointmentId) {
      const result = await store.completeAppointment({
        appointmentId: draft.appointmentId,
        completedRevenueCents: Math.round(Number(draft.completionRevenue ?? 0) * 100),
        completedLaborHours: Number(draft.completionLaborHours ?? draft.totalLaborHours),
        completedAt: draft.completedAt ?? draft.date,
        notes: draft.notes,
      });
      setSaving(false);
      if (!result.ok) setError(result.message ?? "Completion could not be saved.");
      else setDraft(null);
      return;
    }

    const result = draft.mode === "edit" && draft.appointmentId
      ? await store.updateAppointment({
          appointmentId: draft.appointmentId,
          date: draft.date,
          time: draft.time,
          durationMinutes: Math.round(draft.totalLaborHours * 60),
          totalLaborHours: draft.totalLaborHours,
          totalPriceCents: draft.totalPriceCents,
          status: draft.status,
          notes: draft.notes,
        })
      : await store.createCalendarAppointment(draft);
    setSaving(false);
    if (!result.ok) setError(result.message ?? "Appointment could not be saved.");
    else setDraft(null);
  }

  function toggleService(serviceId: string) {
    if (!draft || draft.mode !== "new") return;
    const selected = new Set(draft.serviceDefinitionIds ?? []);
    if (selected.has(serviceId)) selected.delete(serviceId);
    else selected.add(serviceId);
    const next = { ...draft, serviceDefinitionIds: Array.from(selected) };
    const services = draftServices(next);
    setDraft({
      ...next,
      totalLaborHours: services.laborHours || next.totalLaborHours,
      totalPriceCents: services.priceCents,
    });
  }

  function selectCustomer(customerId: string) {
    if (!draft) return;
    const vehicle = vehiclesForCustomer(customerId)[0];
    setDraft({
      ...draft,
      customerId,
      vehicleId: vehicle?.id ?? "",
    });
  }

  const visibleAppointments = state.appointments.filter((appointment) =>
    days.includes(dateKeyInTimeZone(appointment.scheduledStart, state.shop.timezone)),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-violet-700">Capacity Calendar</p>
          <h1 className="mt-1 text-3xl font-semibold">Appointments</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Schedule recovered work, manage shop-level labor capacity, and keep Maintiva-attributed revenue connected to appointments.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => openManualDraft(anchorDate, "09:00")} className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">
            <CalendarPlus className="h-4 w-4" />
            New Appointment
          </button>
          <button onClick={() => setAnchorDate(todayKey)} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold">Today</button>
          <button onClick={() => setAnchorDate(nextDateKey(anchorDate, -1, view))} className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200 bg-white" aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setAnchorDate(nextDateKey(anchorDate, 1, view))} className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200 bg-white" aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </button>
          {(["day", "week"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                view === mode ? "border-violet-950 bg-violet-950 text-white" : "border-zinc-200 bg-white text-zinc-700"
              }`}
            >
              {mode === "day" ? "Day" : "Week"}
            </button>
          ))}
          <button onClick={() => setOpportunityPanelOpen((current) => !current)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold">
            <PanelRightOpen className="h-4 w-4" />
            Ready to Schedule
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div className={`grid gap-5 ${opportunityPanelOpen ? "xl:grid-cols-[minmax(0,1fr)_24rem]" : ""}`}>
        <Card>
          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                {view === "week"
                  ? `${dateHeading(weekDateKeys(anchorDate)[0], state.shop.timezone)} - ${dateHeading(weekDateKeys(anchorDate)[6], state.shop.timezone)}`
                  : dateHeading(anchorDate, state.shop.timezone, "long")}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Shop time zone: {state.shop.timezone}. Capacity uses {state.shop.dailyBayHours} available labor hours per day.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {["All appointments", "Maintiva-attributed", "Manual", "Tentative", "Confirmed", "Completed", "Follow-up tasks"].map((label) => (
                <Badge key={label} variant="neutral">{label}</Badge>
              ))}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <div className={`grid min-w-[760px] gap-3 ${view === "week" ? "lg:grid-cols-7" : "grid-cols-1"}`}>
              {days.map((day) => {
                const capacity = getDayCapacity(state, day);
                const dayAppointments = visibleAppointments.filter(
                  (appointment) => dateKeyInTimeZone(appointment.scheduledStart, state.shop.timezone) === day,
                );
                return (
                  <div key={day} className="min-w-0 rounded-lg border border-zinc-200 bg-white">
                    <div className="border-b border-zinc-100 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold">{dateHeading(day, state.shop.timezone)}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {capacity.scheduledLaborHours} booked / {capacity.availableLaborHours} available
                          </p>
                          <p className="text-xs font-semibold text-violet-800">{capacity.openLaborHours} open hrs</p>
                        </div>
                        <Badge variant={capacity.utilizationPct > 100 ? "red" : capacity.utilizationPct > 85 ? "orange" : "green"}>
                          {capacity.utilizationPct}%
                        </Badge>
                      </div>
                      {capacity.openLaborHours > 0 && (
                        <button
                          onClick={() => setFindWorkDate(day)}
                          className="mt-3 w-full rounded-lg border border-violet-200 px-2 py-1.5 text-xs font-semibold text-violet-950"
                        >
                          Find Work to Fill This Day
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      {slots.map((time) => (
                        <button
                          key={`${day}-${time}`}
                          type="button"
                          onClick={() => openManualDraft(day, time)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => void handleDrop(event, day, time)}
                          className="grid w-full grid-cols-[3.5rem_1fr] border-b border-zinc-100 text-left text-xs hover:bg-violet-50 focus:bg-violet-50 focus:outline-none"
                          style={{ height: slotHeight }}
                        >
                          <span className="border-r border-zinc-100 px-2 py-2 text-zinc-400">{time}</span>
                          <span className="px-2 py-2 text-zinc-300">Click to schedule</span>
                        </button>
                      ))}
                      {dayAppointments.map((appointment) => {
                        const customer = customerFor(appointment.customerId);
                        const vehicle = vehicleFor(appointment.vehicleId);
                        const startMinutes = minutesInZone(appointment.scheduledStart, state.shop.timezone);
                        const top = ((startMinutes - shopBusinessStartHour * 60) / calendarIncrementMinutes) * slotHeight + 3;
                        const height = Math.max(48, (appointmentDurationMinutes(appointment) / calendarIncrementMinutes) * slotHeight - 8);
                        return (
                          <div
                            key={appointment.id}
                            draggable={!["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status)}
                            onDragStart={(event) => event.dataTransfer.setData("application/json", JSON.stringify({ type: "appointment", id: appointment.id }))}
                            className={`absolute left-[4rem] right-2 overflow-hidden rounded-lg border p-2 text-xs shadow-sm ${appointmentStatusClasses(appointment.status)}`}
                            style={{ top, height }}
                          >
                            <button onClick={() => openEditDraft(appointment)} className="block w-full text-left">
                              <span className="font-semibold">{timeInZone(appointment.scheduledStart, state.shop.timezone)} · {customer?.firstName} {customer?.lastName}</span>
                              <span className="mt-0.5 block truncate">{vehicle ? vehicleLabel(vehicle) : "Vehicle unavailable"}</span>
                              <span className="mt-1 block truncate">{appointmentPrimaryService(appointment)}</span>
                              <span className="mt-1 flex flex-wrap gap-1">
                                <Badge variant="neutral">{appointment.totalLaborHours} hr</Badge>
                                <Badge variant="purple">{formatCurrency(appointment.totalPriceCents)}</Badge>
                                <Badge variant={statusVariant(appointment.status)}>{appointmentStatusLabel(appointment.status)}</Badge>
                                {appointment.attributionSource === "MAINTIVA_OUTREACH" && <Badge variant="purple">Maintiva</Badge>}
                              </span>
                            </button>
                            {!["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status) && (
                              <div
                                draggable
                                onDragStart={(event) => {
                                  event.stopPropagation();
                                  event.dataTransfer.setData("application/json", JSON.stringify({ type: "resize", id: appointment.id }));
                                }}
                                className="absolute inset-x-0 bottom-0 grid h-4 cursor-ns-resize place-items-center border-t border-current/20 bg-white/30"
                                title="Drag to resize duration"
                              >
                                <GripVertical className="h-3 w-3" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {opportunityPanelOpen && (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Ready to Schedule</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Opportunities stay here until an appointment save is confirmed.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-zinc-500">
                <Search className="h-4 w-4" />
                <input value={opportunityQuery} onChange={(event) => setOpportunityQuery(event.target.value)} placeholder="Search ready work" className="w-full bg-transparent text-sm outline-none" />
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  ["ALL", "All"],
                  ["HIGH", "High priority"],
                  ["DUE", "Due maintenance"],
                  ["DECLINED", "Declined work"],
                  ["INTERESTED", "Customer interested"],
                  ["FOLLOW_UP", "Follow-up due"],
                  ["SHORT", "Under 1.5 hr"],
                  ["LONG", "Longer work"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setOpportunityFilter(value as OpportunityFilter)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                      opportunityFilter === value ? "border-violet-950 bg-violet-950 text-white" : "border-zinc-200 bg-white text-zinc-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                {filteredReadyGroups.map((group) => (
                  <div
                    key={group.id}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("application/json", JSON.stringify({ type: "opportunity", id: group.id }))}
                    className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{group.customerName}</p>
                        <p className="text-sm text-zinc-500">{group.vehicleLabel}</p>
                      </div>
                      <Badge variant={group.priority === "HIGH" ? "red" : group.priority === "MEDIUM" ? "orange" : "neutral"}>{group.priority}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-zinc-700">{group.recommendedServices.join(", ")}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {group.sources.map((source) => <Badge key={source} variant="purple">{source}</Badge>)}
                      <Badge>{formatCurrency(group.estimatedRevenueCents)}</Badge>
                      <Badge>{group.estimatedLaborHours} hr</Badge>
                      <Badge>{group.outreachStatus}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-zinc-500">
                      Last customer contact: {group.lastContactedAt ? formatDate(group.lastContactedAt) : "Not recorded"}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Link href="/automation" className="rounded-lg border border-zinc-200 px-2 py-1.5 text-center text-xs font-semibold">Contact Customer</Link>
                      <button onClick={() => openOpportunityDraft(group, anchorDate, "09:00")} className="rounded-lg bg-violet-950 px-2 py-1.5 text-xs font-semibold text-white">Schedule</button>
                      <Link href={`/vehicles/${group.vehicleId}`} className="rounded-lg border border-zinc-200 px-2 py-1.5 text-center text-xs font-semibold">View Opportunity</Link>
                      <button disabled={saving} className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60" onClick={() => void snoozeGroup(group)}>Snooze</button>
                    </div>
                  </div>
                ))}
                {filteredReadyGroups.length === 0 && (
                  <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500">No ready opportunities match these filters.</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {findWorkDate && (
        <FindWorkPanel
          dateKey={findWorkDate}
          state={state}
          groups={findWorkForDay(state, findWorkDate)}
          onClose={() => setFindWorkDate(null)}
          onSchedule={(group) => {
            openOpportunityDraft(group, findWorkDate, "09:00");
            setFindWorkDate(null);
          }}
          onSnooze={(group) => void snoozeGroup(group, findWorkDate)}
        />
      )}

      {draft && (
        <AppointmentModal
          draft={draft}
          state={state}
          saving={saving}
          warnings={getCalendarWarnings(
            state,
            {
              customerId: draft.customerId,
              vehicleId: draft.vehicleId,
              scheduledStart: zonedDateTimeToIso(draft.date, draft.time, state.shop.timezone),
              scheduledEnd: addMinutesToIso(zonedDateTimeToIso(draft.date, draft.time, state.shop.timezone), Math.round(draft.totalLaborHours * 60)),
              totalLaborHours: draft.totalLaborHours,
              totalPriceCents: draft.totalPriceCents,
            },
            { excludeAppointmentId: draft.appointmentId },
          )}
          onClose={() => setDraft(null)}
          onSubmit={saveDraft}
          onChange={setDraft}
          onToggleService={toggleService}
          onSelectCustomer={selectCustomer}
          onStatusAction={(status) => {
            if (!draft.appointmentId) return;
            void updateAppointment({ appointmentId: draft.appointmentId, status });
          }}
          onCancelAppointment={() => {
            if (!draft.appointmentId) return;
            if (window.confirm("Cancel this appointment and keep its history?")) {
              void updateAppointment({ appointmentId: draft.appointmentId, status: "CANCELLED" });
            }
          }}
          onComplete={() => setDraft({ ...draft, mode: "complete" })}
        />
      )}
    </div>
  );
}

function AppointmentModal({
  draft,
  state,
  saving,
  warnings,
  onClose,
  onSubmit,
  onChange,
  onToggleService,
  onSelectCustomer,
  onStatusAction,
  onCancelAppointment,
  onComplete,
}: {
  draft: AppointmentDraft;
  state: ReturnType<typeof useDemoStore>["state"];
  saving: boolean;
  warnings: string[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: (draft: AppointmentDraft) => void;
  onToggleService: (serviceId: string) => void;
  onSelectCustomer: (customerId: string) => void;
  onStatusAction: (status: AppointmentStatus) => void;
  onCancelAppointment: () => void;
  onComplete: () => void;
}) {
  const customerVehicles = state.vehicles.filter((vehicle) => vehicle.customerId === draft.customerId);
  const customer = state.customers.find((item) => item.id === draft.customerId);
  const vehicle = state.vehicles.find((item) => item.id === draft.vehicleId);
  const relatedOpportunity = draft.opportunityId ? draft.opportunityId.replace(/^opp-/, "") : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-3">
      <form onSubmit={onSubmit} className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 p-5">
          <div>
            <h2 className="text-lg font-semibold">
              {draft.mode === "complete" ? "Mark Job Complete" : draft.mode === "edit" ? "Edit Appointment" : "New Appointment"}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {customer?.firstName} {customer?.lastName} {vehicle ? `· ${vehicleLabel(vehicle)}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-200" aria-label="Close appointment panel">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            {warnings.length > 0 && draft.mode !== "complete" && (
              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  Calendar warning
                </div>
                <ul className="space-y-1">
                  {warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
                <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={Boolean(draft.allowWarnings)} onChange={(event) => onChange({ ...draft, allowWarnings: event.target.checked })} className="h-4 w-4 accent-violet-950" />
                  Save anyway
                </label>
              </div>
            )}

            {draft.mode === "complete" ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-sm font-medium">
                  Completion date
                  <input type="date" value={draft.completedAt ?? draft.date} onChange={(event) => onChange({ ...draft, completedAt: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
                </label>
                <label className="text-sm font-medium">
                  Final revenue
                  <input type="number" min="0" step="0.01" value={draft.completionRevenue ?? ""} onChange={(event) => onChange({ ...draft, completionRevenue: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
                </label>
                <label className="text-sm font-medium">
                  Final labor hours
                  <input type="number" min="0.1" step="0.1" value={draft.completionLaborHours ?? ""} onChange={(event) => onChange({ ...draft, completionLaborHours: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
                </label>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium">
                    Customer
                    <select value={draft.customerId} onChange={(event) => onSelectCustomer(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500">
                      {state.customers.map((item) => <option key={item.id} value={item.id}>{item.firstName} {item.lastName}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-medium">
                    Vehicle
                    <select value={draft.vehicleId} onChange={(event) => onChange({ ...draft, vehicleId: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500">
                      {customerVehicles.map((item) => <option key={item.id} value={item.id}>{vehicleLabel(item)}</option>)}
                    </select>
                  </label>
                </div>
                {draft.mode === "new" && (draft.maintenanceRecordIds?.length ?? 0) === 0 && (draft.declinedWorkRecordIds?.length ?? 0) === 0 && (
                  <div>
                    <p className="mb-2 text-sm font-semibold">Services</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {state.services.map((service) => (
                        <label key={service.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
                          <span className="flex items-center gap-3">
                            <input type="checkbox" checked={draft.serviceDefinitionIds?.includes(service.id)} onChange={() => onToggleService(service.id)} className="h-4 w-4 accent-violet-950" />
                            <span>
                              <span className="font-semibold">{service.name}</span>
                              <span className="block text-zinc-500">{service.estimatedLaborMinutes / 60} hr</span>
                            </span>
                          </span>
                          <span className="font-semibold">{formatCurrency(service.defaultPriceCents)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-4">
                  <label className="text-sm font-medium">
                    Date
                    <input type="date" value={draft.date} onChange={(event) => onChange({ ...draft, date: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
                  </label>
                  <label className="text-sm font-medium">
                    Start time
                    <input type="time" value={normalizeTimeForInput(draft.time)} onChange={(event) => onChange({ ...draft, time: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
                  </label>
                  <label className="text-sm font-medium">
                    Labor hours
                    <input type="number" min="0.5" step="0.5" value={draft.totalLaborHours} onChange={(event) => onChange({ ...draft, totalLaborHours: Number(event.target.value) })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
                  </label>
                  <label className="text-sm font-medium">
                    Estimated price
                    <input type="number" min="0" step="1" value={Math.round(draft.totalPriceCents / 100)} onChange={(event) => onChange({ ...draft, totalPriceCents: Math.round(Number(event.target.value) * 100) })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
                  </label>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="text-sm font-medium">
                    Status
                    <select value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as AppointmentStatus })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500">
                      {appointmentStatuses.map((status) => <option key={status} value={status}>{appointmentStatusLabel(status)}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-medium">
                    Attribution source
                    <select value={draft.attributionSource} onChange={(event) => onChange({ ...draft, attributionSource: event.target.value as Appointment["attributionSource"] })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500">
                      <option value="MAINTIVA_OUTREACH">Maintiva opportunity</option>
                      <option value="MANUAL_SHOP_ENTRY">Manual shop entry</option>
                      <option value="IMPORTED_APPOINTMENT">Imported appointment</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  <div className="rounded-lg border border-zinc-200 p-3 text-sm">
                    <p className="text-zinc-500">Calculated end time</p>
                    <p className="mt-1 font-semibold">
                      {timeInZone(addMinutesToIso(zonedDateTimeToIso(draft.date, draft.time, state.shop.timezone), Math.round(draft.totalLaborHours * 60)), state.shop.timezone)}
                    </p>
                  </div>
                </div>
              </>
            )}
            <label className="block text-sm font-medium">
              Internal notes
              <textarea value={draft.notes ?? ""} onChange={(event) => onChange({ ...draft, notes: event.target.value })} rows={3} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-violet-500" />
            </label>
          </div>

          <aside className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <h3 className="font-semibold">Appointment details</h3>
            {[
              ["Created", draft.appointmentId ? "Saved appointment" : "New draft"],
              ["Last updated", draft.appointmentId ? "Tracked by database updatedAt" : "Not saved"],
              ["Attribution", readableAttribution(draft.attributionSource)],
              ["Connected opportunity", relatedOpportunity || "None"],
              ["Outreach", draft.outreachRecordId || "None"],
              ["Customer contact", customer ? `${customer.phone || "No phone"} · ${customer.email || "No email"}` : "No customer"],
              ["Vehicle", vehicle ? vehicleLabel(vehicle) : "No vehicle"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
                <p className="text-zinc-500">{label}</p>
                <p className="mt-1 font-semibold">{value}</p>
              </div>
            ))}
            {draft.appointmentId && (
              <div className="grid gap-2">
                <button type="button" onClick={() => onStatusAction("CONFIRMED")} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold">
                  <CheckCircle2 className="h-4 w-4" />
                  Mark Confirmed
                </button>
                <button type="button" onClick={() => onStatusAction("IN_PROGRESS")} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold">
                  <Play className="h-4 w-4" />
                  Start Appointment
                </button>
                <button type="button" onClick={onComplete} className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white">
                  <CalendarCheck className="h-4 w-4" />
                  Mark Job Complete
                </button>
                <button type="button" onClick={onCancelAppointment} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700">
                  Cancel Appointment
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <Link href={`/customers/${draft.customerId}`} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-center text-sm font-semibold">View Customer</Link>
                  <Link href={`/vehicles/${draft.vehicleId}`} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-center text-sm font-semibold">View Vehicle</Link>
                </div>
              </div>
            )}
          </aside>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-100 p-5">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold">Cancel</button>
          <button disabled={saving} className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? "Saving..." : draft.mode === "complete" ? "Save completion" : "Save appointment"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FindWorkPanel({
  dateKey,
  state,
  groups,
  onClose,
  onSchedule,
  onSnooze,
}: {
  dateKey: string;
  state: ReturnType<typeof useDemoStore>["state"];
  groups: RevenueQueueGroup[];
  onClose: () => void;
  onSchedule: (group: RevenueQueueGroup) => void;
  onSnooze: (group: RevenueQueueGroup) => void;
}) {
  const capacity = getDayCapacity(state, dateKey);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-3">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 p-5">
          <div>
            <h2 className="text-lg font-semibold">Find Work to Fill This Day</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {dateHeading(dateKey, state.shop.timezone, "long")} has {capacity.openLaborHours} open labor hours. Maintiva found {groups.length} opportunities that may help fill the day.
            </p>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-200" aria-label="Close find work panel">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          {groups.map((group) => (
            <div key={group.id} className="rounded-lg border border-zinc-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold">{group.customerName}</p>
                  <p className="text-sm text-zinc-500">{group.vehicleLabel}</p>
                  <p className="mt-2 text-sm">{group.recommendedServices.join(", ")}</p>
                  <p className="mt-1 text-xs text-zinc-500">{group.explanation}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={group.priority === "HIGH" ? "red" : group.priority === "MEDIUM" ? "orange" : "neutral"}>{group.priority}</Badge>
                  <Badge variant="purple">{formatCurrency(group.estimatedRevenueCents)}</Badge>
                  <Badge>{group.estimatedLaborHours} hr</Badge>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/automation" className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold">Contact Customer</Link>
                <button onClick={() => onSchedule(group)} className="rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white">Schedule</button>
                <Link href={`/vehicles/${group.vehicleId}`} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold">View Opportunity</Link>
                <button onClick={() => onSnooze(group)} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold">Snooze</button>
              </div>
            </div>
          ))}
          {groups.length === 0 && (
            <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500">No matching opportunities fit this day’s remaining capacity.</p>
          )}
        </div>
      </div>
    </div>
  );
}
