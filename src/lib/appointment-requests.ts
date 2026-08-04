import type { AppointmentRequestRecord, AppointmentRequestStatus } from "@/lib/demo-data";
import type { SmartBlockCapacityCommitment } from "@/lib/smart-maintenance-blocks";

const capacityHoldingStatuses = new Set<AppointmentRequestStatus>([
  "PENDING",
  "APPROVED",
  "ALTERNATE_PROPOSED",
  "CUSTOMER_ACCEPTED_ALTERNATE",
]);
const alternateCapacityStatuses = new Set<AppointmentRequestStatus>([
  "ALTERNATE_PROPOSED",
  "CUSTOMER_ACCEPTED_ALTERNATE",
]);

export const appointmentRequestNotice =
  "This is an appointment request. The shop will confirm the time after reviewing its schedule.";
export const appointmentRequestSubmittedMessage = (shopName: string) =>
  `Your request was sent to ${shopName}. The shop will confirm the appointment or offer another time.`;

export type PublicAppointmentRequestContextInput = {
  shop: { name: string } & Record<string, unknown>;
  customer: { firstName: string } & Record<string, unknown>;
  vehicle: { year: number; make: string; model: string } & Record<string, unknown>;
  services: Array<{ name: string; laborMinutes: number } & Record<string, unknown>>;
  slots: Array<{ startsAt: string; label: string; dateLabel: string } & Record<string, unknown>>;
  notice: string;
};

export type PublicAppointmentRequestContext = {
  shop: { name: string };
  customer: { firstName: string };
  vehicle: { year: number; make: string; model: string };
  services: Array<{ name: string; laborMinutes: number }>;
  slots: Array<{ startsAt: string; label: string; dateLabel: string }>;
  notice: string;
};

export function publicAppointmentRequestContext(input: PublicAppointmentRequestContextInput): PublicAppointmentRequestContext {
  return {
    shop: { name: input.shop.name },
    customer: { firstName: input.customer.firstName },
    vehicle: {
      year: input.vehicle.year,
      make: input.vehicle.make,
      model: input.vehicle.model,
    },
    services: input.services.map((service) => ({
      name: service.name,
      laborMinutes: service.laborMinutes,
    })),
    slots: input.slots.map((slot) => ({
      startsAt: slot.startsAt,
      label: slot.label,
      dateLabel: slot.dateLabel,
    })),
    notice: input.notice,
  };
}

export function isAppointmentRequestActive(
  request: Pick<AppointmentRequestRecord, "status" | "expiresAt" | "finalAppointmentId">,
  now = new Date(),
) {
  if (request.finalAppointmentId) return false;
  if (!capacityHoldingStatuses.has(request.status)) return false;
  return new Date(request.expiresAt).getTime() > now.getTime();
}

export function appointmentRequestCapacityCommitment(
  request: Pick<
    AppointmentRequestRecord,
    "id" | "shopId" | "smartMaintenanceBlockId" | "requestedStart" | "requestedEnd" | "alternateProposedStart" | "alternateProposedEnd" | "status" | "totalLaborMinutes" | "expiresAt" | "finalAppointmentId"
  >,
  now = new Date(),
): SmartBlockCapacityCommitment | null {
  if (!isAppointmentRequestActive(request, now)) return null;
  const usesAlternate =
    alternateCapacityStatuses.has(request.status) &&
    request.alternateProposedStart &&
    request.alternateProposedEnd;
  return {
    id: request.id,
    shopId: request.shopId,
    blockId: request.smartMaintenanceBlockId ?? undefined,
    startsAt: usesAlternate ? request.alternateProposedStart! : request.requestedStart,
    endsAt: usesAlternate ? request.alternateProposedEnd! : request.requestedEnd,
    status: request.status === "APPROVED" || request.status === "CUSTOMER_ACCEPTED_ALTERNATE" ? "APPROVED" : "PENDING",
    vehicleCount: 1,
    laborMinutes: request.totalLaborMinutes,
  };
}

export function appointmentRequestCommitments(
  requests: AppointmentRequestRecord[],
  now = new Date(),
) {
  return requests
    .map((request) => appointmentRequestCapacityCommitment(request, now))
    .filter((request): request is SmartBlockCapacityCommitment => Boolean(request));
}

export function publicTokenState(input: {
  status: "ACTIVE" | "REVOKED" | "USED" | "EXPIRED";
  expiresAt: string;
  requestCount?: number;
}, now = new Date()) {
  if (input.status === "REVOKED") return "revoked";
  if (input.status === "USED") return "used";
  if (input.status === "EXPIRED" || new Date(input.expiresAt).getTime() <= now.getTime()) return "expired";
  return "valid";
}

export function assertRequestTokenScope(
  link: { shopId: string; customerId: string; vehicleId: string; opportunityId?: string },
  expected: { shopId: string; customerId: string; vehicleId: string; opportunityId?: string },
) {
  return (
    link.shopId === expected.shopId &&
    link.customerId === expected.customerId &&
    link.vehicleId === expected.vehicleId &&
    (link.opportunityId ?? "") === (expected.opportunityId ?? "")
  );
}
