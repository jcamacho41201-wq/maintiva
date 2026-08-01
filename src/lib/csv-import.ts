import type { DemoState } from "@/lib/demo-data";

export type ImportType =
  | "CUSTOMERS"
  | "VEHICLES"
  | "SERVICE_HISTORY"
  | "DECLINED_WORK"
  | "APPOINTMENTS"
  | "COMBINED";

export type DuplicateImportMode = "SKIP" | "UPDATE" | "IMPORT_AS_NEW";
export type ImportRowAction = "IMPORT" | "HOLD" | "SKIP" | "UPDATE" | "IMPORT_AS_NEW";

export type MaintivaField =
  | "ignore"
  | "customerExternalId"
  | "customerFirstName"
  | "customerLastName"
  | "customerFullName"
  | "customerEmail"
  | "customerPhone"
  | "vehicleExternalId"
  | "vehicleCustomerExternalId"
  | "vin"
  | "vehicleYear"
  | "vehicleMake"
  | "vehicleModel"
  | "licensePlate"
  | "currentMileage"
  | "serviceName"
  | "serviceDate"
  | "serviceMileage"
  | "price"
  | "laborHours"
  | "status"
  | "declinedDate"
  | "advisorNotes"
  | "appointmentDate"
  | "appointmentTime"
  | "services";

export type CsvRow = Record<string, string>;
export type NormalizedCsvValue = string | number | null;

export const MAINTIVA_IMPORT_ROW_LIMIT = 50;

export function importRowLimitMessage(rowCount: number, limit = MAINTIVA_IMPORT_ROW_LIMIT) {
  return `This import contains ${rowCount} rows. Maintiva currently supports up to ${limit} rows per import. Split the file into smaller batches and try again.`;
}

export function isImportRowLimitExceeded(rowCount: number, limit = MAINTIVA_IMPORT_ROW_LIMIT) {
  return rowCount > limit;
}

export type EntityImportResult = {
  entity: "Customer" | "Vehicle" | "Service" | "Declined work" | "Appointment";
  status: "CREATE" | "MATCH" | "DUPLICATE" | "UPDATE" | "HOLD" | "SKIP" | "ERROR" | "NONE";
  message: string;
  key?: string;
};

export type ImportPreviewRow = {
  rowNumber: number;
  raw: CsvRow;
  normalized: Record<string, NormalizedCsvValue>;
  status: "VALID" | "INVALID" | "DUPLICATE" | "HELD" | "SKIPPED";
  action: ImportRowAction;
  duplicateReason?: string;
  issue: string;
  errors: string[];
  entities: {
    customer: EntityImportResult;
    vehicle: EntityImportResult;
    child: EntityImportResult;
  };
};

export type ImportSummary = {
  totalRows: number;
  readyRows: number;
  validRows: number;
  reviewRows: number;
  invalidRows: number;
  duplicateRows: number;
  duplicateSkippedRows: number;
  failedRows: number;
  customersToCreate: number;
  customersMatched: number;
  vehiclesToCreate: number;
  vehiclesMatched: number;
  servicesToImport: number;
  declinedWorkToImport: number;
  appointmentsToImport: number;
  recordsToUpdate: number;
  duplicateChildRecordsToSkip: number;
  heldRows: number;
  skippedRows: number;
  successfulRows: number;
  updatedRows: number;
};

export const maintivaCsvTemplate = [
  "Customer ID,First Name,Last Name,Email,Phone,Vehicle ID,VIN,Year,Make,Model,License Plate,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours,Status,Declined Date,Advisor Notes,Appointment Date,Appointment Time,Services",
  "C-1001,Jordan,Lee,jordan@example.com,(404) 555-0111,V-2001,1HGCV1F37KA100001,2019,Honda,Accord,ABC123,64250,Brake Fluid,2026-02-18,62100,150.00,0.75,Declined,2026-02-18,Customer wanted to wait,2026-08-05,09:00,\"Brake Fluid; Cabin Air Filter\"",
].join("\n");

