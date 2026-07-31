import { describe, expect, it } from "vitest";
import { availableContactChannels, canContactCustomerForDraft, defaultContactChannel } from "@/lib/contact-workflow";
import { createInitialDemoState, type Customer } from "@/lib/demo-data";

function customer(overrides: Partial<Customer>): Customer {
  return {
    ...createInitialDemoState().customers[0],
    phone: "(347) 555-1046",
    email: "logan.bailey.47@example.com",
    preferredContact: "EMAIL",
    smsConsent: true,
    emailConsent: true,
    callConsent: true,
    ...overrides,
  };
}

describe("contact workflow eligibility", () => {
  it("defaults fully contactable email-preferred customers to email while keeping text and call available", () => {
    const result = customer({});

    expect(defaultContactChannel(result)).toBe("EMAIL");
    expect(availableContactChannels(result).filter((item) => item.available).map((item) => item.channel)).toEqual([
      "TEXT",
      "EMAIL",
      "CALL",
    ]);
    expect(canContactCustomerForDraft(result).enabled).toBe(true);
  });

  it("keeps email-only customers eligible and selects email", () => {
    const result = customer({
      phone: "",
      preferredContact: "SMS",
      smsConsent: false,
      emailConsent: true,
      callConsent: false,
    });

    expect(canContactCustomerForDraft(result).enabled).toBe(true);
    expect(defaultContactChannel(result)).toBe("EMAIL");
  });

  it("keeps phone-only customers eligible through available phone channels", () => {
    const result = customer({
      email: "",
      preferredContact: "EMAIL",
      smsConsent: true,
      emailConsent: false,
      callConsent: true,
    });

    expect(canContactCustomerForDraft(result).enabled).toBe(true);
    expect(defaultContactChannel(result)).toBe("TEXT");
  });

  it("explains customers with no valid channel", () => {
    const result = customer({
      phone: "",
      email: "",
      smsConsent: true,
      emailConsent: true,
      callConsent: true,
    });

    expect(defaultContactChannel(result)).toBeNull();
    expect(canContactCustomerForDraft(result)).toEqual({
      enabled: false,
      reason: "Add a permitted phone, email, or call channel before contacting this customer.",
    });
  });
});
