import {
  asOfDate,
  type Appointment,
  type DeclinedWorkRecord,
  type DemoState,
  type RevenueOpportunityRecord,
  type VehicleMaintenanceRecord,
} from "@/lib/demo-data";
import {
  getRecommendedRecords,
  vehicleLabel,
} from "@/lib/demo-calculations";
import { formatInterval, resolveMaintenanceInterval } from "@/lib/service-intervals";

const dayMs = 86_400_000;

export type OpportunitySource =
  | "DUE_MAINTENANCE"
  | "OVERDUE_MAINTENANCE"
  | "DECLINED_WORK"
  | "DEFERRED_WORK"
  | "REACTIVATION";

export type OpportunityPriority = "HIGH" | "MEDIUM" | "LOW";
export type RevenueStage = "IDENTIFIED" | "CONTACTED" | "RESPONDED" | "BOOKED" | "COMPLETED" | "LOST";

export type RevenueOpportunity = {
  id: string;
  shopId: string;
  customerId: string;
  vehicleId: string;
  customerName: string;
  vehicleLabel: string;
  source: OpportunitySource;
  sourceLabel: string;
  serviceNames: string[];
  maintenanceRecordId?: string;
  declinedWorkRecordId?: string;
  serviceDefinitionId?: string;
  sourceRecordId: string;
  sourceType: "VehicleMaintenanceRecord" | "DeclinedWorkRecord";
  explanation: string;
  priority: OpportunityPriority;
  priorityReason: string;
  lastServiceDate?: string;
  lastServiceMileage?: number;
  currentMileage: number;
  dueDate?: string;
  dueMileage?: number;
  daysOverdue: number;
  milesOverdue: number;
  estimatedRevenueCents: number;
  estimatedLaborHours: number;
  outreachStatus: string;
  appointmentStatus: string;
  stage: RevenueStage;
  createdAt: string;
  lastActivityAt: string;
};

export type RevenueQueueGroup = {
  id: string;
  customerId: string;
  vehicleId: string;
  customerName: string;
  vehicleLabel: string;
  sources: string[];
  opportunities: RevenueOpportunity[];
  recommendedServices: string[];
  explanation: string;
  estimatedRevenueCents: number;
  estimatedLaborHours: number;
  priority: OpportunityPriority;
  priorityReason: string;
  outreachStatus: string;
  appointmentStatus: string;
  lastContactedAt?: string;
  nextAction: string;
};

export function isOpenRevenueStage(stage: RevenueStage) {
  return ["IDENTIFIED", "CONTACTED", "RESPONDED", "BOOKED"].includes(stage);
}

export function getOpenRevenueOpportunitiesForCustomer(state: DemoState, customerId: string) {
  return buildRevenueOpportunities(state).filter((opportunity) =>
    opportunity.customerId === customerId && isOpenRevenueStage(opportunity.stage),
  );
}

function daysBetween(start: string, end: Date = asOfDate) {
  return Math.floor((end.getTime() - new Date(start).getTime()) / dayMs);
}

function sourceLabel(source: OpportunitySource) {
  return {
    DUE_MAINTENANCE: "Due maintenance",
    OVERDUE_MAINTENANCE: "Overdue maintenance",
    DECLINED_WORK: "Declined work",
    DEFERRED_WORK: "Deferred work",
    REACTIVATION: "Reactivation",
  }[source];
}

function priorityFor(input: {
  source: OpportunitySource;
  daysOverdue: number;
  milesOverdue: number;
  estimatedRevenueCents: number;
  outreachStatus: string;
}) {
  if (input.outreachStatus === "SCHEDULED") {
    return {
      priority: "LOW" as const,
      priorityReason: "Appointment already booked.",
    };
  }
  if (
    input.source === "DECLINED_WORK" ||
    input.daysOverdue >= 30 ||
    input.milesOverdue >= 1000 ||
    input.estimatedRevenueCents >= 30000
  ) {
    return {
      priority: "HIGH" as const,
      priorityReason:
        input.source === "DECLINED_WORK"
          ? "Previously declined work is recoverable and ready for advisor follow-up."
          : "High urgency or value based on overdue severity and estimated revenue.",
    };
  }
  if (input.daysOverdue > 0 || input.milesOverdue > 0 || input.estimatedRevenueCents >= 10000) {
    return {
      priority: "MEDIUM" as const,
      priorityReason: "Due service has meaningful value and should fill future capacity.",
    };
  }
  return {
    priority: "LOW" as const,
    priorityReason: "Lower urgency; keep available for capacity gaps.",
  };
}

