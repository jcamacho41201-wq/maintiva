"use client";

import Link from "next/link";
import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Clock3, MessageSquare, RotateCcw, Send } from "lucide-react";
import { ContactCustomerModal } from "@/components/contact-customer-modal";
import { useDemoStore } from "@/lib/demo-store";
import { readyForOutreach } from "@/lib/retention";
import { canSendSmsToCustomer } from "@/lib/contact-workflow";
import { buildOutreachDraft, outreachTemplateVariables, templateReasonForGroup, unresolvedTemplateTokens } from "@/lib/outreach-templates";
import { formatCurrency, formatDate } from "@/lib/utils";
import { addCalendarDays } from "@/lib/forecast-dates";
import { stateForecastAsOfDate } from "@/lib/demo-calculations";
import { smsLength } from "@/lib/sms-length";
import { outreachApprovalKey } from "@/lib/outreach-approval";

function OutreachWorklist() {
  const store = useDemoStore();
  const { state, ready, loadError } = store;
  const params = useSearchParams();
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [contactId, setContactId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const inFlight = useRef(false);
  const keys = useRef<Record<string, string>>({});
  const groups = readyForOutreach(state).filter((group) => !params.get("vehicle") || group.vehicleId === params.get("vehicle"));
  const drafts = groups.map((group) => {
    const customer = state.customers.find((item) => item.id === group.customerId)!;
    const vehicle = state.vehicles.find((item) => item.id === group.vehicleId)!;
    const generated = buildOutreachDraft({ channel: "TEXT", reason: templateReasonForGroup(group), variables: outreachTemplateVariables({ customer, vehicle, shop: state.shop, group }), includeBookingLink: false }).body;
    const body = edited[group.id] ?? generated;
    const eligibility = canSendSmsToCustomer(customer);
    const validPhone = /^1?\d{10}$/.test(customer.phone.replace(/\D/g, ""));
    const reviewKey = outreachApprovalKey({ shopId: state.shop.id, customerId: customer.id, vehicleId: vehicle.id, phone: customer.phone, consent: customer.smsConsentStatus, body, opportunityIds: group.opportunities.map((item) => item.id) });
    return { group, customer, vehicle, body, reviewKey, eligible: eligibility.allowed && validPhone && body.trim().length >= 3 && unresolvedTemplateTokens(body).length === 0, reason: eligibility.reason ?? (!validPhone ? "Invalid SMS phone number" : undefined) };
  });
  const active = drafts.find((item) => item.group.id === contactId);

  async function send(ids: string[]) {
    if (inFlight.current) return;
    const batch = drafts.filter((item) => ids.includes(item.reviewKey) && item.eligible);
    if (!batch.length) return;
    if (!window.confirm(`Approve and send ${batch.length} reviewed SMS draft${batch.length === 1 ? "" : "s"}?`)) return;
    inFlight.current = true;
    setBusy(true);
    let sent = 0;
    setResult("");
    try {
      for (const item of batch) {
        keys.current[item.reviewKey] ??= crypto.randomUUID();
        const response = await store.sendCustomerSms({ customerId: item.customer.id, vehicleId: item.vehicle.id, opportunityIds: item.group.opportunities.map((opportunity) => opportunity.id), message: item.body, idempotencyKey: keys.current[item.reviewKey] });
        if (!response.ok) {
          setResult(`${sent} sent. ${response.message ?? "Sending stopped. Review this customer before trying again."}`);
          return;
        }
        sent++;
        setSelected((current) => current.filter((id) => id !== item.reviewKey));
      }
      setResult(`${sent} outreach action(s) saved. Check Communication History for delivery status.`);
    } catch {
      setResult(`${sent} sent. Sending stopped because the request failed. Review Communication History before retrying.`);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function snooze(id: string) {
    if (inFlight.current) return;
    const item = drafts.find((draft) => draft.group.id === id);
    if (!item) return;
    setBusy(true);
    inFlight.current = true;
    try {
      const response = await store.snoozeOpportunity({ customerId: item.customer.id, vehicleId: item.vehicle.id, opportunityIds: item.group.opportunities.map((opportunity) => opportunity.id), maintenanceRecordIds: item.group.opportunities.flatMap((opportunity) => opportunity.maintenanceRecordId ? [opportunity.maintenanceRecordId] : []), declinedWorkRecordIds: item.group.opportunities.flatMap((opportunity) => opportunity.declinedWorkRecordId ? [opportunity.declinedWorkRecordId] : []), snoozedUntil: addCalendarDays(stateForecastAsOfDate(state), 7), reason: "Advisor deferred outreach for one week" });
      setResult(response.ok ? "Follow-up snoozed for one week." : response.message ?? "Unable to snooze.");
    } catch { setResult("Unable to snooze. Try again."); } finally { setBusy(false); inFlight.current = false; }
  }

  if (!ready) return <p role="status">Loading outreach…</p>;
  if (loadError) return <p role="alert">Outreach could not be loaded. Refresh or sign in again.</p>;
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-violet-800">Daily review</p><h1 className="mt-1 text-3xl font-semibold">Ready for Outreach</h1><p className="mt-2 text-sm text-zinc-600">{drafts.length} vehicle workflows · {formatCurrency(groups.reduce((sum, group) => sum + group.estimatedRevenueCents, 0))} estimated opportunity</p></div><button disabled={busy || !drafts.some((item) => selected.includes(item.reviewKey) && item.eligible)} onClick={() => send(selected)} className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"><Send className="h-4 w-4" />{busy ? "Working..." : `Approve & Send All (${drafts.filter((item) => selected.includes(item.reviewKey) && item.eligible).length})`}</button></header>
    <p className="text-sm text-zinc-600">Advisor approval required. SMS consent and provider availability are checked before sending.</p>
    {result && <p role="status" className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950">{result}</p>}
    {params.get("vehicle") && <Link href="/outreach" className="inline-block text-sm font-semibold text-violet-900">View all ready customers</Link>}
    {!drafts.length && <div className="border-y border-zinc-200 py-10"><p className="font-semibold">Your outreach review is clear.</p><Link href="/automation" className="mt-2 inline-block text-sm text-violet-900">View all retention opportunities</Link></div>}
    <div className="divide-y divide-zinc-200 border-t border-zinc-200">{drafts.map((item) => {
      const length = smsLength(item.body);
      return <article key={item.group.id} className="grid gap-5 py-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div><Link href={`/customers/${item.customer.id}`} className="text-lg font-semibold hover:underline">{item.group.customerName}</Link><p className="text-sm text-zinc-500">{item.group.vehicleLabel}</p><p className="mt-3 font-medium">{item.group.recommendedServices.join(", ")}</p><p className="mt-2 text-sm text-zinc-600">{item.group.explanation}</p><p className="mt-2 text-sm font-semibold">{formatCurrency(item.group.estimatedRevenueCents)} estimated value</p>
          <dl className="mt-3 space-y-2 text-sm">{item.group.opportunities.map((opportunity) => <div key={opportunity.id}><dt className="font-medium">{opportunity.serviceNames.join(", ")}</dt><dd className="text-zinc-500">{opportunity.lastServiceDate ? `Last recorded ${formatDate(opportunity.lastServiceDate)}. ` : ""}{opportunity.dueDate ? `Estimated due ${formatDate(opportunity.dueDate)}. ` : ""}{opportunity.forecastMileage ? `${Math.round(opportunity.forecastMileage).toLocaleString()} mi (${opportunity.forecastMileageKind === "ESTIMATED" ? "estimated" : "recorded"}). ` : ""}{opportunity.forecastMileageConfidence ? `${opportunity.forecastMileageConfidence.toLowerCase()} confidence.` : ""}</dd></div>)}</dl>
        </div>
        <div className="min-w-0"><label className="block text-sm font-semibold" htmlFor={`draft-${item.group.id}`}>SMS draft</label><textarea id={`draft-${item.group.id}`} disabled={busy} rows={5} value={item.body} onChange={(event) => { setEdited((current) => ({ ...current, [item.group.id]: event.target.value })); setSelected((current) => current.filter((id) => id !== item.reviewKey)); }} className="mt-2 w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm" /><div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500"><span>{length.characters} characters · {length.segments} SMS segment{length.segments === 1 ? "" : "s"}</span><button title="Reset SMS draft" aria-label={`Reset draft for ${item.group.customerName}`} disabled={busy} onClick={() => { setEdited((current) => { const next = { ...current }; delete next[item.group.id]; return next; }); setSelected((current) => current.filter((id) => id !== item.reviewKey)); }}><RotateCcw className="h-4 w-4" /></button></div>
          {item.reason && <p className="mt-2 text-sm text-amber-800">{item.reason}</p>}
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(item.reviewKey)} disabled={!item.eligible || busy} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.reviewKey] : current.filter((id) => id !== item.reviewKey))} />Reviewed for batch approval</label>
          <div className="mt-4 flex flex-wrap gap-2"><button disabled={busy || !item.eligible} onClick={() => send([item.reviewKey])} className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Send className="h-4 w-4" />Approve & Send</button><button disabled={busy} onClick={() => setContactId(item.group.id)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm"><MessageSquare className="h-4 w-4" />Contact options</button><button disabled={busy} onClick={() => snooze(item.group.id)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm"><Clock3 className="h-4 w-4" />Snooze 1 week</button></div>
        </div>
      </article>;
    })}</div>
    {active && <ContactCustomerModal group={active.group} customer={active.customer} vehicle={active.vehicle} shop={state.shop} records={state.maintenanceRecords.filter((record) => record.vehicleId === active.vehicle.id)} onClose={() => setContactId(null)} onBook={() => { window.location.href = "/automation"; }} onSave={store.recordOpportunityContact} onSendSms={store.sendCustomerSms} onRecordSmsConsent={store.recordCustomerSmsConsent} onCreateAppointmentRequestLink={store.createAppointmentRequestLink} onRevokeAppointmentRequestLink={store.revokeAppointmentRequestLink} appointmentRequestsEnabled={state.appointmentRequestsEnabled} appointmentRequestLink={state.appointmentRequestLinks.find((link) => link.status === "ACTIVE" && link.vehicleId === active.vehicle.id && link.customerId === active.customer.id)} />}
  </div>;
}

export default function OutreachPage() { return <Suspense fallback={<p>Loading outreach…</p>}><OutreachWorklist /></Suspense>; }
