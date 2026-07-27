import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { customers, getCustomerVehicles, getVehicleMaintenance, vehicleLookup } from "@/lib/demo-data";
import { formatCurrency, formatDate } from "@/lib/utils";

function nextService(customerId: string) {
  const vehicles = getCustomerVehicles(customerId);
  const items = vehicles
    .flatMap((vehicle) => getVehicleMaintenance(vehicle.id))
    .sort((a, b) => a.finalLife - b.finalLife);

  return items[0]?.serviceName ?? "No services due";
}

export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Customers</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Search, filter, and prioritize customers by value, consent, and predicted maintenance.
          </p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" />
          Add Customer
        </button>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-zinc-500">
            <Search className="h-4 w-4" />
            <span className="text-sm">Search by customer, vehicle, phone, or email</span>
          </div>
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
              {customers.map((customer) => {
                const customerVehicles = getCustomerVehicles(customer.id);
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
                        {customerVehicles[0] ? vehicleLookup[customerVehicles[0].id].label : "None"}
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
    </div>
  );
}
