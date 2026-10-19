import type { DemoState, OutreachRecord } from "@/lib/demo-data";
import { buildRevenueOpportunities, groupRevenueOpportunities, type RevenueOpportunity } from "@/lib/revenue-recovery";
import { resolveVehicleForecastMileage, stateForecastAsOfDate } from "@/lib/demo-calculations";
import { resolveMaintenanceInterval } from "@/lib/service-intervals";
import { addCalendarDays, calendarDaysBetween, normalizeDateOnly } from "@/lib/forecast-dates";
import { canContactCustomerForDraft } from "@/lib/contact-workflow";
import { calculateSmartMaintenanceBlockAvailability } from "@/lib/smart-maintenance-blocks";
import { estimateServiceDueDate } from "@/lib/adaptive-mileage";

export function retentionOpportunities(state: DemoState) {
  return buildRevenueOpportunities(state).filter((item) =>
    item.shopId === state.shop.id &&
    state.customers.some((customer) => customer.id === item.customerId && customer.shopId === state.shop.id && !customer.archivedAt) &&
    state.vehicles.some((vehicle) => vehicle.id === item.vehicleId && vehicle.customerId === item.customerId && vehicle.shopId === state.shop.id && !vehicle.archivedAt),
  );
}

export function isRecordedContact(record: OutreachRecord) {
  if (record.smsDeliveryStatus) return ["SENT", "DELIVERED"].includes(record.smsDeliveryStatus);
  return Boolean(record.manuallySentAt) || ["MANUALLY_SENT", "RESPONDED", "SCHEDULED"].includes(record.status);
}

export function retentionType(item: RevenueOpportunity) {
  if (["DECLINED_WORK", "DEFERRED_WORK"].includes(item.source)) return "Deferred Work";
  if (item.source === "REACTIVATION") return "Customer At Risk";
  return "Due Service";
}

export function readyForOutreach(state: DemoState) {
  const today = stateForecastAsOfDate(state);
  const now = Date.now();
  return groupRevenueOpportunities(retentionOpportunities(state).filter((item) => {
    const customer = state.customers.find((value) => value.id === item.customerId)!;
    if (!["ACTIVE", "WATCHLIST"].includes(customer.status) || item.stage !== "IDENTIFIED") return false;
    if (["SNOOZED", "STOPPED", "DECLINED"].includes(item.outreachStatus)) return false;
    if (retentionType(item) === "Deferred Work" && (item.dueDate || item.dueMileage)) {
      const dateDue = item.dueDate && normalizeDateOnly(item.dueDate, state.shop.timezone) <= today;
      const mileageDue = item.dueMileage && item.forecastMileage != null && item.forecastMileage >= item.dueMileage;
      if (!dateDue && !mileageDue) return false;
    }
    if (state.appointmentRequests.some((request) => request.shopId === state.shop.id && request.vehicleId === item.vehicleId && request.status === "PENDING" && Date.parse(request.expiresAt) > now)) return false;
    if (state.appointments.some((appointment) => appointment.shopId === state.shop.id && appointment.vehicleId === item.vehicleId && ["REQUESTED", "CONFIRMED", "IN_PROGRESS"].includes(appointment.status))) return false;
    return canContactCustomerForDraft(customer).enabled;
  }));
}

export type ReportRange = "ALL" | "MONTH" | "30_DAYS" | "QUARTER";

