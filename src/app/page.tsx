"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, MessageSquare, TrendingUp, Users, Wallet } from "lucide-react";
import { useDemoStore } from "@/lib/demo-store";
import { readyForOutreach, retentionReport, upcomingRetention } from "@/lib/retention";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { vehicleLabel } from "@/lib/demo-calculations";

export default function DashboardPage() {
  const { state, ready, loadError } = useDemoStore();
  if (!ready) return <p role="status" className="py-12 text-zinc-600">Loading shop…</p>;
  if (loadError) return <div role="alert" className="py-12 text-red-800"><h1 className="font-semibold">We could not load your shop.</h1><p>Refresh the page or sign in again.</p></div>;
  const report = retentionReport(state);
  const groups = readyForOutreach(state);
  const readyValue = groups.reduce((sum, group) => sum + group.estimatedRevenueCents, 0);
  const pending = state.appointmentRequests.filter((request) => request.shopId === state.shop.id && request.status === "PENDING").sort((a, b) => a.customerSubmittedAt.localeCompare(b.customerSubmittedAt));
  const upcoming = upcomingRetention(state);
  const metrics = [
    { label: "Revenue recovered", value: formatCurrency(report.recoveredRevenueCents), detail: "Recorded completed revenue", icon: Wallet, color: "text-emerald-700" },
    { label: "Customers returned", value: report.customersReturned, detail: "Completed Maintiva appointments", icon: Users, color: "text-emerald-700" },
    { label: "Appointments generated", value: report.appointmentsGenerated, detail: "Scheduled through today", icon: CalendarClock, color: "text-blue-700" },
    { label: "Customers contacted", value: report.customersContacted, detail: "Confirmed outreach only", icon: MessageSquare, color: "text-blue-700" },
    { label: "Estimated opportunity", value: formatCurrency(report.estimatedOpportunityCents), detail: "Open, unbooked services", icon: TrendingUp, color: "text-violet-800" },
    { label: "Subscription ROI", value: "Not available", detail: "Subscription cost not recorded", icon: CheckCircle2, color: "text-zinc-500" },
  ];
  return <div className="space-y-8">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-medium text-violet-800">Customer retention</p><h1 className="mt-1 text-3xl font-semibold">Bring your next customers back.</h1><p className="mt-2 text-sm text-zinc-600">{state.shop.name} · Retention overview · All time through {formatDate(report.through)}</p></div>
      <Link href="/outreach" className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-3 text-sm font-semibold text-white">Review Opportunities <ArrowRight className="h-4 w-4" /></Link>
    </header>
    <section aria-label="Retention metrics" className="grid grid-cols-2 divide-y divide-zinc-200 border-y border-zinc-200 xl:grid-cols-3">
      {metrics.map(({ label, value, detail, icon: Icon, color }) => <div key={label} className="min-w-0 py-5 pr-4"><div className="flex items-center gap-2 text-sm text-zinc-600"><Icon className={`h-4 w-4 ${color}`} />{label}</div><p className={`mt-2 break-words text-2xl font-semibold ${color}`}>{value}</p><p className="mt-1 text-xs text-zinc-500">{detail}</p></div>)}
    </section>
    {report.missingRevenueCount > 0 && <p className="text-sm text-amber-800">{report.missingRevenueCount} completed appointment(s) have no recorded revenue and are excluded from recovered revenue.</p>}
    <section aria-labelledby="ready-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 id="ready-heading" className="text-xl font-semibold">Ready for Outreach</h2><p className="mt-1 text-sm text-zinc-600">{new Set(groups.map((group) => group.customerId)).size} customers ready for outreach · {formatCurrency(readyValue)} estimated opportunity</p></div><Link href="/outreach" className="text-sm font-semibold text-violet-900">Review all →</Link></div>
      <div className="divide-y divide-zinc-200 border-y border-zinc-200">
        {groups.slice(0, 5).map((group) => <div key={group.id} className="grid gap-3 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
          <div><Link className="font-semibold hover:underline" href={`/customers/${group.customerId}`}>{group.customerName}</Link><p className="mt-1 text-sm text-zinc-500">{group.vehicleLabel}</p><div className="mt-2"><Badge variant="purple">Awaiting review</Badge></div></div>
          <div><p className="text-sm font-medium">{group.recommendedServices.join(", ")}</p><p className="mt-1 text-sm text-zinc-600">{group.explanation}</p><p className="mt-1 text-xs text-zinc-500">{group.opportunities[0]?.dueDate ? `Estimated due ${formatDate(group.opportunities[0].dueDate)}` : "Due timing based on available service history"}</p></div>
          <div className="flex items-center justify-between gap-4 md:block md:text-right"><p className="font-semibold">{formatCurrency(group.estimatedRevenueCents)}</p><Link href={`/outreach?vehicle=${encodeURIComponent(group.vehicleId)}`} className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-violet-900">Review <ArrowRight className="h-4 w-4" /></Link></div>
        </div>)}
        {!groups.length && <div className="py-8"><p className="font-medium">No customers ready for outreach.</p><p className="mt-1 text-sm text-zinc-600">Review upcoming services or add a completed service visit to start the next retention cycle.</p><Link href="/visits/new" className="mt-3 inline-block text-sm font-semibold text-violet-900">Add Service Visit</Link></div>}
      </div>
    </section>
    <div className="grid gap-8 xl:grid-cols-2">
      <section><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Pending Appointment Requests</h2><Link href="/appointments" className="text-sm font-semibold text-violet-900">View all</Link></div>
        {pending.length === 0 ? <p className="border-t border-zinc-200 py-5 text-sm text-zinc-500">No appointment requests need review.</p> : <div className="divide-y divide-zinc-200 border-y border-zinc-200">{pending.slice(0, 4).map((request) => {
          const customer = state.customers.find((item) => item.id === request.customerId);
          const vehicle = state.vehicles.find((item) => item.id === request.vehicleId);
          return <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">{customer?.firstName} {customer?.lastName}</p><p className="text-sm text-zinc-500">{vehicle ? vehicleLabel(vehicle) : "Vehicle"}</p><p className="mt-1 text-sm">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: state.shop.timezone }).format(new Date(request.requestedStart))}</p></div><Link href="/appointments" className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900">Review Request</Link></div>;
        })}</div>}
      </section>
      <section><h2 className="text-xl font-semibold">Upcoming Opportunities</h2><p className="mt-1 text-sm text-zinc-500">Cumulative forecasts from active service assignments. Estimates, not recovered revenue.</p><div className="mt-4 divide-y divide-zinc-200 border-y border-zinc-200">{upcoming.map((window) => <div key={window.days} className="flex items-center justify-between gap-3 py-4"><div><p className="font-medium">Next {window.days} days</p><p className="text-sm text-zinc-500">{window.items.length} services · {new Set(window.items.map((item) => item.customerId)).size} customers</p></div><p className="font-semibold">{formatCurrency(window.valueCents)}</p></div>)}</div></section>
    </div>
    <footer className="flex flex-wrap justify-between gap-3 border-t border-zinc-200 pt-4 text-sm text-zinc-500"><p>Shop management software runs today&apos;s work. Maintiva creates tomorrow&apos;s.</p><Link href="/analytics" className="font-medium text-violet-900">View revenue attribution</Link></footer>
  </div>;
}