function stageFor(input: {
  outreachStatus: string;
  appointment?: Appointment;
  responseStatus?: string;
}) {
  if (input.appointment?.status === "COMPLETED") return "COMPLETED" as const;
  if (input.appointment && !["CANCELLED", "NO_SHOW"].includes(input.appointment.status)) {
    return "BOOKED" as const;
  }
  if (input.responseStatus && input.responseStatus !== "NO_RESPONSE") {
    return input.responseStatus === "DECLINED" || input.responseStatus === "DO_NOT_CONTACT"
      ? ("LOST" as const)
      : ("RESPONDED" as const);
  }
  if (["MANUALLY_SENT", "RESPONDED", "SCHEDULED"].includes(input.outreachStatus)) {
    return "CONTACTED" as const;
  }
  if (["DECLINED", "STOPPED"].includes(input.outreachStatus)) return "LOST" as const;
  return "IDENTIFIED" as const;
}

function customerName(state: DemoState, customerId: string) {
  const customer = state.customers.find((item) => item.id === customerId);
  return customer ? `${customer.firstName} ${customer.lastName}` : "Unknown customer";
}

function appointmentForRecord(state: DemoState, record: VehicleMaintenanceRecord | DeclinedWorkRecord) {
  return state.appointments.find(
    (appointment) =>
      appointment.id === record.appointmentId ||
      appointment.maintenanceRecordIds.includes(record.id),
  );
}

function appointmentForOpportunity(state: DemoState, opportunity: RevenueOpportunity) {
  return state.appointments.find((appointment) =>
    appointment.opportunityId === opportunity.id ||
    (
      opportunity.maintenanceRecordId &&
      appointment.maintenanceRecordIds.includes(opportunity.maintenanceRecordId)
    ) ||
    (
      opportunity.declinedWorkRecordId &&
      state.declinedWorkRecords.some((record) =>
        record.id === opportunity.declinedWorkRecordId &&
        record.appointmentId === appointment.id
      )
    ),
  );
}

function lastOutreachForOpportunity(state: DemoState, opportunity: RevenueOpportunity) {
  return state.outreachRecords
    .filter((record) =>
      record.shopId === opportunity.shopId &&
      record.customerId === opportunity.customerId &&
      record.vehicleId === opportunity.vehicleId &&
      (
        opportunity.maintenanceRecordId
          ? record.maintenanceRecordIds.includes(opportunity.maintenanceRecordId)
          : true
      ),
    )
    .sort((a, b) => (a.manuallySentAt ?? a.sentAt).localeCompare(b.manuallySentAt ?? b.sentAt))
    .at(-1);
}

function opportunityServiceName(
  state: DemoState,
  opportunity: RevenueOpportunityRecord,
  maintenanceRecord?: VehicleMaintenanceRecord,
  declinedWorkRecord?: DeclinedWorkRecord,
) {
  if (maintenanceRecord) {
    const service = state.services.find((item) => item.id === maintenanceRecord.serviceId);
    return service?.name ?? maintenanceRecord.serviceName;
  }
  return declinedWorkRecord?.serviceName ?? "Unknown service";
}

