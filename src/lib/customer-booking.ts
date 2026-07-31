import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertSameShop, type AuthenticatedShopContext } from "@/lib/auth";
import { SafeActionError } from "@/lib/server-diagnostics";
import type {
  Appointment,
  BookingIntakeType,
  BookingMode,
  BookingWindow,
  CustomerBookingLink,
  ServiceBookingIntakeOption,
  ServiceBookingRule,
  Shop,
  ShopBookingBlackout,
  ShopBookingSettings,
} from "@/lib/demo-data";

const slotMinutes = 30;

export type BookingServiceSummary = {
  maintenanceRecordId?: string;
  declinedWorkRecordId?: string;
  serviceDefinitionId?: string | null;
  name: string;
  priceCents: number;
  laborMinutes: number;
  reason: "CURRENTLY_RECOMMENDED" | "OPTIONAL_FOR_THIS_VISIT";
  dueText: string;
};

export type PublicBookingContext = {
  link: Pick<CustomerBookingLink, "id" | "status" | "expiresAt" | "usedAt" | "bookingCompletedAt" | "appointmentId">;
  shop: Pick<Shop, "id" | "name" | "phone" | "email" | "address" | "timezone">;
  customer: { firstName: string };
  vehicle: { id: string; year: number; make: string; model: string };
  services: BookingServiceSummary[];
  optionalServices: BookingServiceSummary[];
  bookingMode: BookingMode;
  allowedIntakeTypes: BookingIntakeType[];
  policy: {
    minimumNoticeMinutes: number;
    maximumAdvanceDays: number;
    cancellationCutoffMinutes: number;
    reschedulingCutoffMinutes: number;
  };
};

export type AvailabilitySlot = {
  startsAt: string;
  endsAt: string;
  label: string;
  dateLabel: string;
  intakeType: BookingIntakeType;
};

type AvailabilityInput = {
  shop: Pick<Shop, "id" | "timezone">;
  settings?: ShopBookingSettings;
  shopWindows: BookingWindow[];
  blackouts: ShopBookingBlackout[];
  serviceRules: ServiceBookingRule[];
  services: Array<{ id?: string | null; laborMinutes: number }>;
  appointments: Pick<Appointment, "scheduledStart" | "scheduledEnd" | "status">[];
  dateFrom: string;
  dateTo: string;
  intakeType: BookingIntakeType;
  now?: Date;
};

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createBookingToken() {
  return randomBytes(32).toString("base64url");
}

export function bookingLinkUrl(appUrl: string, token: string) {
  return `${appUrl.replace(/\/$/, "")}/book/${token}`;
}

function defaultSettings(shopId: string): ShopBookingSettings {
  return {
    id: `default-${shopId}`,
    shopId,
    onlineBookingEnabled: true,
    minimumNoticeMinutes: 1440,
    maximumAdvanceDays: 30,
    defaultBufferBeforeMinutes: 0,
    defaultBufferAfterMinutes: 15,
    maximumSimultaneousAppointments: 2,
    cancellationCutoffMinutes: 1440,
    reschedulingCutoffMinutes: 1440,
  };
}

function defaultWindows(shopId: string): BookingWindow[] {
  return [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    id: `default-${shopId}-${dayOfWeek}`,
    shopId,
    dayOfWeek,
    startMinute: 8 * 60,
    endMinute: 17 * 60,
    isActive: true,
  }));
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

function zonedTimeToUtc(date: string, minuteOfDay: number, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const guessed = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  return new Date(guessed.getTime() - timeZoneOffsetMs(guessed, timeZone));
}

function localDateKey(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
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

function serviceAllowsIntake(rule: ServiceBookingRule | undefined, intakeType: BookingIntakeType) {
  const allowed = rule?.allowedIntakeType ?? "EITHER";
  if (allowed === "EITHER") return true;
  if (allowed === "WAIT_ONLY") return intakeType === "WAIT";
  return intakeType === "DROP_OFF";
}

function intersectWindows(shopWindows: BookingWindow[], serviceRules: ServiceBookingRule[], date: string) {
  const dow = dayOfWeek(date);
  const shop = shopWindows.filter((window) => window.isActive && window.dayOfWeek === dow);
  const serviceWindows = serviceRules.flatMap((rule) => rule.windows.filter((window) => window.isActive && window.dayOfWeek === dow));
  if (serviceWindows.length === 0) return shop;

  const result: BookingWindow[] = [];
  for (const shopWindow of shop) {
    for (const serviceWindow of serviceWindows) {
      const startMinute = Math.max(shopWindow.startMinute, serviceWindow.startMinute);
      const endMinute = Math.min(shopWindow.endMinute, serviceWindow.endMinute);
      if (startMinute < endMinute) {
        result.push({ ...shopWindow, startMinute, endMinute });
      }
    }
  }
  return result;
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
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(date),
  };
}

