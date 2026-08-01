"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { Car, ClipboardCheck, Gauge, Pencil, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  customerName,
  getRecordStatus,
  getRecommendedRecords,
  vehicleLabel,
} from "@/lib/demo-calculations";
import { getOpenRevenueOpportunitiesForCustomer, type RevenueOpportunity } from "@/lib/revenue-recovery";
import { useDemoStore } from "@/lib/demo-store";
import { type Customer, type Vehicle } from "@/lib/demo-data";
import { currentDateInTimeZone, formatCurrency, formatDate, formatLaborHours, formatMileage, formatServiceMileage } from "@/lib/utils";

function editableCustomerFields(customer: Customer) {
  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    email: customer.email,
    notes: customer.notes,
  };
}

function emptyVehicleForm(customerId: string) {
  return {
    customerId,
    year: 2020,
    make: "",
    model: "",
    vin: "",
    engine: "",
    trim: "",
    currentMileage: 0,
    estimatedAnnualMileage: 12000,
  };
}

function opportunityStatusLabel(stage: RevenueOpportunity["stage"]) {
  const labels: Record<RevenueOpportunity["stage"], string> = {
    IDENTIFIED: "Needs outreach",
    CONTACTED: "Contacted",
    RESPONDED: "Responded",
    BOOKED: "Booked",
    COMPLETED: "Completed",
    LOST: "Declined",
  };
  return labels[stage];
}

function vehicleMileageDisplayValue(state: ReturnType<typeof useDemoStore>["state"], vehicle: Vehicle) {
  const hasMileageFact = vehicle.currentMileage !== 0 || state.mileageReadings.some((reading) => reading.vehicleId === vehicle.id);
  return hasMileageFact ? vehicle.currentMileage : null;
}

