"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { useDemoStore } from "@/lib/demo-store";
import { groupMessageActivity, messageStatus, needsMessageAttention } from "@/lib/message-activity";
import { formatDate } from "@/lib/utils";

export default function MessagesPage() {
  const { state, ready, loadError } = useDemoStore();
  const [view, setView] = useState("attention");
  const [channel, setChannel] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const lastRowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selectedId) detailsRef.current?.focus();
    else lastRowRef.current?.focus();
  }, [selectedId]);
  if (loadError) return <p role="alert">Messages could not be loaded.</p>;
  if (!ready) return <p role="status">Loading messages...</p>;
  const allGroups = groupMessageActivity(state.outreachRecords, state.shop.id);
  const groups = allGroups.filter(({ latest, attempts }) =>
    (view === "all" || attempts.some(needsMessageAttention)) &&
    (channel === "ALL" || latest.channel === channel) &&
    (status === "ALL" || messageStatus(latest) === status));
  const selected = groups.find((group) => group.id === selectedId);
  const record = selected?.attempts.find((item) => item.id === attemptId) ?? selected?.latest;
  const name = (id: string) => {
    const customer = state.customers.find((item) => item.id === id);
    return customer ? `${customer.firstName} ${customer.lastName}` : "Unavailable customer";
  };
  const clear = () => { setSelectedId(null); setAttemptId(null); };
  return <div className="space-y-5">
    <h1 className="text-2xl font-semibold">Messages</h1>
    <div role="status" className="flex flex-wrap items-center gap-3 border-y border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /><span>SMS provider is not connected yet.</span>
      <Link href="/settings#messaging" className="font-semibold underline">Open messaging settings</Link>
    </div>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex gap-5 border-b border-zinc-200" aria-label="Message views">
        {[["attention", "Needs attention"], ["all", "All activity"]].map(([value, label]) => <button key={value} aria-pressed={view === value} onClick={() => { setView(value); clear(); }} className={`border-b-2 py-3 text-sm font-medium ${view === value ? "border-teal-700 text-teal-800" : "border-transparent text-zinc-500"}`}>{label}</button>)}
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-zinc-600">Channel<select className="mt-1 block h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm" value={channel} onChange={(event) => { setChannel(event.target.value); clear(); }}><option value="ALL">All channels</option>{[...new Set(allGroups.map(({ latest }) => latest.channel))].sort().map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs text-zinc-600">Delivery status<select className="mt-1 block h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm capitalize" value={status} onChange={(event) => { setStatus(event.target.value); clear(); }}><option value="ALL">All statuses</option>{[...new Set(allGroups.map(({ latest }) => messageStatus(latest)))].sort().map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
    </div>
    <div className={`grid min-w-0 gap-6 ${selected ? "xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}`}>
      <section aria-label="Message activity" className={`min-w-0 ${selected ? "hidden xl:block" : ""}`}>
        <p className="pb-3 text-xs text-zinc-500">{groups.length} activity groups</p>
        <ul className="divide-y divide-zinc-200 border-y border-zinc-200">{groups.map((group) => <li key={group.id}><button aria-pressed={selected?.id === group.id} onClick={(event) => { lastRowRef.current = event.currentTarget; setSelectedId(group.id); setAttemptId(null); }} className={`grid w-full min-w-0 gap-2 px-3 py-4 text-left hover:bg-zinc-100 sm:grid-cols-[minmax(0,1fr)_8rem] ${selected?.id === group.id ? "bg-teal-50" : ""}`}>
          <span className="min-w-0"><span className="block truncate text-sm font-semibold">{name(group.latest.customerId)}</span><span className="mt-1 block truncate text-sm text-zinc-600">{group.latest.serviceNames.join(", ") || "General follow-up"}</span><span className="mt-1 block text-xs text-zinc-500">{group.latest.channel}{group.attempts.length > 1 ? ` · ${group.attempts.length} failed attempts` : ""}</span></span>
          <span className="text-xs sm:text-right"><span className={`block capitalize ${needsMessageAttention(group.latest) ? "text-amber-800" : "text-zinc-600"}`}>{messageStatus(group.latest)}</span><span className="mt-2 block text-zinc-500">{formatDate(group.latest.sentAt)}</span></span>
        </button></li>)}</ul>
        {!groups.length && <p className="py-10 text-sm text-zinc-500">{view === "attention" && channel === "ALL" && status === "ALL" ? "No messages need attention." : "No matching activity."}</p>}
      </section>
      {selected && record && <section ref={detailsRef} tabIndex={-1} aria-label="Message details" className="min-w-0 border-t border-zinc-200 pt-4 focus:outline-none xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{name(record.customerId)}</h2><Link className="text-sm text-teal-800 underline" href={`/customers/${record.customerId}`}>View customer</Link></div><button onClick={clear} aria-label="Close message details" title="Close message details" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-zinc-300"><X className="h-4 w-4" /></button></div>
        <p className="mt-4 break-words text-sm font-medium">{record.serviceNames.join(", ") || "General follow-up"}</p>
        <p className="mt-1 text-xs capitalize text-zinc-500">{record.channel} · {messageStatus(record)} · {formatDate(record.sentAt)}</p>
        <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{record.message || "No message text recorded."}</p>
        <p className="mt-5 text-sm">Response: {record.responseStatus.replaceAll("_", " ").toLowerCase()}</p>
        {record.followUpDate && <p className="mt-2 text-sm">Follow-up: {formatDate(record.followUpDate)}</p>}
        {record.smsFailureMessage && <p className="mt-3 break-words text-sm text-amber-800">{record.smsFailureCode === "SMS_PROVIDER_NOT_CONFIGURED" ? "Not sent: SMS provider is not connected yet." : record.smsFailureMessage}</p>}
        <h3 className="mt-8 text-sm font-semibold">Attempt history ({selected.attempts.length})</h3>
        <ol className="mt-2 divide-y divide-zinc-200">{selected.attempts.map((attempt, index) => <li key={attempt.id}><button aria-pressed={record.id === attempt.id} onClick={() => setAttemptId(attempt.id)} className={`w-full py-3 text-left text-xs ${record.id === attempt.id ? "font-semibold text-teal-800" : "text-zinc-600"}`}>Attempt {selected.attempts.length - index} · {formatDate(attempt.sentAt)} · {messageStatus(attempt)}<span className="mt-1 block break-all font-normal text-zinc-500">{attempt.id}</span></button></li>)}</ol>
      </section>}
    </div>
  </div>;
}
