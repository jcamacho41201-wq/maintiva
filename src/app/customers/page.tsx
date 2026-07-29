"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { FileUp, Plus, Search, X } from "lucide-react";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getRecommendedRecords, vehicleLabel } from "@/lib/demo-calculations";
import { useDemoStore } from "@/lib/demo-store";
import { type ContactMethod, type CustomerStatus } from "@/lib/demo-data";
import { formatCurrency, formatDate } from "@/lib/utils";

function emptyCustomerForm() {
  return {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    preferredContact: "SMS" as ContactMethod,
    smsConsent: true,
    emailConsent: true,
    callConsent: false,
    address: "",
    notes: "",
    status: "ACTIVE" as CustomerStatus,
  };
}

export default function CustomersPage() {
  const { state, addCustomer } = useDemoStore();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyCustomerForm());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const filteredCustomers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return state.customers;

    return state.customers.filter((customer) => {
      const vehicles = state.vehicles.filter((vehicle) => vehicle.customerId === customer.id);
      const haystack = [
        customer.firstName,
        customer.lastName,
        customer.phone,
        customer.email,
        ...vehicles.flatMap((vehicle) => [
          vehicleLabel(vehicle),
          vehicle.vin,
          vehicle.licensePlate,
          vehicle.make,
          vehicle.model,
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [query, state.customers, state.vehicles]);

  function nextService(customerId: string) {
    const vehicleIds = state.vehicles
      .filter((vehicle) => vehicle.customerId === customerId)
      .map((vehicle) => vehicle.id);
    const item = getRecommendedRecords(state).find(({ record }) =>
      vehicleIds.includes(record.vehicleId),
    );

    return item?.record.serviceName ?? "No services due";
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
    if (form.email && !form.email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    setSaving(true);
    const result = await addCustomer(form);
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "Customer could not be saved. Check the database connection and try again.");
      return;
    }

    setForm(emptyCustomerForm());
    setAdding(false);
    setError("");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Customers</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Search, filter, and prioritize customers by value, consent, and predicted maintenance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/import"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-800"
          >
            <FileUp className="h-4 w-4" />
            Import Data
          </Link>
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" />
            Add Customer
          </button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-zinc-500">
            <Search className="h-4 w-4" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by customer, vehicle, phone, email, or VIN"
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {["Active", "Watchlist", "SMS consent", "High value", "Due soon"].map((filter) => (
              <Badge key={filter} variant="neutral">{filter}</Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Vehicles</th>
                <th className="px-5 py-3">Last visit</th>
                <th className="px-5 py-3">Next predicted service</th>
                <th className="px-5 py-3">Customer value</th>
                <th className="px-5 py-3">Consent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredCustomers.map((customer) => {
                const customerVehicles = state.vehicles.filter((vehicle) => vehicle.customerId === customer.id);
                return (
                  <tr key={customer.id} className="hover:bg-violet-50/40">
                    <td className="px-5 py-4">
                      <Link href={`/customers/${customer.id}`} className="font-semibold text-violet-950">
                        {customer.firstName} {customer.lastName}
                      </Link>
                      <p className="text-zinc-500">{customer.email}</p>
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={statusVariant(customer.status)}>{customer.status}</Badge>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium">{customerVehicles.length}</p>
                      <p className="text-zinc-500">
                        {customerVehicles[0] ? vehicleLabel(customerVehicles[0]) : "None"}
                      </p>
                    </td>
                    <td className="px-5 py-4">{formatDate(customer.lastVisit)}</td>
                    <td className="px-5 py-4">{nextService(customer.id)}</td>
                    <td className="px-5 py-4">{formatCurrency(customer.lifetimeRevenueCents)}</td>
                    <td className="px-5 py-4">
                      <div className="flex gap-1">
                        {customer.smsConsent && <Badge variant="green">SMS</Badge>}
                        {customer.emailConsent && <Badge variant="green">Email</Badge>}
                        {customer.callConsent && <Badge variant="green">Call</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
          <form onSubmit={submitCustomer} className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-100 p-5">
              <h2 className="text-lg font-semibold">Add customer</h2>
              <button type="button" onClick={() => setAdding(false)} className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-200">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {error && <p className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <label className="text-sm font-medium">
                First name
                <input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
              <label className="text-sm font-medium">
                Last name
                <input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
              <label className="text-sm font-medium">
                Phone
                <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
              <label className="text-sm font-medium">
                Email
                <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
              </label>
              <label className="text-sm font-medium">
                Preferred contact
                <select value={form.preferredContact} onChange={(event) => setForm({ ...form, preferredContact: event.target.value as ContactMethod })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500">
                  <option value="SMS">SMS</option>
                  <option value="EMAIL">Email</option>
                  <option value="CALL">Call</option>
                </select>
              </label>
              <label className="text-sm font-medium">
                Status
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as CustomerStatus })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500">
                  <option value="ACTIVE">Active</option>
                  <option value="WATCHLIST">Watchlist</option>
                  <option value="PAUSED">Paused</option>
                </select>
              </label>
              <label className="sm:col-span-2 text-sm font-medium">
                Notes
                <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-violet-500" />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-100 p-5">
              <button type="button" onClick={() => setAdding(false)} disabled={saving} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
              <button disabled={saving} className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Saving..." : "Save customer"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
