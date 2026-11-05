import type { OutreachRecord } from "@/lib/demo-data";

export function messageStatus(record: OutreachRecord) {
  if (record.smsFailureCode === "SMS_PROVIDER_NOT_CONFIGURED") return "Not sent";
  return (record.smsDeliveryStatus ?? record.status).toLowerCase().replaceAll("_", " ");
}

export function needsMessageAttention(record: OutreachRecord) {
  return record.smsDeliveryStatus === "FAILED" ||
    ["INTERESTED", "WANTS_CALLBACK", "WRONG_CONTACT"].includes(record.responseStatus);
}

// Group failures for display only. Never combine different recipients or service cycles.
export function groupMessageActivity(records: OutreachRecord[], shopId: string) {
  const groups = new Map<string, OutreachRecord[]>();
  for (const record of records.filter((item) => item.shopId === shopId)) {
    const key = record.smsDeliveryStatus === "FAILED"
      ? JSON.stringify([record.shopId, record.customerId, record.vehicleId, record.channel,
        [...record.maintenanceRecordIds].sort(), [...record.serviceNames].sort(),
        record.opportunityId, record.appointmentRequestLinkId, record.message,
        record.smsRecipientPhone, record.smsFailureCode, record.smsFailureMessage,
        record.sentAt.slice(0, 10)])
      : record.id;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return [...groups.values()].map((attempts) => {
    attempts.sort((a, b) => b.sentAt.localeCompare(a.sentAt) || a.id.localeCompare(b.id));
    return { id: attempts[0].id, latest: attempts[0], attempts };
  }).sort((a, b) => b.latest.sentAt.localeCompare(a.latest.sentAt));
}
