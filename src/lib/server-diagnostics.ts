import type { AuthenticatedShopContext } from "@/lib/auth";

type SafeError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type SafeMutationOperation = {
  action?: string;
  table?: string;
  operation?: "SELECT" | "INSERT" | "UPDATE" | "DELETE";
  vehicleId?: string;
  customerId?: string;
  opportunityId?: string;
  serviceDefinitionId?: string;
  maintenanceRecordId?: string;
  targetVehicleShopId?: string;
  channel?: string;
  outreachStage?: string;
};

export class SafeActionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly table?: string;
  readonly operation?: SafeMutationOperation["operation"];
  readonly details?: string;
  readonly hint?: string;

  constructor({
    code,
    message,
    status = 400,
    table,
    operation,
    details,
    hint,
  }: {
    code: string;
    message: string;
    status?: number;
    table?: string;
    operation?: SafeMutationOperation["operation"];
    details?: string;
    hint?: string;
  }) {
    super(message);
    this.name = "SafeActionError";
    this.code = code;
    this.status = status;
    this.table = table;
    this.operation = operation;
    this.details = details;
    this.hint = hint;
  }
}

function valueFrom(error: unknown, key: "code" | "message" | "detail" | "details" | "hint") {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function safeDatabaseError(error: unknown): SafeError {
  const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined;
  const meta = error && typeof error === "object" ? (error as { meta?: unknown }).meta : undefined;
  const causeMeta = cause && typeof cause === "object" ? (cause as { meta?: unknown }).meta : undefined;
  return {
    code: valueFrom(error, "code") ?? valueFrom(meta, "code") ?? valueFrom(cause, "code") ?? valueFrom(causeMeta, "code"),
    message: valueFrom(error, "message") ?? valueFrom(meta, "message") ?? valueFrom(cause, "message") ?? valueFrom(causeMeta, "message"),
    details: valueFrom(error, "details") ?? valueFrom(error, "detail") ?? valueFrom(meta, "details") ?? valueFrom(meta, "detail") ?? valueFrom(meta, "message") ?? valueFrom(cause, "details") ?? valueFrom(cause, "detail") ?? valueFrom(causeMeta, "details") ?? valueFrom(causeMeta, "detail") ?? valueFrom(causeMeta, "message"),
    hint: valueFrom(error, "hint") ?? valueFrom(meta, "hint") ?? valueFrom(cause, "hint") ?? valueFrom(causeMeta, "hint"),
  };
}

function safeId(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function safeMutationPayloadShape(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const action = typeof (value as { action?: unknown }).action === "string"
    ? (value as { action: string }).action
    : undefined;
  const payload = (value as { payload?: unknown }).payload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { action };
  }

  return {
    action,
    payloadFields: Object.keys(payload).sort(),
    payloadPresence: Object.fromEntries(
      Object.entries(payload).map(([key, child]) => [
        key,
        child !== null && child !== undefined && String(child).length > 0,
      ]),
    ),
  };
}

export function safeMutationOperation(value: unknown): SafeMutationOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : undefined;
  const payload = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
    ? record.payload as Record<string, unknown>
    : {};
  const id = typeof record.id === "string" ? record.id : undefined;

  const operationByAction: Record<string, SafeMutationOperation> = {
    addServiceDefinition: { table: "ServiceDefinition", operation: "INSERT" },
    updateServiceDefinition: { table: "ServiceDefinition", operation: "UPDATE", serviceDefinitionId: safeId(id) },
    addMaintenanceItem: {
      table: "VehicleMaintenanceRecord",
      operation: "INSERT",
      vehicleId: safeId(payload.vehicleId),
      serviceDefinitionId: safeId(payload.serviceDefinitionId),
    },
    updateMaintenanceItem: { table: "VehicleMaintenanceRecord", operation: "UPDATE", maintenanceRecordId: id },
    deactivateMaintenanceItem: { table: "VehicleMaintenanceRecord", operation: "UPDATE", maintenanceRecordId: safeId(id) },
    markMaintenanceServiceComplete: {
      table: "ServiceHistoryRecord",
      operation: "INSERT",
      maintenanceRecordId: safeId(payload.maintenanceRecordId),
    },
    updateVehicleMileage: {
      table: "VehicleMileageReading",
      operation: "INSERT",
      vehicleId: safeId(payload.vehicleId),
    },
    setCustomerReportedMileage: {
      table: "VehicleDrivingProfile",
      operation: "UPDATE",
      vehicleId: safeId(payload.vehicleId),
    },
    setManualMileageOverride: {
      table: "VehicleDrivingProfile",
      operation: "UPDATE",
      vehicleId: safeId(payload.vehicleId),
    },
    resetManualMileageOverride: {
      table: "VehicleDrivingProfile",
      operation: "UPDATE",
      vehicleId: safeId(payload.vehicleId),
    },
    reviewMileageReading: {
      table: "VehicleMileageReading",
      operation: "UPDATE",
    },
    markOutreachManuallySent: {
      table: "OutreachRecord",
      operation: "INSERT",
      customerId: safeId(payload.customerId),
      vehicleId: safeId(payload.vehicleId),
      channel: typeof payload.channel === "string" ? payload.channel : undefined,
      outreachStage: typeof payload.responseStatus === "string" ? payload.responseStatus : undefined,
    },
    recordOpportunityContact: {
      table: "OutreachRecord",
      operation: "INSERT",
      customerId: safeId(payload.customerId),
      vehicleId: safeId(payload.vehicleId),
      opportunityId: Array.isArray(payload.opportunityIds) ? safeId(payload.opportunityIds[0]) : undefined,
      channel: typeof payload.channel === "string" ? payload.channel : undefined,
      outreachStage: typeof payload.responseStatus === "string" ? payload.responseStatus : undefined,
    },
    bookAppointment: {
      table: "Appointment",
      operation: "INSERT",
      customerId: safeId(payload.customerId),
      vehicleId: safeId(payload.vehicleId),
      opportunityId: Array.isArray(payload.opportunityIds) ? safeId(payload.opportunityIds[0]) : undefined,
    },
    importCsvRows: {
      table: "ImportHistoryRecord",
      operation: "INSERT",
    },
    snoozeOpportunity: {
      table: "OutreachRecord",
      operation: "INSERT",
      customerId: safeId(payload.customerId),
      vehicleId: safeId(payload.vehicleId),
      opportunityId: Array.isArray(payload.opportunityIds) ? safeId(payload.opportunityIds[0]) : undefined,
      channel: "OTHER",
      outreachStage: "SNOOZED",
    },
    endOpportunitySnooze: {
      table: "MaintenanceRevenueOpportunity",
      operation: "UPDATE",
      customerId: safeId(payload.customerId),
      vehicleId: safeId(payload.vehicleId),
      opportunityId: Array.isArray(payload.opportunityIds) ? safeId(payload.opportunityIds[0]) : undefined,
    },
  };

  return {
    action,
    ...(action ? operationByAction[action] : undefined),
  };
}

