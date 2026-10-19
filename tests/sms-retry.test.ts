import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedShopContext } from "@/lib/auth";

const db = vi.hoisted(() => ({ customer: { findFirst: vi.fn() }, vehicle: { findFirst: vi.fn() }, maintenanceRevenueOpportunity: { findMany: vi.fn() }, outreachRecord: { findFirst: vi.fn() }, $transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
import { sendPilotCustomerSms } from "@/lib/sms";
const context: AuthenticatedShopContext = { userId: "advisor", email: "qa@example.test", shopId: "s", shopName: "QA", shopTimezone: "UTC", role: "SERVICE_ADVISOR", isDemo: false };
const input = { customerId: "c", vehicleId: "v", opportunityIds: ["opp"], message: "Test draft", idempotencyKey: "send-key" };
beforeEach(() => {
  vi.clearAllMocks();
  db.customer.findFirst.mockResolvedValue({ id: "c", shopId: "s", phone: "2025550100", smsConsentStatus: "OPTED_IN" });
  db.vehicle.findFirst.mockResolvedValue({ id: "v" });
  db.maintenanceRevenueOpportunity.findMany.mockResolvedValue([{ id: "opp" }]);
  db.outreachRecord.findFirst.mockResolvedValueOnce(null);
});
describe("SMS retry outcomes", () => {
  it("does not turn a previously failed provider attempt into success", async () => {
    db.outreachRecord.findFirst.mockResolvedValueOnce({ id: "failed", customerId: "c", vehicleId: "v", smsDeliveryStatus: "FAILED", smsFailureCode: "SMS_PROVIDER_NOT_CONFIGURED" });
    await expect(sendPilotCustomerSms(context, input)).rejects.toMatchObject({ code: "SMS_PROVIDER_NOT_CONFIGURED", message: "SMS provider is not connected yet." });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("rejects a send key used for another customer", async () => {
    db.outreachRecord.findFirst.mockResolvedValueOnce({ id: "sent", customerId: "other", vehicleId: "v", smsDeliveryStatus: "SENT" });
    await expect(sendPilotCustomerSms(context, input)).rejects.toMatchObject({ code: "SMS_PROVIDER_FAILED" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
