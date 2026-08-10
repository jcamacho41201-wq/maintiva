import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedShopContext } from "@/lib/auth";
import { assertSameShop } from "@/lib/auth";
import {
  appointmentRequestCapacityCommitment,
  appointmentRequestNotice,
  appointmentRequestSubmittedMessage,
  publicAppointmentRequestContext,
  publicTokenState,
} from "@/lib/appointment-requests";
import {
  appointmentRequestIdempotencyKey,
  appointmentRequestUrl,
  createAppointmentRequestToken,
  hashAppointmentRequestToken,
} from "@/lib/appointment-request-tokens";
import { appointmentRequestsDisabledResponse, isAppointmentRequestsEnabled } from "@/lib/feature-flags";
import { canManageAppointments } from "@/lib/permissions";
import {
  calculateSmartMaintenanceBlockAvailability,
  type SmartBlockCapacityCommitment,
  type SmartBlockAvailabilitySlot,
} from "@/lib/smart-maintenance-blocks";
import type {
  Appointment,
  AppointmentRequestLinkRecord,
  AppointmentRequestRecord,
  MaintenanceService,
  SmartMaintenanceBlock,
  SmartMaintenanceBlockBlackout,
} from "@/lib/demo-data";
import { SafeActionError } from "@/lib/server-diagnostics";

const activeRequestStatuses = ["PENDING", "APPROVED", "ALTERNATE_PROPOSED", "CUSTOMER_ACCEPTED_ALTERNATE"] as const;
const noEligibleBlockMessage = "No Smart Maintenance Block currently supports this service.";
const noCapacityMessage = "No request times are currently available for this service.";
const finalSlotTakenMessage = "That time was just requested. Please choose another available time.";
const linkLifetimeDays = 7;
const maxContextRequestsPerMinute = 60;
const maxSubmissionsPerMinute = 8;

type AppointmentRequestWorkflowClient = Prisma.TransactionClient | typeof prisma;

type StaffLinkResult = {
  id: string;
  url: string;
  expiresAt: string;
  message: string;
};

type PublicRequestState =
  | { state: "available"; context: ReturnType<typeof publicAppointmentRequestContext> }
  | { state: "pending"; context: PublicResolvedRequest }
  | { state: "confirmed"; context: PublicResolvedRequest }
  | { state: "declined"; message: string }
  | { state: "expired"; message: string }
  | { state: "revoked"; message: string }
  | { state: "unavailable"; message: string };

type PublicResolvedRequest = {
  shop: { name: string };
  vehicle: { label: string };
  services: Array<{ name: string; laborMinutes: number }>;
  requested: { startsAt: string; endsAt: string; label: string; dateLabel: string };
  notice: string;
};

type StaffDecisionResult = {
  ok: true;
};

const submissionSchema = z.object({
  startsAt: z.iso.datetime(),
  idempotencyKey: z.string().min(8).max(120),
});

class TokenRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  check(key: string, now = Date.now()) {
    const since = now - this.windowMs;
    const previous = (this.hits.get(key) ?? []).filter((hit) => hit > since);
    if (previous.length >= this.limit) return false;
    previous.push(now);
    this.hits.set(key, previous);
    return true;
  }
}

export const appointmentRequestContextRateLimiter = new TokenRateLimiter(maxContextRequestsPerMinute, 60_000);
export const appointmentRequestSubmissionRateLimiter = new TokenRateLimiter(maxSubmissionsPerMinute, 60_000);

function assertAppointmentRequestsReleased() {
  if (!isAppointmentRequestsEnabled()) {
    throw new SafeActionError({
      code: appointmentRequestsDisabledResponse().code,
      message: appointmentRequestsDisabledResponse().message,
      status: 404,
    });
  }
}

function assertAppointmentRequestAdvisor(context: AuthenticatedShopContext) {
  if (!canManageAppointments(context.role)) {
    throw new SafeActionError({
      code: "APPOINTMENT_REQUEST_FORBIDDEN",
      message: "You do not have permission to manage appointment requests.",
      status: 403,
    });
  }
}

function iso(value?: Date | string | null) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function publicVehicleLabel(vehicle: { year: number; make: string; model: string }) {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}

function displaySlot(startsAt: string, endsAt: string, timezone: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return {
    startsAt,
    endsAt,
    label: `${new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(start)} - ${new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(end)}`,
    dateLabel: new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(start),
  };
}

function dateWindow(now: Date, horizonDays: number) {
  const from = new Date(now);
  const to = new Date(now.getTime() + Math.max(1, horizonDays) * 86_400_000);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  };
}

