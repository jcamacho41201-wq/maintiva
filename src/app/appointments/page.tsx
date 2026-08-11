"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
import { cn, currentDateInTimeZone, formatCurrency, formatLaborMinutes } from "@/lib/utils";

type ActiveTab = "CALENDAR" | "REQUESTS" | "APPOINTMENTS";
type CalendarView = "WEEK" | "DAY" | "AGENDA";
type CalendarFilter = "ALL" | "REQUESTS" | "CONFIRMED" | "CAPACITY" | "BLACKOUTS";
type CalendarEvent =
  | { id: string; type: "REQUEST"; startsAt: string; endsAt: string; request: AppointmentRequestRecord }
  | { id: string; type: "APPOINTMENT"; startsAt: string; endsAt: string; appointment: Appointment }
  | { id: string; type: "CAPACITY"; startsAt: string; endsAt: string; block: SmartMaintenanceBlock; remainingVehicles: number; remainingLaborMinutes: number }
  | { id: string; type: "BLACKOUT"; startsAt: string; endsAt: string; blackout: SmartMaintenanceBlockBlackout };
type TimedCalendarEvent = Extract<CalendarEvent, { type: "REQUEST" | "APPOINTMENT" }>;
type CalendarRegion = Extract<CalendarEvent, { type: "CAPACITY" | "BLACKOUT" }>;
type LaidOutEvent = {
  event: TimedCalendarEvent;
  startMinute: number;
  endMinute: number;
  column: number;
  overlapCount: number;
};

const advisoryNotice =
  "Shows Maintiva appointment requests, confirmed Maintiva appointments, and Smart Maintenance Block capacity. Check your primary shop calendar before confirming this request.";
const pixelsPerMinute = 2;

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

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone });
}

function zonedParts(value: string | Date, timeZone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = formatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "0";
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: Number(part("hour") === "24" ? "0" : part("hour")),
    minute: Number(part("minute")),
  };
}

