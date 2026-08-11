import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedShopContext } from "@/lib/auth";
import { SafeActionError } from "@/lib/server-diagnostics";

export type SmsErrorCode =
  | "SMS_NO_PHONE"
  | "SMS_INVALID_PHONE"
  | "SMS_OPTED_OUT"
  | "SMS_CONSENT_REQUIRED"
  | "SMS_EMPTY_MESSAGE"
  | "SMS_PROVIDER_NOT_CONFIGURED"
  | "SMS_DUPLICATE_WARNING"
  | "SMS_PROVIDER_FAILED";

type SendSmsInput = {
  customerId: string;
  vehicleId: string;
  opportunityIds: string[];
  message: string;
  appointmentRequestLinkId?: string;
  idempotencyKey?: string;
  duplicateOverride?: boolean;
};

type SmsTransportResult = {
  provider: string;
  status: "SIMULATED" | "QUEUED" | "SENT";
  providerMessageId?: string;
};

interface SmsProvider {
  send(input: { to: string; body: string; shopId: string; customerId: string }): Promise<SmsTransportResult>;
}

class MockSmsProvider implements SmsProvider {
  async send(): Promise<SmsTransportResult> {
    return {
      provider: "mock",
      status: "SIMULATED",
      providerMessageId: `mock-${Date.now()}`,
    };
  }
}

export function normalizeUsPhoneForSms(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length !== 10) return null;
  return `+1${normalized}`;
}

