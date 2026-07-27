import { calculateAppointmentDuration } from "@/lib/appointment";

export type AutomationService = {
  id: string;
  name: string;
  customerId: string;
  vehicleId: string;
  remainingLife: number;
  threshold: number;
  estimatedRevenueCents: number;
  estimatedLaborMinutes: number;
  status: "HEALTHY" | "DUE_SOON" | "OVERDUE";
};

export type CommunicationHistory = {
  customerId: string;
  vehicleId?: string;
  sentAt: Date | string;
  responseStatus: "NONE" | "REPLIED" | "BOOKED" | "NO_RESPONSE" | "OPTED_OUT";
};

export function groupAutomationItems(
  services: AutomationService[],
  customerLookup: Record<string, { name: string; preferredContact: string }>,
  vehicleLookup: Record<string, { label: string }>,
) {
  const eligible = services.filter(
    (service) =>
      service.status === "OVERDUE" || service.remainingLife <= service.threshold,
  );
  const grouped = new Map<string, AutomationService[]>();

  for (const service of eligible) {
    const key = `${service.customerId}:${service.vehicleId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), service]);
  }

  return Array.from(grouped.entries()).map(([key, groupedServices]) => {
    const [customerId, vehicleId] = key.split(":");
    const totals = calculateAppointmentDuration(
      groupedServices.map((service) => ({
        name: service.name,
        laborMinutes: service.estimatedLaborMinutes,
        priceCents: service.estimatedRevenueCents,
      })),
    );

    return {
      id: key,
      customerId,
      vehicleId,
      customerName: customerLookup[customerId]?.name ?? "Unknown customer",
      vehicleLabel: vehicleLookup[vehicleId]?.label ?? "Unknown vehicle",
      preferredContact: customerLookup[customerId]?.preferredContact ?? "SMS",
      services: groupedServices.sort((a, b) => a.remainingLife - b.remainingLife),
      urgency: Math.min(...groupedServices.map((service) => service.remainingLife)),
      ...totals,
    };
  });
}

export function canContactCustomer({
  history,
  customerId,
  vehicleId,
  minDaysBetweenContacts,
  asOf = new Date(),
}: {
  history: CommunicationHistory[];
  customerId: string;
  vehicleId?: string;
  minDaysBetweenContacts: number;
  asOf?: Date | string;
}) {
  const latest = history
    .filter(
      (item) =>
        item.customerId === customerId &&
        (!vehicleId || item.vehicleId === vehicleId),
    )
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())[0];

  if (!latest) {
    return { allowed: true, reason: "Never contacted" };
  }

  if (latest.responseStatus === "BOOKED") {
    return { allowed: false, reason: "Appointment already booked" };
  }

  const elapsedDays =
    (new Date(asOf).getTime() - new Date(latest.sentAt).getTime()) / 86_400_000;

  return elapsedDays >= minDaysBetweenContacts
    ? { allowed: true, reason: "Cooldown elapsed" }
    : { allowed: false, reason: "Recently contacted" };
}

export function buildBundledMaintenanceMessage({
  firstName,
  vehicleLabel,
  services,
}: {
  firstName: string;
  vehicleLabel: string;
  services: string[];
}) {
  const serviceList =
    services.length <= 2
      ? services.join(" and ")
      : `${services.slice(0, -1).join(", ")}, and ${services.at(-1)}`;

  return `Hi ${firstName}, your ${vehicleLabel} is approaching its recommended ${serviceList}. We have openings next week. Use this link to choose a time that works for you: [Booking Link]`;
}
