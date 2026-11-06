import { describe, expect, it } from "vitest";
import type { OutreachRecord } from "@/lib/demo-data";
import { groupMessageActivity, messageStatus, needsMessageAttention } from "@/lib/message-activity";

const attempt: OutreachRecord = {
  id: "one", shopId: "shop", customerId: "customer", vehicleId: "vehicle",
  maintenanceRecordIds: ["oil"], serviceNames: ["Oil Change"], message: "Your oil service is due.",
  channel: "TEXT", sentAt: "2026-11-05T12:00:00Z", responseStatus: "NO_RESPONSE",
  status: "DRAFTED", smsDeliveryStatus: "FAILED", smsFailureCode: "SMS_PROVIDER_NOT_CONFIGURED",
};

describe("message activity", () => {
  it("groups matching failures without discarding or mutating original attempts", () => {
    const records = [attempt, { ...attempt, id: "two", sentAt: "2026-11-05T13:00:00Z" }];
    const before = structuredClone(records);
    const groups = groupMessageActivity(records, "shop");
    expect(groups).toHaveLength(1);
    expect(groups[0].attempts.map((record) => record.id)).toEqual(["two", "one"]);
    expect(records).toEqual(before);
  });
  it.each([
    { customerId: "other" }, { vehicleId: "other" }, { message: "Changed draft" },
    { serviceNames: ["Brakes"] }, { opportunityId: "another-cycle" },
    { smsRecipientPhone: "+15555550100" }, { sentAt: "2026-11-06T12:00:00Z" },
  ])("keeps distinct attempts separate: %j", (change) => {
    expect(groupMessageActivity([attempt, { ...attempt, ...change, id: "two" }], "shop")).toHaveLength(2);
  });
  it("does not collapse successful contacts or include another shop", () => {
    const sent = { ...attempt, smsDeliveryStatus: "SENT" as const, smsFailureCode: undefined };
    expect(groupMessageActivity([sent, { ...sent, id: "two" }, { ...attempt, shopId: "other" }], "shop")).toHaveLength(2);
  });
  it("labels disconnected attempts honestly and identifies actionable responses", () => {
    expect(messageStatus(attempt)).toBe("Not sent");
    expect(needsMessageAttention(attempt)).toBe(true);
    expect(needsMessageAttention({ ...attempt, smsDeliveryStatus: "DELIVERED", responseStatus: "WANTS_CALLBACK" })).toBe(true);
    expect(needsMessageAttention({ ...attempt, smsDeliveryStatus: "DELIVERED" })).toBe(false);
  });
});
