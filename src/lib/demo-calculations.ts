import {
  asOfDate,
  calculateAppointmentTotals,
  type Appointment,
  type DemoState,
  type MaintenanceStatus,
  type OutreachStatus,
  type Vehicle,
  type VehicleMaintenanceRecord,
} from "@/lib/demo-data";
import { resolveEffectiveForecastMileage } from "@/lib/adaptive-mileage";
import { resolveMaintenanceInterval } from "@/lib/service-intervals";

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function vehicleLabel(vehicle: Vehicle) {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}

export function customerName(state: DemoState, customerId: string) {
  const customer = state.customers.find((item) => item.id === customerId);
  return customer ? `${customer.firstName} ${customer.lastName}` : "Unknown customer";
}

export function calculateMaintenanceStatus(
  record: VehicleMaintenanceRecord,
  vehicle: Vehicle,
  asOf: Date = asOfDate,
  state?: DemoState,
) {
  const service = state?.services.find((item) => item.id === record.serviceId);
  const forecastMileage = state ? resolveVehicleForecastMileage(state, vehicle, asOf) : undefined;
  const effective = resolveMaintenanceInterval({ record, service, vehicle, forecastMileage, asOf });

  return {
    status: effective.status === "NOT_ENOUGH_HISTORY" ? "HEALTHY" as MaintenanceStatus : effective.status,
    displayStatus: effective.status,
    dueText: effective.dueText,
    lifeRemaining: effective.lifeRemaining,
    milesUntilDue: effective.milesUntilDue ?? 0,
    daysUntilDue: effective.daysUntilDue ?? 0,
    nextDueMileage: effective.nextDueMileage,
    nextDueDate: effective.nextDueDate,
    sourceLabel: effective.sourceLabel,
    thresholdCause: effective.thresholdCause,
    forecastMileage: effective.forecastMileage,
    forecastMileageKind: effective.forecastMileageKind,
    latestKnownMileage: effective.latestKnownMileage,
    latestKnownDate: effective.latestKnownDate,
    forecastConfidence: effective.forecastConfidence,
  };
}

export function resolveVehicleForecastMileage(state: DemoState, vehicle: Vehicle, asOf: Date | string = asOfDate) {
  const profile = state.drivingProfiles.find((item) => item.vehicleId === vehicle.id);
  return resolveEffectiveForecastMileage({
    shopId: state.shop.id,
    vehicleId: vehicle.id,
    readings: state.mileageReadings.filter((reading) => reading.vehicleId === vehicle.id),
    shopDefaultAnnualMileage: state.shop.defaultAnnualMileage,
    customerReportedAnnualMileage: profile?.customerReportedAnnualMileage ?? vehicle.estimatedAnnualMileage,
    customerReportedAt: profile?.customerReportedAt ?? null,
    customerReportedByUserId: profile?.customerReportedByUserId ?? null,
    existingProfile: profile,
    asOf,
  });
}

export function getRecordStatus(state: DemoState, record: VehicleMaintenanceRecord) {
  const vehicle = state.vehicles.find((item) => item.id === record.vehicleId);
  if (!vehicle) {
    return {
      status: "HEALTHY" as MaintenanceStatus,
      dueText: "Vehicle unavailable",
      lifeRemaining: 100,
      milesUntilDue: 0,
      daysUntilDue: 0,
    };
  }

  return calculateMaintenanceStatus(record, vehicle, asOfDate, state);
}

export function getRecommendedRecords(state: DemoState, vehicleId?: string) {
  return state.maintenanceRecords
    .filter((record) => !vehicleId || record.vehicleId === vehicleId)
    .filter((record) => record.isActive !== false)
    .map((record) => ({ record, calculation: getRecordStatus(state, record) }))
    .filter(({ calculation }) => calculation.status !== "HEALTHY")
    .sort((a, b) => a.calculation.lifeRemaining - b.calculation.lifeRemaining);
}

export function getOpportunityStatus(records: VehicleMaintenanceRecord[]): OutreachStatus {
  if (records.length > 0 && records.every((record) => record.outreachStatus === "SCHEDULED")) {
    return "SCHEDULED";
  }

  if (records.some((record) => record.outreachStatus === "MANUALLY_SENT")) {
    return "MANUALLY_SENT";
  }

  if (records.some((record) => record.outreachStatus === "DRAFTED")) {
    return "DRAFTED";
  }

  return "NEEDS_OUTREACH";
}

