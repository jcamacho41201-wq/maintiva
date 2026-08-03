import type {
  Appointment,
  MaintenanceService,
  SmartMaintenanceBlock,
  SmartMaintenanceBlockBlackout,
} from "@/lib/demo-data";

const minutesPerDay = 1440;
const countableAppointmentStatuses = new Set<Appointment["status"]>([
  "REQUESTED",
  "CONFIRMED",
  "IN_PROGRESS",
]);
const countableCommitmentStatuses = new Set<SmartBlockCapacityCommitment["status"]>([
  "PENDING",
  "APPROVED",
]);

export type SmartBlockCapacityCommitment = {
  id: string;
  shopId: string;
  blockId?: string | null;
  startsAt: string;
  endsAt: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "EXPIRED" | "CANCELLED" | "REJECTED";
  vehicleCount: number;
  laborMinutes: number;
};

export type SmartBlockAvailabilitySlot = {
  blockId: string;
  blockName: string;
  startsAt: string;
  endsAt: string;
  label: string;
  dateLabel: string;
  remainingVehicles: number;
  remainingLaborMinutes: number;
};

export type SmartBlockAvailabilityInput = {
  shop: { id: string; timezone: string };
  blocks: SmartMaintenanceBlock[];
  services: Pick<MaintenanceService, "id" | "shopId" | "isActive" | "estimatedLaborMinutes">[];
  selectedServiceIds: string[];
  appointments: Pick<Appointment, "shopId" | "scheduledStart" | "scheduledEnd" | "status" | "totalLaborHours">[];
  blackouts: SmartMaintenanceBlockBlackout[];
  commitments?: SmartBlockCapacityCommitment[];
  dateFrom: string;
  dateTo: string;
  now?: Date;
};

export function timeToMinutes(value: string) {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return Math.min(minutesPerDay, Math.max(0, hours * 60 + minutes));
}

export function minutesToTime(value: number) {
  const minutes = Math.min(minutesPerDay, Math.max(0, value));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return utc - date.getTime();
}

export function zonedTimeToUtc(date: string, minuteOfDay: number, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const guessed = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  return new Date(guessed.getTime() - timeZoneOffsetMs(guessed, timeZone));
}

export function zonedTimeToUtcIso(date: string, minuteOfDay: number, timeZone: string) {
  return zonedTimeToUtc(date, minuteOfDay, timeZone).toISOString();
}