export function getAllowedIntakeTypes(rules: ServiceBookingRule[]) {
  const allowsWait = rules.every((rule) => serviceAllowsIntake(rule, "WAIT"));
  const allowsDropOff = rules.every((rule) => serviceAllowsIntake(rule, "DROP_OFF"));
  return [
    allowsWait ? "WAIT" as const : undefined,
    allowsDropOff ? "DROP_OFF" as const : undefined,
  ].filter((item): item is BookingIntakeType => Boolean(item));
}

export function getBookingMode(rules: ServiceBookingRule[]): BookingMode {
  return rules.some((rule) => rule.bookingMode === "REQUEST") ? "REQUEST" : "INSTANT";
}

export function calculateBookingAvailability(input: AvailabilityInput): AvailabilitySlot[] {
  const settings = input.settings ?? defaultSettings(input.shop.id);
  if (!settings.onlineBookingEnabled) return [];
  if (input.services.length === 0) return [];
  if (input.serviceRules.some((rule) => !rule.bookingEnabled)) return [];
  if (!getAllowedIntakeTypes(input.serviceRules).includes(input.intakeType)) return [];

  const now = input.now ?? new Date();
  const maximumAdvanceDays = Math.min(
    settings.maximumAdvanceDays,
    ...input.serviceRules
      .map((rule) => rule.maximumAdvanceDays ?? settings.maximumAdvanceDays),
  );
  const horizonEnd = new Date(now.getTime() + maximumAdvanceDays * 86_400_000);
  const minimumStart = new Date(now.getTime() + Math.max(...input.serviceRules.map((rule) => rule.minimumNoticeMinutes ?? settings.minimumNoticeMinutes), settings.minimumNoticeMinutes) * 60_000);
  const duration = Math.max(
    input.services.reduce((sum, service) => sum + service.laborMinutes, 0),
    input.serviceRules.reduce((sum, rule) => sum + rule.estimatedDurationMinutes, 0),
    30,
  );
  const bufferBefore = Math.max(...input.serviceRules.map((rule) => rule.bufferBeforeMinutes), settings.defaultBufferBeforeMinutes);
  const bufferAfter = Math.max(...input.serviceRules.map((rule) => rule.bufferAfterMinutes), settings.defaultBufferAfterMinutes);
  const shopCapacity = settings.maximumSimultaneousAppointments;
  const serviceCapacity = Math.min(
    ...input.serviceRules.map((rule) => rule.maximumSimultaneousBookings ?? shopCapacity),
    shopCapacity,
  );
  const shopWindows = input.shopWindows.length > 0 ? input.shopWindows : defaultWindows(input.shop.id);
  const slots: AvailabilitySlot[] = [];

  for (const date of dateRange(input.dateFrom, input.dateTo)) {
    for (const window of intersectWindows(shopWindows, input.serviceRules, date)) {
      for (let minute = window.startMinute; minute + duration <= window.endMinute; minute += slotMinutes) {
        const startsAt = zonedTimeToUtc(date, minute, input.shop.timezone);
        const endsAt = new Date(startsAt.getTime() + duration * 60_000);
        const blockedStart = new Date(startsAt.getTime() - bufferBefore * 60_000);
        const blockedEnd = new Date(endsAt.getTime() + bufferAfter * 60_000);
        if (startsAt < minimumStart || startsAt > horizonEnd) continue;
        if (input.blackouts.some((blackout) => overlaps(blockedStart, blockedEnd, new Date(blackout.startsAt), new Date(blackout.endsAt)))) continue;

        const overlapping = input.appointments.filter((appointment) =>
          !["CANCELLED", "NO_SHOW"].includes(appointment.status) &&
          overlaps(blockedStart, blockedEnd, new Date(appointment.scheduledStart), new Date(appointment.scheduledEnd)),
        );
        if (overlapping.length >= shopCapacity || overlapping.length >= serviceCapacity) continue;

        const labels = slotLabel(startsAt, input.shop.timezone);
        slots.push({
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          intakeType: input.intakeType,
          ...labels,
        });
      }
    }
  }

  return slots;
}

