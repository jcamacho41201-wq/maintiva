"use client";
import Link from "next/link";
import { useState } from "react";
import type { DemoState } from "@/lib/demo-data";
import { customerRetentionTimeline, readyForOutreach, retentionOpportunities } from "@/lib/retention";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function RetentionProfile({ state, customerId, vehicleId }: { state: DemoState; customerId: string; vehicleId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const opportunities = retentionOpportunities(state).filter((item) => item.customerId === customerId && (!vehicleId || item.vehicleId === vehicleId) && ["IDENTIFIED", "CONTACTED", "RESPONDED", "BOOKED"].includes(item.stage));
  const next = opportunities.find((item) => item.stage === "IDENTIFIED") ?? opportunities[0];
  const timeline = customerRetentionTimeline(state, customerId, vehicleId);
  const ready = next && readyForOutreach(state).some((group) => group.opportunities.some((item) => item.id === next.id));
  const pending = state.appointmentRequests.some((item) => item.shopId === state.shop.id && item.customerId === customerId && (!vehicleId || item.vehicleId === vehicleId) && item.status === "PENDING");
  return <section className="space-y-5 border-y border-zinc-200 py-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Retention Status</h2><Badge variant={next ? "purple" : "neutral"}>{pending ? "Appointment requested" : next ? ({ IDENTIFIED: ready ? "Opportunity ready" : "Tracking opportunity", CONTACTED: "Contacted", RESPONDED: "Responded", BOOKED: "Booked", COMPLETED: "Completed", LOST: "Lost" }[next.stage]) : "Tracking next visit"}</Badge></div>
    {next ? <div className="grid gap-5 md:grid-cols-2"><div><h3 className="text-sm font-medium text-zinc-500">Next Opportunity</h3><p className="mt-1 font-semibold">{next.serviceNames.join(", ")}</p><p className="mt-1 text-sm">Estimated value: {formatCurrency(next.estimatedRevenueCents)}</p><p className="mt-1 text-sm text-zinc-500">{next.dueDate ? `Estimated due ${formatDate(next.dueDate)}` : next.dueMileage ? `Due at ${next.dueMileage.toLocaleString()} mi` : "Advisor review needed"}</p><Link href={ready ? `/outreach?vehicle=${encodeURIComponent(next.vehicleId)}` : "/automation"} className="mt-3 inline-block text-sm font-semibold text-violet-900">{ready ? "Review outreach" : "View opportunity"}</Link></div><div><h3 className="text-sm font-medium text-zinc-500">Why Maintiva Thinks This</h3><p className="mt-1 text-sm text-zinc-700">{next.explanation}</p>{next.lastServiceDate && <p className="mt-2 text-sm text-zinc-500">Last recorded {formatDate(next.lastServiceDate)}{next.lastServiceMileage != null ? ` at ${next.lastServiceMileage.toLocaleString()} mi` : ""}.</p>}{next.forecastMileage != null && <p className="mt-2 text-sm text-zinc-500">{next.forecastMileageKind === "ESTIMATED" ? "Estimated current mileage" : "Recorded mileage"}: {Math.round(next.forecastMileage).toLocaleString()} mi.</p>}</div></div> : <p className="text-sm text-zinc-500">No open opportunity. Recorded services and maintenance intervals will inform the next visit.</p>}
    <div><h3 className="text-lg font-semibold">Customer Timeline</h3><ol className="mt-4 divide-y divide-zinc-200">{timeline.slice(0, expanded ? undefined : 6).map((event) => <li key={event.id} className="grid gap-2 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]"><div className="text-xs text-zinc-500"><p>{formatDate(event.date)}</p><p className="mt-1 font-medium text-violet-800">{event.kind}</p></div><div className="min-w-0"><p className="text-sm font-semibold">{event.title}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-600">{event.detail}</p></div></li>)}</ol>{!timeline.length && <p className="mt-3 text-sm text-zinc-500">No recorded activity yet.</p>}{timeline.length > 6 && <button onClick={() => setExpanded(!expanded)} className="mt-3 text-sm font-semibold text-violet-900">{expanded ? "Show recent activity" : `Show all ${timeline.length} events`}</button>}</div>
  </section>;
}
