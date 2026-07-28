import type { DemoState } from "@/lib/demo-data";

export type ImportType =
  | "CUSTOMERS"
  | "VEHICLES"
  | "SERVICE_HISTORY"
  | "DECLINED_WORK"
  | "APPOINTMENTS"
  | "COMBINED";

export type DuplicateImportMode = "SKIP" | "UPDATE" | "IMPORT_AS_NEW";

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

export type ImportPreviewRow = {
  rowNumber: number;
  raw: CsvRow;
  normalized: Record<string, string | number>;
  status: "VALID" | "INVALID" | "DUPLICATE";
  duplicateReason?: string;
  errors: string[];
};

export type ImportSummary = {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  failedRows: number;
  successfulRows: number;
  updatedRows: number;
  skippedRows: number;
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
  "vin": "vin",
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

function nonNegativeInteger(value: string) {
  if (!value) return 0;
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

function detectDuplicate(state: DemoState, normalized: Record<string, string | number>) {
  const email = String(normalized.customerEmail ?? "").toLowerCase();
  const phone = String(normalized.customerPhone ?? "").replace(/\D/g, "");
  const vin = String(normalized.vin ?? "").toUpperCase();
  const name = `${normalized.customerFirstName ?? ""} ${normalized.customerLastName ?? ""}`.trim().toLowerCase();

  if (email && state.customers.some((customer) => customer.email.toLowerCase() === email)) {
    return "Existing customer email";
  }
  if (phone && state.customers.some((customer) => customer.phone.replace(/\D/g, "") === phone)) {
    return "Existing customer phone";
  }
  if (vin && state.vehicles.some((vehicle) => vehicle.vin.toUpperCase() === vin)) {
    return "Existing vehicle VIN";
  }
  if (
    name &&
    state.customers.some(
      (customer) => `${customer.firstName} ${customer.lastName}`.toLowerCase() === name,
    )
  ) {
    return "Existing customer name";
  }
  return "";
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
      currentMileage: nonNegativeInteger(mapped(row, mapping, "currentMileage")),
      serviceName: mapped(row, mapping, "serviceName"),
      serviceDate: validDate(mapped(row, mapping, "serviceDate")),
      serviceMileage: nonNegativeInteger(mapped(row, mapping, "serviceMileage")),
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

    if (["CUSTOMERS", "COMBINED"].includes(importType)) {
      if (!normalized.customerFirstName || !normalized.customerLastName) {
        errors.push("Customer first and last name are required.");
      }
      if (!validateEmail(String(normalized.customerEmail))) errors.push("Email format is invalid.");
      if (!validatePhone(String(normalized.customerPhone))) errors.push("Phone number is invalid.");
    }
    if (["VEHICLES", "COMBINED"].includes(importType)) {
      if (!normalized.vehicleMake || !normalized.vehicleModel) errors.push("Vehicle make and model are required.");
      if (!Number.isInteger(normalized.vehicleYear) || normalized.vehicleYear < 1900 || normalized.vehicleYear > 2100) {
        errors.push("Vehicle year is invalid.");
      }
      if (Number.isNaN(normalized.currentMileage)) errors.push("Mileage must be non-negative.");
      if (normalized.vin && String(normalized.vin).length !== 17) errors.push("VIN must be 17 characters.");
    }
    if (["SERVICE_HISTORY", "DECLINED_WORK", "APPOINTMENTS", "COMBINED"].includes(importType)) {
      if (!normalized.serviceName && !normalized.services) errors.push("Service name is required.");
      if (Number.isNaN(normalized.price) || normalized.price <= 0) errors.push("Service price must be positive.");
      if (Number.isNaN(normalized.laborHours) || normalized.laborHours <= 0) errors.push("Labor hours must be positive.");
    }
    if (importType === "SERVICE_HISTORY" && !normalized.serviceDate) errors.push("Service date is invalid.");
    if (importType === "DECLINED_WORK" && !normalized.declinedDate) errors.push("Declined date is invalid.");
    if (importType === "APPOINTMENTS" && (!normalized.appointmentDate || !normalized.appointmentTime)) {
      errors.push("Appointment date and time are required.");
    }

    const duplicateReason = detectDuplicate(state, normalized);

    return {
      rowNumber: index + 2,
      raw: row,
      normalized,
      duplicateReason,
      status: errors.length > 0 ? "INVALID" : duplicateReason ? "DUPLICATE" : "VALID",
      errors,
    };
  });

  const summary = summarizeImport(previewRows, "SKIP");

  return { rows: previewRows, summary };
}

export function summarizeImport(rows: ImportPreviewRow[], duplicateMode: DuplicateImportMode): ImportSummary {
  const validRows = rows.filter((row) => row.status === "VALID").length;
  const duplicateRows = rows.filter((row) => row.status === "DUPLICATE").length;
  return {
    totalRows: rows.length,
    validRows,
    duplicateRows,
    failedRows: rows.filter((row) => row.status === "INVALID").length,
    successfulRows: validRows + (duplicateMode === "IMPORT_AS_NEW" ? duplicateRows : 0),
    updatedRows: duplicateMode === "UPDATE" ? duplicateRows : 0,
    skippedRows: duplicateMode === "SKIP" ? duplicateRows : 0,
  };
}

export function buildImportErrorCsv(rows: ImportPreviewRow[]) {
  const failures = rows.filter((row) => row.status === "INVALID");
  return [
    "Row,Errors",
    ...failures.map((row) => `${row.rowNumber},"${row.errors.join("; ").replaceAll('"', '""')}"`),
  ].join("\n");
}
