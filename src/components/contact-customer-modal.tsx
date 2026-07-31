"use client";

import { useState } from "react";
import type React from "react";
import { CalendarCheck, CheckCircle2, Clipboard, Mail, MessageSquare, Phone, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  availableContactChannels,
  defaultContactChannel,
  type ContactWorkflowChannel,
} from "@/lib/contact-workflow";
import type { Customer, CustomerResponseStatus, OutreachChannel, Vehicle, VehicleMaintenanceRecord } from "@/lib/demo-data";
import type { RevenueQueueGroup } from "@/lib/revenue-recovery";
import { formatCurrency, formatDate, formatLaborHours } from "@/lib/utils";

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

export function ContactCustomerModal({
  group,
  customer,
  vehicle,
  records,
  onClose,
  onBook,
  onSave,
  onCreateBookingLink,
  customerBookingEnabled,
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
  customerBookingEnabled: boolean;
}) {
  const channels = availableContactChannels(customer);
  const initialChannel = defaultContactChannel(customer) ?? "EMAIL";
  const [channel, setChannel] = useState<ContactWorkflowChannel>(initialChannel);
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
  const selectedChannelAvailable = channels.some((item) => item.channel === channel && item.available);
  const canSaveContact = selectedChannelAvailable && !saving && !saved;

  async function createLink() {
    if (!customerBookingEnabled) {
      return;
    }
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
      const writtenChannel = channels.find((item) => item.available && item.channel !== "CALL")?.channel;
      if (writtenChannel) setChannel(writtenChannel);
    }
    setMessage(result.bookingLink.message ?? `${message.trim()}\n\nSchedule here: ${result.bookingLink.url}`);
    setCopied(false);
  }

  async function copyText() {
    if (!selectedChannelAvailable) {
      setError("Choose an available contact channel first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(channel === "CALL" ? notes : message);
      setCopied(true);
      setError("");
    } catch {
      setError("Copy failed. Select the message text and copy it manually.");
    }
  }

  async function saveContact() {
    if (!selectedChannelAvailable) {
      setError("Choose an available contact channel first.");
      return;
    }
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
                <p className="mt-1 text-zinc-700">{formatCurrency(row.priceCents)} · {formatLaborHours(row.laborHours)}</p>
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
          {channels.map(({ channel: value, label, available, reason }) => {
            const Icon = value === "TEXT" ? MessageSquare : value === "EMAIL" ? Mail : Phone;
            return (
              <button
                key={value}
                onClick={() => {
                  if (available) setChannel(value);
                }}
                disabled={!available}
                className={`flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                  channel === value ? "border-violet-950 bg-violet-950 text-white" : "border-zinc-200 text-zinc-700"
                }`}
                aria-pressed={channel === value}
                title={available ? `${label} available` : reason}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>

        {customerBookingEnabled && (
          <button
            onClick={createLink}
            disabled={creatingLink || saving || Boolean(bookingLink)}
            className="inline-flex items-center gap-2 rounded-lg border border-violet-200 px-4 py-2 text-sm font-semibold text-violet-950 disabled:opacity-60"
          >
            <CalendarCheck className="h-4 w-4" />
            {creatingLink ? "Creating link..." : bookingLink ? "Booking link created" : "Create booking link"}
          </button>
        )}

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
              <button onClick={copyText} disabled={!selectedChannelAvailable || saving} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-800 disabled:opacity-60">
                <Clipboard className="h-4 w-4" />
                Copy {channel.toLowerCase()}
              </button>
            )}
            <button onClick={saveContact} disabled={!canSaveContact} className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
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