export default function CustomerDetailPage() {
  const params = useParams<{ customerId: string }>();
  const store = useDemoStore();
  const { state } = store;
  const customer = state.customers.find((item) => item.id === params.customerId);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (!customer) {
    return (
      <Card>
        <CardContent>
          <p className="font-semibold">Customer not found</p>
          <Link href="/customers" className="mt-2 inline-block text-sm font-semibold text-violet-950">
            Back to customers
          </Link>
        </CardContent>
      </Card>
    );
  }

  const customerId = customer.id;
  const vehicles = state.vehicles.filter((vehicle) => vehicle.customerId === customerId);
  const nextItem = getRecommendedRecords(state).find(({ record }) =>
    vehicles.some((vehicle) => vehicle.id === record.vehicleId),
  );
  const recentRecords = state.serviceRecords
    .filter((record) => record.customerId === customer.id)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  const appointments = state.appointments.filter((appointment) => appointment.customerId === customer.id);
  const outreach = state.outreachRecords.filter((record) => record.customerId === customer.id);
  const openRevenueOpportunities = getOpenRevenueOpportunitiesForCustomer(state, customer.id);
  const openOpportunityValue = openRevenueOpportunities.reduce((sum, opportunity) => sum + opportunity.estimatedRevenueCents, 0);

  async function saveCustomer(input: ReturnType<typeof editableCustomerFields>) {
    if (!input.firstName.trim() || !input.lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
    const result = await store.updateCustomer(customerId, input);
    if (!result.ok) {
      setError(result.message ?? "Customer could not be saved. Check the database connection and try again.");
      return;
    }

    setEditingCustomer(false);
    setError("");
  }

  function saveVehicle(vehicle: Vehicle, input: Partial<Vehicle> & { mileageReadingDate?: string }) {
    if (!String(input.make ?? "").trim() || !String(input.model ?? "").trim()) {
      setError("Vehicle make and model are required.");
      return;
    }
    store.updateVehicle(vehicle.id, input);
    setEditingVehicleId(null);
    setError("");
  }

  function addVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      customerId,
      year: Number(data.get("year")),
      make: String(data.get("make")),
      model: String(data.get("model")),
      vin: String(data.get("vin")),
      engine: String(data.get("engine")),
      trim: String(data.get("trim")),
      currentMileage: Number(data.get("currentMileage")),
      estimatedAnnualMileage: Number(data.get("estimatedAnnualMileage")),
      initialMileageReadingDate: String(data.get("initialMileageReadingDate")),
    };
    if (!input.make.trim() || !input.model.trim() || !input.vin.trim()) {
      setError("Vehicle make, model, and VIN are required.");
      return;
    }
    store.addVehicle(input);
    setAddingVehicle(false);
    setError("");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{customerName(state, customer.id)}</h1>
          <p className="mt-2 text-sm text-zinc-600">
            {customer.phone} · {customer.email} · Prefers {customer.preferredContact}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditingCustomer(true)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold">
            <Pencil className="h-4 w-4" />
            Edit customer
          </button>
          <button onClick={() => setAddingVehicle(true)} className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" />
            Add Vehicle
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["Customer score", customer.customerScore],
          ["Lifetime revenue", formatCurrency(customer.lifetimeRevenueCents)],
          ["Last visit", formatDate(customer.lastVisit)],
          ["Next predicted appointment", nextItem?.record.serviceName ?? "No service due"],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent>
              <p className="text-sm text-zinc-500">{label}</p>
              <p className="mt-2 text-xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Customer Information</h2>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-sm font-medium text-zinc-500">Consent settings</p>
            <div className="mt-2 flex gap-2">
              <Badge variant={customer.smsConsent ? "green" : "neutral"}>SMS</Badge>
              <Badge variant={customer.emailConsent ? "green" : "neutral"}>Email</Badge>
              <Badge variant={customer.callConsent ? "green" : "neutral"}>Call</Badge>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-500">Notes</p>
            <p className="mt-2 text-sm text-zinc-700">{customer.notes}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Open Revenue Opportunities</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Real recoverable opportunities linked to this customer and their vehicles.
              </p>
            </div>
            <Badge variant="purple">
              {openRevenueOpportunities.length} · {formatCurrency(openOpportunityValue)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {vehicles.map((vehicle) => {
            const opportunities = openRevenueOpportunities.filter((opportunity) => opportunity.vehicleId === vehicle.id);
            if (opportunities.length === 0) return null;
            return (
              <div key={vehicle.id} className="rounded-lg border border-zinc-200 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Link href={`/vehicles/${vehicle.id}`} className="font-semibold text-violet-950">
                    {vehicleLabel(vehicle)}
                  </Link>
                  <Badge>{opportunities.length} open</Badge>
                </div>
                <div className="mt-3 space-y-2">
                  {opportunities.map((opportunity) => {
                    const appointment = state.appointments.find((item) =>
                      item.opportunityId === opportunity.id ||
                      (
                        opportunity.maintenanceRecordId &&
                        item.maintenanceRecordIds.includes(opportunity.maintenanceRecordId)
                      ),
                    );
                    return (
                      <div key={opportunity.id} className="grid gap-3 rounded-lg bg-zinc-50 p-3 text-sm md:grid-cols-[1fr_auto] md:items-center">
                        <div>
                          <p className="font-semibold">{opportunity.serviceNames.join(", ")}</p>
                          <p className="mt-1 text-zinc-600">
                            {opportunity.sourceLabel} · {opportunityStatusLabel(opportunity.stage)} · {opportunity.priority} priority
                          </p>
                          <p className="mt-1 text-zinc-500">
                            {opportunity.sourceType === "DeclinedWorkRecord" ? "Declined" : "Due"} {opportunity.dueDate ? formatDate(opportunity.dueDate) : "date not recorded"}
                            {" · "}
                            {opportunity.outreachStatus === "SNOOZED"
                              ? `Snoozed until ${formatDate(opportunity.lastActivityAt)}`
                              : opportunity.lastContactedAt
                                ? `Last contact ${formatDate(opportunity.lastContactedAt)}`
                                : "Not contacted yet"}
                          </p>
                          {appointment && (
                            <Link href="/appointments" className="mt-1 inline-block font-semibold text-violet-950">
                              Linked appointment {formatDate(appointment.scheduledStart)}
                            </Link>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 md:justify-end">
                          <Badge variant="purple">{formatCurrency(opportunity.estimatedRevenueCents)}</Badge>
                          <Badge>{formatLaborHours(opportunity.estimatedLaborHours)}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {openRevenueOpportunities.length === 0 && (
            <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500">
              No open revenue opportunities yet.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {vehicles.map((vehicle) => {
          const items = state.maintenanceRecords.filter((item) => item.vehicleId === vehicle.id);
          const recommended = getRecommendedRecords(state, vehicle.id);
          return (
            <Card key={vehicle.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{vehicleLabel(vehicle)}</h2>
                  <p className="mt-1 text-sm text-zinc-500">{vehicle.vin}</p>
                </div>
                <Badge variant={vehicle.overallHealth < 60 ? "orange" : "green"}>
                  {vehicle.overallHealth}% health
                </Badge>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <Gauge className="mb-2 h-4 w-4 text-violet-900" />
                    <p className="text-zinc-500">Current mileage</p>
                    <p className="font-semibold">{formatMileage(vehicleMileageDisplayValue(state, vehicle))}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <ClipboardCheck className="mb-2 h-4 w-4 text-violet-900" />
                    <p className="text-zinc-500">Recommended services</p>
                    <p className="font-semibold">{recommended.length}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {items.slice(0, 3).map((item) => {
                    const status = getRecordStatus(state, item);
                    return (
                      <div key={item.id}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span>{item.serviceName}</span>
                          <span>{status.dueText}</span>
                        </div>
                        <Progress value={status.lifeRemaining} />
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/vehicles/${vehicle.id}`} className="inline-flex items-center gap-2 rounded-lg border border-violet-200 px-3 py-2 text-sm font-semibold text-violet-950">
                    <Car className="h-4 w-4" />
                    Open vehicle maintenance
                  </Link>
                  <button onClick={() => setEditingVehicleId(vehicle.id)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold">
                    <Pencil className="h-4 w-4" />
                    Edit vehicle
                  </button>
                </div>
                {editingVehicleId === vehicle.id && (
                  <VehicleEditForm
                    vehicle={vehicle}
                    shopTimezone={state.shop.timezone}
                    onCancel={() => setEditingVehicleId(null)}
                    onSave={(input) => saveVehicle(vehicle, input)}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <RelatedList title="Recent service records" items={recentRecords.map((record) => `${formatDate(record.completedAt)} · ${record.serviceName} · ${formatServiceMileage(record.mileage)}`)} />
        <RelatedList title="Recommended maintenance" items={getRecommendedRecords(state).filter(({ record }) => vehicles.some((vehicle) => vehicle.id === record.vehicleId)).map(({ record, calculation }) => `${record.serviceName} · ${calculation.dueText}`)} />
        <RelatedList title="Upcoming appointments" items={appointments.map((appointment) => `${formatDate(appointment.scheduledStart)} · ${appointment.serviceNames.join(", ")}`)} />
        <RelatedList title="Outreach history" items={outreach.map((record) => `${formatDate(record.sentAt)} · ${record.serviceNames.join(", ")} · ${record.channel}`)} />
      </div>

      {editingCustomer && (
        <CustomerEditModal
          customer={customer}
          onClose={() => setEditingCustomer(false)}
          onSave={saveCustomer}
        />
      )}

      {addingVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
          <form onSubmit={addVehicle} className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-100 p-5">
              <h2 className="text-lg font-semibold">Add vehicle</h2>
              <button type="button" onClick={() => setAddingVehicle(false)} className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-200">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {Object.entries(emptyVehicleForm(customer.id)).filter(([key]) => key !== "customerId").map(([key, value]) => {
                const isCustomerEstimate = key === "estimatedAnnualMileage";
                return (
                  <label key={key} className="text-sm font-medium">
                    {isCustomerEstimate
                      ? "Customer's Driving Estimate"
                      : key.replace(/([A-Z])/g, " $1").replace(/^\w/, (letter) => letter.toUpperCase())}
                    <input
                      name={key}
                      defaultValue={value}
                      type={typeof value === "number" ? "number" : "text"}
                      list={isCustomerEstimate ? "annual-mileage-estimates" : undefined}
                      className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
                    />
                    {isCustomerEstimate && (
                      <span className="mt-1 block text-xs font-normal text-zinc-500">
                        About how many miles do you drive each year?
                      </span>
                    )}
                  </label>
                );
              })}
              <datalist id="annual-mileage-estimates">
                <option value="6000" />
                <option value="12000" />
                <option value="18000" />
                <option value="24000" />
              </datalist>
                <label className="text-sm font-medium">
                  Reading Date
                  <input
                    name="initialMileageReadingDate"
                    type="date"
                    required
                    max={currentDateInTimeZone(state.shop.timezone)}
                    defaultValue={currentDateInTimeZone(state.shop.timezone)}
                    className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
                  />
                  <span className="mt-1 block text-xs font-normal text-zinc-500">The date this odometer reading was observed.</span>
                </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-100 p-5">
              <button type="button" onClick={() => setAddingVehicle(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold">Cancel</button>
              <button className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">Save vehicle</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function RelatedList({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">{title}</h2>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-zinc-500">No records yet.</p>
        ) : (
          items.map((item) => (
            <p key={item} className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              {item}
            </p>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function CustomerEditModal({
  customer,
  onClose,
  onSave,
}: {
  customer: Customer;
  onClose: () => void;
  onSave: (input: ReturnType<typeof editableCustomerFields>) => Promise<void>;
}) {
  const [form, setForm] = useState(editableCustomerFields(customer));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-100 p-5">
          <h2 className="text-lg font-semibold">Edit customer</h2>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {(["firstName", "lastName", "phone", "email"] as const).map((field) => (
            <label key={field} className="text-sm font-medium">
              {field.replace(/([A-Z])/g, " $1").replace(/^\w/, (letter) => letter.toUpperCase())}
              <input value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
            </label>
          ))}
          <label className="sm:col-span-2 text-sm font-medium">
            Notes
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 outline-none focus:border-violet-500" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-100 p-5">
          <button onClick={onClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold">Cancel</button>
          <button onClick={() => void onSave(form)} className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">Save changes</button>
        </div>
      </div>
    </div>
  );
}

function VehicleEditForm({
  vehicle,
  shopTimezone,
  onCancel,
  onSave,
}: {
  vehicle: Vehicle;
  shopTimezone: string;
  onCancel: () => void;
  onSave: (input: Partial<Vehicle> & { mileageReadingDate?: string }) => void;
}) {
  const today = currentDateInTimeZone(shopTimezone);
  const [form, setForm] = useState({
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    vin: vehicle.vin,
    currentMileage: vehicle.currentMileage,
    mileageReadingDate: today,
  });

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <input value={form.year} type="number" onChange={(event) => setForm({ ...form, year: Number(event.target.value) })} className="h-10 rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
        <input value={form.make} onChange={(event) => setForm({ ...form, make: event.target.value })} className="h-10 rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
        <input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} className="h-10 rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
        <input value={form.vin} onChange={(event) => setForm({ ...form, vin: event.target.value })} className="h-10 rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
        <input value={form.currentMileage} type="number" onChange={(event) => setForm({ ...form, currentMileage: Number(event.target.value) })} className="h-10 rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
        <label className="text-sm font-medium">
          Reading Date
          <input
            value={form.mileageReadingDate}
            type="date"
            required
            max={today}
            onChange={(event) => setForm({ ...form, mileageReadingDate: event.target.value })}
            className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
          />
          <span className="mt-1 block text-xs font-normal text-zinc-500">The date this odometer reading was observed.</span>
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => onSave(form)} className="rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white">Save vehicle</button>
        <button onClick={onCancel} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold">Cancel</button>
      </div>
    </div>
  );
}
