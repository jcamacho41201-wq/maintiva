import "server-only";

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

const perTypeLimit = 5;

export async function searchPilotGlobal(
  context: AuthenticatedShopContext,
  rawQuery: string,
): Promise<GlobalSearchResponse> {
  const query = normalizeSearchText(rawQuery);
  const phoneQuery = normalizePhoneSearch(rawQuery);
  if (query.length < 2) return { query, results: [] };

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

  const phoneIds = phoneQuery.length >= 2
    ? await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        select "id"
        from "Customer"
        where "shopId" = ${context.shopId}
          and "archivedAt" is null
          and regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g') like ${`%${phoneQuery}%`}
        limit ${perTypeLimit}
      `)
    : [];

  const [customers, vehicles, appointments, opportunities] = await Promise.all([
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
      include: { vehicles: { select: { year: true, make: true, model: true, vin: true }, take: 1 } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: perTypeLimit,
    }),
    prisma.vehicle.findMany({
      where: {
        shopId: context.shopId,
        archivedAt: null,
        OR: vehicleSearchPredicates,
      },
      include: { customer: { select: { firstName: true, lastName: true } } },
      orderBy: [{ make: "asc" }, { model: "asc" }],
      take: perTypeLimit,
    }),
    prisma.appointment.findMany({
      where: {
        shopId: context.shopId,
        OR: [
          { services: { some: { serviceName: contains } } },
          { customer: { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }] } },
          { vehicle: { OR: [{ make: contains }, { model: contains }, { vin: contains }, { licensePlate: contains }] } },
        ],
      },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        vehicle: { select: { year: true, make: true, model: true } },
        services: { select: { serviceName: true } },
      },
      orderBy: { scheduledStart: "asc" },
      take: perTypeLimit,
    }),
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
      include: {
        customer: { select: { firstName: true, lastName: true } },
        vehicle: { select: { year: true, make: true, model: true } },
        maintenanceRecord: { select: { serviceName: true } },
        declinedWorkRecord: { select: { serviceName: true } },
      },
      orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
      take: perTypeLimit,
    }),
  ]);

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