function publicError(code: string, message: string, status = 400) {
  return new SafeActionError({ code, message, status });
}

function mapServiceRule(row: {
  id: string;
  shopId: string;
  serviceDefinitionId: string;
  bookingEnabled: boolean;
  bookingMode: BookingMode;
  estimatedDurationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  allowedIntakeType: ServiceBookingIntakeOption;
  minimumNoticeMinutes: number | null;
  maximumAdvanceDays: number | null;
  maximumSimultaneousBookings: number | null;
  windows?: Array<{
    id: string;
    shopId: string;
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    isActive: boolean;
  }>;
}): ServiceBookingRule {
  return {
    ...row,
    windows: row.windows ?? [],
  };
}

function summarizeMaintenance(record: {
  id: string;
  serviceDefinitionId: string | null;
  serviceName: string;
  laborMinutes: number;
  priceCents: number;
  status: string;
}): BookingServiceSummary {
  return {
    maintenanceRecordId: record.id,
    serviceDefinitionId: record.serviceDefinitionId,
    name: record.serviceName,
    laborMinutes: record.laborMinutes,
    priceCents: record.priceCents,
    reason: "CURRENTLY_RECOMMENDED",
    dueText: record.status === "OVERDUE" ? "Overdue" : "Approaching due",
  };
}

function summarizeDeclined(record: {
  id: string;
  serviceName: string;
  laborMinutes: number;
  recommendedPriceCents: number;
}): BookingServiceSummary {
  return {
    declinedWorkRecordId: record.id,
    name: record.serviceName,
    laborMinutes: record.laborMinutes,
    priceCents: record.recommendedPriceCents,
    reason: "CURRENTLY_RECOMMENDED",
    dueText: "Previously recommended",
  };
}

export async function createCustomerBookingLink({
  context,
  appUrl,
  customerId,
  vehicleId,
  opportunityIds,
}: {
  context: AuthenticatedShopContext;
  appUrl: string;
  customerId: string;
  vehicleId: string;
  opportunityIds: string[];
}) {
  const opportunities = await prisma.maintenanceRevenueOpportunity.findMany({
    where: { id: { in: opportunityIds }, shopId: context.shopId },
  });
  if (opportunities.length !== opportunityIds.length || opportunities.length === 0) {
    throw publicError("BOOKING_LINK_TARGET_INVALID", "The booking link could not be created.", 403);
  }
  if (opportunities.some((opportunity) => opportunity.customerId !== customerId || opportunity.vehicleId !== vehicleId)) {
    throw publicError("BOOKING_LINK_TARGET_INVALID", "The booking link could not be created.", 403);
  }
  if (opportunities.some((opportunity) => ["BOOKED", "COMPLETED", "LOST"].includes(opportunity.stage))) {
    throw publicError("BOOKING_LINK_TARGET_CLOSED", "The booking link could not be created.", 409);
  }
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  assertSameShop(context, customer?.shopId);
  assertSameShop(context, vehicle?.shopId);
  if (!vehicle || vehicle.customerId !== customerId) {
    throw publicError("BOOKING_LINK_TARGET_INVALID", "The booking link could not be created.", 403);
  }

  const token = createBookingToken();
  const created = await prisma.customerBookingLink.create({
    data: {
      shopId: context.shopId,
      tokenHash: tokenHash(token),
      customerId,
      vehicleId,
      opportunityId: opportunities[0].id,
      maintenanceRecordIds: opportunities
        .map((opportunity) => opportunity.maintenanceRecordId)
        .filter((id): id is string => Boolean(id)),
      declinedWorkRecordIds: opportunities
        .map((opportunity) => opportunity.declinedWorkRecordId)
        .filter((id): id is string => Boolean(id)),
      expiresAt: new Date(Date.now() + 14 * 86_400_000),
      createdByUserId: context.userId,
    },
  });

  return {
    id: created.id,
    url: bookingLinkUrl(appUrl, token),
    expiresAt: created.expiresAt.toISOString(),
  };
}

