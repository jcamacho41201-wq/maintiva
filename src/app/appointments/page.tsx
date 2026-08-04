"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListFilter,
  Plus,
  XCircle,
} from "lucide-react";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { appointmentRequestCommitments } from "@/lib/appointment-requests";
import { getDashboardMetrics, vehicleLabel } from "@/lib/demo-calculations";
import { useDemoStore } from "@/lib/demo-store";
import type { Appointment, AppointmentRequestRecord, SmartMaintenanceBlock, SmartMaintenanceBlockBlackout } from "@/lib/demo-data";
import { calculateSmartMaintenanceBlockAvailability, minutesToTime } from "@/lib/smart-maintenance-blocks";
import { formatCurrency } from "@/lib/utils";

type ActiveTab = "CALENDAR" | "REQUESTS" | "APPOINTMENTS";
type CalendarView = "WEEK" | "DAY" | "AGENDA";
type CalendarFilter = "ALL" | "REQUESTS" | "CONFIRMED" | "CAPACITY" | "BLACKOUTS";
type CalendarEvent =
  | { id: string; type: "REQUEST"; startsAt: string; endsAt: string; request: AppointmentRequestRecord }
  | { id: string; type: "APPOINTMENT"; startsAt: string; endsAt: string; appointment: Appointment }
  | { id: string; type: "CAPACITY"; startsAt: string; endsAt: string; block: SmartMaintenanceBlock; remainingVehicles: number; remainingLaborMinutes: number }
  | { id: string; type: "BLACKOUT"; startsAt: string; endsAt: string; blackout: SmartMaintenanceBlockBlackout };

const advisoryNotice =
  "Shows Maintiva appointment requests, confirmed Maintiva appointments, and Smart Maintenance Block capacity. Check your primary shop calendar before approving requests.";

const dayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const fullDayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const day = startOfDay(date);
  day.setDate(day.getDate() - day.getDay());
  return day;
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function eventDateKey(value: string) {
  return localDate(new Date(value));
}

function eventTimeRange(startsAt: string, endsAt: string) {
  return `${timeFormatter.format(new Date(startsAt))}-${timeFormatter.format(new Date(endsAt))}`;
}

function serviceSummary(names: string[]) {
  if (names.length <= 1) return names[0] ?? "Service";
  return `${names[0]} + ${names.length - 1} more`;
}

function requestServices(request: AppointmentRequestRecord) {
  return request.services.map((service) => service.serviceNameSnapshot);
}

function calendarEventMatches(event: CalendarEvent, filter: CalendarFilter) {
  if (filter === "ALL") return true;
  if (filter === "REQUESTS") return event.type === "REQUEST";
  if (filter === "CONFIRMED") return event.type === "APPOINTMENT";
  if (filter === "CAPACITY") return event.type === "CAPACITY";
  return event.type === "BLACKOUT";
}

