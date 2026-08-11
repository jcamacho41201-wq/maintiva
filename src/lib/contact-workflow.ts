import type { Customer, OutreachChannel } from "@/lib/demo-data";

export type ContactWorkflowChannel = Extract<OutreachChannel, "TEXT" | "EMAIL" | "CALL">;

export type ContactChannelAvailability = {
  channel: ContactWorkflowChannel;
  label: string;
  available: boolean;
  reason?: string;
};

function hasValue(value: string | null | undefined) {
  return Boolean(value?.trim());
}

export function smsConsentStatus(customer: Customer) {
  return customer.smsConsentStatus ?? "UNKNOWN";
}

export function canSendSmsToCustomer(customer: Customer) {
  if (!hasValue(customer.phone)) return { allowed: false, code: "SMS_NO_PHONE" as const, reason: "Missing phone number" };
  if (smsConsentStatus(customer) === "OPTED_OUT") return { allowed: false, code: "SMS_OPTED_OUT" as const, reason: "Customer opted out" };
  if (smsConsentStatus(customer) !== "OPTED_IN") return { allowed: false, code: "SMS_CONSENT_REQUIRED" as const, reason: "SMS consent not recorded" };
  return { allowed: true, code: undefined, reason: undefined };
}

export function availableContactChannels(customer: Customer): ContactChannelAvailability[] {
  const sms = canSendSmsToCustomer(customer);
  return [
    {
      channel: "TEXT",
      label: "Text",
      available: sms.allowed,
      reason: sms.reason,
    },
    {
      channel: "EMAIL",
      label: "Email",
      available: customer.emailConsent && hasValue(customer.email),
      reason: !hasValue(customer.email) ? "Missing email address" : "Email consent not enabled",
    },
    {
      channel: "CALL",
      label: "Call",
      available: customer.callConsent && hasValue(customer.phone),
      reason: !hasValue(customer.phone) ? "Missing phone number" : "Call consent not enabled",
    },
  ];
}

export function defaultContactChannel(customer: Customer): ContactWorkflowChannel | null {
  const channels = availableContactChannels(customer);
  const preferred = customer.preferredContact === "SMS" ? "TEXT" : customer.preferredContact;
  return channels.find((item) => item.channel === preferred && item.available)?.channel
    ?? channels.find((item) => item.available)?.channel
    ?? null;
}

export function canContactCustomerForDraft(customer: Customer) {
  const channels = availableContactChannels(customer);
  if (channels.some((item) => item.available)) {
    return { enabled: true, reason: undefined };
  }
  return {
    enabled: false,
    reason: "Add a permitted phone, email, or call channel before contacting this customer.",
  };
}