function isProductionRuntime(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

function configuredSmsProvider(env: NodeJS.ProcessEnv = process.env): SmsProvider | null {
  if (env.MAINTIVA_SMS_TRANSPORT === "mock" && !isProductionRuntime(env)) {
    return new MockSmsProvider();
  }
  return null;
}

async function sendWithConfiguredTransport(input: { to: string; body: string; shopId: string; customerId: string }, env: NodeJS.ProcessEnv = process.env): Promise<SmsTransportResult> {
  const provider = configuredSmsProvider(env);
  if (provider) return provider.send(input);
  throw new SafeActionError({
    code: "SMS_PROVIDER_NOT_CONFIGURED",
    message: "SMS provider is not connected yet.",
    status: 409,
    table: "OutreachRecord",
    operation: "INSERT",
  });
}

function smsActionError(code: SmsErrorCode, message: string, status = 400) {
  return new SafeActionError({
    code,
    message,
    status,
    table: "OutreachRecord",
    operation: "INSERT",
  });
}

function smsStatusFromProvider(status: SmsTransportResult["status"]) {
  return status === "SIMULATED" ? "SIMULATED" : status;
}

export async function recordPilotCustomerSmsConsent(
  context: AuthenticatedShopContext,
  input: {
    customerId: string;
    status: "OPTED_IN" | "OPTED_OUT" | "UNKNOWN";
    source?: "STAFF_RECORDED" | "CUSTOMER_REQUEST" | "PAPER_FORM" | "VERBAL" | "EXISTING_CUSTOMER_RECORD" | "OTHER";
  },
) {
  const existing = await prisma.customer.findFirst({
    where: { id: input.customerId, shopId: context.shopId, archivedAt: null },
    select: { id: true },
  });
  if (!existing) {
    throw smsActionError("SMS_CONSENT_REQUIRED", "Customer was not found in this shop.", 404);
  }

  await prisma.customer.update({
    where: { id: input.customerId },
    data: {
      smsConsentStatus: input.status,
      smsConsent: input.status === "OPTED_IN",
      smsConsentSource: input.status === "UNKNOWN" ? null : input.source ?? "STAFF_RECORDED",
      smsConsentRecordedAt: input.status === "UNKNOWN" ? null : new Date(),
      smsConsentRecordedByUserId: input.status === "UNKNOWN" ? null : context.userId,
    },
    select: { id: true },
  });
}

export async function sendPilotCustomerSms(context: AuthenticatedShopContext, input: SendSmsInput) {
  const body = input.message.trim();
  if (body.length < 3) {
    throw smsActionError("SMS_EMPTY_MESSAGE", "Add a message before sending a text.");
  }

  const [customer, vehicle, opportunities, requestLink] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: input.customerId, shopId: context.shopId, archivedAt: null },
      select: {
        id: true,
        shopId: true,
        phone: true,
        smsConsentStatus: true,
      },
    }),
    prisma.vehicle.findFirst({
      where: { id: input.vehicleId, shopId: context.shopId, customerId: input.customerId, archivedAt: null },
      select: { id: true },
    }),
    prisma.maintenanceRevenueOpportunity.findMany({
      where: {
        id: { in: input.opportunityIds },
        shopId: context.shopId,
        customerId: input.customerId,
        vehicleId: input.vehicleId,
        stage: { in: ["IDENTIFIED", "CONTACTED", "RESPONDED"] },
      },
      select: { id: true },
    }),
    input.appointmentRequestLinkId
      ? prisma.appointmentRequestLink.findFirst({
          where: {
            id: input.appointmentRequestLinkId,
            shopId: context.shopId,
            customerId: input.customerId,
            vehicleId: input.vehicleId,
            status: "ACTIVE",
          },
          select: { id: true, opportunityId: true },
        })
      : Promise.resolve(null),
  ]);

  if (!customer || !vehicle || opportunities.length !== input.opportunityIds.length) {
    throw smsActionError("SMS_PROVIDER_FAILED", "Selected opportunity is no longer available.", 404);
  }
  if (input.appointmentRequestLinkId && !requestLink) {
    throw smsActionError("SMS_PROVIDER_FAILED", "Appointment request link is no longer available.", 404);
  }
  if (!customer.phone?.trim()) {
    throw smsActionError("SMS_NO_PHONE", "Customer does not have a phone number.");
  }
  const normalizedPhone = normalizeUsPhoneForSms(customer.phone);
  if (!normalizedPhone) {
    throw smsActionError("SMS_INVALID_PHONE", "Customer phone number is not valid for SMS.");
  }
  if (customer.smsConsentStatus === "OPTED_OUT") {
    throw smsActionError("SMS_OPTED_OUT", "Customer opted out of SMS.");
  }
  if (customer.smsConsentStatus !== "OPTED_IN") {
    throw smsActionError("SMS_CONSENT_REQUIRED", "SMS consent not recorded.");
  }

  const primaryOpportunityId = input.opportunityIds[0];
  const duplicateWindow = new Date(Date.now() - 30 * 60_000);
  const recentDuplicate = await prisma.outreachRecord.findFirst({
    where: {
      shopId: context.shopId,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      opportunityId: primaryOpportunityId,
      channel: "TEXT",
      smsDeliveryStatus: { in: ["QUEUED", "SENT", "SIMULATED"] },
      createdAt: { gte: duplicateWindow },
    },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (recentDuplicate && !input.duplicateOverride) {
    throw smsActionError("SMS_DUPLICATE_WARNING", "A text was already sent recently. Use Send Again to override.", 409);
  }

  const existingForKey = input.idempotencyKey
    ? await prisma.outreachRecord.findFirst({
        where: { shopId: context.shopId, smsIdempotencyKey: input.idempotencyKey },
        select: { id: true },
      })
    : null;
  if (existingForKey) return { outreachRecordId: existingForKey.id, simulated: false };

  let providerResult: SmsTransportResult | undefined;
  let providerError: SafeActionError | undefined;
  try {
    providerResult = await sendWithConfiguredTransport({
      to: normalizedPhone,
      body,
      shopId: context.shopId,
      customerId: input.customerId,
    });
  } catch (error) {
    if (error instanceof SafeActionError) {
      providerError = error;
    } else {
      providerError = smsActionError("SMS_PROVIDER_FAILED", "SMS provider failed.", 502);
    }
  }

  const now = new Date();
  const outreachData: Prisma.OutreachRecordCreateInput = {
    shop: { connect: { id: context.shopId } },
    customer: { connect: { id: input.customerId } },
    vehicle: { connect: { id: input.vehicleId } },
    message: body,
    channel: "TEXT",
    status: providerResult ? "MANUALLY_SENT" : "DRAFTED",
    copiedAt: null,
    manuallySentAt: providerResult ? now : null,
    responseStatus: "NO_RESPONSE",
    performedBy: { connect: { id: context.userId } },
    opportunity: { connect: { id: primaryOpportunityId } },
    appointmentRequestLink: input.appointmentRequestLinkId ? { connect: { id: input.appointmentRequestLinkId } } : undefined,
    smsRecipientPhone: normalizedPhone,
    smsProvider: providerResult?.provider,
    smsDeliveryStatus: providerResult ? smsStatusFromProvider(providerResult.status) : "FAILED",
    smsSentAt: providerResult ? now : null,
    smsFailureCode: providerError?.code,
    smsFailureMessage: providerError?.message,
    smsIdempotencyKey: input.idempotencyKey,
    providerExternalId: providerResult?.providerMessageId,
    providerPayload: providerResult ? { transport: providerResult.provider, simulated: providerResult.status === "SIMULATED" } : undefined,
  };

  const created = await prisma.$transaction(async (tx) => {
    const outreach = await tx.outreachRecord.create({
      data: outreachData,
      select: { id: true },
    });
    if (providerResult) {
      await tx.maintenanceRevenueOpportunity.updateMany({
        where: { id: { in: input.opportunityIds }, shopId: context.shopId },
        data: { stage: "CONTACTED", lastActivityAt: now },
      });
    }
    return outreach;
  });

  if (providerError) throw providerError;
  return { outreachRecordId: created.id, simulated: providerResult?.status === "SIMULATED" };
}
