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

export function availableContactChannels(customer: Customer): ContactChannelAvailability[] {
  return [
    {
      channel: "TEXT",
      label: "Text",
      available: customer.smsConsent && hasValue(customer.phone),
      reason: !hasValue(customer.phone) ? "Missing phone number" : "SMS consent not enabled",
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