export function retentionReport(state: DemoState, range: ReportRange = "ALL") {
  const today = stateForecastAsOfDate(state);
  const monthStart = `${today.slice(0, 7)}-01`;
  const quarterMonth = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
  const from = range === "MONTH" ? monthStart : range === "30_DAYS" ? addCalendarDays(today, -29) : range === "QUARTER" ? `${today.slice(0, 4)}-${String(quarterMonth).padStart(2, "0")}-01` : "0000-01-01";
  function inRange(date?: string) {
    if (!date || !Number.isFinite(Date.parse(date))) return false;
    const day = normalizeDateOnly(date, state.shop.timezone);
    return day >= from && day <= today;
  }
  const opportunities = retentionOpportunities(state);
  const contacts = state.outreachRecords.filter((item) => item.shopId === state.shop.id && isRecordedContact(item) && inRange(item.smsSentAt ?? item.manuallySentAt ?? item.sentAt));
  const contactedIds = new Set(contacts.map((item) => item.customerId));
  const responses = new Set(contacts.filter((item) => item.responseStatus !== "NO_RESPONSE").map((item) => item.customerId));
  const appointments = state.appointments.filter((item) => item.shopId === state.shop.id && item.attributionSource === "MAINTIVA_OUTREACH" && !["CANCELLED", "NO_SHOW"].includes(item.status));
  const completed = appointments.filter((item) => item.status === "COMPLETED" && inRange(item.completedAt));
  const recordedRevenue = completed.filter((item) => item.completedRevenueCents !== undefined && Number.isFinite(item.completedRevenueCents) && item.completedRevenueCents >= 0);
  // Appointment has no creation timestamp in the client contract; use scheduled date and label it explicitly.
  const scheduled = appointments.filter((item) => inRange(item.scheduledStart));
  const bookedCustomerIds = new Set(scheduled.map((item) => item.customerId));
  const converted = [...contactedIds].filter((id) => bookedCustomerIds.has(id)).length;
  const recoveredRevenueCents = recordedRevenue.reduce((sum, item) => sum + item.completedRevenueCents!, 0);
  const pendingRequests = state.appointmentRequests.filter((item) => item.shopId === state.shop.id && item.status === "PENDING");
  const deferredRevenueCents = recordedRevenue.filter((appointment) => {
    const linked = opportunities.find((item) => item.id === appointment.opportunityId);
    // Do not attribute an entire mixed-service appointment to deferred work.
    return linked && retentionType(linked) === "Deferred Work" && appointment.serviceNames.length === 1 && linked.serviceNames.includes(appointment.serviceNames[0]);
  }).reduce((sum, item) => sum + item.completedRevenueCents!, 0);
  return {
    from, through: today,
    recoveredRevenueCents,
    deferredRevenueCents,
    customersReturned: new Set(completed.map((item) => item.customerId)).size,
    customersContacted: contactedIds.size,
    customerResponses: responses.size,
    appointmentsGenerated: scheduled.length,
    pendingRequests: pendingRequests.length,
    requestCount: state.appointmentRequests.filter((item) => item.shopId === state.shop.id && inRange(item.customerSubmittedAt)).length,
    missingRevenueCount: completed.length - recordedRevenue.length,
    completedCount: completed.length,
    estimatedScheduledCents: appointments.filter((item) => ["REQUESTED", "CONFIRMED", "IN_PROGRESS"].includes(item.status)).reduce((sum, item) => sum + item.totalPriceCents, 0),
    estimatedOpportunityCents: opportunities.filter((item) => ["IDENTIFIED", "CONTACTED", "RESPONDED"].includes(item.stage)).reduce((sum, item) => sum + item.estimatedRevenueCents, 0),
    responseRate: contactedIds.size ? Math.round(responses.size / contactedIds.size * 100) : null,
    bookingRate: contactedIds.size ? Math.round(converted / contactedIds.size * 100) : null,
    roi: null,
  };
}

export function upcomingRetention(state: DemoState) {
  const asOf = stateForecastAsOfDate(state);
  const items = state.maintenanceRecords.flatMap((record) => {
    if (record.shopId !== state.shop.id || record.isActive === false) return [];
    const vehicle = state.vehicles.find((item) => item.id === record.vehicleId && item.shopId === state.shop.id && !item.archivedAt);
    const customer = vehicle && state.customers.find((item) => item.id === vehicle.customerId && item.shopId === state.shop.id && !item.archivedAt && ["ACTIVE", "WATCHLIST"].includes(item.status));
    if (!vehicle || !customer) return [];
    if (state.appointments.some((appointment) => appointment.shopId === state.shop.id && ["REQUESTED", "CONFIRMED", "IN_PROGRESS"].includes(appointment.status) && appointment.maintenanceRecordIds.includes(record.id))) return [];
    const service = state.services.find((item) => item.id === record.serviceId && item.shopId === state.shop.id);
    if (service?.isActive === false) return [];
    const forecast = resolveVehicleForecastMileage(state, vehicle);
    const effective = resolveMaintenanceInterval({ record, service, vehicle, forecastMileage: forecast, asOf, shopTimezone: state.shop.timezone });
    if (effective.status === "NOT_ENOUGH_HISTORY") return [];
    const dueDate = estimateServiceDueDate({ currentMileage: forecast.mileage ?? 0, dailyMileage: forecast.mileage == null ? 0 : forecast.dailyMileage ?? 0, effective, asOf }).firstDueDate;
    if (!dueDate) return [];
    const days = calendarDaysBetween(asOf, dueDate);
    return days > 0 && days <= 90 ? [{ id: record.id, customerId: customer.id, vehicleId: vehicle.id, name: effective.serviceName, dueDate, days, valueCents: effective.priceCents }] : [];
  });
  return [30, 60, 90].map((days) => ({ days, items: items.filter((item) => item.days <= days), valueCents: items.filter((item) => item.days <= days).reduce((sum, item) => sum + item.valueCents, 0) }));
}