async function loadBookingLink(token: string, options: { allowBooked?: boolean } = {}) {
  const link = await prisma.customerBookingLink.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: {
      shop: true,
      customer: true,
      vehicle: true,
    },
  });
  const statusAllowed = link?.status === "ACTIVE" || Boolean(options.allowBooked && link?.appointmentId && link?.status === "COMPLETED");
  if (!link || !statusAllowed || link.revokedAt || link.expiresAt <= new Date()) {
    throw publicError("BOOKING_LINK_INVALID", "This booking link is no longer valid.", 404);
  }
  if (link.customer.shopId !== link.shopId || link.vehicle.shopId !== link.shopId || link.vehicle.customerId !== link.customerId) {
    throw publicError("BOOKING_LINK_INVALID", "This booking link is no longer valid.", 404);
  }
  return link;
}

async function loadPublicContextData(token: string, options: { allowBooked?: boolean } = {}) {
  const link = await loadBookingLink(token, options);
  const [settings, shopWindows, blackouts, maintenanceRecords, declinedWorkRecords, appointments] = await Promise.all([
    prisma.shopBookingSettings.findUnique({ where: { shopId: link.shopId } }),
    prisma.shopBookingWindow.findMany({ where: { shopId: link.shopId, isActive: true } }),
    prisma.shopBookingBlackout.findMany({ where: { shopId: link.shopId } }),
    prisma.vehicleMaintenanceRecord.findMany({
      where: { id: { in: link.maintenanceRecordIds }, shopId: link.shopId, archivedAt: null },
      include: { serviceDefinition: { include: { bookingRule: { include: { windows: true } } } } },
    }),
    prisma.declinedWorkRecord.findMany({
      where: { id: { in: link.declinedWorkRecordIds }, shopId: link.shopId },
    }),
    prisma.appointment.findMany({
      where: {
        shopId: link.shopId,
        scheduledStart: {
          gte: new Date(),
        },
      },
    }),
  ]);
  const optionalRecords = await prisma.vehicleMaintenanceRecord.findMany({
    where: {
      shopId: link.shopId,
      vehicleId: link.vehicleId,
      id: { notIn: link.maintenanceRecordIds },
      archivedAt: null,
      isActive: true,
      status: { in: ["DUE_SOON", "DUE", "OVERDUE"] },
    },
    include: { serviceDefinition: { include: { bookingRule: { include: { windows: true } } } } },
    take: 5,
  });

  const services = [
    ...maintenanceRecords.map(summarizeMaintenance),
    ...declinedWorkRecords.map(summarizeDeclined),
  ];
  const optionalServices = optionalRecords.map((record) => ({
    ...summarizeMaintenance(record),
    reason: "OPTIONAL_FOR_THIS_VISIT" as const,
  }));
  const rules = maintenanceRecords
    .map((record) => record.serviceDefinition?.bookingRule ? mapServiceRule(record.serviceDefinition.bookingRule) : undefined)
    .filter((rule): rule is ServiceBookingRule => Boolean(rule));

  return {
    link,
    settings: settings ?? defaultSettings(link.shopId),
    shopWindows: shopWindows.length ? shopWindows : defaultWindows(link.shopId),
    blackouts,
    maintenanceRecords,
    declinedWorkRecords,
    optionalRecords,
    services,
    optionalServices,
    rules,
    appointments,
  };
}

