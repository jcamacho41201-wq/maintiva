"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { useDemoStore } from "@/lib/demo-store";
import { serviceVisitSchema, type ServiceVisitInput } from "@/lib/service-visit";
import { stateForecastAsOfDate, vehicleLabel } from "@/lib/demo-calculations";
import { formatCurrency } from "@/lib/utils";

export default function AddServiceVisitPage() {
  const store = useDemoStore();
  const { state, ready, loadError } = store;
  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [date, setDate] = useState("");
  const [mileage, setMileage] = useState("");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ServiceVisitInput["services"]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const key = useRef<string | null>(null);
  if (!ready) return <p>Loading service visit…</p>;
  if (loadError) return <p role="alert">Shop data could not be loaded.</p>;
  const today = stateForecastAsOfDate(state);
  const services = state.services.filter((service) => service.shopId === state.shop.id && service.isActive && service.name.toLowerCase().includes(search.toLowerCase()));
  const vehicles = state.vehicles.filter((vehicle) => vehicle.shopId === state.shop.id && vehicle.customerId === customerId && !vehicle.archivedAt);
  const field = "mt-2 w-full rounded-lg border border-zinc-300 bg-white p-2.5 text-sm";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || saved) return;
    key.current ??= crypto.randomUUID();
    const parsed = serviceVisitSchema.safeParse({ customerId, vehicleId, date: date || today, mileage: mileage.trim() ? Number(mileage) : NaN, notes, idempotencyKey: key.current, services: lines });
    if (!parsed.success) { setMessage(parsed.error.issues[0].message); return; }
    lock.current = true;
    setSaving(true);
    try {
      const result = await store.recordServiceVisit(parsed.data);
      setMessage(result.ok ? "Service visit saved. Maintenance and retention opportunities updated." : result.message ?? "Visit could not be saved.");
      setSaved(result.ok);
    } catch { setMessage("The request failed. Retry this same visit to safely check its save status."); }
    finally { setSaving(false); lock.current = false; }
  }
  return <div className="mx-auto max-w-4xl space-y-6"><header><h1 className="text-3xl font-semibold">Add Service Visit</h1><p className="mt-2 text-sm text-zinc-600">Record what was completed and what should bring the customer back.</p></header>{message && <p role="status" className={`border-l-4 p-4 text-sm ${saved ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-amber-500 bg-amber-50 text-amber-900"}`}>{message}</p>}{saved ? <Link href={`/customers/${customerId}`} className="inline-block font-semibold text-violet-900">View customer timeline</Link> : <form onSubmit={save} className="space-y-6"><fieldset disabled={saving} className="space-y-6"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Customer<select required value={customerId} onChange={(event) => { setCustomerId(event.target.value); setVehicleId(""); }} className={field}><option value="">Choose customer</option>{state.customers.filter((item) => item.shopId === state.shop.id && !item.archivedAt).map((customer) => <option key={customer.id} value={customer.id}>{customer.firstName} {customer.lastName}</option>)}</select></label><label className="text-sm font-medium">Vehicle<select required value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className={field}><option value="">Choose vehicle</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicleLabel(vehicle)}</option>)}</select></label><label className="text-sm font-medium">Visit date<input required type="date" max={today} value={date || today} onChange={(event) => setDate(event.target.value)} className={field} /></label><label className="text-sm font-medium">Odometer at visit<input required type="number" min="0" max="3000000" value={mileage} onChange={(event) => setMileage(event.target.value)} className={field} /></label></div>
    <section className="border-t border-zinc-200 pt-5"><h2 className="text-lg font-semibold">Completed & Deferred Services</h2><label className="mt-3 block text-sm font-medium">Find a service<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search service library" className={field} /></label><div className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto">{services.filter((service) => !lines.some((line) => line.serviceDefinitionId === service.id)).map((service) => <button type="button" key={service.id} onClick={() => setLines((current) => [...current, { serviceDefinitionId: service.id, outcome: "COMPLETED", priceCents: service.defaultPriceCents }])} className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"><Plus className="h-3 w-3" />{service.name}</button>)}</div><div className="mt-4 divide-y divide-zinc-200">{lines.map((line, index) => <div key={line.serviceDefinitionId} className="space-y-3 py-4"><div className="flex items-center justify-between gap-3"><p className="font-medium">{state.services.find((service) => service.id === line.serviceDefinitionId)?.name}</p><button type="button" aria-label="Remove service" title="Remove service" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 className="h-4 w-4 text-red-700" /></button></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Outcome<select className={field} value={line.outcome} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, outcome: event.target.value as "COMPLETED" | "DEFERRED" } : item))}><option value="COMPLETED">Completed</option><option value="DEFERRED">Deferred</option></select></label><label className="text-sm">{line.outcome === "COMPLETED" ? "Recorded service price ($)" : "Estimated service value ($)"}<input required type="number" min="0" step="0.01" className={field} value={line.priceCents / 100} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, priceCents: Math.round(Number(event.target.value) * 100) } : item))} /></label>{line.outcome === "DEFERRED" && <><label className="text-sm">Estimated due date (optional)<input type="date" min={date || today} className={field} value={line.dueDate ?? ""} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, dueDate: event.target.value || undefined } : item))} /></label><label className="text-sm">Estimated due mileage (optional)<input type="number" min={Number(mileage) || 0} className={field} value={line.dueMileage ?? ""} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, dueMileage: event.target.value ? Number(event.target.value) : undefined } : item))} /></label></>}</div></div>)}</div></section><label className="block text-sm font-medium">Visit notes<textarea rows={3} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} className={field} /></label><div className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-200 pt-4"><p className="text-sm text-zinc-600">{lines.filter((item) => item.outcome === "COMPLETED").length} completed · {lines.filter((item) => item.outcome === "DEFERRED").length} deferred · {formatCurrency(lines.filter((item) => item.outcome === "DEFERRED").reduce((sum, item) => sum + item.priceCents, 0))} estimated opportunity</p><button disabled={!lines.length || saving} className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Saving..." : "Save & Track"}</button></div></fieldset></form>}</div>;
}