function buildPersistedRevenueOpportunities(state: DemoState): RevenueOpportunity[] {
  return (state.revenueOpportunities ?? [])
    .map((opportunity): RevenueOpportunity | null => {
      if (opportunity.shopId !== state.shop.id) return null;
      const customer = state.customers.find((item) => item.id === opportunity.customerId && item.shopId === state.shop.id);
      const vehicle = state.vehicles.find((item) =>
        item.id === opportunity.vehicleId &&
        item.shopId === state.shop.id &&
        item.customerId === opportunity.customerId,
      );
      if (!customer || !vehicle) return null;

      const maintenanceRecord = opportunity.maintenanceRecordId
        ? state.maintenanceRecords.find((item) =>
            item.id === opportunity.maintenanceRecordId &&
            item.shopId === state.shop.id &&
            item.vehicleId === vehicle.id,
          )
        : undefined;
      const declinedWorkRecord = opportunity.declinedWorkRecordId
        ? state.declinedWorkRecords.find((item) =>
            item.id === opportunity.declinedWorkRecordId &&
            item.shopId === state.shop.id &&
            item.customerId === customer.id &&
            item.vehicleId === vehicle.id,
          )
        : undefined;

      if (opportunity.maintenanceRecordId && !maintenanceRecord) return null;
      if (opportunity.declinedWorkRecordId && !declinedWorkRecord) return null;

      const sourceRecordId = opportunity.declinedWorkRecordId ?? opportunity.maintenanceRecordId;
      if (!sourceRecordId) return null;

      const serviceName = opportunityServiceName(state, opportunity, maintenanceRecord, declinedWorkRecord);
      const lastOutreach = lastOutreachForOpportunity(state, {
        ...opportunity,
        customerName: `${customer.firstName} ${customer.lastName}`,
        vehicleLabel: vehicleLabel(vehicle),
        sourceLabel: sourceLabel(opportunity.source),
        serviceNames: [serviceName],
        sourceRecordId,
        sourceType: opportunity.declinedWorkRecordId ? "DeclinedWorkRecord" : "VehicleMaintenanceRecord",
        currentMileage: vehicle.currentMileage,
        estimatedLaborHours: opportunity.estimatedLaborHours,
        appointmentStatus: "UNSCHEDULED",
      } as RevenueOpportunity);

      return {
        id: opportunity.id,
        shopId: opportunity.shopId,
        customerId: opportunity.customerId,
        vehicleId: opportunity.vehicleId,
        customerName: `${customer.firstName} ${customer.lastName}`,
        vehicleLabel: vehicleLabel(vehicle),
        source: opportunity.source,
        sourceLabel: sourceLabel(opportunity.source),
        serviceNames: [serviceName],
        maintenanceRecordId: opportunity.maintenanceRecordId,
        declinedWorkRecordId: opportunity.declinedWorkRecordId,
        serviceDefinitionId: maintenanceRecord?.serviceId ?? undefined,
        sourceRecordId,
        sourceType: opportunity.declinedWorkRecordId ? "DeclinedWorkRecord" : "VehicleMaintenanceRecord",
        explanation: opportunity.explanation,
        priority: opportunity.priority,
        priorityReason: opportunity.priorityReason,
        lastServiceDate: declinedWorkRecord?.declinedAt ?? maintenanceRecord?.lastCompletedDate,
        lastServiceMileage: maintenanceRecord?.lastCompletedMileage,
        currentMileage: vehicle.currentMileage,
        dueDate: opportunity.dueDate,
        dueMileage: opportunity.dueMileage,
        daysOverdue: opportunity.daysOverdue,
        milesOverdue: opportunity.milesOverdue,
        estimatedRevenueCents: opportunity.estimatedRevenueCents,
        estimatedLaborHours: opportunity.estimatedLaborHours,
        outreachStatus: lastOutreach?.status ?? declinedWorkRecord?.outreachStatus ?? maintenanceRecord?.outreachStatus ?? "NEEDS_OUTREACH",
        appointmentStatus: appointmentForOpportunity(state, {
          ...opportunity,
          customerName: "",
          vehicleLabel: "",
          sourceLabel: "",
          serviceNames: [],
          sourceRecordId,
          sourceType: opportunity.declinedWorkRecordId ? "DeclinedWorkRecord" : "VehicleMaintenanceRecord",
          currentMileage: vehicle.currentMileage,
          estimatedLaborHours: opportunity.estimatedLaborHours,
          outreachStatus: "",
          appointmentStatus: "",
          lastActivityAt: opportunity.lastActivityAt ?? opportunity.createdAt,
        } as RevenueOpportunity)?.status ?? "UNSCHEDULED",
        stage: opportunity.stage,
        createdAt: opportunity.createdAt,
        lastActivityAt: lastOutreach?.manuallySentAt ?? lastOutreach?.sentAt ?? opportunity.lastActivityAt ?? opportunity.createdAt,
      };
    })
    .filter((item): item is RevenueOpportunity => item !== null)
    .sort((a, b) => {
      const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return (
        rank[a.priority] - rank[b.priority] ||
        b.estimatedRevenueCents - a.estimatedRevenueCents ||
        b.daysOverdue - a.daysOverdue
      );
    });
}