export function openCapacityOpportunityIds(state: DemoState) {
  const today = stateForecastAsOfDate(state);
  return new Set(retentionOpportunities(state).filter((item) => {
    if (!["IDENTIFIED", "CONTACTED", "RESPONDED"].includes(item.stage) || !item.serviceDefinitionId) return false;
    return calculateSmartMaintenanceBlockAvailability({
      shop: state.shop, blocks: state.smartMaintenanceBlocks, blackouts: state.smartMaintenanceBlockBlackouts,
      services: state.services.map((service) => service.id === item.serviceDefinitionId ? { ...service, estimatedLaborMinutes: Math.ceil(item.estimatedLaborHours * 60) } : service),
      selectedServiceIds: [item.serviceDefinitionId], appointments: state.appointments,
      commitments: state.appointmentRequests.filter((request) => request.shopId === state.shop.id && request.status === "PENDING" && Date.parse(request.expiresAt) > Date.now()).map((request) => ({ id: request.id, shopId: request.shopId, blockId: request.smartMaintenanceBlockId, startsAt: request.requestedStart, endsAt: request.requestedEnd, status: "PENDING" as const, vehicleCount: 1, laborMinutes: request.totalLaborMinutes })),
      dateFrom: today, dateTo: addCalendarDays(today, 14),
    }).length > 0;
  }).map((item) => item.id));
}

export type RetentionTimelineEvent = { id: string; date: string; kind: string; title: string; detail: string; vehicleId: string };

export function customerRetentionTimeline(state: DemoState, customerId: string, vehicleId?: string) {
  const matches = (item: { shopId: string; customerId: string; vehicleId: string }) => item.shopId === state.shop.id && item.customerId === customerId && (!vehicleId || item.vehicleId === vehicleId);
  const events: RetentionTimelineEvent[] = [
    ...state.serviceRecords.filter(matches).map((item) => ({ id: `service-${item.id}`, date: item.completedAt, kind: "Service visit", title: item.serviceName, detail: item.mileage == null ? "Mileage not recorded" : `${item.mileage.toLocaleString()} mi`, vehicleId: item.vehicleId })),
    ...state.declinedWorkRecords.filter(matches).map((item) => ({ id: `deferred-${item.id}`, date: item.declinedAt, kind: "Deferred work", title: item.serviceName, detail: item.status, vehicleId: item.vehicleId })),
    ...retentionOpportunities(state).filter(matches).map((item) => ({ id: `opportunity-${item.id}`, date: item.createdAt, kind: "Opportunity identified", title: item.serviceNames.join(", "), detail: item.explanation, vehicleId: item.vehicleId })),
    ...state.outreachRecords.filter(matches).map((item) => ({ id: `outreach-${item.id}`, date: item.smsSentAt ?? item.manuallySentAt ?? item.sentAt, kind: isRecordedContact(item) ? "Customer contacted" : "Outreach activity", title: `${item.channel} · ${item.smsDeliveryStatus ?? item.status}`, detail: item.message, vehicleId: item.vehicleId })),
    ...state.appointmentRequests.filter(matches).map((item) => ({ id: `request-${item.id}`, date: item.customerSubmittedAt, kind: "Appointment request", title: item.services.map((service) => service.serviceNameSnapshot).join(", "), detail: item.status, vehicleId: item.vehicleId })),
    ...state.appointments.filter(matches).map((item) => ({ id: `appointment-${item.id}`, date: item.completedAt ?? item.scheduledStart, kind: item.status === "COMPLETED" ? "Completed return" : "Appointment", title: item.serviceNames.join(", "), detail: item.status, vehicleId: item.vehicleId })),
  ];
  return events.filter((item) => Number.isFinite(Date.parse(item.date))).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