function dayOfWeek(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function dateRange(from: string, to: string) {
  const dates: string[] = [];
  for (let current = from; current <= to && dates.length < 370; current = addDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

function slotLabel(date: Date, timeZone: string) {
  return {
    label: new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(date),
    dateLabel: new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date),
  };
}

function selectedServiceLaborMinutes(
  services: Pick<MaintenanceService, "id" | "shopId" | "isActive" | "estimatedLaborMinutes">[],
  shopId: string,
  selectedServiceIds: string[],
) {
  return services
    .filter((service) => service.shopId === shopId && selectedServiceIds.includes(service.id) && service.isActive)
    .reduce((sum, service) => sum + service.estimatedLaborMinutes, 0);
}

export function blockEligibleServices(
  block: SmartMaintenanceBlock,
  services: Pick<MaintenanceService, "id" | "shopId" | "isActive">[],
) {
  const activeIds = new Set(
    services
      .filter((service) => service.shopId === block.shopId && service.isActive)
      .map((service) => service.id),
  );
  return block.serviceDefinitionIds.filter((id) => activeIds.has(id));
}

function blockSupportsSelection(
  block: SmartMaintenanceBlock,
  services: Pick<MaintenanceService, "id" | "shopId" | "isActive">[],
  selectedServiceIds: string[],
) {
  if (!block.isActive || block.archivedAt) return false;
  if (selectedServiceIds.length === 0) return false;
  const eligible = new Set(blockEligibleServices(block, services));
  return selectedServiceIds.every((serviceId) => eligible.has(serviceId));
}

function matchingBlackouts(
  block: SmartMaintenanceBlock,
  blackouts: SmartMaintenanceBlockBlackout[],
) {
  return blackouts.filter((blackout) =>
    blackout.shopId === block.shopId && (!blackout.blockId || blackout.blockId === block.id),
  );
}

function slotIsBlackedOut(
  slotStart: Date,
  slotEnd: Date,
  block: SmartMaintenanceBlock,
  blackouts: SmartMaintenanceBlockBlackout[],
) {
  return matchingBlackouts(block, blackouts).some((blackout) =>
    overlaps(slotStart, slotEnd, new Date(blackout.startsAt), new Date(blackout.endsAt)),
  );
}

function countAppointmentLaborMinutes(appointment: Pick<Appointment, "totalLaborHours">) {
  return Math.round(Math.max(0, appointment.totalLaborHours) * 60);
}

function capacityUsedBySlot(input: {
  shopId: string;
  blockId: string;
  slotStart: Date;
  slotEnd: Date;
  appointments: SmartBlockAvailabilityInput["appointments"];
  commitments: SmartBlockCapacityCommitment[];
}) {
  const appointmentUsage = input.appointments
    .filter((appointment) =>
      appointment.shopId === input.shopId &&
      countableAppointmentStatuses.has(appointment.status) &&
      overlaps(input.slotStart, input.slotEnd, new Date(appointment.scheduledStart), new Date(appointment.scheduledEnd)),
    )
    .reduce((usage, appointment) => ({
      vehicleCount: usage.vehicleCount + 1,
      laborMinutes: usage.laborMinutes + countAppointmentLaborMinutes(appointment),
    }), { vehicleCount: 0, laborMinutes: 0 });

  return input.commitments
    .filter((commitment) =>
      commitment.shopId === input.shopId &&
      (!commitment.blockId || commitment.blockId === input.blockId) &&
      countableCommitmentStatuses.has(commitment.status) &&
      overlaps(input.slotStart, input.slotEnd, new Date(commitment.startsAt), new Date(commitment.endsAt)),
    )
    .reduce((usage, commitment) => ({
      vehicleCount: usage.vehicleCount + Math.max(0, commitment.vehicleCount),
      laborMinutes: usage.laborMinutes + Math.max(0, commitment.laborMinutes),
    }), appointmentUsage);
}

export function calculateSmartMaintenanceBlockAvailability(input: SmartBlockAvailabilityInput) {
  const serviceLaborMinutes = selectedServiceLaborMinutes(input.services, input.shop.id, input.selectedServiceIds);
  if (serviceLaborMinutes <= 0) return [];

  const now = input.now ?? new Date();
  const slots: SmartBlockAvailabilitySlot[] = [];

  for (const block of input.blocks) {
    if (block.shopId !== input.shop.id) continue;
    if (!blockSupportsSelection(block, input.services, input.selectedServiceIds)) continue;

    const minimumStart = new Date(now.getTime() + block.minimumNoticeMinutes * 60_000);
    const maximumEnd = new Date(now.getTime() + block.maximumHorizonDays * 86_400_000);
    const duration = Math.max(15, serviceLaborMinutes);

    for (const date of dateRange(input.dateFrom, input.dateTo)) {
      if (!block.daysOfWeek.includes(dayOfWeek(date))) continue;

      for (let minute = block.startMinute; minute + duration <= block.endMinute; minute += block.slotIntervalMinutes) {
        const startsAt = zonedTimeToUtc(date, minute, block.timezone || input.shop.timezone);
        const endsAt = new Date(startsAt.getTime() + duration * 60_000);
        if (startsAt < minimumStart || startsAt > maximumEnd) continue;
        if (slotIsBlackedOut(startsAt, endsAt, block, input.blackouts)) continue;

        const used = capacityUsedBySlot({
          shopId: input.shop.id,
          blockId: block.id,
          slotStart: startsAt,
          slotEnd: endsAt,
          appointments: input.appointments,
          commitments: input.commitments ?? [],
        });
        const remainingVehicles = block.maxVehicles - used.vehicleCount;
        const remainingLaborMinutes = block.maxLaborMinutes - used.laborMinutes;
        if (remainingVehicles < 1 || remainingLaborMinutes < duration) continue;

        const label = slotLabel(startsAt, block.timezone || input.shop.timezone);
        slots.push({
          blockId: block.id,
          blockName: block.name,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          label: label.label,
          dateLabel: label.dateLabel,
          remainingVehicles,
          remainingLaborMinutes,
        });
      }
    }
  }

  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