function eventDateKey(value: string, timeZone: string) {
  const parts = zonedParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minuteOfDay(value: string, timeZone: string) {
  const parts = zonedParts(value, timeZone);
  return parts.hour * 60 + parts.minute;
}

function displayDay(date: Date | string, timeZone: string, format: "short" | "full" = "short") {
  return formatter(timeZone, {
    weekday: format === "full" ? "long" : "short",
    month: "short",
    day: "numeric",
  }).format(typeof date === "string" ? new Date(date) : date);
}

function displayTime(value: string, timeZone: string) {
  return formatter(timeZone, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function eventTimeRange(startsAt: string, endsAt: string, timeZone: string) {
  return `${displayTime(startsAt, timeZone)}-${displayTime(endsAt, timeZone)}`;
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

function timedEventBounds(event: TimedCalendarEvent, timeZone: string) {
  const startMinute = minuteOfDay(event.startsAt, timeZone);
  const rawEndMinute = minuteOfDay(event.endsAt, timeZone);
  const endMinute = rawEndMinute <= startMinute ? startMinute + 30 : rawEndMinute;
  return { startMinute, endMinute };
}

function layoutTimedEvents(events: TimedCalendarEvent[], timeZone: string) {
  const ordered = events
    .map((event) => ({ event, ...timedEventBounds(event, timeZone) }))
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.event.id.localeCompare(b.event.id));
  const laidOut = new Map<string, LaidOutEvent>();

  for (let index = 0; index < ordered.length;) {
    const cluster = [ordered[index]];
    let clusterEnd = ordered[index].endMinute;
    index += 1;

    while (index < ordered.length && ordered[index].startMinute < clusterEnd) {
      cluster.push(ordered[index]);
      clusterEnd = Math.max(clusterEnd, ordered[index].endMinute);
      index += 1;
    }

    const columnEnds: number[] = [];
    const assigned = cluster.map((item) => {
      let column = columnEnds.findIndex((endMinute) => endMinute <= item.startMinute);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(item.endMinute);
      } else {
        columnEnds[column] = item.endMinute;
      }
      return { ...item, column };
    });
    const overlapCount = Math.max(1, columnEnds.length);
    assigned.forEach((item) => laidOut.set(item.event.id, { ...item, overlapCount }));
  }

  return laidOut;
}

export default function AppointmentsPage() {
  const {
    state,
    completeAppointment,
    acceptAppointmentRequest,
    declineMaintenanceRequest,
  } = useDemoStore();
  const [tab, setTab] = useState<ActiveTab>("CALENDAR");
  const [view, setView] = useState<CalendarView>("WEEK");
  const [filter, setFilter] = useState<CalendarFilter>("ALL");
  const [cursor, setCursor] = useState(() => startOfWeek(new Date()));
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [requestActionError, setRequestActionError] = useState<{ requestId: string; message: string } | null>(null);
  const [completion, setCompletion] = useState<{
    appointmentId: string;
    revenue: string;
    laborHours: string;
    completedAt: string;
    notes: string;
  } | null>(null);

  useEffect(() => {
    if (window.innerWidth >= 768) return undefined;
    const frame = window.requestAnimationFrame(() => setView("AGENDA"));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const metrics = getDashboardMetrics(state);
  const committedHours = state.shop.dailyBayHours - metrics.openBayCapacityHours;
  const shopTimeZone = state.shop.timezone || "America/New_York";
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

  const allCalendarEvents = useMemo(() => {
    const capacityRegions = state.smartMaintenanceBlocks.flatMap((block) => {
      const slots = calculateSmartMaintenanceBlockAvailability({
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
      });
      const byDay = new Map<string, {
        startsAt: string;
        endsAt: string;
        remainingVehicles: number;
        remainingLaborMinutes: number;
      }>();

      slots.forEach((slot) => {
        const key = eventDateKey(slot.startsAt, block.timezone || shopTimeZone);
        const existing = byDay.get(key);
        if (!existing) {
          byDay.set(key, {
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            remainingVehicles: slot.remainingVehicles,
            remainingLaborMinutes: slot.remainingLaborMinutes,
          });
          return;
        }
        existing.startsAt = existing.startsAt < slot.startsAt ? existing.startsAt : slot.startsAt;
        existing.endsAt = existing.endsAt > slot.endsAt ? existing.endsAt : slot.endsAt;
        existing.remainingVehicles = Math.min(existing.remainingVehicles, slot.remainingVehicles);
        existing.remainingLaborMinutes = Math.min(existing.remainingLaborMinutes, slot.remainingLaborMinutes);
      });

      return Array.from(byDay.entries()).map(([day, region]): CalendarEvent => ({
        id: `capacity-${block.id}-${day}`,
        type: "CAPACITY",
        startsAt: region.startsAt,
        endsAt: region.endsAt,
        remainingVehicles: region.remainingVehicles,
        remainingLaborMinutes: region.remainingLaborMinutes,
        block,
      }));
    });

    const events: CalendarEvent[] = [
      ...capacityRegions,
      ...state.appointmentRequests
        .filter((request) => request.status === "PENDING")
        .map((request): CalendarEvent => ({
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
      .filter((event) => eventDateKey(event.startsAt, shopTimeZone) >= dateFrom && eventDateKey(event.startsAt, shopTimeZone) <= dateTo)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [dateFrom, dateTo, shopTimeZone, state.appointmentRequests, state.appointments, state.services, state.shop.id, state.shop.timezone, state.smartMaintenanceBlockBlackouts, state.smartMaintenanceBlocks]);

  const calendarEvents = useMemo(
    () => allCalendarEvents.filter((event) => calendarEventMatches(event, filter)),
    [allCalendarEvents, filter],
  );
  const selectedEvent = allCalendarEvents.find((event) => event.id === selectedEventId) ?? null;
  const timedEvents = calendarEvents.filter((event): event is TimedCalendarEvent =>
    event.type === "REQUEST" || event.type === "APPOINTMENT",
  );
  const calendarRegions = calendarEvents.filter((event): event is CalendarRegion =>
    event.type === "CAPACITY" || event.type === "BLACKOUT",
  );
  const displayedMinutes = useMemo(() => {
    const candidates = [7 * 60, 19 * 60];
    state.smartMaintenanceBlocks
      .filter((block) => block.isActive && !block.archivedAt)
      .forEach((block) => candidates.push(block.startMinute, block.endMinute));
    allCalendarEvents.forEach((event) => {
      candidates.push(minuteOfDay(event.startsAt, shopTimeZone), minuteOfDay(event.endsAt, shopTimeZone));
    });
    const start = Math.max(0, Math.floor(Math.min(...candidates) / 60) * 60);
    const end = Math.min(24 * 60, Math.ceil(Math.max(...candidates) / 60) * 60);
    return { start, end: Math.max(end, start + 60) };
  }, [allCalendarEvents, shopTimeZone, state.smartMaintenanceBlocks]);
  const hourMarks = useMemo(() => {
    const hours: number[] = [];
    for (let minute = displayedMinutes.start; minute <= displayedMinutes.end; minute += 60) hours.push(minute);
    return hours;
  }, [displayedMinutes]);
  const agendaGroups = useMemo(() => {
    const groups = new Map<string, CalendarEvent[]>();
    calendarEvents.forEach((event) => {
      const key = eventDateKey(event.startsAt, shopTimeZone);
      groups.set(key, [...(groups.get(key) ?? []), event]);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [calendarEvents, shopTimeZone]);

  async function acceptRequest(requestId: string) {
    setProcessingRequestId(requestId);
    setRequestActionError(null);
    const result = await acceptAppointmentRequest(requestId);
    setProcessingRequestId(null);
    if (!result.ok) {
      setRequestActionError({
        requestId,
        message: result.message ?? "Unable to confirm this appointment.",
      });
    }
  }

  async function declineRequest(requestId: string, reason: string) {
    setProcessingRequestId(requestId);
    setRequestActionError(null);
    const result = await declineMaintenanceRequest(requestId, reason);
    setProcessingRequestId(null);
    if (!result.ok) {
      setRequestActionError({
        requestId,
        message: result.message ?? "Unable to update this appointment request.",
      });
    }
  }

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
          <p className="font-semibold text-emerald-900">Maintenance capacity</p>
          <p className="mt-1 text-xs text-emerald-800">{eventTimeRange(event.startsAt, event.endsAt, shopTimeZone)} · {event.block.name}</p>
        </button>
      );
    }
    if (event.type === "BLACKOUT") {
      return (
        <button key={event.id} onClick={() => setSelectedEventId(event.id)} className="w-full rounded-lg border border-zinc-300 bg-zinc-100 p-3 text-left text-sm text-zinc-600">
          <p className="font-semibold">UNAVAILABLE</p>
          <p className="mt-1 text-xs">{eventTimeRange(event.startsAt, event.endsAt, shopTimeZone)} · {event.blackout.reason || "Blackout"}</p>
        </button>
      );
    }
    if (event.type === "REQUEST") {
      const request = event.request;
      return (
        <button key={event.id} onClick={() => setSelectedEventId(event.id)} className="w-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-left text-sm">
          <p className="font-semibold text-amber-950">PENDING REQUEST</p>
          <p className="mt-1 text-xs text-amber-900">{eventTimeRange(event.startsAt, event.endsAt, shopTimeZone)} · {customerName(request.customerId)}</p>
          <p className="mt-1 truncate text-xs text-amber-900">{vehicleName(request.vehicleId)} · {serviceSummary(requestServices(request))}</p>
        </button>
      );
    }
    const appointment = event.appointment;
    const muted = appointment.status === "CANCELLED" || appointment.status === "NO_SHOW";
    return (
      <button key={event.id} onClick={() => setSelectedEventId(event.id)} className={`w-full rounded-lg border p-3 text-left text-sm ${muted ? "border-zinc-200 bg-zinc-50 text-zinc-500" : "border-violet-200 bg-violet-50 text-violet-950"}`}>
        <p className="font-semibold">{appointment.status === "IN_PROGRESS" ? "IN PROGRESS" : appointment.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED"}</p>
        <p className="mt-1 text-xs">{eventTimeRange(event.startsAt, event.endsAt, shopTimeZone)} · {customerName(appointment.customerId)}</p>
        <p className="mt-1 truncate text-xs">{vehicleName(appointment.vehicleId)} · {serviceSummary(appointment.serviceNames)}</p>
      </button>
    );
  }

  function renderTimedCard(layout: LaidOutEvent) {
    const { event, startMinute, endMinute, column, overlapCount } = layout;
    const top = (startMinute - displayedMinutes.start) * pixelsPerMinute;
    const height = Math.max(44, (endMinute - startMinute) * pixelsPerMinute - 4);
    const width = 100 / overlapCount;
    const left = `calc(${column * width}% + 3px)`;
    const cardWidth = `calc(${width}% - 6px)`;

    if (event.type === "REQUEST") {
      const request = event.request;
      return (
        <button
          key={event.id}
          onClick={() => setSelectedEventId(event.id)}
          style={{ top, height, left, width: cardWidth }}
          className="absolute z-20 overflow-hidden rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-left text-[11px] leading-tight text-amber-950 shadow-sm transition hover:border-amber-500"
        >
          <p className="font-bold">PENDING REQUEST</p>
          <p className="mt-0.5">{eventTimeRange(event.startsAt, event.endsAt, shopTimeZone)}</p>
          <p className="mt-1 truncate font-semibold">{customerName(request.customerId)}</p>
          <p className="truncate">{vehicleName(request.vehicleId)}</p>
          <p className="truncate">{serviceSummary(requestServices(request))}</p>
        </button>
      );
    }

    const appointment = event.appointment;
    const muted = appointment.status === "CANCELLED" || appointment.status === "NO_SHOW";
    return (
      <button
        key={event.id}
        onClick={() => setSelectedEventId(event.id)}
        style={{ top, height, left, width: cardWidth }}
        className={cn(
          "absolute z-20 overflow-hidden rounded-md border px-2 py-1.5 text-left text-[11px] leading-tight shadow-sm transition",
          muted
            ? "border-zinc-200 bg-zinc-50 text-zinc-500 hover:border-zinc-300"
            : "border-violet-200 bg-violet-50 text-violet-950 hover:border-violet-400",
        )}
      >
        <p className="font-bold">{appointment.status === "IN_PROGRESS" ? "IN PROGRESS" : appointment.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED"}</p>
        <p className="mt-0.5">{eventTimeRange(event.startsAt, event.endsAt, shopTimeZone)}</p>
        <p className="mt-1 truncate font-semibold">{customerName(appointment.customerId)}</p>
        <p className="truncate">{vehicleName(appointment.vehicleId)}</p>
        <p className="truncate">{serviceSummary(appointment.serviceNames)}</p>
      </button>
    );
  }

  function renderRegion(region: CalendarRegion) {
    const startMinute = minuteOfDay(region.startsAt, shopTimeZone);
    const rawEndMinute = minuteOfDay(region.endsAt, shopTimeZone);
    const endMinute = rawEndMinute <= startMinute ? startMinute + 30 : rawEndMinute;
    const top = (startMinute - displayedMinutes.start) * pixelsPerMinute;
    const height = Math.max(36, (endMinute - startMinute) * pixelsPerMinute - 2);

    if (region.type === "BLACKOUT") {
      return (
        <button
          key={region.id}
          onClick={() => setSelectedEventId(region.id)}
          style={{ top, height, left: 6, right: 6 }}
          className="absolute z-10 overflow-hidden rounded-md border border-zinc-300 bg-zinc-200/80 px-2 py-1.5 text-left text-[11px] leading-tight text-zinc-700"
        >
          <p className="font-bold">UNAVAILABLE</p>
          <p className="truncate">{region.blackout.reason || "Blackout"}</p>
        </button>
      );
    }

    const serviceNames = region.block.serviceDefinitionIds
      .map((serviceId) => state.services.find((service) => service.id === serviceId)?.name)
      .filter((name): name is string => Boolean(name));
    return (
      <button
        key={region.id}
        onClick={() => setSelectedEventId(region.id)}
        style={{ top, height, left: 6, right: 6 }}
        className="absolute z-0 overflow-hidden rounded-md border border-dashed border-emerald-300 bg-emerald-50/70 px-2 py-1.5 text-left text-[11px] leading-tight text-emerald-900"
      >
        <p className="font-bold">Maintenance capacity</p>
        <p>{eventTimeRange(region.startsAt, region.endsAt, shopTimeZone)}</p>
        <p className="truncate">Eligible: {serviceSummary(serviceNames)}</p>
        <p>{region.remainingVehicles} vehicles · {formatLaborMinutes(region.remainingLaborMinutes)}</p>
      </button>
    );
  }

  function renderTimeGrid() {
    const dayKeys = visibleDays.map(localDate);
    const totalMinutes = displayedMinutes.end - displayedMinutes.start;
    const gridHeight = totalMinutes * pixelsPerMinute;
    const gridTemplateColumns = `72px repeat(${visibleDays.length}, minmax(${view === "DAY" ? "220px" : "160px"}, 1fr))`;
    const minWidth = view === "DAY" ? 360 : Math.max(820, visibleDays.length * 170 + 72);
    const currentDayKey = currentDateInTimeZone(shopTimeZone);
    const currentMinute = minuteOfDay(new Date().toISOString(), shopTimeZone);
    const showCurrentTime = currentMinute >= displayedMinutes.start && currentMinute <= displayedMinutes.end;

    return (
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="overflow-x-auto">
          <div style={{ minWidth }}>
            <div
              className="sticky top-0 z-30 grid border-b border-zinc-200 bg-white"
              style={{ gridTemplateColumns }}
            >
              <div className="border-r border-zinc-200 px-2 py-3 text-xs font-medium text-zinc-500">
                Time
              </div>
              {visibleDays.map((day, index) => {
                const key = dayKeys[index];
                const isToday = key === currentDayKey;
                return (
                  <div
                    key={key}
                    className={cn(
                      "px-3 py-3 text-sm font-semibold",
                      isToday ? "bg-violet-50 text-violet-950" : "text-zinc-800",
                    )}
                  >
                    {displayDay(day, shopTimeZone)}
                  </div>
                );
              })}
            </div>
            <div className="max-h-[680px] overflow-y-auto">
              <div className="grid" style={{ gridTemplateColumns, height: gridHeight }}>
                <div className="relative border-r border-zinc-200 bg-zinc-50">
                  {hourMarks.map((minute) => (
                    <div
                      key={minute}
                      className="absolute right-2 -translate-y-2 text-xs text-zinc-500"
                      style={{ top: (minute - displayedMinutes.start) * pixelsPerMinute }}
                    >
                      {minutesToTime(minute)}
                    </div>
                  ))}
                </div>
                {visibleDays.map((_, dayIndex) => {
                  const key = dayKeys[dayIndex];
                  const dayEvents = timedEvents.filter((event) => eventDateKey(event.startsAt, shopTimeZone) === key);
                  const dayRegions = calendarRegions.filter((event) => eventDateKey(event.startsAt, shopTimeZone) === key);
                  const layouts = layoutTimedEvents(dayEvents, shopTimeZone);
                  const isToday = key === currentDayKey;
                  return (
                    <div key={key} className={cn("relative border-l border-zinc-200", isToday && "bg-violet-50/30")}>
                      {hourMarks.map((minute) => (
                        <div
                          key={minute}
                          className="absolute left-0 right-0 border-t border-zinc-100"
                          style={{ top: (minute - displayedMinutes.start) * pixelsPerMinute }}
                        />
                      ))}
                      {dayRegions.map(renderRegion)}
                      {showCurrentTime && isToday && (
                        <div
                          className="absolute left-0 right-0 z-30 border-t-2 border-red-500"
                          style={{ top: (currentMinute - displayedMinutes.start) * pixelsPerMinute }}
                        >
                          <span className="absolute -top-2 left-1 h-3 w-3 rounded-full bg-red-500" />
                        </div>
                      )}
                      {dayEvents
                        .map((event) => layouts.get(event.id))
                        .filter((event): event is LaidOutEvent => Boolean(event))
                        .map(renderTimedCard)}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
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
            <div><p className="text-zinc-500">Requested</p><p className="font-semibold">{displayDay(selectedEvent.startsAt, shopTimeZone, "full")}, {eventTimeRange(selectedEvent.startsAt, selectedEvent.endsAt, shopTimeZone)}</p></div>
            <div><p className="text-zinc-500">Block</p><p className="font-semibold">{block?.name ?? "Maintenance block"}</p></div>
            <div><p className="text-zinc-500">Duration</p><p className="font-semibold">{formatLaborMinutes(request.totalLaborMinutes)}</p></div>
            <div><p className="text-zinc-500">Estimated value</p><p className="font-semibold">{formatCurrency(request.estimatedRevenueCents)}</p></div>
            <div><p className="text-zinc-500">Source</p><p className="font-semibold">{request.source.replaceAll("_", " ")}</p></div>
            <div><p className="text-zinc-500">Submitted</p><p className="font-semibold">{displayTime(request.customerSubmittedAt, shopTimeZone)}</p></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {requestServices(request).map((service) => <Badge key={service} variant="purple">{service}</Badge>)}
          </div>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Check your primary shop calendar before confirming this request.
          </div>
          {request.status === "PENDING" && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => void acceptRequest(request.id)}
                disabled={processingRequestId === request.id}
                className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {processingRequestId === request.id ? "Accepting..." : "Accept"}
              </button>
              <button
                onClick={() => void declineRequest(request.id, "Declined from Maintiva calendar.")}
                disabled={processingRequestId === request.id}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800 disabled:opacity-60"
              >
                <XCircle className="h-4 w-4" />
                Decline
              </button>
              <Link href={`/customers/${request.customerId}`} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800">Open Customer</Link>
              {requestActionError?.requestId === request.id && (
                <p className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{requestActionError.message}</p>
              )}
            </div>
          )}
        </div>
      );
    }
    if (selectedEvent.type === "CAPACITY") {
      return (
        <div className="rounded-lg border border-zinc-200 p-4">
          <p className="font-semibold">Open maintenance capacity</p>
          <p className="mt-1 text-sm text-zinc-500">{selectedEvent.block.name} · {eventTimeRange(selectedEvent.startsAt, selectedEvent.endsAt, shopTimeZone)}</p>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><p className="text-zinc-500">Remaining vehicles</p><p className="font-semibold">{selectedEvent.remainingVehicles}</p></div>
            <div><p className="text-zinc-500">Remaining labor</p><p className="font-semibold">{formatLaborMinutes(selectedEvent.remainingLaborMinutes)}</p></div>
            <div><p className="text-zinc-500">Window</p><p className="font-semibold">{minutesToTime(selectedEvent.block.startMinute)}-{minutesToTime(selectedEvent.block.endMinute)}</p></div>
            <div><p className="text-zinc-500">Eligible services</p><p className="font-semibold">{selectedEvent.block.serviceDefinitionIds.length}</p></div>
          </div>
        </div>
      );
    }
    if (selectedEvent.type === "BLACKOUT") {
      return (
        <div className="rounded-lg border border-zinc-200 p-4">
          <p className="font-semibold">UNAVAILABLE</p>
          <p className="mt-1 text-sm text-zinc-500">{eventTimeRange(selectedEvent.startsAt, selectedEvent.endsAt, shopTimeZone)}</p>
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
          <div><p className="text-zinc-500">Scheduled</p><p className="font-semibold">{displayDay(appointment.scheduledStart, shopTimeZone, "full")}, {eventTimeRange(appointment.scheduledStart, appointment.scheduledEnd, shopTimeZone)}</p></div>
          <div><p className="text-zinc-500">Source</p><p className="font-semibold">{sourceLabel(appointment)}</p></div>
          <div><p className="text-zinc-500">Labor</p><p className="font-semibold">{appointment.totalLaborHours} hr</p></div>
          <div><p className="text-zinc-500">Revenue</p><p className="font-semibold">{formatCurrency(appointment.totalPriceCents)}</p></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {appointment.serviceNames.map((service) => <Badge key={service} variant="purple">{service}</Badge>)}
        </div>
        <Link href={`/customers/${appointment.customerId}`} className="mt-4 inline-flex rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800">Open Customer</Link>
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
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="min-w-0">
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Calendar</h2>
                  <p className="text-sm text-zinc-500">
                    {view === "WEEK"
                      ? `${displayDay(visibleDays[0], shopTimeZone)} - ${displayDay(visibleDays[visibleDays.length - 1], shopTimeZone)}`
                      : displayDay(visibleDays[0], shopTimeZone, "full")}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">Times shown in shop local time: {shopTimeZone}</p>
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
                <div className="space-y-5">
                  {agendaGroups.length === 0 ? (
                    <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500">No Maintiva calendar items in this window.</p>
                  ) : agendaGroups.map(([day, events]) => (
                    <section key={day}>
                      <h3 className="mb-2 text-sm font-semibold text-zinc-800">{displayDay(`${day}T12:00:00`, shopTimeZone, "full")}</h3>
                      <div className="space-y-2">{events.map(renderEvent)}</div>
                    </section>
                  ))}
                </div>
              ) : (
                renderTimeGrid()
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
                  <p className="mt-1 text-sm text-zinc-500">{displayDay(request.requestedStart, shopTimeZone, "full")}, {eventTimeRange(request.requestedStart, request.requestedEnd, shopTimeZone)}</p>
                  <p className="mt-1 text-sm text-zinc-500">{serviceSummary(requestServices(request))}</p>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-3 lg:w-96">
                  <div><p className="text-zinc-500">Duration</p><p className="font-semibold">{formatLaborMinutes(request.totalLaborMinutes)}</p></div>
                  <div><p className="text-zinc-500">Value</p><p className="font-semibold">{formatCurrency(request.estimatedRevenueCents)}</p></div>
                  <div><p className="text-zinc-500">Expires</p><p className="font-semibold">{displayDay(request.expiresAt, shopTimeZone)}</p></div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => void acceptRequest(request.id)}
                  disabled={processingRequestId === request.id}
                  className="rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {processingRequestId === request.id ? "Accepting..." : "Accept"}
                </button>
                <button
                  onClick={() => void declineRequest(request.id, "Declined from request list.")}
                  disabled={processingRequestId === request.id}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800 disabled:opacity-60"
                >
                  Decline
                </button>
                <Link href={`/customers/${request.customerId}`} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800">Open Customer</Link>
                {requestActionError?.requestId === request.id && (
                  <p className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{requestActionError.message}</p>
                )}
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
                      <p className="font-semibold">{displayDay(appointment.scheduledStart, shopTimeZone, "full")}, {eventTimeRange(appointment.scheduledStart, appointment.scheduledEnd, shopTimeZone)}</p>
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
    </div>
  );
}
