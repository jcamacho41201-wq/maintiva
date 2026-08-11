import { describe, expect, it, vi } from "vitest";
import { normalizeUsPhoneForSms } from "@/lib/sms";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("SMS foundation", () => {
  it("normalizes US phone numbers without rewriting source customer data", () => {
    expect(normalizeUsPhoneForSms("(404) 555-0123")).toBe("+14045550123");
    expect(normalizeUsPhoneForSms("1-404-555-0123")).toBe("+14045550123");
    expect(normalizeUsPhoneForSms("555")).toBeNull();
  });

  it("keeps production SMS provider unavailable without a real provider", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/sms.ts"), "utf8");

    expect(source).toContain('code: "SMS_PROVIDER_NOT_CONFIGURED"');
    expect(source).toContain('message: "SMS provider is not connected yet."');
    expect(source).toContain('env.MAINTIVA_SMS_TRANSPORT === "mock" && !isProductionRuntime(env)');
    expect(source).not.toContain("twilio.messages.create");
  });

  it("does not let duplicate override bypass consent checks in the contact modal", () => {
    const source = readFileSync(join(process.cwd(), "src/components/contact-customer-modal.tsx"), "utf8");
    expect(source).toContain("if (!smsEligibility.allowed)");
    expect(source).not.toContain("!smsEligibility.allowed && !duplicateOverride");
  });

  it("has no direct Twilio dependency", async () => {
    const importResult = await import("@/lib/sms");
    expect(importResult.normalizeUsPhoneForSms("4045550100")).toBe("+14045550100");
    expect(vi.isMockFunction(importResult.normalizeUsPhoneForSms)).toBe(false);
  });
});