export function clientMutationError(error: unknown, operation: SafeMutationOperation) {
  if (error instanceof SafeActionError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }

  const database = safeDatabaseError(error);
  const serviceIntervalActions = new Set([
    "addServiceDefinition",
    "updateServiceDefinition",
    "addMaintenanceItem",
    "updateMaintenanceItem",
    "deactivateMaintenanceItem",
    "markMaintenanceServiceComplete",
  ]);
  const schemaCodes = new Set(["P2010", "P2021", "P2022", "42703", "42P01", "42704"]);
  const duplicateCodes = new Set(["P2002", "23505"]);
  const invalidIdCodes = new Set(["22P02", "P2023"]);

  if (schemaCodes.has(database.code ?? "") && serviceIntervalActions.has(operation.action ?? "")) {
    return {
      code: "SERVICE_INTERVAL_SCHEMA_MISSING",
      message: "The database update for service intervals has not been installed.",
      status: 500,
    };
  }

  const adaptiveMileageActions = new Set([
    "updateVehicleMileage",
    "setCustomerReportedMileage",
    "setManualMileageOverride",
    "resetManualMileageOverride",
    "reviewMileageReading",
  ]);
  if (schemaCodes.has(database.code ?? "") && adaptiveMileageActions.has(operation.action ?? "")) {
    return {
      code: "ADAPTIVE_MILEAGE_SCHEMA_MISSING",
      message: "The database update for adaptive mileage forecasting has not been installed.",
      status: 500,
    };
  }

  if (schemaCodes.has(database.code ?? "") && operation.action === "importCsvRows") {
    return {
      code: "IMPORT_SCHEMA_COMPATIBILITY_ERROR",
      message: "The import could not be completed because a required application update is missing.",
      status: 500,
    };
  }

  if (schemaCodes.has(database.code ?? "") && ["recordOpportunityContact", "markOutreachManuallySent", "snoozeOpportunity"].includes(operation.action ?? "")) {
    return {
      code: "OUTREACH_SCHEMA_COMPATIBILITY_ERROR",
      message: "The outreach could not be recorded because a required application update is missing.",
      status: 500,
    };
  }

  if (duplicateCodes.has(database.code ?? "")) {
    return {
      code: "DUPLICATE_RECORD",
      message: operation.table === "ServiceDefinition"
        ? "A service with this name already exists for your shop."
        : "This service already exists for the vehicle.",
      status: 409,
    };
  }

  if (invalidIdCodes.has(database.code ?? "")) {
    return {
      code: "INVALID_RECORD_ID",
      message: "One of the selected records is invalid. Refresh the page and try again.",
      status: 400,
    };
  }

  return undefined;
}

export function logPilotMutationFailure({
  error,
  context,
  payload,
  operation,
}: {
  error: unknown;
  context?: AuthenticatedShopContext;
  payload?: unknown;
  operation?: SafeMutationOperation;
}) {
  console.error("Maintiva pilot mutation failed", {
    auth: context
      ? {
          userId: safeId(context.userId),
          shopId: safeId(context.shopId),
          membershipActive: true,
          role: context.role,
        }
      : undefined,
    mutation: safeMutationPayloadShape(payload),
    operation: operation ?? safeMutationOperation(payload),
    database: safeDatabaseError(error),
    actionError: error instanceof SafeActionError
      ? {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
          table: error.table,
          operation: error.operation,
        }
      : undefined,
  });
}