function toBlock(block: {
  id: string;
  shopId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  timezone: string;
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  services: Array<{ serviceDefinitionId: string }>;
  maxVehicles: number;
  maxLaborMinutes: number;
  minimumNoticeMinutes: number;
  maximumHorizonDays: number;
  slotIntervalMinutes: number;
  internalNotes: string | null;
  createdByUserId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SmartMaintenanceBlock {
  return {
    id: block.id,
    shopId: block.shopId,
    name: block.name,
    description: block.description ?? "",
    isActive: block.isActive,
    timezone: block.timezone,
    daysOfWeek: block.daysOfWeek,
    startMinute: block.startMinute,
    endMinute: block.endMinute,
    serviceDefinitionIds: block.services.map((service) => service.serviceDefinitionId),
    maxVehicles: block.maxVehicles,
    maxLaborMinutes: block.maxLaborMinutes,
    minimumNoticeMinutes: block.minimumNoticeMinutes,
    maximumHorizonDays: block.maximumHorizonDays,
    slotIntervalMinutes: block.slotIntervalMinutes === 15 || block.slotIntervalMinutes === 60 ? block.slotIntervalMinutes : 30,
    approvalRequired: true,
    internalNotes: block.internalNotes ?? "",
    createdByUserId: block.createdByUserId ?? undefined,
    archivedAt: iso(block.archivedAt) || undefined,
    createdAt: iso(block.createdAt),
    updatedAt: iso(block.updatedAt),
  };
}

function toBlackout(blackout: {
  id: string;
  shopId: string;
  blockId: string | null;
  startsAt: Date;
  endsAt: Date;
  localDate: Date | null;
  startMinute: number | null;
  endMinute: number | null;
  reason: string | null;
  isFullDay: boolean;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SmartMaintenanceBlockBlackout {
  return {
    id: blackout.id,
    shopId: blackout.shopId,
    blockId: blackout.blockId,
    startsAt: iso(blackout.startsAt),
    endsAt: iso(blackout.endsAt),
    localDate: blackout.localDate ? iso(blackout.localDate).slice(0, 10) : undefined,
    startMinute: blackout.startMinute ?? undefined,
    endMinute: blackout.endMinute ?? undefined,
    reason: blackout.reason ?? "",
    isFullDay: blackout.isFullDay,
    createdByUserId: blackout.createdByUserId ?? undefined,
    createdAt: iso(blackout.createdAt),
    updatedAt: iso(blackout.updatedAt),
  };
}

function toService(service: {
  id: string;
  shopId: string;
  name: string;
  isActive: boolean;
  estimatedLaborMinutes: number;
  defaultPriceCents: number;
}): MaintenanceService {
  return {
    id: service.id,
    shopId: service.shopId,
    name: service.name,
    category: "",
    defaultMileageInterval: null,
    defaultTimeIntervalMonths: null,
    defaultTimeIntervalValue: null,
    defaultTimeIntervalUnit: "MONTHS",
    defaultNotificationThreshold: 10,
    estimatedLaborMinutes: service.estimatedLaborMinutes,
    defaultPriceCents: service.defaultPriceCents,
    description: "",
    isActive: service.isActive,
  };
}

function toAppointment(appointment: {
  shopId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: Appointment["status"];
  totalLaborMinutes: number;
}): Pick<Appointment, "shopId" | "scheduledStart" | "scheduledEnd" | "status" | "totalLaborHours"> {
  return {
    shopId: appointment.shopId,
    scheduledStart: iso(appointment.scheduledStart),
    scheduledEnd: iso(appointment.scheduledEnd),
    status: appointment.status,
    totalLaborHours: appointment.totalLaborMinutes / 60,
  };
}

function toCommitment(request: {
  id: string;
  shopId: string;
  smartMaintenanceBlockId: string;
  requestedStart: Date;
  requestedEnd: Date;
  alternateProposedStart: Date | null;
  alternateProposedEnd: Date | null;
  status: AppointmentRequestRecord["status"];
  totalLaborMinutes: number;
  expiresAt: Date;
  finalAppointmentId: string | null;
}, now: Date): SmartBlockCapacityCommitment | null {
  return appointmentRequestCapacityCommitment({
    id: request.id,
    shopId: request.shopId,
    smartMaintenanceBlockId: request.smartMaintenanceBlockId,
    requestedStart: iso(request.requestedStart),
    requestedEnd: iso(request.requestedEnd),
    alternateProposedStart: iso(request.alternateProposedStart) || undefined,
    alternateProposedEnd: iso(request.alternateProposedEnd) || undefined,
    status: request.status,
    totalLaborMinutes: request.totalLaborMinutes,
    expiresAt: iso(request.expiresAt),
    finalAppointmentId: request.finalAppointmentId ?? undefined,
  }, now);
}

async function loadAvailabilityInputs(client: AppointmentRequestWorkflowClient, shopId: string, now: Date, options?: {
  blockId?: string;
  serviceDefinitionIds?: string[];
  excludeRequestId?: string;
}) {
  const [shop, services, blocks, blackouts, appointments, requests] = await Promise.all([
    client.shop.findUniqueOrThrow({ where: { id: shopId }, select: { id: true, name: true, timezone: true } }),
    client.serviceDefinition.findMany({
      where: { shopId, ...(options?.serviceDefinitionIds?.length ? { id: { in: options.serviceDefinitionIds } } : {}) },
      select: { id: true, shopId: true, name: true, isActive: true, estimatedLaborMinutes: true, defaultPriceCents: true },
    }),
    client.smartMaintenanceBlock.findMany({
      where: {
        shopId,
        ...(options?.blockId ? { id: options.blockId } : {}),
        isActive: true,
        archivedAt: null,
      },
      include: { services: { select: { serviceDefinitionId: true } } },
    }),
    client.smartMaintenanceBlockBlackout.findMany({ where: { shopId } }),
    client.appointment.findMany({
      where: {
        shopId,
        status: { in: ["REQUESTED", "CONFIRMED", "IN_PROGRESS"] },
      },
      select: { shopId: true, scheduledStart: true, scheduledEnd: true, status: true, totalLaborMinutes: true },
    }),
    client.appointmentRequest.findMany({
      where: {
        shopId,
        ...(options?.excludeRequestId ? { id: { not: options.excludeRequestId } } : {}),
        status: { in: [...activeRequestStatuses] },
        expiresAt: { gt: now },
        finalAppointmentId: null,
      },
      select: {
        id: true,
        shopId: true,
        smartMaintenanceBlockId: true,
        requestedStart: true,
        requestedEnd: true,
        alternateProposedStart: true,
        alternateProposedEnd: true,
        status: true,
        totalLaborMinutes: true,
        expiresAt: true,
        finalAppointmentId: true,
      },
    }),
  ]);

  return {
    shop,
    services: services.map(toService),
    blocks: blocks.map(toBlock),
    blackouts: blackouts.map(toBlackout),
    appointments: appointments.map(toAppointment),
    commitments: requests
      .map((request) => toCommitment(request, now))
      .filter((request): request is SmartBlockCapacityCommitment => Boolean(request)),
  };
}

async function availableSlots(client: AppointmentRequestWorkflowClient, input: {
  shopId: string;
  serviceDefinitionIds: string[];
  now: Date;
  blockId?: string;
  excludeRequestId?: string;
}) {
  const data = await loadAvailabilityInputs(client, input.shopId, input.now, input);
  const maxHorizon = Math.max(14, ...data.blocks.map((block) => block.maximumHorizonDays));
  const window = dateWindow(input.now, maxHorizon);
  return calculateSmartMaintenanceBlockAvailability({
    shop: { id: data.shop.id, timezone: data.shop.timezone },
    blocks: data.blocks,
    services: data.services,
    selectedServiceIds: input.serviceDefinitionIds,
    appointments: data.appointments,
    blackouts: data.blackouts,
    commitments: data.commitments,
    now: input.now,
    ...window,
  });
}

async function loadLinkByToken(token: string, client: AppointmentRequestWorkflowClient = prisma) {
  const tokenHash = hashAppointmentRequestToken(token);
  const link = await client.appointmentRequestLink.findUnique({
    where: { tokenHash },
    include: {
      shop: { select: { id: true, name: true, timezone: true } },
      customer: { select: { firstName: true } },
      vehicle: { select: { year: true, make: true, model: true } },
      smartMaintenanceBlock: true,
      services: { orderBy: { createdAt: "asc" } },
      requests: {
        include: { services: { orderBy: { createdAt: "asc" } }, finalAppointment: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  return { tokenHash, link };
}

async function loadOpportunityTarget(context: AuthenticatedShopContext, input: {
  customerId: string;
  vehicleId: string;
  opportunityId: string;
}) {
  const opportunity = await prisma.maintenanceRevenueOpportunity.findFirst({
    where: {
      id: input.opportunityId,
      shopId: context.shopId,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      stage: { notIn: ["BOOKED", "COMPLETED", "LOST"] },
    },
    include: {
      maintenanceRecord: {
        include: {
          serviceDefinition: true,
        },
      },
      customer: true,
      vehicle: true,
    },
  });
  if (!opportunity) {
    throw new SafeActionError({
      code: "APPOINTMENT_REQUEST_TARGET_UNAVAILABLE",
      message: "This opportunity is no longer available for a request link.",
      status: 409,
    });
  }
  assertSameShop(context, opportunity.shopId);
  assertSameShop(context, opportunity.customer.shopId);
  assertSameShop(context, opportunity.vehicle.shopId);

  const record = opportunity.maintenanceRecord;
  const serviceDefinition = record?.serviceDefinition;
  if (!record || !serviceDefinition || !record.serviceDefinitionId || !serviceDefinition.isActive) {
    throw new SafeActionError({
      code: "APPOINTMENT_REQUEST_SERVICE_UNAVAILABLE",
      message: noCapacityMessage,
      status: 409,
    });
  }

  return {
    opportunity,
    customer: opportunity.customer,
    vehicle: opportunity.vehicle,
    services: [{
      serviceDefinitionId: serviceDefinition.id,
      serviceNameSnapshot: record.serviceName || serviceDefinition.name,
      laborMinutes: record.laborMinutes || serviceDefinition.estimatedLaborMinutes,
      priceCents: record.priceCents || serviceDefinition.defaultPriceCents,
    }],
  };
}

export async function createPilotAppointmentRequestLink(context: AuthenticatedShopContext, input: {
  customerId: string;
  vehicleId: string;
  opportunityId: string;
  appUrl: string;
}): Promise<StaffLinkResult> {
  assertAppointmentRequestsReleased();
  assertAppointmentRequestAdvisor(context);
  const target = await loadOpportunityTarget(context, input);
  const serviceDefinitionIds = target.services.map((service) => service.serviceDefinitionId);
  const now = new Date();
  const eligibleBlocks = await prisma.smartMaintenanceBlock.findMany({
    where: {
      shopId: context.shopId,
      isActive: true,
      archivedAt: null,
      services: {
        some: {
          serviceDefinitionId: {
            in: serviceDefinitionIds,
          },
        },
      },
    },
    include: { services: { select: { serviceDefinitionId: true } } },
  });
  const eligibleBlock = eligibleBlocks.find((block) => {
    const blockServiceIds = new Set(block.services.map((service) => service.serviceDefinitionId));
    return serviceDefinitionIds.every((serviceDefinitionId) => blockServiceIds.has(serviceDefinitionId));
  });
  if (!eligibleBlock) {
    throw new SafeActionError({
      code: "APPOINTMENT_REQUEST_NO_ELIGIBLE_BLOCK",
      message: noEligibleBlockMessage,
      status: 409,
    });
  }
  const slots = await availableSlots(prisma, {
    shopId: context.shopId,
    serviceDefinitionIds,
    now,
  });
  const slot = slots[0];
  if (!slot) {
    throw new SafeActionError({ code: "APPOINTMENT_REQUEST_NO_CAPACITY", message: noCapacityMessage, status: 409 });
  }
  const expiresAt = new Date(now.getTime() + linkLifetimeDays * 86_400_000);
  const token = createAppointmentRequestToken();
  const tokenHash = hashAppointmentRequestToken(token);
  const rawUrl = appointmentRequestUrl(input.appUrl, token);

  const created = await prisma.$transaction(async (tx) => {
    const previous = await tx.appointmentRequestLink.findFirst({
      where: {
        shopId: context.shopId,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        opportunityId: input.opportunityId,
        status: "ACTIVE",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    await tx.appointmentRequestLink.updateMany({
      where: {
        shopId: context.shopId,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        opportunityId: input.opportunityId,
        status: "ACTIVE",
      },
      data: { status: "REVOKED", revokedAt: now },
    });
    return tx.appointmentRequestLink.create({
      data: {
        shopId: context.shopId,
        tokenHash,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        opportunityId: input.opportunityId,
        smartMaintenanceBlockId: slot.blockId,
        expiresAt,
        regeneratedFromId: previous?.id,
        createdByUserId: context.userId,
        services: {
          create: target.services.map((service) => ({
            shopId: context.shopId,
            smartMaintenanceBlockId: slot.blockId,
            serviceDefinitionId: service.serviceDefinitionId,
            serviceNameSnapshot: service.serviceNameSnapshot,
            laborMinutes: service.laborMinutes,
            priceCents: service.priceCents,
          })),
        },
      },
      select: { id: true, expiresAt: true },
    });
  });

  return {
    id: created.id,
    url: rawUrl,
    expiresAt: iso(created.expiresAt),
    message: `Hi ${target.customer.firstName}, this is ${context.shopName}. You can request a maintenance time for your ${publicVehicleLabel(target.vehicle)} here: ${rawUrl}`,
  };
}

export async function revokePilotAppointmentRequestLink(context: AuthenticatedShopContext, linkId: string) {
  assertAppointmentRequestsReleased();
  assertAppointmentRequestAdvisor(context);
  await prisma.appointmentRequestLink.updateMany({
    where: { id: linkId, shopId: context.shopId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
}

function resolvedRequestContext(link: NonNullable<Awaited<ReturnType<typeof loadLinkByToken>>["link"]>, request: (typeof link.requests)[number]): PublicResolvedRequest {
  const startsAt = iso(request.finalAppointment?.scheduledStart ?? request.requestedStart);
  const endsAt = iso(request.finalAppointment?.scheduledEnd ?? request.requestedEnd);
  return {
    shop: { name: link.shop.name },
    vehicle: { label: publicVehicleLabel(link.vehicle) },
    services: request.services.map((service) => ({
      name: service.serviceNameSnapshot,
      laborMinutes: service.laborMinutes,
    })),
    requested: displaySlot(startsAt, endsAt, link.shop.timezone),
    notice: appointmentRequestNotice,
  };
}

export async function publicAppointmentRequestState(token: string, request: Request): Promise<PublicRequestState> {
  assertAppointmentRequestsReleased();
  const remoteKey = `${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}:${hashAppointmentRequestToken(token).slice(0, 16)}`;
  if (!appointmentRequestContextRateLimiter.check(remoteKey)) {
    throw new SafeActionError({ code: "APPOINTMENT_REQUEST_RATE_LIMITED", message: "Too many attempts. Try again soon.", status: 429 });
  }
  const now = new Date();
  const { link } = await loadLinkByToken(token);
  if (!link) return { state: "unavailable", message: "Appointment request link is not available." };

  const tokenState = publicTokenState({ status: link.status, expiresAt: iso(link.expiresAt) }, now);
  const latestRequest = link.requests[0];
  if (latestRequest?.status === "APPROVED" && latestRequest.finalAppointmentId) {
    return { state: "confirmed", context: resolvedRequestContext(link, latestRequest) };
  }
  if (latestRequest?.status === "PENDING") {
    return { state: "pending", context: resolvedRequestContext(link, latestRequest) };
  }
  if (latestRequest?.status === "DECLINED") {
    return { state: "declined", message: "This appointment request was declined. Please contact the shop for another time." };
  }
  if (tokenState === "revoked") return { state: "revoked", message: "This appointment request link is no longer active." };
  if (tokenState === "expired") return { state: "expired", message: "This appointment request link has expired." };
  if (tokenState !== "valid") return { state: "unavailable", message: "Appointment request link is not available." };

  const serviceDefinitionIds = link.services.map((service) => service.serviceDefinitionId);
  const slots = await availableSlots(prisma, {
    shopId: link.shopId,
    serviceDefinitionIds,
    blockId: link.smartMaintenanceBlockId,
    now,
  });
  return {
    state: "available",
    context: publicAppointmentRequestContext({
      shop: link.shop,
      customer: link.customer,
      vehicle: link.vehicle,
      services: link.services.map((service) => ({
        name: service.serviceNameSnapshot,
        laborMinutes: service.laborMinutes,
        priceCents: service.priceCents,
      })),
      slots: slots.map((slot) => ({ startsAt: slot.startsAt, label: slot.label, dateLabel: slot.dateLabel })),
      notice: appointmentRequestNotice,
    }),
  };
}

function safeSubmittedResponse(link: NonNullable<Awaited<ReturnType<typeof loadLinkByToken>>["link"]>, slot: SmartBlockAvailabilitySlot) {
  return {
    message: appointmentRequestSubmittedMessage(link.shop.name),
    context: {
      shop: { name: link.shop.name },
      vehicle: { label: publicVehicleLabel(link.vehicle) },
      services: link.services.map((service) => ({ name: service.serviceNameSnapshot, laborMinutes: service.laborMinutes })),
      requested: displaySlot(slot.startsAt, slot.endsAt, link.shop.timezone),
      notice: appointmentRequestNotice,
    },
  };
}

export async function submitPublicAppointmentRequest(token: string, input: unknown, request: Request) {
  assertAppointmentRequestsReleased();
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) {
    throw new SafeActionError({ code: "APPOINTMENT_REQUEST_INVALID", message: "Choose a valid request time.", status: 400 });
  }
  const tokenHash = hashAppointmentRequestToken(token);
  const remoteKey = `${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}:${tokenHash.slice(0, 16)}`;
  if (!appointmentRequestSubmissionRateLimiter.check(remoteKey)) {
    throw new SafeActionError({ code: "APPOINTMENT_REQUEST_RATE_LIMITED", message: "Too many attempts. Try again soon.", status: 429 });
  }
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appointment-request:${tokenHash}:${parsed.data.startsAt}`}))`;
    const { link } = await loadLinkByToken(token, tx);
    if (!link) {
      throw new SafeActionError({ code: "APPOINTMENT_REQUEST_UNAVAILABLE", message: "Appointment request link is not available.", status: 404 });
    }
    const tokenState = publicTokenState({ status: link.status, expiresAt: iso(link.expiresAt) }, now);
    if (tokenState !== "valid") {
      throw new SafeActionError({ code: "APPOINTMENT_REQUEST_UNAVAILABLE", message: "Appointment request link is not available.", status: 404 });
    }

    const idempotencyKey = appointmentRequestIdempotencyKey(tokenHash, parsed.data.startsAt, parsed.data.idempotencyKey);
    const existing = await tx.appointmentRequest.findFirst({
      where: { requestLinkId: link.id, idempotencyKey },
      include: { services: true },
    });
    if (existing) {
      return safeSubmittedResponse(link, {
        blockId: existing.smartMaintenanceBlockId,
        blockName: link.smartMaintenanceBlock.name,
        startsAt: iso(existing.requestedStart),
        endsAt: iso(existing.requestedEnd),
        label: "",
        dateLabel: "",
        remainingLaborMinutes: 0,
        remainingVehicles: 0,
      });
    }

    const activeExisting = await tx.appointmentRequest.findFirst({
      where: {
        requestLinkId: link.id,
        status: { in: [...activeRequestStatuses] },
        expiresAt: { gt: now },
        finalAppointmentId: null,
      },
    });
    if (activeExisting) {
      if (activeExisting.requestedStart.toISOString() === parsed.data.startsAt) {
        return safeSubmittedResponse(link, {
          blockId: activeExisting.smartMaintenanceBlockId,
          blockName: link.smartMaintenanceBlock.name,
          startsAt: iso(activeExisting.requestedStart),
          endsAt: iso(activeExisting.requestedEnd),
          label: "",
          dateLabel: "",
          remainingLaborMinutes: 0,
          remainingVehicles: 0,
        });
      }
      throw new SafeActionError({ code: "APPOINTMENT_REQUEST_ALREADY_SUBMITTED", message: "This request link has already been used.", status: 409 });
    }

    const serviceDefinitionIds = link.services.map((service) => service.serviceDefinitionId);
    const slots = await availableSlots(tx, {
      shopId: link.shopId,
      serviceDefinitionIds,
      blockId: link.smartMaintenanceBlockId,
      now,
    });
    const selectedSlot = slots.find((slot) => slot.startsAt === parsed.data.startsAt);
    if (!selectedSlot) {
      throw new SafeActionError({ code: "APPOINTMENT_REQUEST_SLOT_UNAVAILABLE", message: finalSlotTakenMessage, status: 409 });
    }
    const totalLaborMinutes = link.services.reduce((sum, service) => sum + service.laborMinutes, 0);
    const estimatedRevenueCents = link.services.reduce((sum, service) => sum + service.priceCents, 0);

    await tx.appointmentRequest.create({
      data: {
        shopId: link.shopId,
        customerId: link.customerId,
        vehicleId: link.vehicleId,
        opportunityId: link.opportunityId,
        smartMaintenanceBlockId: link.smartMaintenanceBlockId,
        requestLinkId: link.id,
        requestedStart: new Date(selectedSlot.startsAt),
        requestedEnd: new Date(selectedSlot.endsAt),
        shopTimezone: link.shop.timezone,
        totalLaborMinutes,
        estimatedRevenueCents,
        status: "PENDING",
        expiresAt: link.expiresAt,
        idempotencyKey,
        services: {
          create: link.services.map((service) => ({
            shopId: link.shopId,
            smartMaintenanceBlockId: link.smartMaintenanceBlockId,
            serviceDefinitionId: service.serviceDefinitionId,
            serviceNameSnapshot: service.serviceNameSnapshot,
            laborMinutes: service.laborMinutes,
            priceCents: service.priceCents,
          })),
        },
      },
    });
    await tx.appointmentRequestLink.update({
      where: { id: link.id },
      data: {
        requestAttemptCount: { increment: 1 },
        lastRequestAttemptAt: now,
      },
    });
    return safeSubmittedResponse(link, selectedSlot);
  });
}

export async function acceptPilotMaintenanceAppointmentRequest(context: AuthenticatedShopContext, requestId: string): Promise<StaffDecisionResult> {
  assertAppointmentRequestsReleased();
  assertAppointmentRequestAdvisor(context);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appointment-request:${context.shopId}:${requestId}`}))`;
    const request = await tx.appointmentRequest.findFirst({
      where: { id: requestId, shopId: context.shopId },
      include: {
        services: true,
        requestLink: true,
        opportunity: true,
        finalAppointment: true,
      },
    });
    if (!request) {
      throw new SafeActionError({ code: "APPOINTMENT_REQUEST_NOT_FOUND", message: "Appointment request not found.", status: 404 });
    }
    if (request.status === "APPROVED" && request.finalAppointmentId) return;
    if (request.status !== "PENDING" || request.expiresAt <= now) {
      throw new SafeActionError({ code: "APPOINTMENT_REQUEST_NOT_PENDING", message: "This request is no longer pending.", status: 409 });
    }
    const serviceDefinitionIds = request.services.map((service) => service.serviceDefinitionId);
    const slots = await availableSlots(tx, {
      shopId: context.shopId,
      serviceDefinitionIds,
      blockId: request.smartMaintenanceBlockId,
      excludeRequestId: request.id,
      now,
    });
    const stillOpen = slots.some((slot) => slot.startsAt === request.requestedStart.toISOString());
    if (!stillOpen) {
      throw new SafeActionError({
        code: "APPOINTMENT_REQUEST_SLOT_UNAVAILABLE",
        message: "That requested time no longer has enough capacity.",
        status: 409,
      });
    }
    const appointmentId = `appt-${request.id}`;
    const existingAppointment = await tx.appointment.findUnique({ where: { id: appointmentId } });
    const appointment = existingAppointment ?? await tx.appointment.create({
      data: {
        id: appointmentId,
        shopId: context.shopId,
        customerId: request.customerId,
        vehicleId: request.vehicleId,
        scheduledStart: request.requestedStart,
        scheduledEnd: request.requestedEnd,
        status: "CONFIRMED",
        totalLaborMinutes: request.totalLaborMinutes,
        totalPriceCents: request.estimatedRevenueCents,
        source: "AUTOMATION",
        attributionSource: "MAINTIVA_OUTREACH",
        opportunityId: request.opportunityId,
        approvedAt: now,
        notes: "Confirmed from Maintiva appointment request.",
        services: {
          create: request.services.map((service) => ({
            shopId: context.shopId,
            serviceDefinitionId: service.serviceDefinitionId,
            serviceName: service.serviceNameSnapshot,
            laborMinutes: service.laborMinutes,
            priceCents: service.priceCents,
          })),
        },
      },
    });
    await tx.appointmentRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        advisorDecisionAt: now,
        decidedByUserId: context.userId,
        finalAppointmentId: appointment.id,
      },
    });
    await tx.appointmentRequestLink.update({
      where: { id: request.requestLinkId },
      data: { status: "USED", usedAt: now },
    });
    await tx.maintenanceRevenueOpportunity.update({
      where: { id: request.opportunityId },
      data: { stage: "BOOKED", lastActivityAt: now },
    });
    if (request.opportunity.maintenanceRecordId) {
      await tx.vehicleMaintenanceRecord.updateMany({
        where: { id: request.opportunity.maintenanceRecordId, shopId: context.shopId },
        data: { outreachStatus: "SCHEDULED", appointmentId: appointment.id, updatedByUserId: context.userId },
      });
    }
    if (request.opportunity.declinedWorkRecordId) {
      await tx.declinedWorkRecord.updateMany({
        where: { id: request.opportunity.declinedWorkRecordId, shopId: context.shopId },
        data: { status: "BOOKED", outreachStatus: "SCHEDULED", appointmentId: appointment.id },
      });
    }
  });

  return { ok: true };
}

export async function declinePilotMaintenanceAppointmentRequest(context: AuthenticatedShopContext, requestId: string, input?: { reason?: string }) {
  assertAppointmentRequestsReleased();
  assertAppointmentRequestAdvisor(context);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appointment-request:${context.shopId}:${requestId}`}))`;
    const request = await tx.appointmentRequest.findFirst({ where: { id: requestId, shopId: context.shopId } });
    if (!request) {
      throw new SafeActionError({ code: "APPOINTMENT_REQUEST_NOT_FOUND", message: "Appointment request not found.", status: 404 });
    }
    if (request.status === "DECLINED") return;
    if (request.status !== "PENDING") {
      throw new SafeActionError({ code: "APPOINTMENT_REQUEST_NOT_PENDING", message: "This request is no longer pending.", status: 409 });
    }
    await tx.appointmentRequest.update({
      where: { id: request.id },
      data: {
        status: "DECLINED",
        advisorDecisionAt: new Date(),
        decidedByUserId: context.userId,
        declineReason: input?.reason?.slice(0, 500) || null,
      },
    });
  });
}

export async function stateAppointmentRequestLinks(shopId: string): Promise<AppointmentRequestLinkRecord[]> {
  if (!isAppointmentRequestsEnabled()) return [];
  const links = await prisma.appointmentRequestLink.findMany({
    where: { shopId },
    include: { services: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return links.map((link): AppointmentRequestLinkRecord => ({
    id: link.id,
    shopId: link.shopId,
    customerId: link.customerId,
    vehicleId: link.vehicleId,
    opportunityId: link.opportunityId,
    smartMaintenanceBlockId: link.smartMaintenanceBlockId,
    status: link.status,
    expiresAt: iso(link.expiresAt),
    revokedAt: iso(link.revokedAt) || undefined,
    usedAt: iso(link.usedAt) || undefined,
    requestAttemptCount: link.requestAttemptCount,
    lastRequestAttemptAt: iso(link.lastRequestAttemptAt) || undefined,
    regeneratedFromId: link.regeneratedFromId ?? undefined,
    createdByUserId: link.createdByUserId ?? undefined,
    services: link.services.map((service) => ({
      id: service.id,
      shopId: service.shopId,
      requestLinkId: service.requestLinkId,
      smartMaintenanceBlockId: service.smartMaintenanceBlockId,
      serviceDefinitionId: service.serviceDefinitionId,
      serviceNameSnapshot: service.serviceNameSnapshot,
      laborMinutes: service.laborMinutes,
      priceCents: service.priceCents,
      createdAt: iso(service.createdAt),
    })),
    createdAt: iso(link.createdAt),
    updatedAt: iso(link.updatedAt),
  }));
}

export async function stateAppointmentRequests(shopId: string): Promise<AppointmentRequestRecord[]> {
  if (!isAppointmentRequestsEnabled()) return [];
  const requests = await prisma.appointmentRequest.findMany({
    where: { shopId },
    include: { services: { orderBy: { createdAt: "asc" } } },
    orderBy: { requestedStart: "asc" },
  });
  return requests.map((request): AppointmentRequestRecord => ({
    id: request.id,
    shopId: request.shopId,
    customerId: request.customerId,
    vehicleId: request.vehicleId,
    opportunityId: request.opportunityId,
    smartMaintenanceBlockId: request.smartMaintenanceBlockId,
    requestLinkId: request.requestLinkId,
    requestedStart: iso(request.requestedStart),
    requestedEnd: iso(request.requestedEnd),
    shopTimezone: request.shopTimezone,
    totalLaborMinutes: request.totalLaborMinutes,
    estimatedRevenueCents: request.estimatedRevenueCents,
    status: request.status,
    source: request.source,
    expiresAt: iso(request.expiresAt),
    customerSubmittedAt: iso(request.customerSubmittedAt),
    advisorDecisionAt: iso(request.advisorDecisionAt) || undefined,
    decidedByUserId: request.decidedByUserId ?? undefined,
    declineReason: request.declineReason ?? undefined,
    alternateProposedStart: iso(request.alternateProposedStart) || undefined,
    alternateProposedEnd: iso(request.alternateProposedEnd) || undefined,
    finalAppointmentId: request.finalAppointmentId ?? undefined,
    idempotencyKey: request.idempotencyKey ?? undefined,
    services: request.services.map((service) => ({
      id: service.id,
      shopId: service.shopId,
      appointmentRequestId: service.appointmentRequestId,
      smartMaintenanceBlockId: service.smartMaintenanceBlockId,
      serviceDefinitionId: service.serviceDefinitionId,
      serviceNameSnapshot: service.serviceNameSnapshot,
      laborMinutes: service.laborMinutes,
      priceCents: service.priceCents,
      createdAt: iso(service.createdAt),
    })),
    createdAt: iso(request.createdAt),
    updatedAt: iso(request.updatedAt),
  }));
}