const columnAliases: Record<string, MaintivaField> = {
  "customer id": "customerExternalId",
  customerid: "customerExternalId",
  "first name": "customerFirstName",
  firstname: "customerFirstName",
  "last name": "customerLastName",
  lastname: "customerLastName",
  "full name": "customerFullName",
  fullname: "customerFullName",
  email: "customerEmail",
  phone: "customerPhone",
  "vehicle id": "vehicleExternalId",
  vehicleid: "vehicleExternalId",
  "vehicle customer id": "vehicleCustomerExternalId",
  vin: "vin",
  year: "vehicleYear",
  make: "vehicleMake",
  model: "vehicleModel",
  "license plate": "licensePlate",
  license: "licensePlate",
  "current mileage": "currentMileage",
  mileage: "currentMileage",
  "service name": "serviceName",
  service: "serviceName",
  "service date": "serviceDate",
  "service mileage": "serviceMileage",
  "recommended price": "price",
  price: "price",
  "labor hours": "laborHours",
  labor: "laborHours",
  status: "status",
  "declined date": "declinedDate",
  "advisor notes": "advisorNotes",
  notes: "advisorNotes",
  "appointment date": "appointmentDate",
  "appointment time": "appointmentTime",
  services: "services",
};

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function normalizeText(value: NormalizedCsvValue | undefined) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePhone(value: NormalizedCsvValue | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeVin(value: NormalizedCsvValue | undefined) {
  return String(value ?? "").trim().toUpperCase();
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);

  const [headers = [], ...body] = rows;
  return body.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

export function detectColumnMapping(headers: string[]): Record<string, MaintivaField> {
  return Object.fromEntries(
    headers.map((header) => [
      header,
      columnAliases[normalizeHeader(header)] ?? "ignore",
    ]),
  );
}

function mapped(row: CsvRow, mapping: Record<string, MaintivaField>, field: MaintivaField) {
  const source = Object.entries(mapping).find(([, value]) => value === field)?.[0];
  return source ? row[source]?.trim() ?? "" : "";
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ") || parts[0] || "",
  };
}

function cents(value: string) {
  const number = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(number) ? Math.round(number * 100) : NaN;
}

function nullableNonNegativeInteger(value: string) {
  if (!value.trim()) return null;
  const number = Number(value.replace(/,/g, ""));
  return Number.isInteger(number) && number >= 0 ? number : NaN;
}

function positiveHours(value: string) {
  if (!value) return 0;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : NaN;
}

function validDate(value: string) {
  if (!value) return "";
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? "" : new Date(value).toISOString().slice(0, 10);
}

function validateEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validatePhone(value: string) {
  return !value || value.replace(/\D/g, "").length >= 10;
}