export async function getPublicBookingContext(token: string): Promise<PublicBookingContext> {
  const data = await loadPublicContextData(token, { allowBooked: true });
  await prisma.customerBookingLink.update({
    where: { id: data.link.id },
    data: { lastViewedAt: new Date() },
  });
  return {
    link: {
      id: data.link.id,
      status: data.link.status,
      expiresAt: data.link.expiresAt.toISOString(),
      usedAt: data.link.usedAt?.toISOString(),
      bookingCompletedAt: data.link.bookingCompletedAt?.toISOString(),
      appointmentId: data.link.appointmentId ?? undefined,
    },
    shop: {
      id: data.link.shop.id,
      name: data.link.shop.name,
      phone: data.link.shop.phone ?? "",
      email: data.link.shop.email ?? "",
      address: data.link.shop.address ?? "",
      timezone: data.link.shop.timezone,
    },
    customer: { firstName: data.link.customer.firstName },
    vehicle: {
      id: data.link.vehicle.id,
      year: data.link.vehicle.year,
      make: data.link.vehicle.make,
      model: data.link.vehicle.model,
    },
    services: data.services,
    optionalServices: data.optionalServices,
    bookingMode: getBookingMode(data.rules),
    allowedIntakeTypes: getAllowedIntakeTypes(data.rules),
    policy: {
      minimumNoticeMinutes: data.settings.minimumNoticeMinutes,
      maximumAdvanceDays: data.settings.maximumAdvanceDays,
      cancellationCutoffMinutes: data.settings.cancellationCutoffMinutes,
      reschedulingCutoffMinutes: data.settings.reschedulingCutoffMinutes,
    },
  };
}

export async function getPublicAvailability(token: string, intakeType: BookingIntakeType, extraMaintenanceRecordIds: string[] = []) {
  const data = await loadPublicContextData(token, { allowBooked: true });
  const selectedOptional = data.optionalRecords.filter((record) => extraMaintenanceRecordIds.includes(record.id));
  const rules = [
    ...data.rules,
    ...selectedOptional
      .map((record) => record.serviceDefinition?.bookingRule ? mapServiceRule(record.serviceDefinition.bookingRule) : undefined)
      .filter((rule): rule is ServiceBookingRule => Boolean(rule)),
  ];
  const services = [
    ...data.services.map((service) => ({ laborMinutes: service.laborMinutes })),
    ...selectedOptional.map((record) => ({ id: record.serviceDefinitionId, laborMinutes: record.laborMinutes })),
  ];
  const today = localDateKey(new Date(), data.link.shop.timezone);
  const dateTo = addDays(today, data.settings.maximumAdvanceDays);

  return calculateBookingAvailability({
    shop: { id: data.link.shop.id, timezone: data.link.shop.timezone },
    settings: data.settings,
    shopWindows: data.shopWindows,
    blackouts: data.blackouts.map((blackout) => ({
      id: blackout.id,
      shopId: blackout.shopId,
      startsAt: blackout.startsAt.toISOString(),
      endsAt: blackout.endsAt.toISOString(),
      reason: blackout.reason ?? undefined,
      isFullDay: blackout.isFullDay,
    })),
    serviceRules: rules,
    services,
    appointments: data.appointments.map((appointment) => ({
      scheduledStart: appointment.scheduledStart.toISOString(),
      scheduledEnd: appointment.scheduledEnd.toISOString(),
      status: appointment.status,
    })),
    dateFrom: today,
    dateTo,
    intakeType,
  }).slice(0, 60);
}

