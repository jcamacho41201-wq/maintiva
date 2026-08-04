import { describe, expect, it } from "vitest";
import type { AppointmentRequestRecord } from "@/lib/demo-data";
import {
  appointmentRequestCommitments,
  assertRequestTokenScope,
  isAppointmentRequestActive,
  publicAppointmentRequestContext,
  publicTokenState,
} from "@/lib/appointment-requests";
import {
  appointmentRequestIdempotencyKey,
  appointmentRequestPathPrefix,
  appointmentRequestUrl,
  createAppointmentRequestToken,
  hashAppointmentRequestToken,
} from "@/lib/appointment-request-tokens";

function request(overrides: Partial<AppointmentRequestRecord> = {}): AppointmentRequestRecord {
  return {
    id: "request-1",
    shopId: "shop-a",
    customerId: "customer-a",
    vehicleId: "vehicle-a",
    opportunityId: "opportunity-a",
    smartMaintenanceBlockId: "block-a",
    requestLinkId: "link-a",
    requestedStart: "2026-08-11T12:00:00.000Z",
    requestedEnd: "2026-08-11T13:00:00.000Z",
    shopTimezone: "America/New_York",
    totalLaborMinutes: 60,
    estimatedRevenueCents: 18900,
    status: "PENDING",
    source: "MAINTENANCE_REQUEST_LINK",
    expiresAt: "2026-08-12T12:00:00.000Z",
    customerSubmittedAt: "2026-08-04T12:00:00.000Z",
    services: [{
      id: "request-service-1",
      shopId: "shop-a",
      appointmentRequestId: "request-1",
      smartMaintenanceBlockId: "block-a",
      serviceDefinitionId: "svc-oil",
      serviceNameSnapshot: "Oil Change",
      laborMinutes: 60,
      priceCents: 18900,
      createdAt: "2026-08-04T12:00:00.000Z",
    }],
    createdAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:00:00.000Z",
    ...overrides,
  };
}

