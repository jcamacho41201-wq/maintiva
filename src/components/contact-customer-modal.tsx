"use client";

import { useMemo, useRef, useState } from "react";
import type React from "react";
import { CalendarCheck, CheckCircle2, Clipboard, Mail, MessageSquare, Phone, RotateCcw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  availableContactChannels,
  defaultContactChannel,
  type ContactWorkflowChannel,
} from "@/lib/contact-workflow";
import type { Customer, CustomerResponseStatus, OutreachChannel, Shop, Vehicle, VehicleMaintenanceRecord } from "@/lib/demo-data";
import {
  buildOutreachDraft,
  outreachTemplateReasons,
  outreachTemplateVariables,
  templateReasonForGroup,
  unresolvedTemplateTokens,
  type OutreachTemplateReason,
} from "@/lib/outreach-templates";
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
  shop,
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
  shop: Pick<Shop, "name" | "phone" | "email">;
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
    idempotencyKey?: string;
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
  const initialTemplateReason = templateReasonForGroup(group);
  const initialVariables = outreachTemplateVariables({
    customer,
    vehicle,
    shop,
    group,
  });
  const initialDraft = buildOutreachDraft({
    channel: initialChannel === "TEXT" ? "TEXT" : "EMAIL",
    reason: initialTemplateReason,
    variables: initialVariables,
    includeBookingLink: false,
  });
  const [channel, setChannel] = useState<ContactWorkflowChannel>(initialChannel);
  const [templateReason, setTemplateReason] = useState<OutreachTemplateReason>(initialTemplateReason);
  const [includeBookingLink, setIncludeBookingLink] = useState(false);
  const [subject, setSubject] = useState(initialDraft.subject);
  const [message, setMessage] = useState(initialDraft.body);
  const [draftEdited, setDraftEdited] = useState(false);
  const [responseStatus, setResponseStatus] = useState<CustomerResponseStatus>("NO_RESPONSE");
  const [followUpDate, setFollowUpDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);
  const [bookingLink, setBookingLink] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const rows = serviceRows(group, records);
  const selectedChannelAvailable = channels.some((item) => item.channel === channel && item.available);
  const canSaveContact = selectedChannelAvailable && !saving && !saved;
  const templateVariables = useMemo(() => outreachTemplateVariables({
    customer,
    vehicle,
    shop,
    group,
    bookingUrl: bookingLink?.url,
  }), [bookingLink?.url, customer, group, shop, vehicle]);
  const unresolvedTokens = unresolvedTemplateTokens(channel === "EMAIL" ? `${subject}\n${message}` : message);
  const smsCharacterCount = message.length;

  function replaceDraft(
    nextChannel: ContactWorkflowChannel,
    nextReason = templateReason,
    nextIncludeBookingLink = includeBookingLink,
    nextBookingUrl = bookingLink?.url,
  ) {
    if (nextChannel === "CALL") {
      setChannel(nextChannel);
      return;
    }
    const variables = nextBookingUrl === bookingLink?.url
      ? templateVariables
      : outreachTemplateVariables({ customer, vehicle, shop, group, bookingUrl: nextBookingUrl });
    const draft = buildOutreachDraft({
      channel: nextChannel === "TEXT" ? "TEXT" : "EMAIL",
      reason: nextReason,
      variables,
      includeBookingLink: nextIncludeBookingLink && Boolean(nextBookingUrl),
    });
    setChannel(nextChannel);
    setTemplateReason(nextReason);
    setIncludeBookingLink(nextIncludeBookingLink && Boolean(nextBookingUrl));
    setSubject(draft.subject);
    setMessage(draft.body);
    setDraftEdited(false);
    setCopied(false);
  }

  function confirmReplaceDraft() {
    return !draftEdited || window.confirm("Replace the current edited draft with the selected template?");
  }

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
      if (writtenChannel) {
        replaceDraft(writtenChannel, templateReason, true, result.bookingLink.url);
      }
    } else if (!draftEdited) {
      replaceDraft(channel, templateReason, true, result.bookingLink.url);
    }
    setCopied(false);
  }

  async function copyText() {
    if (!selectedChannelAvailable) {
      setError("Choose an available contact channel first.");
      return;
    }
    if (channel !== "CALL" && unresolvedTokens.length > 0) {
      setError("This message contains information that still needs to be completed.");
      return;
    }
    try {
      await navigator.clipboard.writeText(channel === "CALL" ? notes : channel === "EMAIL" ? `Subject: ${subject}\n\n${message}` : message);
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
      : channel === "EMAIL"
        ? `Subject: ${subject.trim()}\n\n${message.trim()}`
        : message.trim();
    if (body.length < 3) {
      setError(channel === "CALL" ? "Add call notes or choose an outcome." : "Add a message before marking outreach sent.");
      return;
    }
    if (channel !== "CALL" && unresolvedTokens.length > 0) {
      setError("This message contains information that still needs to be completed.");
      return;
    }
    if (responseStatus === "WANTS_CALLBACK" && !followUpDate) {
      setError("Choose a callback date.");
      return;
    }
    idempotencyKeyRef.current ??= typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setSaving(true);
    const result = await onSave({
      ...queuePayload(group),
      message: body,
      channel,
      responseStatus,
      followUpDate: followUpDate || undefined,
      bookingLinkId: bookingLink?.id,
      idempotencyKey: idempotencyKeyRef.current,
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
                  if (available && confirmReplaceDraft()) replaceDraft(value);
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

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="text-sm font-medium">
            Template
            <select
              value={templateReason}
              onChange={(event) => {
                const nextReason = event.target.value as OutreachTemplateReason;
                if (confirmReplaceDraft()) replaceDraft(channel, nextReason);
              }}
              disabled={channel === "CALL"}
              className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500 disabled:bg-zinc-50"
            >
              {outreachTemplateReasons.map((reason) => (
                <option key={reason.value} value={reason.value}>{reason.label}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => replaceDraft(channel)}
            disabled={channel === "CALL"}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-800 disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </div>

        {group.lastContactedAt && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            Last contacted {formatDate(group.lastContactedAt)}. Review the draft before sending another follow-up.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 p-3">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700">
            <input
              type="checkbox"
              checked={includeBookingLink}
              disabled={!bookingLink || channel === "CALL"}
              onChange={(event) => {
                if (confirmReplaceDraft()) replaceDraft(channel, templateReason, event.target.checked);
              }}
              className="h-4 w-4 rounded border-zinc-300 text-violet-950 focus:ring-violet-500"
            />
            Include booking link
          </label>
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
          {!bookingLink && (
            <span className="text-sm text-zinc-500">
              {customerBookingEnabled ? "No booking link has been created for this message." : "Booking links are not available for this shop yet."}
            </span>
          )}
        </div>

        {channel === "CALL" ? (
          <label className="block text-sm font-semibold">
            Call notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500" />
          </label>
        ) : (
          <div className="space-y-4">
            {channel === "EMAIL" && (
              <label className="block text-sm font-semibold">
                Email subject
                <input
                  value={subject}
                  onChange={(event) => {
                    setSubject(event.target.value);
                    setDraftEdited(true);
                  }}
                  className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm font-normal outline-none focus:border-violet-500"
                />
              </label>
            )}
            <label className="block text-sm font-semibold">
              Editable {channel.toLowerCase()} message
              <textarea
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value);
                  setDraftEdited(true);
                }}
                rows={channel === "EMAIL" ? 7 : 5}
                className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500"
              />
            </label>
            {channel === "TEXT" && <p className="text-sm text-zinc-500">{smsCharacterCount} SMS characters</p>}
            {unresolvedTokens.length > 0 && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                Complete these placeholders before sending: {unresolvedTokens.join(", ")}
              </p>
            )}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
              <p className="font-semibold text-zinc-800">Final preview</p>
              {channel === "EMAIL" && <p className="mt-3 font-medium text-zinc-700">Subject: {subject}</p>}
              <p className="mt-3 whitespace-pre-wrap text-zinc-700">{message}</p>
            </div>
          </div>
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
