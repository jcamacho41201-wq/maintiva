"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Clock3 } from "lucide-react";
import { ContactCustomerModal } from "@/components/contact-customer-modal";
import { BookAppointmentModal } from "@/components/queue-booking-modal";
import { useDemoStore } from "@/lib/demo-store";
import { needsReviewOpportunities, matchesCampaign } from "@/lib/campaign-review";
import { openCapacityOpportunityIds, retentionOpportunities } from "@/lib/retention";
import { groupRevenueOpportunities } from "@/lib/revenue-recovery";
import { addCalendarDays, normalizeDateOnly } from "@/lib/forecast-dates";
import { formatDate } from "@/lib/utils";

function CampaignReviewQueue() {
  const store = useDemoStore();
  const { state, ready, loadError } = store;
  const params = useSearchParams();
  const router = useRouter();
  const selectedId = params.get("opportunity");
  const category = params.get("campaign") ?? "all";
  const view = params.get("view") ?? "review";
  const vehicleFilter = params.get("vehicle");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [booking, setBooking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const inFlight = useRef(false);
  const detailRef = useRef<HTMLElement>(null);
  const all = retentionOpportunities(state);
  const review = needsReviewOpportunities(state);
  const reviewIds = new Set(review.map((item) => item.id));
  const capacityIds = useMemo(() => category === "capacity" ? openCapacityOpportunityIds(state) : new Set<string>(), [state, category]);
  const selected = all.find((item) => item.id === selectedId);
  const group = selected ? groupRevenueOpportunities([selected])[0] : undefined;
  const customer = selected && state.customers.find((item) => item.id === selected.customerId);
  const vehicle = selected && state.vehicles.find((item) => item.id === selected.vehicleId);
  const canReview = Boolean(selected && reviewIds.has(selected.id));
  const snoozed = selected?.outreachStatus === "SNOOZED";
  const link = selected && state.appointmentRequestLinks.find((item) => item.shopId === state.shop.id && item.opportunityId === selected.id && item.customerId === selected.customerId && item.vehicleId === selected.vehicleId && item.status === "ACTIVE" && Date.parse(item.expiresAt) > now);
  const block = link && state.smartMaintenanceBlocks.find((item) => item.id === link.smartMaintenanceBlockId && item.shopId === state.shop.id);
  const rows = (view === "all" ? all : view === "snoozed" ? all.filter((item) => item.outreachStatus === "SNOOZED") : review)
    .filter((item) => (!vehicleFilter || item.vehicleId === vehicleFilter) && matchesCampaign(item, category, capacityIds));

  useEffect(() => {
    if (selectedId && ready) {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: "start" });
    }
  }, [selectedId, ready]);

  function navigate(changes: Record<string, string | null>) {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) query.set(key, value); else query.delete(key);
    }
    setBooking(false);
    setResult("");
    router.push(`/campaigns${query.size ? `?${query}` : ""}`, { scroll: false });
  }

  async function changeSnooze(end = false) {
    if (!selected || inFlight.current || (!canReview && !snoozed)) return;
    inFlight.current = true;
    setBusy(true);
    const payload = { customerId: selected.customerId, vehicleId: selected.vehicleId,
      opportunityIds: [selected.id], maintenanceRecordIds: selected.maintenanceRecordId ? [selected.maintenanceRecordId] : [],
      declinedWorkRecordIds: selected.declinedWorkRecordId ? [selected.declinedWorkRecordId] : [] };
    try {
      const response = end ? await store.endOpportunitySnooze(payload) : await store.snoozeOpportunity({ ...payload,
        snoozedUntil: addCalendarDays(normalizeDateOnly(new Date().toISOString(), state.shop.timezone), 7), reason: "Advisor deferred opportunity review for one week" });
      setResult(response.ok ? end ? "Snooze ended. Eligibility has been recalculated." : "Opportunity snoozed for one week." : response.message ?? "Unable to update snooze.");
    } catch { setResult("Unable to update snooze. Please try again."); }
    finally { setBusy(false); inFlight.current = false; }
  }

  if (loadError) return <p role="alert">Opportunities could not be loaded. Refresh or sign in again.</p>;
  if (!ready) return <p role="status">Loading opportunities...</p>;
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-semibold">Campaigns</h1><p className="mt-1 text-sm text-zinc-600">{review.length} opportunities need review</p></header>
    <div className={`flex flex-wrap items-end justify-between gap-3 ${selectedId ? "hidden xl:flex" : ""}`}>
      <div className="flex flex-wrap gap-4 border-b border-zinc-200" aria-label="Review queue views">{[["review", "Needs review"], ["snoozed", "Snoozed"], ["all", "All opportunities"]].map(([value, label]) => <button key={value} onClick={() => navigate({ view: value, opportunity: null })} aria-pressed={view === value} className={`border-b-2 py-3 text-sm ${view === value ? "border-teal-700 font-semibold text-teal-800" : "border-transparent text-zinc-600"}`}>{label}</button>)}</div>
      <label className="text-xs text-zinc-600">Campaign category<select value={category} onChange={(event) => navigate({ campaign: event.target.value, opportunity: null })} className="mt-1 block h-10 max-w-full rounded-md border border-zinc-300 bg-white px-3 text-sm"><option value="all">All categories</option><option value="maintenance">Upcoming Maintenance</option><option value="deferred">Deferred Service</option><option value="reactivation">Customer Reactivation</option><option value="capacity">Fill Open Capacity</option></select></label>
    </div>
    {vehicleFilter && <button onClick={() => navigate({ vehicle: null })} className="text-sm text-teal-800 underline">Clear vehicle filter</button>}
    {result && <p role="status" className="border-l-4 border-teal-600 bg-teal-50 p-3 text-sm">{result}</p>}
    <div className={`grid min-w-0 gap-6 ${selectedId ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" : ""}`}>
      <section aria-label="Opportunities" className={`min-w-0 ${selectedId ? "hidden xl:block" : ""}`}>
        <ul className="divide-y divide-zinc-200 border-y border-zinc-200">{rows.map((item) => <li key={item.id} className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-4 px-2 py-4 ${selectedId === item.id ? "bg-teal-50" : ""}`}>
          <div className="min-w-0"><p className="break-words text-sm font-semibold">{item.customerName}</p><p className="mt-1 text-xs text-zinc-500">{item.vehicleLabel}</p><p className="mt-2 break-words text-sm font-medium">{item.serviceNames.join(", ")}</p><p className="mt-1 break-words text-sm text-zinc-600">{item.explanation}</p>{item.outreachStatus === "SNOOZED" && <p className="mt-1 text-xs text-amber-800">Snoozed until {formatDate(item.followUpDate ?? item.lastActivityAt)}</p>}</div>
          <button onClick={() => navigate({ opportunity: item.id })} aria-label={`Review ${item.serviceNames.join(", ")} for ${item.customerName}`} className="rounded-md bg-teal-800 px-3 py-2 text-sm font-semibold text-white">Review</button>
        </li>)}</ul>
        {!rows.length && <p className="py-8 text-sm text-zinc-500">{view === "snoozed" ? "No snoozed opportunities." : "No opportunities match this view."}</p>}
      </section>
      {selectedId && <section ref={detailRef} tabIndex={-1} aria-label="Opportunity review" className="min-w-0 scroll-mt-20 focus:outline-none xl:border-l xl:border-zinc-200 xl:pl-6">
        <button onClick={() => navigate({ opportunity: null })} className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-teal-800"><ArrowLeft className="h-4 w-4" />Back to queue</button>
        {!selected || !group || !customer || !vehicle ? <p role="status">This opportunity is unavailable in the current shop.</p> : <>
          <h2 className="break-words text-xl font-semibold">{selected.serviceNames.join(", ")}</h2><p className="mt-1 text-sm text-zinc-600">{selected.customerName} · {selected.vehicleLabel}</p>
          <h3 className="mt-5 text-sm font-semibold">Why now</h3><p className="mt-2 text-sm leading-6">{selected.explanation}</p>
          <details className="my-4 border-y border-zinc-200 py-3"><summary className="cursor-pointer text-sm font-medium">Service history &amp; supporting details</summary><div className="mt-3 space-y-2 text-sm text-zinc-600"><p>{selected.priorityReason}</p><p>{selected.lastServiceDate ? `Last service: ${formatDate(selected.lastServiceDate)}` : "Last service date not recorded."}</p>{state.serviceRecords.filter((item) => item.vehicleId === selected.vehicleId && item.shopId === state.shop.id && selected.serviceNames.includes(item.serviceName)).map((item) => <p key={item.id}>{formatDate(item.completedAt)} · {item.serviceName} · {item.mileage == null ? "Mileage not recorded" : `${item.mileage.toLocaleString()} mi`}</p>)}<Link href={`/vehicles/${vehicle.id}`} className="inline-block text-teal-800 underline">Open vehicle record</Link></div></details>
          <div className="mb-4 text-sm"><h3 className="font-semibold">Booking window</h3>{block ? <p className="mt-1">{block.name} · {block.daysOfWeek.map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ")} · {String(Math.floor(block.startMinute / 60)).padStart(2, "0")}:{String(block.startMinute % 60).padStart(2, "0")} - {String(Math.floor(block.endMinute / 60)).padStart(2, "0")}:{String(block.endMinute % 60).padStart(2, "0")} ({block.timezone})</p> : <p className="mt-1 text-zinc-500">No active booking window associated with this opportunity.</p>}</div>
          {canReview ? <ContactCustomerModal key={selected.id} embedded smsDisabledReason="SMS provider is not connected yet. Live sending is disabled." group={group} customer={customer} vehicle={vehicle} shop={state.shop} records={state.maintenanceRecords.filter((item) => item.id === selected.maintenanceRecordId)} onClose={() => navigate({ opportunity: null })} onBook={() => setBooking(true)} onSave={store.recordOpportunityContact} onSendSms={store.sendCustomerSms} onRecordSmsConsent={store.recordCustomerSmsConsent} onCreateAppointmentRequestLink={store.createAppointmentRequestLink} onRevokeAppointmentRequestLink={store.revokeAppointmentRequestLink} appointmentRequestsEnabled={state.appointmentRequestsEnabled} appointmentRequestLink={link || undefined} reviewActions={<button disabled={busy} onClick={() => changeSnooze()} className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50"><Clock3 className="h-4 w-4" />{busy ? "Saving..." : "Snooze 1 week"}</button>} /> : <div className="border-t border-zinc-200 py-4"><p className="text-sm text-amber-900">{snoozed ? `Snoozed until ${formatDate(selected.followUpDate ?? selected.lastActivityAt)}.` : "This opportunity is not eligible for new outreach in the Needs review queue."}</p>{snoozed && <button disabled={busy} onClick={() => changeSnooze(true)} className="mt-3 rounded-md border border-zinc-300 px-3 py-2 text-sm">End snooze</button>}<Link href="/messages" className="mt-4 block text-sm text-teal-800 underline">View delivery history and responses</Link></div>}
          {!canReview && !snoozed && ["CONTACTED", "RESPONDED"].includes(selected.stage) && <button onClick={() => setBooking(true)} className="mt-4 rounded-md border border-zinc-300 px-3 py-2 text-sm">Book appointment</button>}
          {booking && <BookAppointmentModal group={group} customer={customer} vehicle={vehicle} records={state.maintenanceRecords.filter((item) => item.id === selected.maintenanceRecordId)} onClose={() => setBooking(false)} onSave={store.bookQueueAppointment} />}
        </>}
      </section>}
    </div>
  </div>;
}

export default function CampaignsPage() { return <Suspense fallback={<p>Loading opportunities...</p>}><CampaignReviewQueue /></Suspense>; }