describe("appointment request security helpers", () => {
  it("creates opaque request URLs without internal identifiers", () => {
    const token = createAppointmentRequestToken();
    const url = appointmentRequestUrl("https://maintiva.example/", token);

    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(url).toBe(`https://maintiva.example${appointmentRequestPathPrefix}${token}`);
    expect(url).not.toContain("shop-a");
    expect(url).not.toContain("customer-a");
    expect(url).not.toContain("vehicle-a");
    expect(url).not.toContain("opportunity-a");
  });

  it("hashes tokens and derives stable idempotency keys", () => {
    const hash = hashAppointmentRequestToken("token-value");

    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashAppointmentRequestToken("token-value"));
    expect(hash).not.toBe(hashAppointmentRequestToken("other-token"));
    expect(appointmentRequestIdempotencyKey(hash, "2026-08-11T12:00:00.000Z", "retry-1"))
      .toBe(appointmentRequestIdempotencyKey(hash, "2026-08-11T12:00:00.000Z", "retry-1"));
  });

  it("returns safe public token states", () => {
    const now = new Date("2026-08-04T12:00:00.000Z");

    expect(publicTokenState({ status: "ACTIVE", expiresAt: "2026-08-05T12:00:00.000Z" }, now)).toBe("valid");
    expect(publicTokenState({ status: "REVOKED", expiresAt: "2026-08-05T12:00:00.000Z" }, now)).toBe("revoked");
    expect(publicTokenState({ status: "USED", expiresAt: "2026-08-05T12:00:00.000Z" }, now)).toBe("used");
    expect(publicTokenState({ status: "ACTIVE", expiresAt: "2026-08-04T11:59:59.000Z" }, now)).toBe("expired");
  });

  it("keeps token scope locked to one tenant target", () => {
    const link = {
      shopId: "shop-a",
      customerId: "customer-a",
      vehicleId: "vehicle-a",
      opportunityId: "opportunity-a",
    };

    expect(assertRequestTokenScope(link, link)).toBe(true);
    expect(assertRequestTokenScope(link, { ...link, shopId: "shop-b" })).toBe(false);
    expect(assertRequestTokenScope(link, { ...link, customerId: "customer-b" })).toBe(false);
    expect(assertRequestTokenScope(link, { ...link, vehicleId: "vehicle-b" })).toBe(false);
    expect(assertRequestTokenScope(link, { ...link, opportunityId: "opportunity-b" })).toBe(false);
  });

  it("turns only active unconverted requests into capacity commitments", () => {
    const now = new Date("2026-08-04T12:00:00.000Z");

    expect(isAppointmentRequestActive(request(), now)).toBe(true);
    expect(isAppointmentRequestActive(request({ status: "ALTERNATE_PROPOSED" }), now)).toBe(true);
    expect(isAppointmentRequestActive(request({ status: "DECLINED" }), now)).toBe(false);
    expect(isAppointmentRequestActive(request({ expiresAt: "2026-08-04T11:59:59.000Z" }), now)).toBe(false);
    expect(isAppointmentRequestActive(request({ finalAppointmentId: "appt-1" }), now)).toBe(false);

    expect(appointmentRequestCommitments([
      request(),
      request({ id: "request-2", status: "DECLINED" }),
      request({ id: "request-3", finalAppointmentId: "appt-1" }),
    ], now)).toEqual([{
      id: "request-1",
      shopId: "shop-a",
      blockId: "block-a",
      startsAt: "2026-08-11T12:00:00.000Z",
      endsAt: "2026-08-11T13:00:00.000Z",
      status: "PENDING",
      vehicleCount: 1,
      laborMinutes: 60,
    }]);
  });

  it("reserves alternate capacity instead of the original requested time", () => {
    const now = new Date("2026-08-04T12:00:00.000Z");
    const [proposed, accepted] = appointmentRequestCommitments([
      request({
        status: "ALTERNATE_PROPOSED",
        alternateProposedStart: "2026-08-12T14:00:00.000Z",
        alternateProposedEnd: "2026-08-12T15:00:00.000Z",
      }),
      request({
        id: "request-accepted",
        status: "CUSTOMER_ACCEPTED_ALTERNATE",
        alternateProposedStart: "2026-08-12T16:00:00.000Z",
        alternateProposedEnd: "2026-08-12T17:00:00.000Z",
      }),
    ], now);

    expect(proposed.startsAt).toBe("2026-08-12T14:00:00.000Z");
    expect(proposed.endsAt).toBe("2026-08-12T15:00:00.000Z");
    expect(proposed.status).toBe("PENDING");
    expect(accepted.startsAt).toBe("2026-08-12T16:00:00.000Z");
    expect(accepted.endsAt).toBe("2026-08-12T17:00:00.000Z");
    expect(accepted.status).toBe("APPROVED");
  });

  it("strips internal fields from public request context responses", () => {
    const context = publicAppointmentRequestContext({
      shop: { id: "shop-a", name: "Cedar Bay Auto Works", internalNotes: "private" },
      customer: { id: "customer-a", firstName: "Justin", email: "private@example.com", phone: "555-0100" },
      vehicle: { id: "vehicle-a", year: 2020, make: "Jeep", model: "Wrangler", vin: "private-vin" },
      services: [{ id: "svc-oil", name: "Oil Change", laborMinutes: 45, priceCents: 9900, internalNotes: "private" }],
      slots: [{ id: "slot-1", startsAt: "2026-08-11T12:00:00.000Z", label: "8:00 AM", dateLabel: "Tuesday, August 11", remainingVehicles: 1 }],
      notice: "This is an appointment request. The shop will confirm the time after reviewing its schedule.",
    });

    expect(context).toEqual({
      shop: { name: "Cedar Bay Auto Works" },
      customer: { firstName: "Justin" },
      vehicle: { year: 2020, make: "Jeep", model: "Wrangler" },
      services: [{ name: "Oil Change", laborMinutes: 45 }],
      slots: [{ startsAt: "2026-08-11T12:00:00.000Z", label: "8:00 AM", dateLabel: "Tuesday, August 11" }],
      notice: "This is an appointment request. The shop will confirm the time after reviewing its schedule.",
    });
    expect(JSON.stringify(context)).not.toContain("shop-a");
    expect(JSON.stringify(context)).not.toContain("customer-a");
    expect(JSON.stringify(context)).not.toContain("vehicle-a");
    expect(JSON.stringify(context)).not.toContain("private@example.com");
    expect(JSON.stringify(context)).not.toContain("remainingVehicles");
  });
});
