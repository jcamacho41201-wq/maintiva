import {
  asOfDate,
  type Appointment,
  type AppointmentStatus,
  type DemoState,
} from "@/lib/demo-data";
import {
  buildRevenueOpportunities,
  groupRevenueOpportunities,
  type RevenueQueueGroup,
} from "@/lib/revenue-recovery";

export const calendarIncrementMinutes = 30;
export const shopBusinessStartHour = 8;
export const shopBusinessEndHour = 18;

export const appointmentStatuses: AppointmentStatus[] = [
  "TENTATIVE",
  "SCHEDULED",
  "REQUESTED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

export function appointmentStatusLabel(status: string) {
  return {
    TENTATIVE: "Tentative",
    SCHEDULED: "Scheduled",
    REQUESTED: "Tentative",
    CONFIRMED: "Confirmed",
    IN_PROGRESS: "In progress",
    COMPLETED: "Completed",
    CANCELLED: "Canceled",
    NO_SHOW: "No show",
  }[status] ?? status.replaceAll("_", " ").toLowerCase();
}

export function appointmentStatusClasses(status: string) {
  if (status === "TENTATIVE" || status === "REQUESTED") return "border-dashed border-yellow-300 bg-yellow-50 text-yellow-900";
  if (status === "SCHEDULED") return "border-violet-200 bg-violet-50 text-violet-950";
  if (status === "CONFIRMED") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (status === "IN_PROGRESS") return "border-blue-200 bg-blue-50 text-blue-950";
  if (status === "COMPLETED") return "border-zinc-300 bg-zinc-100 text-zinc-700";
  if (status === "CANCELLED" || status === "NO_SHOW") return "border-red-200 bg-red-50 text-red-800 opacity-75";
  return "border-zinc-200 bg-white text-zinc-800";
}

function dateKeyToUtcNoon(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function addDays(dateKey: string, days: number) {
  const date = dateKeyToUtcNoon(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateKeyInTimeZone(date: Date | string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(date));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

export function zonedDateTimeToIso(dateKey: string, time: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = target;

  for (let index = 0; index < 3; index += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const rendered = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    utc -= rendered - target;
  }

  return new Date(utc).toISOString();
}

export function timeInZone(date: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

export function minutesInZone(date: Date | string, timeZone: string) {
  const parts = zonedParts(new Date(date), timeZone);
  return parts.hour * 60 + parts.minute;
}

export function dateHeading(dateKey: string, timeZone: string, mode: "short" | "long" = "short") {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: mode,
    month: "short",
    day: "numeric",
  }).format(dateKeyToUtcNoon(dateKey));
}

export function weekDateKeys(anchorDateKey: string) {
  const anchor = dateKeyToUtcNoon(anchorDateKey);
  const day = anchor.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addDays(anchorDateKey, mondayOffset);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function nextDateKey(dateKey: string, direction: -1 | 1, view: "day" | "week") {
  return addDays(dateKey, direction * (view === "week" ? 7 : 1));
}

export function calendarDays(anchorDateKey: string, view: "day" | "week") {
  return view === "day" ? [anchorDateKey] : weekDateKeys(anchorDateKey);
}

export function slotTimes() {
  const times: string[] = [];
  for (
    let minute = shopBusinessStartHour * 60;
    minute < shopBusinessEndHour * 60;
    minute += calendarIncrementMinutes
  ) {
    times.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  return times;
}

export function addMinutesToIso(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export function appointmentDurationMinutes(appointment: Pick<Appointment, "scheduledStart" | "scheduledEnd" | "totalLaborHours">) {
  const duration = Math.round(
    (new Date(appointment.scheduledEnd).getTime() - new Date(appointment.scheduledStart).getTime()) / 60_000,
  );
  return duration > 0 ? duration : Math.max(calendarIncrementMinutes, Math.round(appointment.totalLaborHours * 60));
}

export function isCapacityActiveAppointment(appointment: Pick<Appointment, "status" | "scheduledStart">, todayKey = dateKeyInTimeZone(asOfDate, "America/New_York")) {
  if (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") return false;
  if (appointment.status === "COMPLETED") {
    return dateKeyInTimeZone(appointment.scheduledStart, "America/New_York") < todayKey;
  }
  return true;
}

export function getDayCapacity(
  state: DemoState,
  dateKey: string,
  options: { excludeAppointmentId?: string; draftLaborHours?: number } = {},
) {
  const appointments = state.appointments.filter(
    (appointment) =>
      appointment.id !== options.excludeAppointmentId &&
      dateKeyInTimeZone(appointment.scheduledStart, state.shop.timezone) === dateKey,
  );
  const activeAppointments = appointments.filter((appointment) =>
    !["CANCELLED", "NO_SHOW"].includes(appointment.status) &&
    !(appointment.status === "COMPLETED" && dateKey >= dateKeyInTimeZone(asOfDate, state.shop.timezone)),
  );
  const scheduledLaborHours = activeAppointments.reduce(
    (sum, appointment) => sum + appointment.totalLaborHours,
    0,
  ) + (options.draftLaborHours ?? 0);
  const confirmedLaborHours = activeAppointments
    .filter((appointment) => appointment.status === "CONFIRMED" || appointment.status === "IN_PROGRESS")
    .reduce((sum, appointment) => sum + appointment.totalLaborHours, 0);
  const availableLaborHours = state.shop.dailyBayHours;
  const scheduledRevenue = activeAppointments.reduce((sum, appointment) => sum + appointment.totalPriceCents, 0);
  const bookedMaintivaRevenue = activeAppointments
    .filter((appointment) => appointment.attributionSource === "MAINTIVA_OUTREACH")
    .reduce((sum, appointment) => sum + appointment.totalPriceCents, 0);

  return {
    dateKey,
    availableLaborHours,
    scheduledLaborHours: Number(scheduledLaborHours.toFixed(2)),
    confirmedLaborHours: Number(confirmedLaborHours.toFixed(2)),
    openLaborHours: Number(Math.max(0, availableLaborHours - scheduledLaborHours).toFixed(2)),
    utilizationPct: availableLaborHours === 0 ? 0 : Math.round((scheduledLaborHours / availableLaborHours) * 100),
    scheduledRevenue,
    bookedMaintivaRevenue,
    appointments,
  };
}

export function getReadyToScheduleGroups(state: DemoState) {
  return groupRevenueOpportunities(buildRevenueOpportunities(state)).filter((group) => {
    if (group.opportunities.some((item) => ["BOOKED", "COMPLETED", "LOST"].includes(item.stage))) return false;
    return group.opportunities.some((item) =>
      item.stage === "RESPONDED" ||
      item.outreachStatus === "MANUALLY_SENT" ||
      item.outreachStatus === "RESPONDED" ||
      item.outreachStatus === "SNOOZED" ||
      item.priority === "HIGH",
    );
  });
}

export function getOpportunityRecordIds(group: RevenueQueueGroup) {
  return {
    maintenanceRecordIds: group.opportunities
      .map((opportunity) => opportunity.id.replace(/^opp-/, ""))
      .filter((id) => id.startsWith("item-")),
    declinedWorkRecordIds: group.opportunities
      .map((opportunity) => opportunity.id.replace(/^opp-/, ""))
      .filter((id) => id.startsWith("declined-")),
  };
}

export function findWorkForDay(state: DemoState, dateKey: string) {
  const capacity = getDayCapacity(state, dateKey);
  return getReadyToScheduleGroups(state)
    .filter((group) => group.estimatedLaborHours <= Math.max(capacity.openLaborHours, calendarIncrementMinutes / 60))
    .sort((a, b) => {
      const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return rank[a.priority] - rank[b.priority] ||
        b.estimatedRevenueCents - a.estimatedRevenueCents ||
        a.estimatedLaborHours - b.estimatedLaborHours;
    });
}

export type AppointmentDraft = {
  customerId: string;
  vehicleId: string;
  scheduledStart: string;
  scheduledEnd: string;
  totalLaborHours: number;
  totalPriceCents: number;
};

export function getCalendarWarnings(
  state: DemoState,
  draft: AppointmentDraft,
  options: { excludeAppointmentId?: string; allowOverCapacity?: boolean } = {},
) {
  const warnings: string[] = [];
  const dateKey = dateKeyInTimeZone(draft.scheduledStart, state.shop.timezone);
  const startMinutes = minutesInZone(draft.scheduledStart, state.shop.timezone);
  const endMinutes = minutesInZone(draft.scheduledEnd, state.shop.timezone);
  const capacity = getDayCapacity(state, dateKey, {
    excludeAppointmentId: options.excludeAppointmentId,
    draftLaborHours: draft.totalLaborHours,
  });

  if (capacity.scheduledLaborHours > capacity.availableLaborHours) {
    warnings.push(
      `This appointment exceeds ${dateHeading(dateKey, state.shop.timezone)}'s available labor capacity by ${(capacity.scheduledLaborHours - capacity.availableLaborHours).toFixed(1)} hours.`,
    );
  }
  if (startMinutes < shopBusinessStartHour * 60) warnings.push("Appointment starts before shop business hours.");
  if (endMinutes > shopBusinessEndHour * 60 || endMinutes <= startMinutes) warnings.push("Appointment ends after closing or has an invalid duration.");

  const duplicate = state.appointments.find((appointment) =>
    appointment.id !== options.excludeAppointmentId &&
    appointment.vehicleId === draft.vehicleId &&
    new Date(appointment.scheduledStart).getTime() === new Date(draft.scheduledStart).getTime() &&
    !["CANCELLED", "NO_SHOW"].includes(appointment.status),
  );
  if (duplicate) warnings.push("Same vehicle already has an active appointment at this time.");

  const customerOverlap = state.appointments.find((appointment) =>
    appointment.id !== options.excludeAppointmentId &&
    appointment.customerId === draft.customerId &&
    !["CANCELLED", "NO_SHOW"].includes(appointment.status) &&
    new Date(appointment.scheduledStart) < new Date(draft.scheduledEnd) &&
    new Date(appointment.scheduledEnd) > new Date(draft.scheduledStart),
  );
  if (customerOverlap) warnings.push("Customer already has another appointment overlapping this time.");

  return warnings;
}
