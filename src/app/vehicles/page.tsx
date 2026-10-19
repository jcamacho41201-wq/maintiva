"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemoStore } from "@/lib/demo-store";
import { getVehicleMaintenanceCondition, resolveVehicleForecastMileage, vehicleLabel } from "@/lib/demo-calculations";

export default function VehiclesPage() {
  const { state, ready, loadError } = useDemoStore();
  const [search, setSearch] = useState("");
  if (!ready) return <p>Loading vehicles…</p>;
  if (loadError) return <p role="alert">Vehicles could not be loaded.</p>;
  const vehicles = state.vehicles.filter((item) => item.shopId === state.shop.id && !item.archivedAt && `${vehicleLabel(item)} ${item.vin}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-6"><h1 className="text-3xl font-semibold">Vehicles</h1><label className="block max-w-lg text-sm font-medium">Find a vehicle<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Year, make, model or VIN" className="mt-2 w-full rounded-lg border border-zinc-300 bg-white p-3" /></label><div className="divide-y divide-zinc-200 border-y border-zinc-200">{vehicles.map((vehicle) => {
    const customer = state.customers.find((item) => item.id === vehicle.customerId);
    const forecast = resolveVehicleForecastMileage(state, vehicle);
    return <div key={vehicle.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><Link href={`/vehicles/${vehicle.id}`} className="font-semibold text-violet-900">{vehicleLabel(vehicle)}</Link><Link href={`/customers/${vehicle.customerId}`} className="mt-1 block text-sm text-zinc-600">{customer?.firstName} {customer?.lastName}</Link></div><div className="text-sm"><p>{getVehicleMaintenanceCondition(state, vehicle.id).label}</p><p className="mt-1 text-zinc-500">{forecast.mileage == null ? "Mileage unavailable" : `${Math.round(forecast.mileage).toLocaleString()} mi · ${forecast.kind === "ESTIMATED" ? "estimated" : "recorded"}`}</p></div></div>;
  })}{!vehicles.length && <p className="py-8 text-zinc-500">No matching vehicles.</p>}</div></div>;
}
