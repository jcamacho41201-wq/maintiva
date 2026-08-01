import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientMutationError, safeMutationOperation } from "@/lib/server-diagnostics";

const pilotStateSource = readFileSync(join(process.cwd(), "src/lib/pilot-state.ts"), "utf8");
const mutateRouteSource = readFileSync(join(process.cwd(), "src/app/api/pilot/mutate/route.ts"), "utf8");
const demoStoreSource = readFileSync(join(process.cwd(), "src/lib/demo-store.ts"), "utf8");
const contactModalSource = readFileSync(join(process.cwd(), "src/components/contact-customer-modal.tsx"), "utf8");

function functionBody(name: string) {
  const start = pilotStateSource.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = pilotStateSource.indexOf("\nexport async function ", start + 1);
  return pilotStateSource.slice(start, next === -1 ? undefined : next);
}

function constantBlock(name: string) {
  const start = pilotStateSource.indexOf(`const ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = pilotStateSource.indexOf(";\n", start);
  expect(end).toBeGreaterThan(start);
  return pilotStateSource.slice(start, end);
}

describe("outreach production schema compatibility", () => {
  it("uses one production-safe baseline OutreachRecord select", () => {
    const select = constantBlock("baselineOutreachRecordSelect");

    expect(pilotStateSource).toContain("const baselineOutreachRecordSelect");
    expect(pilotStateSource).toContain("} satisfies Prisma.OutreachRecordSelect");
    expect(select).not.toContain("bookingLinkId");
    expect(select).not.toContain("customerBookingLinks");
  });

  it("prevents implicit OutreachRecord full-model returns on every create", () => {
    const createCount = (pilotStateSource.match(/outreachRecord\.create/g) ?? []).length;
    const safeSelectCount = (pilotStateSource.match(/select: baselineOutreachRecordSelect/g) ?? []).length;

    expect(createCount).toBeGreaterThan(0);
    expect(safeSelectCount).toBeGreaterThanOrEqual(createCount + 2);
  });

  it("does not send self-scheduling fields during core opportunity contact inserts", () => {
    const body = functionBody("recordPilotOpportunityContact");

    expect(body).toContain("select: baselineOutreachRecordSelect");
    expect(body).not.toContain("bookingLinkId: input.bookingLinkId ?? null");
    expect(body).not.toMatch(/data:\s*\{[\s\S]+bookingLinkId:/);
    expect(body).toContain("if (input.bookingLinkId && isCustomerBookingEnabled())");
  });

  it("keeps self-scheduling-disabled state loads away from optional columns", () => {
    expect(pilotStateSource).toContain("loadStateOutreachBookingLinkIds");
    expect(pilotStateSource).toContain("if (!isCustomerBookingEnabled())");
    expect(pilotStateSource).toContain("select: baselineOutreachRecordSelect");
    expect(pilotStateSource).toContain("select: baselineAppointmentWithServicesSelect");
  });

  it("maps outreach schema drift to a safe client message", () => {
    expect(clientMutationError(
      {
        code: "P2022",
        message: "The column `bookingLinkId of relation OutreachRecord` does not exist in the current database.",
      },
      { action: "recordOpportunityContact", table: "OutreachRecord", operation: "INSERT" },
    )).toMatchObject({
      code: "OUTREACH_SCHEMA_COMPATIBILITY_ERROR",
      message: "The outreach could not be recorded because a required application update is missing.",
    });
  });
});

describe("outreach idempotency and refresh recovery", () => {
  it("threads a stable idempotency key from modal to server", () => {
    expect(contactModalSource).toContain("idempotencyKeyRef");
    expect(contactModalSource).toContain("crypto.randomUUID()");
    expect(contactModalSource).toContain("idempotencyKey: idempotencyKeyRef.current");
    expect(mutateRouteSource).toContain("idempotencyKey: z.string()");
    expect(pilotStateSource).toContain("outreachIdFromIdempotencyKey");
    expect(pilotStateSource).toContain("existingOutreach");
    expect(demoStoreSource).toContain("input.idempotencyKey ? `outreach-${input.idempotencyKey}`");
  });

  it("logs safe outreach action metadata without message bodies", () => {
    expect(safeMutationOperation({
      action: "recordOpportunityContact",
      payload: {
        customerId: "customer_1234567890",
        vehicleId: "vehicle_1234567890",
        opportunityIds: ["opportunity_1234567890"],
        channel: "EMAIL",
        responseStatus: "NO_RESPONSE",
        message: "Do not expose this message body in operation logs.",
      },
    })).toMatchObject({
      table: "OutreachRecord",
      operation: "INSERT",
      channel: "EMAIL",
      outreachStage: "NO_RESPONSE",
    });
  });

  it("returns a committed response when state refresh fails after a write", () => {
    expect(mutateRouteSource).toContain("mutationCommitted = true");
    expect(mutateRouteSource).toContain("STATE_REFRESH_FAILED_AFTER_MUTATION");
    expect(mutateRouteSource).toContain("The customer was contacted, but the opportunity could not be refreshed.");
    expect(demoStoreSource).toContain("response.ok && data.committed");
  });
});