export default function AppointmentsPage() {
  const {
    state,
    completeAppointment,
    acceptAppointmentRequest,
    declineMaintenanceRequest,
    proposeAppointmentRequestAlternate,
  } = useDemoStore();
  const [tab, setTab] = useState<ActiveTab>("CALENDAR");
  const [view, setView] = useState<CalendarView>("WEEK");
  const [filter, setFilter] = useState<CalendarFilter>("ALL");
  const [cursor, setCursor] = useState(() => startOfWeek(new Date()));
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [completion, setCompletion] = useState<{
    appointmentId: string;
    revenue: string;
    laborHours: string;
    completedAt: string;
    notes: string;
  } | null>(null);
  const [alternate, setAlternate] = useState<{ requestId: string; startsAt: string; endsAt: string } | null>(null);
  const metrics = getDashboardMetrics(state);
  const committedHours = state.shop.dailyBayHours - metrics.openBayCapacityHours;
  const pendingRequests = state.appointmentRequests
    .filter((request) => request.status === "PENDING")
    .sort((a, b) => a.customerSubmittedAt.localeCompare(b.customerSubmittedAt));

  const visibleDays = useMemo(() => {
    if (view === "DAY") return [startOfDay(cursor)];
    const start = view === "WEEK" ? startOfWeek(cursor) : startOfDay(cursor);
    return Array.from({ length: view === "WEEK" ? 7 : 14 }, (_, index) => addDays(start, index));
  }, [cursor, view]);
  const dateFrom = localDate(visibleDays[0]);
  const dateTo = localDate(visibleDays[visibleDays.length - 1]);

  const calendarEvents = useMemo(() => {
    const capacitySlots = state.smartMaintenanceBlocks.flatMap((block) =>
      calculateSmartMaintenanceBlockAvailability({
        shop: { id: state.shop.id, timezone: state.shop.timezone },
        blocks: [block],
        services: state.services,
        selectedServiceIds: block.serviceDefinitionIds,
        appointments: state.appointments,
        blackouts: state.smartMaintenanceBlockBlackouts,
        commitments: appointmentRequestCommitments(state.appointmentRequests),
        dateFrom,
        dateTo,
        now: new Date(),
      }),
    ).slice(0, view === "AGENDA" ? 24 : 48);

    const events: CalendarEvent[] = [
      ...capacitySlots.flatMap((slot): CalendarEvent[] => {
        const block = state.smartMaintenanceBlocks.find((item) => item.id === slot.blockId);
        if (!block) return [];
        return [{
          id: `capacity-${slot.blockId}-${slot.startsAt}`,
          type: "CAPACITY",
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          remainingVehicles: slot.remainingVehicles,
          remainingLaborMinutes: slot.remainingLaborMinutes,
          block,
        }];
      }),
      ...state.appointmentRequests.map((request): CalendarEvent => ({
        id: `request-${request.id}`,
        type: "REQUEST",
        startsAt: request.alternateProposedStart ?? request.requestedStart,
        endsAt: request.alternateProposedEnd ?? request.requestedEnd,
        request,
      })),
      ...state.appointments.map((appointment): CalendarEvent => ({
        id: `appointment-${appointment.id}`,
        type: "APPOINTMENT",
        startsAt: appointment.scheduledStart,
        endsAt: appointment.scheduledEnd,
        appointment,
      })),
      ...state.smartMaintenanceBlockBlackouts.map((blackout): CalendarEvent => ({
        id: `blackout-${blackout.id}`,
        type: "BLACKOUT",
        startsAt: blackout.startsAt,
        endsAt: blackout.endsAt,
        blackout,
      })),
    ];

    return events
      .filter((event) => eventDateKey(event.startsAt) >= dateFrom && eventDateKey(event.startsAt) <= dateTo)
      .filter((event) => calendarEventMatches(event, filter))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [dateFrom, dateTo, filter, state.appointmentRequests, state.appointments, state.services, state.shop.id, state.shop.timezone, state.smartMaintenanceBlockBlackouts, state.smartMaintenanceBlocks, view]);

  const selectedEvent = calendarEvents.find((event) => event.id === selectedEventId) ?? null;

  function customerName(customerId: string) {
    const customer = state.customers.find((item) => item.id === customerId);
    return customer ? `${customer.firstName} ${customer.lastName}` : "Customer";
  }

  function vehicleName(vehicleId: string) {
    const vehicle = state.vehicles.find((item) => item.id === vehicleId);
    return vehicle ? vehicleLabel(vehicle) : "Vehicle";
  }

  function sourceLabel(appointment: Appointment) {
    if (appointment.source === "CUSTOMER_BOOKING" && appointment.status === "REQUESTED") return "Customer requested";
    if (appointment.source === "CUSTOMER_BOOKING") return "Customer self-booked";
    if (appointment.source === "IMPORTED") return "Imported";
    if (appointment.source === "AUTOMATION") return "Queue booked";
    return "Staff booked";
  }

  function submitCompletion() {
    if (!completion) return;
    const revenue = Math.round(Number(completion.revenue) * 100);
    const laborHours = Number(completion.laborHours);
    if (!Number.isFinite(revenue) || revenue < 0 || !Number.isFinite(laborHours) || laborHours <= 0) return;
    completeAppointment({
      appointmentId: completion.appointmentId,
      completedRevenueCents: revenue,
      completedLaborHours: laborHours,
      completedAt: completion.completedAt,
      notes: completion.notes,
    });
    setCompletion(null);
  }

  function renderEvent(event: CalendarEvent) {
    if (event.type === "CAPACITY") {
      return (
        <button key={event.id} onClick={() => setSelectedEventId(event.id)} className="w-full rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-3 text-left text-sm">
          <p className="font-semibold text-emerald-900">Open maintenance capacity</p>
          <p className="mt-1 text-xs text-emerald-800">{eventTimeRange(event.startsAt, event.endsAt)} · {event.block.name}</p>
        </button>
      );
    }
    if (event.type === "BLACKOUT") {
      return (
        <button key={event.id} onClick={() => setSelectedEventId(event.id)} className="w-full rounded-lg border border-zinc-300 bg-zinc-100 p-3 text-left text-sm text-zinc-600">
          <p className="font-semibold">Unavailable</p>
          <p className="mt-1 text-xs">{eventTimeRange(event.startsAt, event.endsAt)} · {event.blackout.reason || "Blackout"}</p>
        </button>
      );
    }
    if (event.type === "REQUEST") {
      const request = event.request;
      return (
        <button key={event.id} onClick={() => setSelectedEventId(event.id)} className="w-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-left text-sm">
          <p className="font-semibold text-amber-950">Pending request</p>
          <p className="mt-1 text-xs text-amber-900">{eventTimeRange(event.startsAt, event.endsAt)} · {customerName(request.customerId)}</p>
          <p className="mt-1 truncate text-xs text-amber-900">{vehicleName(request.vehicleId)} · {serviceSummary(requestServices(request))}</p>
        </button>
      );
    }
    const appointment = event.appointment;
    const muted = appointment.status === "CANCELLED" || appointment.status === "NO_SHOW";
    return (
      <button key={event.id} onClick={() => setSelectedEventId(event.id)} className={`w-full rounded-lg border p-3 text-left text-sm ${muted ? "border-zinc-200 bg-zinc-50 text-zinc-500" : "border-violet-200 bg-violet-50 text-violet-950"}`}>
        <p className="font-semibold">{appointment.status === "IN_PROGRESS" ? "In progress" : appointment.status === "CANCELLED" ? "Cancelled" : "Confirmed"}</p>
        <p className="mt-1 text-xs">{eventTimeRange(event.startsAt, event.endsAt)} · {customerName(appointment.customerId)}</p>
        <p className="mt-1 truncate text-xs">{vehicleName(appointment.vehicleId)} · {serviceSummary(appointment.serviceNames)}</p>
      </button>
    );
  }

  function renderDetails() {
    if (!selectedEvent) {
      return <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500">Select a calendar item to review details.</p>;
    }
    if (selectedEvent.type === "REQUEST") {
      const request = selectedEvent.request;
      const block = state.smartMaintenanceBlocks.find((item) => item.id === request.smartMaintenanceBlockId);
      return (
        <div className="rounded-lg border border-zinc-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Pending request</p>
              <p className="mt-1 text-sm text-zinc-500">{customerName(request.customerId)} · {vehicleName(request.vehicleId)}</p>
            </div>
            <Badge variant="yellow">{request.status}</Badge>
          </div>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><p className="text-zinc-500">Requested</p><p className="font-semibold">{fullDayFormatter.format(new Date(selectedEvent.startsAt))}, {eventTimeRange(selectedEvent.startsAt, selectedEvent.endsAt)}</p></div>
            <div><p className="text-zinc-500">Block</p><p className="font-semibold">{block?.name ?? "Maintenance block"}</p></div>
            <div><p className="text-zinc-500">Labor</p><p className="font-semibold">{request.totalLaborMinutes} min</p></div>
            <div><p className="text-zinc-500">Estimated value</p><p className="font-semibold">{formatCurrency(request.estimatedRevenueCents)}</p></div>
            <div><p className="text-zinc-500">Source</p><p className="font-semibold">{request.source.replaceAll("_", " ")}</p></div>
            <div><p className="text-zinc-500">Submitted</p><p className="font-semibold">{timeFormatter.format(new Date(request.customerSubmittedAt))}</p></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {requestServices(request).map((service) => <Badge key={service} variant="purple">{service}</Badge>)}
          </div>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Check your primary shop calendar before confirming this request.
          </div>
          {request.status === "PENDING" && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => void acceptAppointmentRequest(request.id)} className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white"><CheckCircle2 className="h-4 w-4" />Accept</button>
              <button onClick={() => setAlternate({ requestId: request.id, startsAt: request.requestedStart, endsAt: request.requestedEnd })} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800"><Clock3 className="h-4 w-4" />Offer Another Time</button>
              <button onClick={() => void declineMaintenanceRequest(request.id, "Declined from Maintiva calendar.")} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800"><XCircle className="h-4 w-4" />Decline</button>
              <Link href={`/customers/${request.customerId}`} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800">Open Customer</Link>
            </div>
          )}
        </div>
      );
    }
    if (selectedEvent.type === "CAPACITY") {
      return (
        <div className="rounded-lg border border-zinc-200 p-4">
          <p className="font-semibold">Open maintenance capacity</p>
          <p className="mt-1 text-sm text-zinc-500">{selectedEvent.block.name} · {eventTimeRange(selectedEvent.startsAt, selectedEvent.endsAt)}</p>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><p className="text-zinc-500">Remaining vehicles</p><p className="font-semibold">{selectedEvent.remainingVehicles}</p></div>
            <div><p className="text-zinc-500">Remaining labor</p><p className="font-semibold">{selectedEvent.remainingLaborMinutes} min</p></div>
            <div><p className="text-zinc-500">Window</p><p className="font-semibold">{minutesToTime(selectedEvent.block.startMinute)}-{minutesToTime(selectedEvent.block.endMinute)}</p></div>
            <div><p className="text-zinc-500">Eligible services</p><p className="font-semibold">{selectedEvent.block.serviceDefinitionIds.length}</p></div>
          </div>
        </div>
      );
    }
    if (selectedEvent.type === "BLACKOUT") {
      return (
        <div className="rounded-lg border border-zinc-200 p-4">
          <p className="font-semibold">Unavailable</p>
          <p className="mt-1 text-sm text-zinc-500">{eventTimeRange(selectedEvent.startsAt, selectedEvent.endsAt)}</p>
          <p className="mt-4 text-sm">{selectedEvent.blackout.reason || "No reason recorded."}</p>
        </div>
      );
    }
    const appointment = selectedEvent.appointment;
    return (
      <div className="rounded-lg border border-zinc-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">Appointment details</p>
            <p className="mt-1 text-sm text-zinc-500">{customerName(appointment.customerId)} · {vehicleName(appointment.vehicleId)}</p>
          </div>
          <Badge variant={statusVariant(appointment.status)}>{appointment.status}</Badge>
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><p className="text-zinc-500">Scheduled</p><p className="font-semibold">{fullDayFormatter.format(new Date(appointment.scheduledStart))}, {eventTimeRange(appointment.scheduledStart, appointment.scheduledEnd)}</p></div>
          <div><p className="text-zinc-500">Source</p><p className="font-semibold">{sourceLabel(appointment)}</p></div>
          <div><p className="text-zinc-500">Labor</p><p className="font-semibold">{appointment.totalLaborHours} hr</p></div>
          <div><p className="text-zinc-500">Revenue</p><p className="font-semibold">{formatCurrency(appointment.totalPriceCents)}</p></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {appointment.serviceNames.map((service) => <Badge key={service} variant="purple">{service}</Badge>)}
        </div>
        {appointment.status !== "COMPLETED" && (
          <button onClick={() => setCompletion({ appointmentId: appointment.id, revenue: String((appointment.totalPriceCents / 100).toFixed(2)), laborHours: String(appointment.totalLaborHours), completedAt: new Date().toISOString().slice(0, 10), notes: appointment.notes })} className="mt-4 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800">Complete appointment</button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-violet-700">Maintiva Maintenance Calendar</p>
          <h1 className="text-3xl font-semibold tracking-tight">Appointments</h1>
          <p className="mt-2 text-sm text-zinc-600">Review controlled maintenance capacity, requests, and confirmed Maintiva appointments.</p>
        </div>
        <Link href="/automation" className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />Book from queue</Link>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{advisoryNotice}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ["CALENDAR", "Calendar"],
          ["REQUESTS", `Requests (${pendingRequests.length})`],
          ["APPOINTMENTS", "Appointments"],
        ].map(([value, label]) => (
          <button key={value} onClick={() => setTab(value as ActiveTab)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === value ? "bg-violet-950 text-white" : "border border-zinc-200 bg-white text-zinc-700"}`}>{label}</button>
        ))}
      </div>

      {tab === "CALENDAR" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Calendar</h2>
                  <p className="text-sm text-zinc-500">{view === "WEEK" ? `${dayFormatter.format(visibleDays[0])} - ${dayFormatter.format(visibleDays[visibleDays.length - 1])}` : fullDayFormatter.format(visibleDays[0])}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setCursor(addDays(cursor, view === "WEEK" ? -7 : -1))} className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-200" aria-label="Previous"><ChevronLeft className="h-4 w-4" /></button>
                  <button onClick={() => setCursor(view === "WEEK" ? startOfWeek(new Date()) : startOfDay(new Date()))} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold">Today</button>
                  <button onClick={() => setCursor(addDays(cursor, view === "WEEK" ? 7 : 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-200" aria-label="Next"><ChevronRight className="h-4 w-4" /></button>
                  {(["WEEK", "DAY", "AGENDA"] as CalendarView[]).map((value) => (
                    <button key={value} onClick={() => setView(value)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${view === value ? "bg-zinc-900 text-white" : "border border-zinc-200 text-zinc-700"}`}>{value[0] + value.slice(1).toLowerCase()}</button>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <ListFilter className="h-4 w-4 text-zinc-500" />
                {[
                  ["ALL", "All"],
                  ["REQUESTS", "Pending requests"],
                  ["CONFIRMED", "Confirmed appointments"],
                  ["CAPACITY", "Open capacity"],
                  ["BLACKOUTS", "Blackouts"],
                ].map(([value, label]) => (
                  <button key={value} onClick={() => setFilter(value as CalendarFilter)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filter === value ? "bg-violet-100 text-violet-900" : "border border-zinc-200 text-zinc-600"}`}>{label}</button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {view === "AGENDA" ? (
                <div className="space-y-3">
                  {calendarEvents.length === 0 ? <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500">No Maintiva calendar items in this window.</p> : calendarEvents.map(renderEvent)}
                </div>
              ) : (
                <div className={`grid gap-3 ${view === "WEEK" ? "lg:grid-cols-7" : "grid-cols-1"}`}>
                  {visibleDays.map((day) => {
                    const key = localDate(day);
                    const events = calendarEvents.filter((event) => eventDateKey(event.startsAt) === key);
                    return (
                      <section key={key} className="min-h-56 rounded-lg border border-zinc-200 bg-white p-3">
                        <h3 className="text-sm font-semibold">{dayFormatter.format(day)}</h3>
                        <div className="mt-3 space-y-2">
                          {events.length === 0 ? <p className="text-xs text-zinc-400">No Maintiva items</p> : events.slice(0, 5).map(renderEvent)}
                          {events.length > 5 && <p className="rounded-lg bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600">+ {events.length - 5} more in agenda</p>}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><h2 className="text-lg font-semibold">Details</h2></CardHeader>
            <CardContent>{renderDetails()}</CardContent>
          </Card>
        </div>
      )}

      {tab === "REQUESTS" && (
        <div className="grid gap-4">
          {pendingRequests.length === 0 ? <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500">No pending appointment requests.</p> : pendingRequests.map((request) => (
            <div key={request.id} className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <Badge variant="yellow">Pending</Badge>
                  <h2 className="mt-3 font-semibold">{customerName(request.customerId)} · {vehicleName(request.vehicleId)}</h2>
                  <p className="mt-1 text-sm text-zinc-500">{fullDayFormatter.format(new Date(request.requestedStart))}, {eventTimeRange(request.requestedStart, request.requestedEnd)}</p>
                  <p className="mt-1 text-sm text-zinc-500">{serviceSummary(requestServices(request))}</p>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-3 lg:w-96">
                  <div><p className="text-zinc-500">Duration</p><p className="font-semibold">{request.totalLaborMinutes} min</p></div>
                  <div><p className="text-zinc-500">Value</p><p className="font-semibold">{formatCurrency(request.estimatedRevenueCents)}</p></div>
                  <div><p className="text-zinc-500">Expires</p><p className="font-semibold">{dayFormatter.format(new Date(request.expiresAt))}</p></div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => void acceptAppointmentRequest(request.id)} className="rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white">Accept</button>
                <button onClick={() => setAlternate({ requestId: request.id, startsAt: request.requestedStart, endsAt: request.requestedEnd })} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800">Offer Another Time</button>
                <button onClick={() => void declineMaintenanceRequest(request.id, "Declined from request list.")} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800">Decline</button>
                <Link href={`/customers/${request.customerId}`} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800">Open Customer</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "APPOINTMENTS" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_0.55fr]">
          <Card>
            <CardHeader><h2 className="text-lg font-semibold">Appointments</h2></CardHeader>
            <CardContent className="space-y-4">
              {state.appointments.length === 0 && <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500">No appointments have been booked yet.</p>}
              {state.appointments.map((appointment) => (
                <div key={appointment.id} className="rounded-lg border border-zinc-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{fullDayFormatter.format(new Date(appointment.scheduledStart))}, {eventTimeRange(appointment.scheduledStart, appointment.scheduledEnd)}</p>
                      <p className="mt-1 text-sm text-zinc-500">{customerName(appointment.customerId)} · {vehicleName(appointment.vehicleId)}</p>
                    </div>
                    <Badge variant={statusVariant(appointment.status)}>{appointment.status}</Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">{appointment.serviceNames.map((service) => <Badge key={service} variant="purple">{service}</Badge>)}</div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><h2 className="text-lg font-semibold">Bay Capacity</h2></CardHeader>
            <CardContent className="space-y-4">
              {[
                ["Today committed", `${committedHours} hrs`],
                ["Today open", `${metrics.openBayCapacityHours} hrs`],
                ["Scheduled revenue", formatCurrency(metrics.scheduledRevenue)],
                ["Appointments today", String(metrics.appointmentsToday)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-lg border border-zinc-200 p-4">
                  <span className="text-sm text-zinc-500">{label}</span>
                  <span className="font-semibold">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {completion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">Complete appointment</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">Final revenue<input value={completion.revenue} onChange={(event) => setCompletion({ ...completion, revenue: event.target.value })} type="number" min="0" step="0.01" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" /></label>
              <label className="text-sm font-medium">Final labor hours<input value={completion.laborHours} onChange={(event) => setCompletion({ ...completion, laborHours: event.target.value })} type="number" min="0.1" step="0.1" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" /></label>
              <label className="text-sm font-medium">Completion date<input value={completion.completedAt} onChange={(event) => setCompletion({ ...completion, completedAt: event.target.value })} type="date" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" /></label>
              <label className="text-sm font-medium sm:col-span-2">Notes<textarea value={completion.notes} onChange={(event) => setCompletion({ ...completion, notes: event.target.value })} rows={3} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-violet-500" /></label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setCompletion(null)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-800">Cancel</button>
              <button onClick={submitCompletion} className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">Save completion</button>
            </div>
          </div>
        </div>
      )}

      {alternate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">Offer Another Time</h2>
            <p className="mt-1 text-sm text-zinc-500">Check your primary shop calendar before sending an alternate request time.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">Alternate start<input value={alternate.startsAt.slice(0, 16)} onChange={(event) => setAlternate({ ...alternate, startsAt: new Date(event.target.value).toISOString() })} type="datetime-local" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" /></label>
              <label className="text-sm font-medium">Alternate end<input value={alternate.endsAt.slice(0, 16)} onChange={(event) => setAlternate({ ...alternate, endsAt: new Date(event.target.value).toISOString() })} type="datetime-local" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" /></label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setAlternate(null)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-800">Cancel</button>
              <button onClick={() => { void proposeAppointmentRequestAlternate(alternate.requestId, alternate.startsAt, alternate.endsAt); setAlternate(null); }} className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">Save alternate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