function displayDate(value: NormalizedCsvValue | undefined) {
  const date = validDate(String(value ?? ""));
  if (!date) return String(value ?? "").trim() || "an unrecorded date";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function includesDeclinedStatus(value: NormalizedCsvValue | undefined) {
  return normalizeText(value).includes("declin");
}

function includesCompletedStatus(value: NormalizedCsvValue | undefined) {
  const status = normalizeText(value);
  return ["complete", "completed", "done", "performed", "paid", "closed"].some((token) => status.includes(token));
}

export type ImportRowEventClassification = {
  importsCompletedService: boolean;
  importsDeclinedWork: boolean;
  importsAppointment: boolean;
  ambiguousConflict: boolean;
  issue?: string;
};

export function classifyImportRowEvent(
  importType: ImportType,
  normalized: Record<string, NormalizedCsvValue>,
): ImportRowEventClassification {
  const serviceName = String(normalized.serviceName || normalized.services || "").trim();
  const serviceDate = String(normalized.serviceDate ?? "");
  const serviceMileage = Number(normalized.serviceMileage || 0);
  const declinedDate = String(normalized.declinedDate ?? "");
  const appointmentDate = String(normalized.appointmentDate ?? "");
  const appointmentTime = String(normalized.appointmentTime ?? "");
  const statusDeclined = includesDeclinedStatus(normalized.status);
  const statusCompleted = includesCompletedStatus(normalized.status);
  const importsAppointment = importType === "APPOINTMENTS" || Boolean(appointmentDate && appointmentTime);
  const hasCompletionSignal = Boolean(serviceDate) || serviceMileage > 0 || statusCompleted || importType === "SERVICE_HISTORY";
  const hasDeclineSignal = importType === "DECLINED_WORK" || Boolean(declinedDate) || statusDeclined;
  const sameCycleDate = !serviceDate || !declinedDate || serviceDate === declinedDate;
  const ambiguousConflict =
    Boolean(serviceName) &&
    hasCompletionSignal &&
    hasDeclineSignal &&
    sameCycleDate &&
    !importsAppointment;

  if (ambiguousConflict) {
    return {
      importsCompletedService: false,
      importsDeclinedWork: false,
      importsAppointment,
      ambiguousConflict: true,
      issue: `Row marks ${serviceName} as both completed and declined on ${displayDate(declinedDate || serviceDate)}.`,
    };
  }

  const importsDeclinedWork = hasDeclineSignal && !importsAppointment;
  const importsCompletedService =
    !importsDeclinedWork &&
    !importsAppointment &&
    hasCompletionSignal;

  return {
    importsCompletedService,
    importsDeclinedWork,
    importsAppointment,
    ambiguousConflict: false,
  };
}

function customerKey(normalized: Record<string, NormalizedCsvValue>) {
  const external = normalizeText(normalized.customerExternalId);
  const email = normalizeText(normalized.customerEmail);
  const phone = normalizePhone(normalized.customerPhone);
  const name = `${normalizeText(normalized.customerFirstName)}|${normalizeText(normalized.customerLastName)}`;
  if (external) return `external:${external}`;
  if (email) return `email:${email}`;
  if (phone) return `phone:${phone}`;
  return `name:${name}`;
}

function vehicleKey(normalized: Record<string, NormalizedCsvValue>, resolvedCustomerKey: string) {
  const external = normalizeText(normalized.vehicleExternalId);
  const vin = normalizeVin(normalized.vin);
  if (external) return `external:${external}`;
  if (vin) return `vin:${vin}`;
  return `details:${resolvedCustomerKey}|${normalized.vehicleYear}|${normalizeText(normalized.vehicleMake)}|${normalizeText(normalized.vehicleModel)}`;
}

function childKind(
  importType: ImportType,
  normalized: Record<string, NormalizedCsvValue>,
  classification = classifyImportRowEvent(importType, normalized),
) {
  if (classification.importsAppointment) return "Appointment" as const;
  if (classification.importsDeclinedWork) return "Declined work" as const;
  return "Service" as const;
}

function childKey(kind: EntityImportResult["entity"], vehicleKeyValue: string, normalized: Record<string, NormalizedCsvValue>) {
  const serviceName = normalizeText(normalized.serviceName || normalized.services);
  if (kind === "Appointment") {
    return `appointment:${vehicleKeyValue}|${normalized.appointmentDate}|${normalized.appointmentTime}|${serviceName}`;
  }
  if (kind === "Declined work") {
    return `declined:${vehicleKeyValue}|${serviceName}|${normalized.declinedDate}`;
  }
  return `service:${vehicleKeyValue}|${serviceName}|${normalized.serviceDate}|${normalized.serviceMileage}`;
}

function existingCustomerResult(state: DemoState, normalized: Record<string, NormalizedCsvValue>) {
  const email = normalizeText(normalized.customerEmail);
  const phone = normalizePhone(normalized.customerPhone);
  const first = normalizeText(normalized.customerFirstName);
  const last = normalizeText(normalized.customerLastName);
  const match = state.customers.find((customer) =>
    (email && normalizeText(customer.email) === email) ||
    (phone && normalizePhone(customer.phone) === phone) ||
    (first && last && normalizeText(customer.firstName) === first && normalizeText(customer.lastName) === last),
  );
  return match ? { match, key: `existing:${match.id}` } : undefined;
}

function existingVehicleResult(state: DemoState, normalized: Record<string, NormalizedCsvValue>, customerId?: string) {
  const vin = normalizeVin(normalized.vin);
  const year = Number(normalized.vehicleYear);
  const make = normalizeText(normalized.vehicleMake);
  const model = normalizeText(normalized.vehicleModel);
  const match = state.vehicles.find((vehicle) =>
    (vin && normalizeVin(vehicle.vin) === vin) ||
    (customerId && vehicle.customerId === customerId && vehicle.year === year && normalizeText(vehicle.make) === make && normalizeText(vehicle.model) === model),
  );
  return match ? { match, key: `existing:${match.id}` } : undefined;
}

function existingChildResult(state: DemoState, kind: EntityImportResult["entity"], vehicleId: string | undefined, normalized: Record<string, NormalizedCsvValue>) {
  if (!vehicleId) return undefined;
  const serviceName = normalizeText(normalized.serviceName || normalized.services);
  if (kind === "Appointment") {
    const start = normalized.appointmentDate && normalized.appointmentTime
      ? new Date(`${normalized.appointmentDate}T${normalized.appointmentTime}:00`).toISOString()
      : "";
    const match = state.appointments.find((appointment) =>
      appointment.vehicleId === vehicleId && appointment.scheduledStart === start,
    );
    return match ? { key: `appointment:${match.id}` } : undefined;
  }
  if (kind === "Declined work") {
    const match = state.declinedWorkRecords.find((record) =>
      record.vehicleId === vehicleId &&
      normalizeText(record.serviceName) === serviceName &&
      record.declinedAt.slice(0, 10) === String(normalized.declinedDate ?? "").slice(0, 10),
    );
    return match ? { key: `declined:${match.id}` } : undefined;
  }
  const serviceMileage = typeof normalized.serviceMileage === "number" && !Number.isNaN(normalized.serviceMileage)
    ? normalized.serviceMileage
    : null;
  const match = state.serviceRecords.find((record) =>
    record.vehicleId === vehicleId &&
    normalizeText(record.serviceName) === serviceName &&
    record.completedAt.slice(0, 10) === String(normalized.serviceDate ?? "").slice(0, 10) &&
    record.mileage === serviceMileage,
  );
  return match ? { key: `service:${match.id}` } : undefined;
}

export function previewImport({
  rows,
  mapping,
  importType,
  state,
}: {
  rows: CsvRow[];
  mapping: Record<string, MaintivaField>;
  importType: ImportType;
  state: DemoState;
}) {
  const customerBatch = new Map<string, string>();
  const vehicleBatch = new Map<string, string>();
  const childBatch = new Set<string>();

  const previewRows: ImportPreviewRow[] = rows.map((row, index) => {
    const fullName = mapped(row, mapping, "customerFullName");
    const split = splitName(fullName);
    const normalized = {
      customerExternalId: mapped(row, mapping, "customerExternalId"),
      customerFirstName: mapped(row, mapping, "customerFirstName") || split.firstName,
      customerLastName: mapped(row, mapping, "customerLastName") || split.lastName,
      customerEmail: mapped(row, mapping, "customerEmail"),
      customerPhone: mapped(row, mapping, "customerPhone"),
      vehicleExternalId: mapped(row, mapping, "vehicleExternalId"),
      vehicleCustomerExternalId: mapped(row, mapping, "vehicleCustomerExternalId"),
      vin: mapped(row, mapping, "vin").toUpperCase(),
      vehicleYear: Number(mapped(row, mapping, "vehicleYear")),
      vehicleMake: mapped(row, mapping, "vehicleMake"),
      vehicleModel: mapped(row, mapping, "vehicleModel"),
      licensePlate: mapped(row, mapping, "licensePlate"),
      currentMileage: nullableNonNegativeInteger(mapped(row, mapping, "currentMileage")),
      serviceName: mapped(row, mapping, "serviceName"),
      serviceDate: validDate(mapped(row, mapping, "serviceDate")),
      serviceMileage: nullableNonNegativeInteger(mapped(row, mapping, "serviceMileage")),
      price: cents(mapped(row, mapping, "price")),
      laborHours: positiveHours(mapped(row, mapping, "laborHours")),
      status: mapped(row, mapping, "status"),
      declinedDate: validDate(mapped(row, mapping, "declinedDate")),
      advisorNotes: mapped(row, mapping, "advisorNotes"),
      appointmentDate: validDate(mapped(row, mapping, "appointmentDate")),
      appointmentTime: mapped(row, mapping, "appointmentTime"),
      services: mapped(row, mapping, "services"),
    };
    const errors: string[] = [];
    const reviewIssues: string[] = [];

    if (["CUSTOMERS", "COMBINED"].includes(importType)) {
      if (!normalized.customerFirstName || !normalized.customerLastName) errors.push("Customer first and last name are required.");
      if (!validateEmail(String(normalized.customerEmail))) errors.push("Email format is invalid.");
      if (!validatePhone(String(normalized.customerPhone))) errors.push("Phone number is invalid.");
    }
    if (["VEHICLES", "COMBINED"].includes(importType)) {
      if (!normalized.vehicleMake || !normalized.vehicleModel) errors.push("Vehicle make and model are required.");
      if (!Number.isInteger(normalized.vehicleYear) || normalized.vehicleYear < 1900 || normalized.vehicleYear > 2100) errors.push("Vehicle year is invalid.");
      if (Number.isNaN(normalized.currentMileage)) errors.push("Mileage must be non-negative.");
      if (Number.isNaN(normalized.serviceMileage)) errors.push("Service mileage must be non-negative.");
      if (normalized.vin && String(normalized.vin).length !== 17) errors.push("VIN must be 17 characters.");
    }
    if (["SERVICE_HISTORY", "DECLINED_WORK", "APPOINTMENTS", "COMBINED"].includes(importType)) {
      if (!normalized.serviceName && !normalized.services) errors.push("Service name is required.");
      if (Number.isNaN(normalized.price) || normalized.price <= 0) errors.push("Service price must be positive.");
      if (Number.isNaN(normalized.laborHours) || normalized.laborHours <= 0) errors.push("Labor hours must be positive.");
    }
    const eventClassification = classifyImportRowEvent(importType, normalized);
    if (
      ["SERVICE_HISTORY", "COMBINED"].includes(importType) &&
      eventClassification.importsCompletedService &&
      (normalized.serviceName || normalized.services) &&
      (
        (typeof normalized.serviceMileage === "number" && normalized.serviceMileage > 0) ||
        (typeof normalized.currentMileage === "number" && normalized.currentMileage > 0)
      ) &&
      !normalized.serviceDate
    ) {
      errors.push("Reading Date is required when importing mileage history.");
    }
    if (importType === "SERVICE_HISTORY" && !normalized.serviceDate) errors.push("Service date is invalid.");
    if (importType === "DECLINED_WORK" && !normalized.declinedDate) errors.push("Declined date is invalid.");
    if (importType === "APPOINTMENTS" && (!normalized.appointmentDate || !normalized.appointmentTime)) errors.push("Appointment date and time are required.");
    if (eventClassification.ambiguousConflict && eventClassification.issue) {
      reviewIssues.push(eventClassification.issue.replace(/^Row /, `Row ${index + 2} `));
    }

    const customerMatch = existingCustomerResult(state, normalized);
    const cKey = customerMatch?.key ?? customerKey(normalized);
    const customerAlreadyInBatch = customerBatch.has(cKey);
    if (!customerMatch && !customerAlreadyInBatch) customerBatch.set(cKey, `batch-customer-${index}`);
    const customer: EntityImportResult = customerMatch
      ? { entity: "Customer", status: "MATCH", message: "Matched existing customer using email, phone, or name.", key: cKey }
      : customerAlreadyInBatch
        ? { entity: "Customer", status: "MATCH", message: "Reuses customer created earlier in this import.", key: cKey }
        : { entity: "Customer", status: "CREATE", message: "New customer will be created.", key: cKey };

    const vehicleMatch = existingVehicleResult(state, normalized, customerMatch?.match.id);
    const vKey = vehicleMatch?.key ?? vehicleKey(normalized, cKey);
    const vehicleAlreadyInBatch = vehicleBatch.has(vKey);
    if (!vehicleMatch && !vehicleAlreadyInBatch) vehicleBatch.set(vKey, `batch-vehicle-${index}`);
    const vehicle: EntityImportResult = vehicleMatch
      ? { entity: "Vehicle", status: "MATCH", message: "Matched existing vehicle using VIN or customer plus vehicle details.", key: vKey }
      : vehicleAlreadyInBatch
        ? { entity: "Vehicle", status: "MATCH", message: "Reuses vehicle created earlier in this import.", key: vKey }
        : { entity: "Vehicle", status: "CREATE", message: "New vehicle will be created under the resolved customer.", key: vKey };

    const kind = childKind(importType, normalized, eventClassification);
    const key = childKey(kind, vKey, normalized);
    const existingChild = existingChildResult(state, kind, vehicleMatch?.match.id, normalized);
    const childDuplicate = Boolean(existingChild) || childBatch.has(key);
    if (!childDuplicate) childBatch.add(key);
    const child: EntityImportResult = childDuplicate
      ? {
          entity: kind,
          status: "DUPLICATE",
          message: kind === "Service"
            ? `Matched existing customer and vehicle. This service appears to have already been imported for ${normalized.serviceDate || "that date"}${normalized.serviceMileage === null ? " with no mileage entered" : ` at ${normalized.serviceMileage} miles`}.`
            : `${kind} appears to have already been imported and will follow the selected row action.`,
          key,
        }
      : { entity: kind, status: "CREATE", message: `${kind} is new and ready to import.`, key };

    const status = errors.length > 0 ? "INVALID" : reviewIssues.length > 0 ? "HELD" : childDuplicate ? "DUPLICATE" : "VALID";
    const action: ImportRowAction = status === "INVALID" || status === "HELD" ? "HOLD" : childDuplicate ? "SKIP" : "IMPORT";
    const duplicateReason = childDuplicate ? child.message : undefined;
    const issue = errors[0] ?? reviewIssues[0] ?? [customer.message, vehicle.message, child.message].join(" ");

    return {
      rowNumber: index + 2,
      raw: row,
      normalized,
      duplicateReason,
      status,
      action,
      issue,
      errors: [...errors, ...reviewIssues],
      entities: { customer, vehicle, child },
    };
  });

  const summary = summarizeImport(previewRows);

  return { rows: previewRows, summary };
}

function effectiveAction(row: ImportPreviewRow, rowActions?: Record<number, ImportRowAction>, duplicateMode: DuplicateImportMode = "SKIP") {
  const override = rowActions?.[row.rowNumber];
  if (row.status === "INVALID" || row.status === "HELD") {
    return override === "SKIP" ? "SKIP" : "HOLD";
  }
  if (override) return override;
  if (row.entities.child.status === "DUPLICATE") {
    if (duplicateMode === "UPDATE") return "UPDATE";
    if (duplicateMode === "IMPORT_AS_NEW") return "IMPORT_AS_NEW";
    return "SKIP";
  }
  return row.action;
}

export function summarizeImport(
  rows: ImportPreviewRow[],
  duplicateMode: DuplicateImportMode = "SKIP",
  rowActions: Record<number, ImportRowAction> = {},
): ImportSummary {
  const actionFor = (row: ImportPreviewRow) => effectiveAction(row, rowActions, duplicateMode);
  const importable = rows.filter((row) =>
    ["IMPORT", "UPDATE", "IMPORT_AS_NEW"].includes(actionFor(row)) &&
    row.status !== "INVALID" &&
    row.status !== "HELD",
  );
  const customersToCreate = new Set(importable.filter((row) => row.entities.customer.status === "CREATE").map((row) => row.entities.customer.key)).size;
  const customersMatched = new Set(importable.filter((row) => row.entities.customer.status === "MATCH").map((row) => row.entities.customer.key)).size;
  const vehiclesToCreate = new Set(importable.filter((row) => row.entities.vehicle.status === "CREATE").map((row) => row.entities.vehicle.key)).size;
  const vehiclesMatched = new Set(importable.filter((row) => row.entities.vehicle.status === "MATCH").map((row) => row.entities.vehicle.key)).size;
  const skippedDuplicateRows = rows.filter((row) => row.entities.child.status === "DUPLICATE" && actionFor(row) === "SKIP").length;

  return {
    totalRows: rows.length,
    readyRows: importable.length,
    validRows: rows.filter((row) => row.status === "VALID").length,
    reviewRows: rows.filter((row) => row.status === "HELD").length,
    invalidRows: rows.filter((row) => row.status === "INVALID").length,
    duplicateRows: rows.filter((row) => row.entities.child.status === "DUPLICATE").length,
    duplicateSkippedRows: skippedDuplicateRows,
    failedRows: rows.filter((row) => row.status === "INVALID").length,
    customersToCreate,
    customersMatched,
    vehiclesToCreate,
    vehiclesMatched,
    servicesToImport: importable.filter((row) => row.entities.child.entity === "Service" && row.entities.child.status !== "DUPLICATE").length,
    declinedWorkToImport: importable.filter((row) => row.entities.child.entity === "Declined work" && row.entities.child.status !== "DUPLICATE").length,
    appointmentsToImport: importable.filter((row) => row.entities.child.entity === "Appointment" && row.entities.child.status !== "DUPLICATE").length,
    recordsToUpdate: rows.filter((row) => actionFor(row) === "UPDATE").length,
    duplicateChildRecordsToSkip: skippedDuplicateRows,
    heldRows: rows.filter((row) => actionFor(row) === "HOLD").length,
    skippedRows: rows.filter((row) => actionFor(row) === "SKIP").length,
    successfulRows: importable.filter((row) => actionFor(row) !== "UPDATE").length,
    updatedRows: rows.filter((row) => actionFor(row) === "UPDATE").length,
  };
}

export function buildImportErrorCsv(rows: ImportPreviewRow[]) {
  const failures = rows.filter((row) =>
    row.status === "INVALID" ||
    row.status === "HELD" ||
    row.entities.child.status === "DUPLICATE" ||
    row.action === "HOLD" ||
    row.action === "SKIP",
  );
  const disposition = (row: ImportPreviewRow) => {
    if (row.status === "HELD") return "NEEDS_REVIEW";
    if (row.status === "INVALID") return "INVALID";
    if (row.entities.child.status === "DUPLICATE") return "DUPLICATE_SKIPPED";
    return row.action;
  };
  return [
    "Row,Disposition,Issue",
    ...failures.map((row) => `${row.rowNumber},${disposition(row)},"${(row.errors.join("; ") || row.issue).replaceAll('"', '""')}"`),
  ].join("\n");
}