function buildDerivedDemoRevenueOpportunities(state: DemoState): RevenueOpportunity[] {
  const maintenance = getRecommendedRecords(state).map(({ record, calculation }): RevenueOpportunity | null => {
    const vehicle = state.vehicles.find((item) => item.id === record.vehicleId);
    if (!vehicle) return null;
    const appointment = appointmentForRecord(state, record);
    const outreach = state.outreachRecords.find((item) => item.id === record.outreachRecordId);
    const service = state.services.find((item) => item.id === record.serviceId);
    const effective = resolveMaintenanceInterval({ record, service, vehicle });
    const source: OpportunitySource =
      calculation.status === "OVERDUE" ? "OVERDUE_MAINTENANCE" : "DUE_MAINTENANCE";
    const daysOverdue = Math.max(0, -calculation.daysUntilDue);
    const milesOverdue = Math.max(0, -calculation.milesUntilDue);
    const priority = priorityFor({
      source,
      daysOverdue,
      milesOverdue,
      estimatedRevenueCents: effective.priceCents,
      outreachStatus: record.outreachStatus,
    });

    return {
      id: `opp-${record.id}`,
      shopId: record.shopId,
      customerId: vehicle.customerId,
      vehicleId: record.vehicleId,
      customerName: customerName(state, vehicle.customerId),
      vehicleLabel: vehicleLabel(vehicle),
      source,
      sourceLabel: sourceLabel(source),
      serviceNames: [record.serviceName],
      maintenanceRecordId: record.id,
      serviceDefinitionId: record.serviceId ?? undefined,
      sourceRecordId: record.id,
      sourceType: "VehicleMaintenanceRecord",
      explanation: `${effective.serviceName} ${effective.dueText.toLowerCase()} based on ${formatInterval(
        effective.mileageInterval,
        effective.timeIntervalValue,
        effective.timeIntervalUnit,
      )}.`,
      ...priority,
      lastServiceDate: record.lastCompletedDate,
      lastServiceMileage: record.lastCompletedMileage,
      currentMileage: vehicle.currentMileage,
      dueDate: effective.nextDueDate ?? undefined,
      dueMileage: effective.nextDueMileage ?? undefined,
      daysOverdue,
      milesOverdue,
      estimatedRevenueCents: effective.priceCents,
      estimatedLaborHours: effective.laborMinutes / 60,
      outreachStatus: record.outreachStatus,
      appointmentStatus: appointment?.status ?? "UNSCHEDULED",
      stage: stageFor({
        outreachStatus: record.outreachStatus,
        appointment,
        responseStatus: outreach?.responseStatus,
      }),
      createdAt: record.lastCompletedDate,
      lastActivityAt: outreach?.sentAt ?? appointment?.scheduledStart ?? record.lastCompletedDate,
    };
  });

  const declined = state.declinedWorkRecords.map((record): RevenueOpportunity => {
    const vehicle = state.vehicles.find((item) => item.id === record.vehicleId);
    const appointment = appointmentForRecord(state, record);
    const outreach = state.outreachRecords.find((item) => item.appointmentId === appointment?.id);
    const daysOverdue = Math.max(0, daysBetween(record.declinedAt));
    const priority = priorityFor({
      source: "DECLINED_WORK",
      daysOverdue,
      milesOverdue: 0,
      estimatedRevenueCents: record.recommendedPriceCents,
      outreachStatus: record.outreachStatus,
    });

    return {
      id: `opp-${record.id}`,
      shopId: record.shopId,
      customerId: record.customerId,
      vehicleId: record.vehicleId,
      customerName: customerName(state, record.customerId),
      vehicleLabel: vehicle ? vehicleLabel(vehicle) : "Unknown vehicle",
      source: "DECLINED_WORK" as const,
      sourceLabel: "Declined work",
      serviceNames: [record.serviceName],
      declinedWorkRecordId: record.id,
      sourceRecordId: record.id,
      sourceType: "DeclinedWorkRecord",
      explanation: `${record.serviceName} declined on ${new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
      }).format(new Date(record.declinedAt))}.`,
      ...priority,
      lastServiceDate: record.declinedAt,
      currentMileage: vehicle?.currentMileage ?? 0,
      daysOverdue,
      milesOverdue: 0,
      estimatedRevenueCents: record.recommendedPriceCents,
      estimatedLaborHours: record.laborHours,
      outreachStatus: record.outreachStatus,
      appointmentStatus: appointment?.status ?? "UNSCHEDULED",
      stage: stageFor({
        outreachStatus: record.outreachStatus,
        appointment,
        responseStatus: outreach?.responseStatus,
      }),
      createdAt: record.declinedAt,
      lastActivityAt: appointment?.scheduledStart ?? outreach?.sentAt ?? record.declinedAt,
    };
  });

  const maintenanceOpportunities = maintenance.filter(
    (item): item is RevenueOpportunity => item !== null,
  );

  return [
    ...maintenanceOpportunities,
    ...declined.filter((item) => item.stage !== "COMPLETED"),
  ].sort(
    (a, b) => {
      const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return (
        rank[a.priority] - rank[b.priority] ||
        b.estimatedRevenueCents - a.estimatedRevenueCents ||
        b.daysOverdue - a.daysOverdue
      );
    },
  );
}

