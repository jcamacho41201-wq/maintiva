"use client";
import Link from "next/link";
import { useState } from "react";
import { useDemoStore } from "@/lib/demo-store";
import { isRecordedContact } from "@/lib/retention";
import { formatDate } from "@/lib/utils";

export default function MessagesPage() {
  const { state, ready, loadError } = useDemoStore();
  const [filter, setFilter] = useState("ALL");
  if (!ready) return <p>Loading messages…</p>;
  if (loadError) return <p role="alert">Messages could not be loaded.</p>;
  const records = state.outreachRecords.filter((item) => item.shopId === state.shop.id && (filter === "ALL" || filter === "CONTACTED" && isRecordedContact(item) || filter === "FAILED" && item.smsDeliveryStatus === "FAILED")).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  return <div className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-semibold">Communication History</h1><p className="mt-2 text-sm text-zinc-600">Outreach attempts, recorded contacts, and customer responses.</p></div><Link href="/outreach" className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white">Review outreach</Link></header><label className="block text-sm font-medium">Delivery<select value={filter} onChange={(event) => setFilter(event.target.value)} className="ml-3 rounded-lg border border-zinc-300 bg-white p-2"><option value="ALL">All activity</option><option value="CONTACTED">Confirmed contact</option><option value="FAILED">Failed SMS</option></select></label><div className="divide-y divide-zinc-200 border-y border-zinc-200">{records.map((record) => {
    const customer = state.customers.find((item) => item.id === record.customerId);
    return <article key={record.id} className="py-5"><div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/customers/${record.customerId}`} className="font-semibold text-violet-900">{customer?.firstName} {customer?.lastName}</Link><p className="text-xs text-zinc-500">{formatDate(record.smsSentAt ?? record.manuallySentAt ?? record.sentAt)} · {record.channel} · {record.smsDeliveryStatus ?? record.status}</p></div><p className="mt-3 whitespace-pre-wrap break-words text-sm text-zinc-700">{record.message}</p><p className="mt-2 text-xs text-zinc-500">Response: {record.responseStatus.replaceAll("_", " ").toLowerCase()}</p>{record.smsFailureMessage && <p className="mt-2 text-sm text-red-700">{record.smsFailureMessage}</p>}</article>;
  })}{!records.length && <p className="py-8 text-zinc-500">No matching communication activity.</p>}</div></div>;
}