export async function submitPublicBooking(token: string, input: {
  startsAt: string;
  intakeType: BookingIntakeType;
  extraMaintenanceRecordIds?: string[];
  customerNotes?: string;
  idempotencyKey?: string;
}) {
  const requestedStart = new Date(input.startsAt);
  if (Number.isNaN(requestedStart.getTime())) {
    throw publicError("BOOKING_SLOT_INVALID", "That time is no longer available.", 400);
  }

  return prisma.$transaction(async (tx) => {
    const link = await tx.customerBookingLink.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: {
        shop: true,
        customer: true,
        vehicle: true,
      },
    });
    if (!link || link.status !== "ACTIVE" || link.revokedAt || link.expiresAt <= new Date()) {
      throw publicError("BOOKING_LINK_INVALID", "This booking link is no longer valid.", 404);
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-booking:${link.shopId}:${input.startsAt}`}))`;

    const context = await getPublicAvailability(token, input.intakeType, input.extraMaintenanceRecordIds ?? []);
    const selectedSlot = context.find((slot) => slot.startsAt === requestedStart.toISOString());
    if (!selectedSlot) {
      throw publicError("BOOKING_SLOT_TAKEN", "That time is no longer available. Please choose another.", 409);
    }

    const maintenanceRecords = await tx.vehicleMaintenanceRecord.findMany({
      where: {
        shopId: link.shopId,
        id: { in: [...link.maintenanceRecordIds, ...(input.extraMaintenanceRecordIds ?? [])] },
      },
      include: { serviceDefinition: { include: { bookingRule: { include: { windows: true } } } } },
    });
    const declinedWorkRecords = await tx.declinedWorkRecord.findMany({
      where: { shopId: link.shopId, id: { in: link.declinedWorkRecordIds } },
    });
    const rules = maintenanceRecords
      .map((record) => record.serviceDefinition?.bookingRule ? mapServiceRule(record.serviceDefinition.bookingRule) : undefined)
      .filter((rule): rule is ServiceBookingRule => Boolean(rule));
    const mode = getBookingMode(rules);
    const totalLaborMinutes = maintenanceRecords.reduce((sum, record) => sum + record.laborMinutes, 0) +
      declinedWorkRecords.reduce((sum, record) => sum + record.laborMinutes, 0);
    const totalPriceCents = maintenanceRecords.reduce((sum, record) => sum + record.priceCents, 0) +
      declinedWorkRecords.reduce((sum, record) => sum + record.recommendedPriceCents, 0);
    const appointmentStatus = mode === "INSTANT" ? "CONFIRMED" as const : "REQUESTED" as const;

    const existing = await tx.appointment.findFirst({
      where: {
        shopId: link.shopId,
        bookingLinkId: link.id,
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
    });
    if (existing) {
      throw publicError("BOOKING_DUPLICATE", "Your appointment could not be created.", 409);
    }

    const appointment = await tx.appointment.create({
      data: {
        shopId: link.shopId,
        customerId: link.customerId,
        vehicleId: link.vehicleId,
        scheduledStart: new Date(selectedSlot.startsAt),
        scheduledEnd: new Date(selectedSlot.endsAt),
        status: appointmentStatus,
        totalLaborMinutes,
        totalPriceCents,
        source: "CUSTOMER_BOOKING",
        attributionSource: "MAINTIVA_OUTREACH",
        opportunityId: link.opportunityId,
        bookingLinkId: link.id,
        intakeType: input.intakeType,
        customerNotes: input.customerNotes || null,
        requestedAt: new Date(),
        approvedAt: appointmentStatus === "CONFIRMED" ? new Date() : null,
        notes: input.customerNotes || null,
        services: {
          create: [
            ...maintenanceRecords.map((record) => ({
              shopId: link.shopId,
              serviceDefinitionId: record.serviceDefinitionId,
              maintenanceRecordId: record.id,
              serviceName: record.serviceName,
              laborMinutes: record.laborMinutes,
              priceCents: record.priceCents,
            })),
            ...declinedWorkRecords.map((record) => ({
              shopId: link.shopId,
              serviceDefinitionId: null,
              maintenanceRecordId: null,
              serviceName: record.serviceName,
              laborMinutes: record.laborMinutes,
              priceCents: record.recommendedPriceCents,
            })),
          ],
        },
      },
    });

    await tx.customerBookingLink.update({
      where: { id: link.id },
      data: {
        usedAt: new Date(),
        bookingCompletedAt: appointmentStatus === "CONFIRMED" ? new Date() : null,
        appointmentId: appointment.id,
        status: appointmentStatus === "CONFIRMED" ? "COMPLETED" : "ACTIVE",
      },
    });
    if (appointmentStatus === "CONFIRMED") {
      if (maintenanceRecords.length > 0) {
        await tx.vehicleMaintenanceRecord.updateMany({
          where: { shopId: link.shopId, id: { in: maintenanceRecords.map((record) => record.id) } },
          data: { outreachStatus: "SCHEDULED", appointmentId: appointment.id },
        });
      }
      if (declinedWorkRecords.length > 0) {
        await tx.declinedWorkRecord.updateMany({
          where: { shopId: link.shopId, id: { in: declinedWorkRecords.map((record) => record.id) } },
          data: { outreachStatus: "SCHEDULED", status: "BOOKED", appointmentId: appointment.id },
        });
      }
      await tx.maintenanceRevenueOpportunity.updateMany({
        where: {
          shopId: link.shopId,
          OR: [
            link.opportunityId ? { id: link.opportunityId } : undefined,
            link.maintenanceRecordIds.length ? { maintenanceRecordId: { in: link.maintenanceRecordIds } } : undefined,
            link.declinedWorkRecordIds.length ? { declinedWorkRecordId: { in: link.declinedWorkRecordIds } } : undefined,
          ].filter((item): item is Exclude<typeof item, undefined> => Boolean(item)),
        },
        data: { stage: "BOOKED", lastActivityAt: new Date() },
      });
    } else {
      await tx.maintenanceRevenueOpportunity.updateMany({
        where: {
          shopId: link.shopId,
          OR: [
            link.opportunityId ? { id: link.opportunityId } : undefined,
            link.maintenanceRecordIds.length ? { maintenanceRecordId: { in: link.maintenanceRecordIds } } : undefined,
            link.declinedWorkRecordIds.length ? { declinedWorkRecordId: { in: link.declinedWorkRecordIds } } : undefined,
          ].filter((item): item is Exclude<typeof item, undefined> => Boolean(item)),
        },
        data: { stage: "RESPONDED", lastActivityAt: new Date() },
      });
    }

    return {
      id: appointment.id,
      status: appointment.status,
      startsAt: appointment.scheduledStart.toISOString(),
    };
  });
}

