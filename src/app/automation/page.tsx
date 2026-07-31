"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type React from "react";
import {
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Clock3,
  ExternalLink,
  Mail,
  MessageSquare,
  Phone,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Appointment, Customer, CustomerResponseStatus, OutreachChannel, Vehicle, VehicleMaintenanceRecord } from "@/lib/demo-data";
import { useDemoStore } from "@/lib/demo-store";
import {
  buildRevenueOpportunities,
  groupRevenueOpportunities,
  type RevenueQueueGroup,
} from "@/lib/revenue-recovery";
import { formatCurrency, formatDate } from "@/lib/utils";

type QueueTab = "NEEDS_ATTENTION" | "CONTACTED" | "BOOKED" | "CLOSED";
type QueueSort = "PRIORITY" | "REVENUE" | "LABOR" | "OLDEST_DUE" | "MOST_OVERDUE" | "RECENT";
type ReasonFilter = "ALL" | "DUE_MAINTENANCE" | "OVERDUE_MAINTENANCE" | "DECLINED_WORK";
type PriorityFilter = "ALL" | "HIGH" | "NORMAL";
type ContactFilter = "ALL" | "NEEDS_OUTREACH" | "CONTACTED" | "SNOOZED";

const workflowTabs: { value: QueueTab; label: string }[] = [
  { value: "NEEDS_ATTENTION", label: "Needs Attention" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "BOOKED", label: "Booked" },
  { value: "CLOSED", label: "Closed" },
];

function priorityVariant(priority: string) {
  if (priority === "HIGH") return "red" as const;
  return "neutral" as const;
}

function priorityLabel(priority: string) {
  return priority === "HIGH" ? "High" : "Normal";
}

function workflowTabFor(group: RevenueQueueGroup): QueueTab {
  if (group.opportunities.every((item) => item.stage === "COMPLETED" || item.stage === "LOST")) {
    return "CLOSED";
  }
  if (group.opportunities.some((item) => item.stage === "BOOKED") || group.appointmentStatus === "Booked") {
    return "BOOKED";
  }
  if (group.opportunities.some((item) => item.stage === "CONTACTED")) {
    return "CONTACTED";
  }
  return "NEEDS_ATTENTION";
}

function workflowLabel(group: RevenueQueueGroup) {
  return workflowTabs.find((tab) => tab.value === workflowTabFor(group))?.label ?? "Needs Attention";
}

function selectedRecordIds(group: RevenueQueueGroup) {
  return group.opportunities
    .map((opportunity) => opportunity.maintenanceRecordId)
    .filter((id): id is string => Boolean(id));
}

function selectedDeclinedWorkIds(group: RevenueQueueGroup) {
  return group.opportunities
    .map((opportunity) => opportunity.declinedWorkRecordId)
    .filter((id): id is string => Boolean(id));
}

function selectedOpportunityIds(group: RevenueQueueGroup) {
  return group.opportunities.map((opportunity) => opportunity.id);
}

function activeSnooze(group: RevenueQueueGroup) {
  return group.opportunities.find((opportunity) => opportunity.outreachStatus === "SNOOZED");
}

function mainReason(group: RevenueQueueGroup) {
  const source = group.opportunities.some((item) => item.source === "OVERDUE_MAINTENANCE")
    ? "Overdue"
    : group.opportunities.some((item) => item.source === "DECLINED_WORK")
      ? "Declined work"
      : "Due maintenance";
  return source;
}

function dueSummary(group: RevenueQueueGroup) {
  const due = group.opportunities.find((item) => item.dueMileage || item.dueDate);
  if (!due) return "Due details unavailable";
  const parts = [
    due.dueMileage ? `${due.dueMileage.toLocaleString()} mi` : "",
    due.dueDate ? formatDate(due.dueDate) : "",
  ].filter(Boolean);
  return parts.join(" or ");
}

type QueueModal = {
  kind: "contact" | "book" | "snooze";
  vehicleId: string;
} | null;