export function getVehicleOpportunities(state: DemoState) {
  const byVehicle = new Map<string, VehicleMaintenanceRecord[]>();

  for (const { record } of getRecommendedRecords(state)) {
    const records = byVehicle.get(record.vehicleId) ?? [];
    records.push(record);
    byVehicle.set(record.vehicleId, records);
  }

  return Array.from(byVehicle.entries())
    .map(([vehicleId, records]) => {
      const vehicle = state.vehicles.find((item) => item.id === vehicleId);
      const customer = vehicle
        ? state.customers.find((item) => item.id === vehicle.customerId)
        : undefined;
      const totals = calculateAppointmentTotals(records);
      const calculations = records.map((record) => getRecordStatus(state, record));

      return {
        id: vehicleId,
        vehicle,
        customer,
        records,
        calculations,
        opportunityStatus: getOpportunityStatus(records),
        urgency: Math.min(...calculations.map((item) => item.lifeRemaining)),
        totalPriceCents: totals.totalPriceCents,
        totalLaborHours: totals.totalLaborHours,
        recommendedHours: totals.recommendedHours,
      };
    })
    .filter((item) => item.vehicle && item.customer)
    .sort((a, b) => {
      const statusRank: Record<OutreachStatus, number> = {
        NEEDS_OUTREACH: 0,
        DRAFTED: 1,
        MANUALLY_SENT: 2,
        RESPONDED: 3,
        SNOOZED: 4,
        DECLINED: 5,
        STOPPED: 6,
        SCHEDULED: 7,
      };
      return (
        statusRank[a.opportunityStatus] - statusRank[b.opportunityStatus] ||
        a.urgency - b.urgency
      );
    });
}

export function getDashboardMetrics(state: DemoState) {
  const opportunities = getVehicleOpportunities(state);
  const activeCustomers = state.customers.filter(
    (customer) => customer.status === "ACTIVE",
  ).length;
  const scheduledRevenue = state.appointments.reduce(
    (sum, appointment) => sum + appointment.totalPriceCents,
    0,
  );
  const predictedRevenue = getRecommendedRecords(state).reduce(
    (sum, item) => sum + item.record.priceCents,
    0,
  );
  const today = asOfDate.toISOString().slice(0, 10);
  const appointmentsToday = state.appointments.filter((appointment) =>
    appointment.scheduledStart.startsWith(today),
  );
  const committedHours = appointmentsToday.reduce(
    (sum, appointment) => sum + appointment.totalLaborHours,
    0,
  );

  return {
    activeCustomers,
    activeVehicles: state.vehicles.length,
    maintenanceOpportunities: opportunities.filter(
      (item) => item.opportunityStatus !== "SCHEDULED",
    ).length,
    readyForOutreach: opportunities.filter(
      (item) => item.opportunityStatus === "NEEDS_OUTREACH",
    ).length,
    appointmentsToday: appointmentsToday.length,
    scheduledRevenue,
    predictedRevenue,
    openBayCapacityHours: Math.max(0, state.shop.dailyBayHours - committedHours),
  };
}

export function buildForecast(state: DemoState) {
  const scheduled = state.appointments.reduce(
    (sum, appointment) => sum + appointment.totalPriceCents,
    0,
  );
  const predicted = getRecommendedRecords(state).reduce(
    (sum, item) => sum + item.record.priceCents,
    0,
  );

  return [
    { label: "Next 7 days", predicted: Math.round(predicted * 0.35), scheduled },
    { label: "Next 30 days", predicted, scheduled },
    { label: "Next 60 days", predicted: Math.round(predicted * 1.65), scheduled },
    { label: "Next 90 days", predicted: Math.round(predicted * 2.35), scheduled },
  ];
}

export function createAppointmentFromRecords({
  state,
  customerId,
  vehicleId,
  maintenanceRecordIds,
  date,
  time,
  status,
  notes,
}: {
  state: DemoState;
  customerId: string;
  vehicleId: string;
  maintenanceRecordIds: string[];
  date: string;
  time: string;
  status: Appointment["status"];
  notes?: string;
}) {
  const records = state.maintenanceRecords.filter((record) =>
    maintenanceRecordIds.includes(record.id),
  );
  const totals = calculateAppointmentTotals(records);
  const scheduledStart = new Date(`${date}T${time}:00`);
  const appointmentId = `appt-${Date.now()}`;

  return {
    id: appointmentId,
    shopId: state.shop.id,
    customerId,
    vehicleId,
    maintenanceRecordIds,
    serviceNames: records.map((record) => record.serviceName),
    scheduledStart: scheduledStart.toISOString(),
    scheduledEnd: addHours(scheduledStart, totals.recommendedHours).toISOString(),
    status,
    totalPriceCents: totals.totalPriceCents,
    totalLaborHours: totals.recommendedHours,
    source: "AUTOMATION" as const,
    attributionSource: "MAINTIVA_OUTREACH" as const,
    notes: notes ?? "",
  };
}
