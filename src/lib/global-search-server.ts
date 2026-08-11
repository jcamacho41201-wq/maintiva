import { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedShopContext } from "@/lib/auth";
import {
  type GlobalSearchResponse,
  type GlobalSearchResult,
  normalizePhoneSearch,
  normalizeSearchText,
  vehicleSearchLabel,
} from "@/lib/global-search";
import { prisma } from "@/lib/prisma";
import { safeDatabaseError } from "@/lib/server-diagnostics";

const perTypeLimit = 5;

export type SearchDiagnosticCode =
  | "SEARCH_INVALID_QUERY"
  | "SEARCH_CUSTOMER_QUERY_FAILED"
  | "SEARCH_VEHICLE_QUERY_FAILED"
  | "SEARCH_APPOINTMENT_QUERY_FAILED"
  | "SEARCH_OPPORTUNITY_QUERY_FAILED"
  | "SEARCH_SCHEMA_DRIFT"
  | "SEARCH_SERVER_ERROR";

type SearchCategory = "CUSTOMER" | "VEHICLE" | "APPOINTMENT" | "OPPORTUNITY";

export class SearchServiceError extends Error {
  constructor(
    readonly code: SearchDiagnosticCode,
    message: string,
    readonly status = 500,
    readonly category?: SearchCategory,
  ) {
    super(message);
    this.name = "SearchServiceError";
  }
}