export default function AutomationPage() {
  const store = useDemoStore();
  const { state, ready, loadError } = store;
  const [queueModal, setQueueModal] = useState<QueueModal>(null);
  const [tab, setTab] = useState<QueueTab>("NEEDS_ATTENTION");
  const [sort, setSort] = useState<QueueSort>("PRIORITY");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("ALL");
  const [contactFilter, setContactFilter] = useState<ContactFilter>("ALL");
  const [search, setSearch] = useState("");

  const groups = useMemo(
    () => groupRevenueOpportunities(buildRevenueOpportunities(state)),
    [state],
  );
  const counts = useMemo(
    () => Object.fromEntries(
      workflowTabs.map((item) => [
        item.value,
        groups.filter((group) => workflowTabFor(group) === item.value).length,
      ]),
    ) as Record<QueueTab, number>,
    [groups],
  );
  const filteredGroups = groups.filter((group) => {
    const query = search.trim().toLowerCase();
    if (workflowTabFor(group) !== tab) return false;
    if (reasonFilter !== "ALL" && !group.opportunities.some((item) => item.source === reasonFilter)) return false;
    if (priorityFilter === "HIGH" && group.priority !== "HIGH") return false;
    if (priorityFilter === "NORMAL" && group.priority === "HIGH") return false;
    if (contactFilter === "NEEDS_OUTREACH" && group.outreachStatus !== "Needs outreach") return false;
    if (contactFilter === "CONTACTED" && !group.opportunities.some((item) => ["CONTACTED", "RESPONDED"].includes(item.stage))) return false;
    if (contactFilter === "SNOOZED" && !group.opportunities.some((item) => item.outreachStatus === "SNOOZED")) return false;
    if (query) {
      const searchable = [
        group.customerName,
        group.vehicleLabel,
        ...group.recommendedServices,
      ].join(" ").toLowerCase();
      if (!searchable.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => {
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    if (sort === "REVENUE") return b.estimatedRevenueCents - a.estimatedRevenueCents;
    if (sort === "LABOR") return b.estimatedLaborHours - a.estimatedLaborHours;
    if (sort === "OLDEST_DUE") return a.opportunities[0].daysOverdue - b.opportunities[0].daysOverdue;
    if (sort === "MOST_OVERDUE") {
      return Math.max(...b.opportunities.map((item) => item.daysOverdue)) -
        Math.max(...a.opportunities.map((item) => item.daysOverdue));
    }
    if (sort === "RECENT") {
      return new Date(b.lastContactedAt ?? 0).getTime() - new Date(a.lastContactedAt ?? 0).getTime();
    }
    return rank[a.priority] - rank[b.priority] || b.estimatedRevenueCents - a.estimatedRevenueCents;
  });
  const activeGroup = queueModal ? groups.find((group) => group.vehicleId === queueModal.vehicleId) : undefined;
  const activeRecords = activeGroup
    ? state.maintenanceRecords.filter((record) => selectedRecordIds(activeGroup).includes(record.id))
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Revenue Recovery Queue</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Live maintenance and declined-work opportunities grouped by customer vehicle.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as QueueSort)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold outline-none focus:border-violet-500"
          >
            <option value="PRIORITY">Sort by priority</option>
            <option value="REVENUE">Sort by estimated revenue</option>
            <option value="LABOR">Sort by labor hours</option>
            <option value="OLDEST_DUE">Sort by oldest due date</option>
            <option value="MOST_OVERDUE">Sort by most overdue</option>
            <option value="RECENT">Sort by recent activity</option>
          </select>
          <button
            onClick={() => setAdvancedOpen((open) => !open)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Advanced Filters
            <ChevronDown className={`h-4 w-4 transition ${advancedOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {workflowTabs.map((item) => (
          <button
            key={item.value}
            onClick={() => setTab(item.value)}
            className={`flex min-h-12 items-center justify-between rounded-lg border px-4 py-3 text-left text-sm font-semibold ${
              tab === item.value
                ? "border-violet-950 bg-violet-950 text-white"
                : "border-zinc-200 bg-white text-zinc-700"
            }`}
          >
            <span>{item.label}</span>
            <span className={tab === item.value ? "text-violet-100" : "text-zinc-400"}>{counts[item.value]}</span>
          </button>
        ))}
      </div>

      {advancedOpen && (
        <div className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Customer, vehicle, or service"
            className="h-10 rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:border-violet-500"
          />
          <select
            value={reasonFilter}
            onChange={(event) => setReasonFilter(event.target.value as ReasonFilter)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-violet-500"
          >
            <option value="ALL">Any reason</option>
            <option value="DUE_MAINTENANCE">Due maintenance</option>
            <option value="OVERDUE_MAINTENANCE">Overdue</option>
            <option value="DECLINED_WORK">Declined work</option>
          </select>
          <select
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-violet-500"
          >
            <option value="ALL">Any priority</option>
            <option value="HIGH">High</option>
            <option value="NORMAL">Normal</option>
          </select>
          <select
            value={contactFilter}
            onChange={(event) => setContactFilter(event.target.value as ContactFilter)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-violet-500"
          >
            <option value="ALL">Any contact state</option>
            <option value="NEEDS_OUTREACH">Needs outreach</option>
            <option value="CONTACTED">Contacted or responded</option>
            <option value="SNOOZED">Snoozed</option>
          </select>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {!ready && (
          <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm font-medium text-zinc-600 xl:col-span-2">
            Loading revenue opportunities…
          </div>
        )}
        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800 xl:col-span-2">
            <p className="font-semibold">Revenue opportunities could not be loaded.</p>
          </div>
        )}
        {ready && !loadError && filteredGroups.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-600 xl:col-span-2">
            <p className="font-semibold text-zinc-900">No customers currently need outreach.</p>
            <p className="mt-1">
              Maintiva will add customers here when maintenance becomes due, overdue, or previously recommended work is declined.
            </p>
          </div>
        )}
        {ready && !loadError && filteredGroups.map((group) => {
          const lastContact = group.lastContactedAt;
          const snooze = activeSnooze(group);
          return (
            <Card key={group.id} className="shadow-none">
              <CardContent className="space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link href={`/customers/${group.customerId}`} className="text-lg font-semibold hover:text-violet-900">
                      {group.customerName}
                    </Link>
                    <Link href={`/vehicles/${group.vehicleId}`} className="block truncate text-sm text-zinc-500 hover:text-violet-900">
                      {group.vehicleLabel}
                    </Link>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Badge variant={priorityVariant(group.priority)}>{priorityLabel(group.priority)}</Badge>
                    <Badge variant="neutral">{workflowLabel(group)}</Badge>
                  </div>
                </div>

                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reason</p>
                    <p className="mt-1 font-semibold">{mainReason(group)}</p>
                    <p className="mt-1 text-zinc-600">{dueSummary(group)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Action</p>
                    <p className="mt-1 font-semibold">{group.nextAction}</p>
                    <p className="mt-1 text-zinc-600">
                      {snooze?.lastActivityAt
                        ? `Snoozed until ${formatDate(snooze.lastActivityAt)}`
                        : lastContact
                          ? `Last touch ${formatDate(lastContact)}`
                          : "No prior contact logged"}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {group.opportunities.slice(0, 4).map((opportunity) => (
                    <div key={opportunity.id} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{opportunity.serviceNames.join(", ")}</p>
                          <p className="mt-1 text-xs text-zinc-500">{opportunity.explanation}</p>
                        </div>
                        <Badge variant={opportunity.source === "OVERDUE_MAINTENANCE" ? "red" : "purple"}>
                          {opportunity.sourceLabel}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <p className="text-zinc-500">Value</p>
                    <p className="font-semibold">{formatCurrency(group.estimatedRevenueCents)}</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <p className="text-zinc-500">Labor</p>
                    <p className="font-semibold">{group.estimatedLaborHours} hr</p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 p-3">
                    <p className="text-zinc-500">Services</p>
                    <p className="font-semibold">{group.recommendedServices.length}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link
                    href={`/customers/${group.customerId}`}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open customer
                  </Link>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setQueueModal({ kind: "contact", vehicleId: group.vehicleId })}
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700"
                    >
                      <Phone className="h-4 w-4" />
                      Contact
                    </button>
                    <button
                      onClick={() => setQueueModal({ kind: "book", vehicleId: group.vehicleId })}
                      disabled={workflowTabFor(group) === "BOOKED"}
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-950 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CalendarCheck className="h-4 w-4" />
                      Book
                    </button>
                    <button
                      onClick={() => setQueueModal({ kind: "snooze", vehicleId: group.vehicleId })}
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700"
                      title="Snooze follow-up"
                    >
                      <Clock3 className="h-4 w-4" />
                      Snooze
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {activeGroup && queueModal?.kind === "contact" && (
        <ContactCustomerModal
          group={activeGroup}
          customer={state.customers.find((customer) => customer.id === activeGroup.customerId)!}
          vehicle={state.vehicles.find((vehicle) => vehicle.id === activeGroup.vehicleId)!}
          records={activeRecords}
          onClose={() => setQueueModal(null)}
          onBook={() => setQueueModal({ kind: "book", vehicleId: activeGroup.vehicleId })}
          onSave={store.recordOpportunityContact}
          onCreateBookingLink={store.createBookingLink}
        />
      )}
      {activeGroup && queueModal?.kind === "book" && (
        <BookAppointmentModal
          group={activeGroup}
          customer={state.customers.find((customer) => customer.id === activeGroup.customerId)!}
          vehicle={state.vehicles.find((vehicle) => vehicle.id === activeGroup.vehicleId)!}
          records={activeRecords}
          onClose={() => setQueueModal(null)}
          onSave={store.bookQueueAppointment}
        />
      )}
      {activeGroup && queueModal?.kind === "snooze" && (
        <SnoozeOpportunityModal
          group={activeGroup}
          customer={state.customers.find((customer) => customer.id === activeGroup.customerId)!}
          vehicle={state.vehicles.find((vehicle) => vehicle.id === activeGroup.vehicleId)!}
          onClose={() => setQueueModal(null)}
          onSave={store.snoozeOpportunity}
          onEndSnooze={store.endOpportunitySnooze}
        />
      )}
    </div>
  );
}

function ModalFrame({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 p-5">
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-200"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function queuePayload(group: RevenueQueueGroup) {
  return {
    customerId: group.customerId,
    vehicleId: group.vehicleId,
    opportunityIds: selectedOpportunityIds(group),
    maintenanceRecordIds: selectedRecordIds(group),
    declinedWorkRecordIds: selectedDeclinedWorkIds(group),
  };
}

function serviceRows(group: RevenueQueueGroup, records: VehicleMaintenanceRecord[]) {
  return group.opportunities.map((opportunity) => {
    const record = opportunity.maintenanceRecordId
      ? records.find((item) => item.id === opportunity.maintenanceRecordId)
      : undefined;
    return {
      id: opportunity.id,
      name: opportunity.serviceNames.join(", "),
      reason: opportunity.sourceLabel,
      priceCents: opportunity.estimatedRevenueCents,
      laborHours: record?.laborHours ?? opportunity.estimatedLaborHours,
      timing: opportunity.dueDate ? formatDate(opportunity.dueDate) : opportunity.dueMileage ? `${opportunity.dueMileage.toLocaleString()} mi` : "Timing not recorded",
    };
  });
}

function ContactCustomerModal({
  group,
  customer,
  vehicle,
  records,
  onClose,
  onBook,
  onSave,
  onCreateBookingLink,
}: {
  group: RevenueQueueGroup;
  customer: Customer;
  vehicle: Vehicle;
  records: VehicleMaintenanceRecord[];
  onClose: () => void;
  onBook: () => void;
  onSave: (input: {
    customerId: string;
    vehicleId: string;
    opportunityIds: string[];
    maintenanceRecordIds: string[];
    declinedWorkRecordIds: string[];
    message: string;
    channel: OutreachChannel;
    responseStatus: CustomerResponseStatus;
    followUpDate?: string;
    bookingLinkId?: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  onCreateBookingLink: (input: {
    customerId: string;
    vehicleId: string;
    opportunityIds: string[];
  }) => Promise<{ ok: boolean; message?: string; bookingLink?: { id: string; url: string; expiresAt: string; message?: string } }>;
}) {
  const [channel, setChannel] = useState<"TEXT" | "EMAIL" | "CALL">("TEXT");
  const [message, setMessage] = useState(
    `Hi ${customer.firstName}, this is Maintiva with ${group.recommendedServices.join(", ")} recommended for your ${group.vehicleLabel}. Reply here or call us to choose a time.`,
  );
  const [responseStatus, setResponseStatus] = useState<CustomerResponseStatus>("NO_RESPONSE");
  const [followUpDate, setFollowUpDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);
  const [bookingLink, setBookingLink] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const rows = serviceRows(group, records);

  async function createLink() {
    setCreatingLink(true);
    setError("");
    const result = await onCreateBookingLink({
      customerId: group.customerId,
      vehicleId: group.vehicleId,
      opportunityIds: selectedOpportunityIds(group),
    });
    setCreatingLink(false);
    if (!result.ok || !result.bookingLink) {
      setError(result.message ?? "Booking link could not be created.");
      return;
    }
    setBookingLink(result.bookingLink);
    if (channel === "CALL") {
      setChannel("TEXT");
    }
    setMessage(result.bookingLink.message ?? `${message.trim()}\n\nSchedule here: ${result.bookingLink.url}`);
    setCopied(false);
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(channel === "CALL" ? notes : message);
      setCopied(true);
      setError("");
    } catch {
      setError("Copy failed. Select the message text and copy it manually.");
    }
  }

  async function saveContact() {
    const body = channel === "CALL"
      ? [
          `Call outcome: ${responseStatus.replaceAll("_", " ").toLowerCase()}.`,
          notes.trim() ? `Notes: ${notes.trim()}` : "",
        ].filter(Boolean).join("\n")
      : message.trim();
    if (body.length < 3) {
      setError(channel === "CALL" ? "Add call notes or choose an outcome." : "Add a message before marking outreach sent.");
      return;
    }
    if (responseStatus === "WANTS_CALLBACK" && !followUpDate) {
      setError("Choose a callback date.");
      return;
    }
    setSaving(true);
    const result = await onSave({
      ...queuePayload(group),
      message: body,
      channel,
      responseStatus,
      followUpDate: followUpDate || undefined,
      bookingLinkId: bookingLink?.id,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "The contact could not be saved.");
      return;
    }
    setSaved(true);
    setError("");
  }

  return (
    <ModalFrame title="Contact customer" subtitle={`${customer.firstName} ${customer.lastName} · ${vehicle.year} ${vehicle.make} ${vehicle.model}`} onClose={onClose}>
      <div className="space-y-5 p-5">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        {copied && !saved && <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700">Message copied. Copying alone does not mark the customer contacted.</p>}
        {bookingLink && !saved && <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-700">Booking link ready. It will be tied to this outreach when you mark the message as sent.</p>}
        {saved && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">Outreach saved. No appointment was created.</p>}

        <div className="rounded-lg border border-zinc-200 p-4">
          <div className="grid gap-3 text-sm md:grid-cols-3">
            {rows.map((row) => (
              <div key={row.id}>
                <p className="font-semibold">{row.name}</p>
                <p className="mt-1 text-zinc-500">{row.reason} · {row.timing}</p>
                <p className="mt-1 text-zinc-700">{formatCurrency(row.priceCents)} · {row.laborHours} hr</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant={customer.smsConsent ? "green" : "neutral"}>Text {customer.smsConsent ? "permitted" : "not permitted"}</Badge>
            <Badge variant={customer.emailConsent ? "green" : "neutral"}>Email {customer.emailConsent ? "permitted" : "not permitted"}</Badge>
            <Badge variant={customer.callConsent ? "green" : "neutral"}>Call {customer.callConsent ? "permitted" : "not permitted"}</Badge>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Communication channel">
          {[
            ["TEXT", MessageSquare, "Text"],
            ["EMAIL", Mail, "Email"],
            ["CALL", Phone, "Call"],
          ].map(([value, Icon, label]) => (
            <button
              key={String(value)}
              onClick={() => setChannel(value as "TEXT" | "EMAIL" | "CALL")}
              className={`flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-semibold ${
                channel === value ? "border-violet-950 bg-violet-950 text-white" : "border-zinc-200 text-zinc-700"
              }`}
              aria-pressed={channel === value}
            >
              <Icon className="h-4 w-4" />
              {String(label)}
            </button>
          ))}
        </div>

        <button
          onClick={createLink}
          disabled={creatingLink || saving || Boolean(bookingLink)}
          className="inline-flex items-center gap-2 rounded-lg border border-violet-200 px-4 py-2 text-sm font-semibold text-violet-950 disabled:opacity-60"
        >
          <CalendarCheck className="h-4 w-4" />
          {creatingLink ? "Creating link..." : bookingLink ? "Booking link created" : "Create booking link"}
        </button>

        {channel === "CALL" ? (
          <label className="block text-sm font-semibold">
            Call notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500" />
          </label>
        ) : (
          <label className="block text-sm font-semibold">
            Editable {channel.toLowerCase()} message
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={5} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500" />
          </label>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Customer response
            <select value={responseStatus} onChange={(event) => setResponseStatus(event.target.value as CustomerResponseStatus)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500">
              <option value="NO_RESPONSE">No response</option>
              <option value="INTERESTED">Interested</option>
              <option value="NOT_NOW">Not interested</option>
              <option value="WANTS_CALLBACK">Call back later</option>
              <option value="BOOKED">Appointment requested</option>
              <option value="DECLINED">Already completed elsewhere</option>
              <option value="DO_NOT_CONTACT">Do not contact</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Callback date
            <input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-5">
          <Badge variant="neutral">Manual outreach · no live send integration</Badge>
          <div className="flex flex-wrap gap-2">
            {channel !== "CALL" && (
              <button onClick={copyText} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-800 disabled:opacity-60">
                <Clipboard className="h-4 w-4" />
                Copy {channel.toLowerCase()}
              </button>
            )}
            <button onClick={saveContact} disabled={saving || saved} className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <CheckCircle2 className="h-4 w-4" />
              {saved ? "Saved" : saving ? "Saving..." : channel === "CALL" ? "Record call" : `Mark ${channel.toLowerCase()} as sent`}
            </button>
            {saved && ["INTERESTED", "BOOKED"].includes(responseStatus) && (
              <button onClick={onBook} className="inline-flex items-center gap-2 rounded-lg border border-violet-200 px-4 py-2 text-sm font-semibold text-violet-950">
                <CalendarCheck className="h-4 w-4" />
                Book appointment
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}

function BookAppointmentModal({
  group,
  customer,
  vehicle,
  records,
  onClose,
  onSave,
}: {
  group: RevenueQueueGroup;
  customer: Customer;
  vehicle: Vehicle;
  records: VehicleMaintenanceRecord[];
  onClose: () => void;
  onSave: (input: {
    customerId: string;
    vehicleId: string;
    opportunityIds: string[];
    maintenanceRecordIds: string[];
    declinedWorkRecordIds: string[];
    date: string;
    time: string;
    status: Appointment["status"];
    notes?: string;
  }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const rows = serviceRows(group, records);
  const totalPrice = rows.reduce((sum, row) => sum + row.priceCents, 0);
  const totalLabor = rows.reduce((sum, row) => sum + row.laborHours, 0);

  async function createAppointment() {
    if (!date || !time) {
      setError("Choose an appointment date and time.");
      return;
    }
    setSaving(true);
    const result = await onSave({
      ...queuePayload(group),
      date,
      time,
      status: "CONFIRMED",
      notes,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "Appointment could not be created.");
      return;
    }
    onClose();
  }

  return (
    <ModalFrame title="Book appointment" subtitle={`${customer.firstName} ${customer.lastName} · ${vehicle.year} ${vehicle.make} ${vehicle.model}`} onClose={onClose}>
      <div className="space-y-5 p-5">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
              <div>
                <p className="font-semibold">{row.name}</p>
                <p className="text-zinc-500">{row.reason} · {row.timing}</p>
              </div>
              <p className="font-semibold">{formatCurrency(row.priceCents)} · {row.laborHours} hr</p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-zinc-500">Total price</p>
            <p className="mt-1 text-2xl font-semibold">{formatCurrency(totalPrice)}</p>
          </div>
          <div>
            <p className="text-sm text-zinc-500">Total labor</p>
            <p className="mt-1 text-2xl font-semibold">{totalLabor} hr</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
          <label className="text-sm font-medium">
            Start time
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
          <label className="text-sm font-medium">
            Duration
            <input value={`${totalLabor} hr`} readOnly className="mt-2 h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 outline-none" />
          </label>
          <label className="text-sm font-medium">
            Confirmation method
            <select className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" defaultValue={customer.preferredContact === "EMAIL" ? "EMAIL" : "TEXT"}>
              <option value="TEXT">Text</option>
              <option value="EMAIL">Email</option>
              <option value="CALL">Call</option>
            </select>
          </label>
        </div>
        <label className="block text-sm font-semibold">
          Customer notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500" />
        </label>
        <div className="flex justify-end gap-2 border-t border-zinc-100 pt-5">
          <button onClick={onClose} disabled={saving} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-60">Cancel</button>
          <button onClick={createAppointment} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            <CalendarCheck className="h-4 w-4" />
            {saving ? "Saving..." : "Create appointment"}
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}

function SnoozeOpportunityModal({
  group,
  customer,
  vehicle,
  onClose,
  onSave,
  onEndSnooze,
}: {
  group: RevenueQueueGroup;
  customer: Customer;
  vehicle: Vehicle;
  onClose: () => void;
  onSave: (input: {
    customerId: string;
    vehicleId: string;
    opportunityIds: string[];
    maintenanceRecordIds: string[];
    declinedWorkRecordIds: string[];
    snoozedUntil: string;
    reason: string;
    notes?: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  onEndSnooze: (input: {
    customerId: string;
    vehicleId: string;
    opportunityIds: string[];
    maintenanceRecordIds: string[];
    declinedWorkRecordIds: string[];
  }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [snoozedUntil, setSnoozedUntil] = useState("");
  const [reason, setReason] = useState("Customer asked for a later follow-up");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const snooze = activeSnooze(group);

  async function snoozeOpportunity() {
    if (!snoozedUntil) {
      setError("Choose a future snooze date.");
      return;
    }
    setSaving(true);
    const result = await onSave({
      ...queuePayload(group),
      snoozedUntil,
      reason,
      notes,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "The opportunity could not be snoozed.");
      return;
    }
    onClose();
  }

  async function endSnoozeNow() {
    setSaving(true);
    const result = await onEndSnooze(queuePayload(group));
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "The opportunity could not be returned to Needs Attention.");
      return;
    }
    onClose();
  }

  return (
    <ModalFrame title="Snooze opportunity" subtitle={`${customer.firstName} ${customer.lastName} · ${vehicle.year} ${vehicle.make} ${vehicle.model}`} onClose={onClose}>
      <div className="space-y-5 p-5">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
        {snooze?.lastActivityAt && <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700">Currently snoozed until {formatDate(snooze.lastActivityAt)}.</p>}
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ["Tomorrow", 1],
            ["3 days", 3],
            ["1 week", 7],
            ["2 weeks", 14],
            ["1 month", 30],
          ].map(([label, days]) => (
            <button key={label} onClick={() => setSnoozedUntil(new Date(Date.now() + Number(days) * 86_400_000).toISOString().slice(0, 10))} className="h-10 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700">
              {label}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Snooze until
            <input type="date" value={snoozedUntil} onChange={(event) => setSnoozedUntil(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
          <label className="text-sm font-medium">
            Reason
            <select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500">
              <option>Customer asked for a later follow-up</option>
              <option>Waiting for payday</option>
              <option>Waiting for parts</option>
              <option>Vehicle currently unavailable</option>
              <option>Customer traveling</option>
              <option>Shop capacity</option>
              <option>Other</option>
            </select>
          </label>
        </div>
        <label className="block text-sm font-semibold">
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500" />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-5">
          <p className="text-sm text-zinc-500">Reason stays {mainReason(group)} while this follow-up is snoozed.</p>
          <div className="flex flex-wrap gap-2">
            {snooze && (
              <button onClick={endSnoozeNow} disabled={saving} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-60">
                End snooze now
              </button>
            )}
            <button onClick={snoozeOpportunity} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <Clock3 className="h-4 w-4" />
              {saving ? "Saving..." : snoozedUntil ? `Snooze until ${formatDate(snoozedUntil)}` : "Snooze opportunity"}
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}
