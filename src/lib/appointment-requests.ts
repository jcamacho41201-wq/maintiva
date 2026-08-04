import { createHash, randomBytes } from "node:crypto";
import type { AppointmentRequestRecord, AppointmentRequestStatus } from "@/lib/demo-data";
import type { SmartBlockCapacityCommitment } from "@/lib/smart-maintenance-blocks";

const tokenBytes = 32;
const tokenAlphabet = "base64url";
const capacityHoldingStatuses = new Set<AppointmentRequestStatus>([
  "PENDING",
  "APPROVED",
  "CUSTOMER_ACCEPTED_ALTERNATE",
]);

export const appointmentRequestPathPrefix = "/request/";
export const appointmentRequestNotice =
  "This is an appointment request. The shop will confirm the time after reviewing its schedule.";
export const appointmentRequestSubmittedMessage = (shopName: string) =>
  `Your request was sent to ${shopName}. The shop will confirm the appointment or offer another time.`;

export function createAppointmentRequestToken() {
  return randomBytes(tokenBytes).toString(tokenAlphabet);
}

export function hashAppointmentRequestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function appointmentRequestUrl(appUrl: string, token: string) {
  const baseUrl = appUrl.endsWith("/") ? appUrl.slice(0, -1) : appUrl;
  return `${baseUrl}${appointmentRequestPathPrefix}${encodeURIComponent(token)}`;
}

export function appointmentRequestIdempotencyKey(tokenHash: string, startsAt: string, clientKey: string) {
  return hashAppointmentRequestToken(`${tokenHash}:${startsAt}:${clientKey}`);
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
    request.status === "ALTERNATE_PROPOSED" &&
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