function safeId(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function isSchemaDrift(error: unknown) {
  const safe = safeDatabaseError(error);
  return ["P2021", "P2022", "42P01", "42703"].includes(safe.code ?? "");
}

function diagnosticCode(category: SearchCategory, error: unknown): SearchDiagnosticCode {
  if (isSchemaDrift(error)) return "SEARCH_SCHEMA_DRIFT";
  return `SEARCH_${category}_QUERY_FAILED` as SearchDiagnosticCode;
}

function logSearchFailure(input: {
  code: SearchDiagnosticCode;
  category?: SearchCategory;
  context: AuthenticatedShopContext;
  error: unknown;
}) {
  console.error("Maintiva global search failed", {
    code: input.code,
    category: input.category,
    auth: {
      shopId: safeId(input.context.shopId),
      role: input.context.role,
      activeShopResolved: true,
    },
    database: safeDatabaseError(input.error),
  });
}

async function mandatoryCategory<T>(
  category: SearchCategory,
  context: AuthenticatedShopContext,
  callback: () => Promise<T>,
) {
  try {
    return await callback();
  } catch (error) {
    const code = diagnosticCode(category, error);
    logSearchFailure({ code, category, context, error });
    throw new SearchServiceError(code, "Search is unavailable right now.", 500, category);
  }
}

async function optionalCategory<T>(
  category: SearchCategory,
  context: AuthenticatedShopContext,
  callback: () => Promise<T[]>,
) {
  try {
    return await callback();
  } catch (error) {
    logSearchFailure({ code: diagnosticCode(category, error), category, context, error });
    return [];
  }
}

export async function searchPilotGlobal(
  context: AuthenticatedShopContext,
  rawQuery: string,
): Promise<GlobalSearchResponse> {
  const query = normalizeSearchText(rawQuery);
  const phoneQuery = normalizePhoneSearch(rawQuery);
  if (query.length < 2) return { query, results: [] };
  if (query.length > 100) {
    throw new SearchServiceError(
      "SEARCH_INVALID_QUERY",
      "Search query is too long.",
      400,
    );
  }

  const contains = { contains: query, mode: Prisma.QueryMode.insensitive };
  const vehicleSearchPredicates: Prisma.VehicleWhereInput[] = [
    { make: contains },
    { model: contains },
    { vin: contains },
    { licensePlate: contains },
    { customer: { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }] } },
  ];
  const numericQuery = Number(query);
  if (Number.isInteger(numericQuery)) {
    vehicleSearchPredicates.push({ year: numericQuery });
  }

  const phoneIds = await mandatoryCategory("CUSTOMER", context, async () =>
    phoneQuery.length >= 2
      ? prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          select "id"
          from "Customer"
          where "shopId" = ${context.shopId}
            and "archivedAt" is null
            and regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g') like ${`%${phoneQuery}%`}
          limit ${perTypeLimit}
        `)
      : Promise.resolve([]),
  );

  const customers = await mandatoryCategory("CUSTOMER", context, () =>
    prisma.customer.findMany({
      where: {
        shopId: context.shopId,
        archivedAt: null,
        OR: [
          { firstName: contains },
          { lastName: contains },
          { email: contains },
          { phone: contains },
          { id: { in: phoneIds.map((row) => row.id) } },
          { vehicles: { some: { OR: [{ make: contains }, { model: contains }, { vin: contains }, { licensePlate: contains }] } } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        vehicles: { select: { year: true, make: true, model: true, vin: true }, take: 1 },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: perTypeLimit,
    }),
  );

  const vehicles = await mandatoryCategory("VEHICLE", context, () =>
    prisma.vehicle.findMany({
      where: {
        shopId: context.shopId,
        archivedAt: null,
        OR: vehicleSearchPredicates,
      },
      select: {
        id: true,
        year: true,
        make: true,
        model: true,
        vin: true,
        licensePlate: true,
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ make: "asc" }, { model: "asc" }],
      take: perTypeLimit,
    }),
  );

  const appointments = await optionalCategory("APPOINTMENT", context, () =>
    prisma.appointment.findMany({
      where: {
        shopId: context.shopId,
        OR: [
          { services: { some: { serviceName: contains } } },
          { customer: { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }] } },
          { vehicle: { OR: [{ make: contains }, { model: contains }, { vin: contains }, { licensePlate: contains }] } },
        ],
      },
      select: {
        id: true,
        scheduledStart: true,
        customer: { select: { firstName: true, lastName: true } },
        services: { select: { serviceName: true } },
      },
      orderBy: { scheduledStart: "asc" },
      take: perTypeLimit,
    }),
  );

  const opportunities = await optionalCategory("OPPORTUNITY", context, () =>
    prisma.maintenanceRevenueOpportunity.findMany({
      where: {
        shopId: context.shopId,
        OR: [
          { explanation: contains },
          { priorityReason: contains },
          { customer: { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }] } },
          { vehicle: { OR: [{ make: contains }, { model: contains }, { vin: contains }, { licensePlate: contains }] } },
          { maintenanceRecord: { serviceName: contains } },
          { declinedWorkRecord: { serviceName: contains } },
        ],
      },
      select: {
        id: true,
        stage: true,
        explanation: true,
        customer: { select: { firstName: true, lastName: true } },
        maintenanceRecord: { select: { serviceName: true } },
        declinedWorkRecord: { select: { serviceName: true } },
      },
      orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
      take: perTypeLimit,
    }),
  );

  return {
    query,
    results: [
      ...customers.map((customer): GlobalSearchResult => ({
        id: customer.id,
        type: "customer",
        title: `${customer.firstName} ${customer.lastName}`,
        subtitle: [customer.phone, customer.email, customer.vehicles[0] ? vehicleSearchLabel(customer.vehicles[0]) : ""].filter(Boolean).join(" | ") || "Customer",
        href: `/customers/${customer.id}`,
      })),
      ...vehicles.map((vehicle): GlobalSearchResult => ({
        id: vehicle.id,
        type: "vehicle",
        title: vehicleSearchLabel(vehicle),
        subtitle: `${vehicle.customer.firstName} ${vehicle.customer.lastName}${vehicle.vin ? ` | VIN ${vehicle.vin}` : ""}`,
        href: `/vehicles/${vehicle.id}`,
      })),
      ...appointments.map((appointment): GlobalSearchResult => ({
        id: appointment.id,
        type: "appointment",
        title: appointment.services.map((service) => service.serviceName).join(", ") || "Appointment",
        subtitle: `${appointment.customer.firstName} ${appointment.customer.lastName} | ${appointment.scheduledStart.toISOString()}`,
        href: `/appointments?appointment=${appointment.id}`,
      })),
      ...opportunities.map((opportunity): GlobalSearchResult => ({
        id: opportunity.id,
        type: "opportunity",
        title: opportunity.maintenanceRecord?.serviceName ?? opportunity.declinedWorkRecord?.serviceName ?? opportunity.explanation,
        subtitle: `${opportunity.customer.firstName} ${opportunity.customer.lastName} | ${opportunity.stage}`,
        href: `/automation?opportunity=${opportunity.id}`,
      })),
    ],
  };
}