export async function cancelPublicAppointment(token: string, reason?: string) {
  const link = await loadBookingLink(token, { allowBooked: true });
  if (!link.appointmentId) {
    throw publicError("BOOKING_APPOINTMENT_MISSING", "This booking link is no longer valid.", 404);
  }
  await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: { id: link.appointmentId!, shopId: link.shopId, bookingLinkId: link.id },
    });
    if (!appointment || appointment.status === "COMPLETED") {
      throw publicError("BOOKING_APPOINTMENT_MISSING", "This booking link is no longer valid.", 404);
    }
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        customerCancelledAt: new Date(),
      },
    });
    await tx.appointmentChangeRecord.create({
      data: {
        shopId: link.shopId,
        appointmentId: appointment.id,
        bookingLinkId: link.id,
        action: "CUSTOMER_CANCELLED",
        previousStart: appointment.scheduledStart,
        previousEnd: appointment.scheduledEnd,
        reason,
      },
    });
    if (link.opportunityId) {
      await tx.maintenanceRevenueOpportunity.updateMany({
        where: { shopId: link.shopId, id: link.opportunityId },
        data: { stage: "RESPONDED", lastActivityAt: new Date() },
      });
    }
  });
}

export async function reschedulePublicAppointment(token: string, input: {
  startsAt: string;
  intakeType: BookingIntakeType;
  customerNotes?: string;
}) {
  const link = await loadBookingLink(token, { allowBooked: true });
  if (!link.appointmentId) {
    throw publicError("BOOKING_APPOINTMENT_MISSING", "This booking link is no longer valid.", 404);
  }
  const availability = await getPublicAvailability(token, input.intakeType);
  const selected = availability.find((slot) => slot.startsAt === new Date(input.startsAt).toISOString());
  if (!selected) {
    throw publicError("BOOKING_SLOT_TAKEN", "That time is no longer available. Please choose another.", 409);
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-booking:${link.shopId}:${selected.startsAt}`}))`;
    const appointment = await tx.appointment.findFirst({
      where: { id: link.appointmentId!, shopId: link.shopId, bookingLinkId: link.id },
    });
    if (!appointment || ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status)) {
      throw publicError("BOOKING_APPOINTMENT_MISSING", "This booking link is no longer valid.", 404);
    }
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        scheduledStart: new Date(selected.startsAt),
        scheduledEnd: new Date(selected.endsAt),
        intakeType: input.intakeType,
        customerNotes: input.customerNotes || appointment.customerNotes,
        notes: input.customerNotes || appointment.notes,
        rescheduledAt: new Date(),
      },
    });
    await tx.appointmentChangeRecord.create({
      data: {
        shopId: link.shopId,
        appointmentId: appointment.id,
        bookingLinkId: link.id,
        action: "CUSTOMER_RESCHEDULED",
        previousStart: appointment.scheduledStart,
        previousEnd: appointment.scheduledEnd,
        newStart: new Date(selected.startsAt),
        newEnd: new Date(selected.endsAt),
      },
    });
  });
}
