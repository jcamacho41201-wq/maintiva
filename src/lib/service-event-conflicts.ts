import type { DemoState } from "@/lib/demo-data";

function dateOnly(value?: string | null) {
  return String(value ?? "").slice(0, 10);
}

function normalizedServiceName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export type ServiceCycleConflict = {
  shopId: string;
  customerId: string;
  vehicleId: string;
  serviceName: string;
  sourceDate: string;
  serviceHistoryRecordId: string;
  maintenanceRecordId?: string;
  declinedWorkRecordId: string;
  revenueOpportunityId?: string;
  serviceDefinitionId?: string | null;
  category: "SERVICE_DECLINED_AND_MARKED_COMPLETED" | "AMBIGUOUS_REQUIRES_REVIEW";
};

export function findCompletedDeclinedServiceConflicts(state: DemoState): ServiceCycleConflict[] {
  const maintenanceByVehicleService = new Map(
    state.maintenanceRecords.map((record) => [
      `${record.shopId}|${record.vehicleId}|${normalizedServiceName(record.serviceName)}`,
      record,
    ]),
  );
  const declinedByCycle = new Map<string, typeof state.declinedWorkRecords>();

  for (const record of state.declinedWorkRecords) {
    const key = `${record.shopId}|${record.customerId}|${record.vehicleId}|${normalizedServiceName(record.serviceName)}|${dateOnly(record.declinedAt)}`;
    declinedByCycle.set(key, [...(declinedByCycle.get(key) ?? []), record]);
  }

  return state.serviceRecords.flatMap((serviceRecord) => {
    const key = `${serviceRecord.shopId}|${serviceRecord.customerId}|${serviceRecord.vehicleId}|${normalizedServiceName(serviceRecord.serviceName)}|${dateOnly(serviceRecord.completedAt)}`;
    const declinedRecords = declinedByCycle.get(key) ?? [];
    const maintenanceRecord = maintenanceByVehicleService.get(
      `${serviceRecord.shopId}|${serviceRecord.vehicleId}|${normalizedServiceName(serviceRecord.serviceName)}`,
    );

    return declinedRecords.map((declinedWorkRecord) => {
      const revenueOpportunity = state.revenueOpportunities.find((opportunity) =>
        opportunity.shopId === serviceRecord.shopId &&
        opportunity.customerId === serviceRecord.customerId &&
        opportunity.vehicleId === serviceRecord.vehicleId &&
        opportunity.declinedWorkRecordId === declinedWorkRecord.id,
      );

      return {
        shopId: serviceRecord.shopId,
        customerId: serviceRecord.customerId,
        vehicleId: serviceRecord.vehicleId,
        serviceName: serviceRecord.serviceName,
        sourceDate: dateOnly(serviceRecord.completedAt),
        serviceHistoryRecordId: serviceRecord.id,
        maintenanceRecordId: maintenanceRecord?.id,
        declinedWorkRecordId: declinedWorkRecord.id,
        revenueOpportunityId: revenueOpportunity?.id,
        serviceDefinitionId: maintenanceRecord?.serviceId ?? null,
        category: serviceRecord.notes?.includes("Imported from CSV") || declinedWorkRecord.advisorNotes?.includes("Imported")
          ? "SERVICE_DECLINED_AND_MARKED_COMPLETED"
          : "AMBIGUOUS_REQUIRES_REVIEW",
      };
    });
  });
}
