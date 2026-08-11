import type { DemoState } from "@/lib/demo-data";
import { customerName } from "@/lib/demo-calculations";

export type GlobalSearchResultType = "customer" | "vehicle" | "appointment" | "opportunity";

export type GlobalSearchResult = {
  id: string;
  type: GlobalSearchResultType;
  title: string;
  subtitle: string;
  href: string;
};

export type GlobalSearchResponse = {
  query: string;
  results: GlobalSearchResult[];
};

const perTypeLimit = 5;

export function vehicleSearchLabel(vehicle: { year: number; make: string; model: string }) {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}

export function normalizeSearchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizePhoneSearch(value: string) {
  return value.replace(/\D/g, "");
}

function includesQuery(value: unknown, query: string, phoneQuery: string) {
  const text = normalizeSearchText(String(value ?? ""));
  if (text.includes(query)) return true;
  return phoneQuery.length >= 2 && normalizePhoneSearch(text).includes(phoneQuery);
}

export function searchDemoGlobal(state: DemoState, rawQuery: string): GlobalSearchResponse {
  const query = normalizeSearchText(rawQuery);
  const phoneQuery = normalizePhoneSearch(rawQuery);
  if (query.length < 2) return { query, results: [] };

  const customers = state.customers
    .filter((customer) => customer.shopId === state.shop.id && !customer.archivedAt)
    .filter((customer) => {
      const vehicles = state.vehicles.filter((vehicle) => vehicle.customerId === customer.id);
      return [
        customer.firstName,
        customer.lastName,
        customer.email,
        customer.phone,
        customer.address,
        ...vehicles.flatMap((vehicle) => [
          vehicleSearchLabel(vehicle),
          vehicle.vin,
          vehicle.licensePlate,
        ]),
      ].some((value) => includesQuery(value, query, phoneQuery));
    })
    .slice(0, perTypeLimit)
    .map((customer): GlobalSearchResult => ({
      id: customer.id,
      type: "customer",
      title: `${customer.firstName} ${customer.lastName}`,
      subtitle: [customer.phone, customer.email].filter(Boolean).join(" | ") || "Customer",
      href: `/customers/${customer.id}`,
    }));

  const vehicles = state.vehicles
    .filter((vehicle) => vehicle.shopId === state.shop.id && !vehicle.archivedAt)
    .filter((vehicle) => [
      vehicleSearchLabel(vehicle),
      vehicle.vin,
      vehicle.licensePlate,
      vehicle.make,
      vehicle.model,
      vehicle.year,
      customerName(state, vehicle.customerId),
    ].some((value) => includesQuery(value, query, phoneQuery)))
    .slice(0, perTypeLimit)
    .map((vehicle): GlobalSearchResult => ({
      id: vehicle.id,
      type: "vehicle",
      title: vehicleSearchLabel(vehicle),
      subtitle: `${customerName(state, vehicle.customerId)}${vehicle.vin ? ` | VIN ${vehicle.vin}` : ""}`,
      href: `/vehicles/${vehicle.id}`,
    }));

  const appointments = state.appointments
    .filter((appointment) => appointment.shopId === state.shop.id)
    .filter((appointment) => {
      const vehicle = state.vehicles.find((item) => item.id === appointment.vehicleId);
      return [
        customerName(state, appointment.customerId),
        vehicle ? vehicleSearchLabel(vehicle) : "",
        vehicle?.vin,
        appointment.status,
        appointment.scheduledStart,
        ...appointment.serviceNames,
      ].some((value) => includesQuery(value, query, phoneQuery));
    })
    .slice(0, perTypeLimit)
    .map((appointment): GlobalSearchResult => ({
      id: appointment.id,
      type: "appointment",
      title: appointment.serviceNames.join(", ") || "Appointment",
      subtitle: `${customerName(state, appointment.customerId)} | ${appointment.scheduledStart}`,
      href: `/appointments?appointment=${appointment.id}`,
    }));

  const opportunities = state.revenueOpportunities
    .filter((opportunity) => opportunity.shopId === state.shop.id)
    .filter((opportunity) => {
      const vehicle = state.vehicles.find((item) => item.id === opportunity.vehicleId);
      const maintenance = opportunity.maintenanceRecordId
        ? state.maintenanceRecords.find((record) => record.id === opportunity.maintenanceRecordId)
        : undefined;
      const declined = opportunity.declinedWorkRecordId
        ? state.declinedWorkRecords.find((record) => record.id === opportunity.declinedWorkRecordId)
        : undefined;
      return [
        customerName(state, opportunity.customerId),
        vehicle ? vehicleSearchLabel(vehicle) : "",
        maintenance?.serviceName,
        declined?.serviceName,
        opportunity.stage,
        opportunity.source,
        opportunity.priority,
        opportunity.explanation,
      ].some((value) => includesQuery(value, query, phoneQuery));
    })
    .slice(0, perTypeLimit)
    .map((opportunity): GlobalSearchResult => ({
      id: opportunity.id,
      type: "opportunity",
      title: opportunity.explanation,
      subtitle: `${customerName(state, opportunity.customerId)} | ${opportunity.stage}`,
      href: `/automation?opportunity=${opportunity.id}`,
    }));

  return {
    query,
    results: [...customers, ...vehicles, ...appointments, ...opportunities],
  };
}