export function buildRevenueOpportunities(state: DemoState): RevenueOpportunity[] {
  const persisted = buildPersistedRevenueOpportunities(state);
  if (persisted.length > 0 || !state.shop.isDemo) {
    return persisted;
  }
  return buildDerivedDemoRevenueOpportunities(state);
}

export function groupRevenueOpportunities(opportunities: RevenueOpportunity[]): RevenueQueueGroup[] {
  const byVehicle = new Map<string, RevenueOpportunity[]>();
  for (const opportunity of opportunities) {
    const current = byVehicle.get(opportunity.vehicleId) ?? [];
    current.push(opportunity);
    byVehicle.set(opportunity.vehicleId, current);
  }

  return Array.from(byVehicle.entries()).map(([vehicleId, items]) => {
    const priority = items.some((item) => item.priority === "HIGH")
      ? "HIGH"
      : items.some((item) => item.priority === "MEDIUM")
        ? "MEDIUM"
        : "LOW";
    const booked = items.some((item) => item.stage === "BOOKED" || item.stage === "COMPLETED");
    const contacted = items.some((item) => item.stage === "CONTACTED" || item.stage === "RESPONDED");
    return {
      id: vehicleId,
      customerId: items[0].customerId,
      vehicleId,
      customerName: items[0].customerName,
      vehicleLabel: items[0].vehicleLabel,
      sources: Array.from(new Set(items.map((item) => item.sourceLabel))),
      opportunities: items,
      recommendedServices: Array.from(new Set(items.flatMap((item) => item.serviceNames))),
      explanation: items[0].explanation,
      estimatedRevenueCents: items.reduce((sum, item) => sum + item.estimatedRevenueCents, 0),
      estimatedLaborHours: items.reduce((sum, item) => sum + item.estimatedLaborHours, 0),
      priority,
      priorityReason: items.find((item) => item.priority === priority)?.priorityReason ?? "",
      outreachStatus: booked ? "Booked" : contacted ? "Contacted" : "Needs outreach",
      appointmentStatus: booked ? "Booked" : "Unscheduled",
      lastContactedAt: items
        .map((item) => item.lastActivityAt)
        .sort()
        .at(-1),
      nextAction: booked ? "Complete appointment" : contacted ? "Record response" : "Generate message",
    };
  });
}

function maintivaAppointments(state: DemoState) {
  return state.appointments.filter((appointment) => appointment.attributionSource === "MAINTIVA_OUTREACH");
}

export function getRevenueRecoveryMetrics(state: DemoState) {
  const opportunities = buildRevenueOpportunities(state);
  const open = opportunities.filter((item) => isOpenRevenueStage(item.stage));
  const appointments = maintivaAppointments(state);
  const bookedAppointments = appointments.filter(
    (appointment) => !["CANCELLED", "NO_SHOW", "COMPLETED"].includes(appointment.status),
  );
  const completedAppointments = appointments.filter((appointment) => appointment.status === "COMPLETED");
  const contacted = opportunities.filter((item) => ["CONTACTED", "RESPONDED", "BOOKED", "COMPLETED"].includes(item.stage));
  const bookedCount = bookedAppointments.length + completedAppointments.length;

  return {
    activeCustomers: state.customers.filter((customer) => customer.status === "ACTIVE").length,
    activeVehicles: state.vehicles.filter((vehicle) => !vehicle.archivedAt).length,
    recoveredRevenueThisMonth: completedAppointments.reduce(
      (sum, appointment) => sum + (appointment.completedRevenueCents ?? appointment.totalPriceCents),
      0,
    ),
    bookedMaintivaRevenue: bookedAppointments.reduce((sum, appointment) => sum + appointment.totalPriceCents, 0),
    openOpportunityValue: open.reduce((sum, item) => sum + item.estimatedRevenueCents, 0),
    appointmentsBookedThroughMaintiva: bookedCount,
    outreachToBookingConversionRate: contacted.length === 0 ? 0 : Math.round((bookedCount / contacted.length) * 100),
    openOpportunityCount: open.length,
    contactedCount: contacted.length,
    completedMaintivaRevenue: completedAppointments.reduce(
      (sum, appointment) => sum + (appointment.completedRevenueCents ?? appointment.totalPriceCents),
      0,
    ),
  };
}

export function getRevenueFunnel(state: DemoState) {
  const opportunities = buildRevenueOpportunities(state);
  const stages: RevenueStage[] = ["IDENTIFIED", "CONTACTED", "RESPONDED", "BOOKED", "COMPLETED"];
  return stages.map((stage) => {
    const items = opportunities.filter((item) => item.stage === stage);
    const appointmentValue =
      stage === "BOOKED"
        ? maintivaAppointments(state)
            .filter((appointment) => !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status))
            .reduce((sum, appointment) => sum + appointment.totalPriceCents, 0)
        : stage === "COMPLETED"
          ? maintivaAppointments(state)
              .filter((appointment) => appointment.status === "COMPLETED")
              .reduce((sum, appointment) => sum + (appointment.completedRevenueCents ?? appointment.totalPriceCents), 0)
          : items.reduce((sum, item) => sum + item.estimatedRevenueCents, 0);
    return {
      stage,
      label: stage.toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase()),
      count: stage === "BOOKED" || stage === "COMPLETED" ? Math.max(items.length, appointmentValue > 0 ? 1 : 0) : items.length,
      valueCents: appointmentValue,
    };
  });
}

export function getCapacitySummary(state: DemoState, days: 7 | 14 | 30) {
  const appointments = state.appointments.filter((appointment) => {
    const delta = Math.ceil((new Date(appointment.scheduledStart).getTime() - asOfDate.getTime()) / dayMs);
    return delta >= 0 && delta < days && !["CANCELLED", "NO_SHOW"].includes(appointment.status);
  });
  const totalAvailableLaborHours = state.shop.dailyBayHours * days;
  const bookedLaborHours = appointments.reduce((sum, appointment) => sum + appointment.totalLaborHours, 0);
  const openLaborHours = Math.max(0, totalAvailableLaborHours - bookedLaborHours);
  const openOpportunities = buildRevenueOpportunities(state).filter((item) => !["BOOKED", "COMPLETED", "LOST"].includes(item.stage));
  const matching = openOpportunities.filter((item) => item.estimatedLaborHours <= openLaborHours);
  const potentialLaborHours = matching.reduce((sum, item) => sum + item.estimatedLaborHours, 0);
  const scheduledRevenue = appointments.reduce((sum, appointment) => sum + appointment.totalPriceCents, 0);

  return {
    days,
    totalAvailableLaborHours,
    bookedLaborHours,
    openLaborHours,
    scheduledRevenue,
    estimatedRevenueNeeded: Math.round(openLaborHours * 18000),
    matchingOpportunityCount: matching.length,
    potentialLaborHours,
    matchingOpportunities: matching,
  };
}

export function getRoiReport(state: DemoState) {
  const metrics = getRevenueRecoveryMetrics(state);
  const opportunities = buildRevenueOpportunities(state);
  const contacted = opportunities.filter((item) => ["CONTACTED", "RESPONDED", "BOOKED", "COMPLETED"].includes(item.stage));
  const responded = opportunities.filter((item) => ["RESPONDED", "BOOKED", "COMPLETED"].includes(item.stage));
  const booked = maintivaAppointments(state).filter((appointment) => !["CANCELLED", "NO_SHOW"].includes(appointment.status));
  const completed = booked.filter((appointment) => appointment.status === "COMPLETED");

  return {
    opportunitiesIdentified: opportunities.length,
    opportunityValueIdentified: opportunities.reduce((sum, item) => sum + item.estimatedRevenueCents, 0),
    customersContacted: new Set(contacted.map((item) => item.customerId)).size,
    customerResponses: responded.length,
    appointmentsBookedThroughMaintiva: booked.length,
    bookedMaintivaRevenue: metrics.bookedMaintivaRevenue,
    completedMaintivaRevenue: metrics.completedMaintivaRevenue,
    averageRecoveredRepairOrder:
      completed.length === 0 ? 0 : Math.round(metrics.completedMaintivaRevenue / completed.length),
    outreachToResponseRate: contacted.length === 0 ? 0 : Math.round((responded.length / contacted.length) * 100),
    responseToBookingRate: responded.length === 0 ? 0 : Math.round((booked.length / responded.length) * 100),
    overallOutreachToBookingRate:
      contacted.length === 0 ? 0 : Math.round((booked.length / contacted.length) * 100),
    laborHoursBookedThroughMaintiva: booked.reduce((sum, appointment) => sum + appointment.totalLaborHours, 0),
    declinedOpportunities: opportunities.filter((item) => item.stage === "LOST").length,
    lostOpportunities: opportunities.filter((item) => item.stage === "LOST").length,
  };
}
