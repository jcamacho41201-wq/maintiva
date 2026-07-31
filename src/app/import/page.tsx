"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { Download, FileUp, TableProperties } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  buildImportErrorCsv,
  detectColumnMapping,
  importRowLimitMessage,
  isImportRowLimitExceeded,
  MAINTIVA_IMPORT_BATCH_SIZE,
  maintivaCsvTemplate,
  parseCsv,
  previewImport,
  summarizeImport,
  type DuplicateImportMode,
  type ImportRowAction,
  type ImportType,
  type MaintivaField,
} from "@/lib/csv-import";
import { useDemoStore } from "@/lib/demo-store";

const fields: { value: MaintivaField; label: string }[] = [
  { value: "ignore", label: "Ignore" },
  { value: "customerExternalId", label: "Customer external ID" },
  { value: "customerFirstName", label: "Customer first name" },
  { value: "customerLastName", label: "Customer last name" },
  { value: "customerFullName", label: "Customer full name" },
  { value: "customerEmail", label: "Customer email" },
  { value: "customerPhone", label: "Customer phone" },
  { value: "vehicleExternalId", label: "Vehicle external ID" },
  { value: "vehicleCustomerExternalId", label: "Vehicle customer external ID" },
  { value: "vin", label: "VIN" },
  { value: "vehicleYear", label: "Vehicle year" },
  { value: "vehicleMake", label: "Vehicle make" },
  { value: "vehicleModel", label: "Vehicle model" },
  { value: "licensePlate", label: "License plate" },
  { value: "currentMileage", label: "Current mileage" },
  { value: "serviceName", label: "Service name" },
  { value: "serviceDate", label: "Service date" },
  { value: "serviceMileage", label: "Service mileage" },
  { value: "price", label: "Price" },
  { value: "laborHours", label: "Labor hours" },
  { value: "status", label: "Status" },
  { value: "declinedDate", label: "Declined date" },
  { value: "advisorNotes", label: "Advisor notes" },
  { value: "appointmentDate", label: "Appointment date" },
  { value: "appointmentTime", label: "Appointment time" },
  { value: "services", label: "Services" },
];

const importTypes: { value: ImportType; label: string }[] = [
  { value: "COMBINED", label: "Combined customer, vehicle, services" },
  { value: "CUSTOMERS", label: "Customers only" },
  { value: "VEHICLES", label: "Vehicles only" },
  { value: "SERVICE_HISTORY", label: "Service history" },
  { value: "DECLINED_WORK", label: "Declined work" },
  { value: "APPOINTMENTS", label: "Appointments" },
];

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ImportPage() {
  const store = useDemoStore();
  const { state } = store;
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, MaintivaField>>({});
  const [importType, setImportType] = useState<ImportType>("COMBINED");
  const [duplicateMode, setDuplicateMode] = useState<DuplicateImportMode>("SKIP");
  const [rowActions, setRowActions] = useState<Record<number, ImportRowAction>>({});
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [activeImportId, setActiveImportId] = useState("");
  const headers = Object.keys(rows[0] ?? {});
  const preview = useMemo(
    () => previewImport({ rows, mapping, importType, state }),
    [rows, mapping, importType, state],
  );
  const summary = useMemo(
    () => summarizeImport(preview.rows, duplicateMode, rowActions),
    [preview.rows, duplicateMode, rowActions],
  );
  const rowLimitExceeded = isImportRowLimitExceeded(summary.totalRows);
  const rowLimitError = rowLimitExceeded ? importRowLimitMessage(summary.totalRows) : "";

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    const detected = detectColumnMapping(Object.keys(parsed[0] ?? {}));
    setFileName(file.name);
    setRows(parsed);
    setMapping(detected);
    setRowActions({});
    setCompleted(false);
    setSaveError(isImportRowLimitExceeded(parsed.length) ? importRowLimitMessage(parsed.length) : "");
  }

  async function confirmImport() {
    if (rowLimitExceeded) {
      setCompleted(false);
      setSaveError(rowLimitError);
      return;
    }

    setSaving(true);
    setSaveError("");
    setCompleted(false);
    setActiveImportId("");
    const createResult = await store.createImportJob({
      fileName: fileName || "manual-import.csv",
      importType,
      duplicateMode,
      rows,
      mapping,
      rowActions: Object.fromEntries(Object.entries(rowActions).map(([key, value]) => [key, value])),
      batchSize: MAINTIVA_IMPORT_BATCH_SIZE,
    });
    if (!createResult.ok) {
      setSaving(false);
      setCompleted(false);
      setSaveError(createResult.message ?? "Import could not be saved. Check the database schema and try again.");
      return;
    }

    let importJob = createResult.state?.importHistory[0];
    if (!importJob) {
      setSaving(false);
      setSaveError("Import job could not be loaded. Refresh the page and try again.");
      return;
    }
    setActiveImportId(importJob.id);
    importJob = await processImportUntilComplete(importJob.id, createResult.state);
    setSaving(false);
    setCompleted(Boolean(importJob && (importJob.status === "COMPLETED" || importJob.status === "PARTIAL")));
  }

  async function processImportUntilComplete(importId: string, startingState = state) {
    let importJob = startingState.importHistory.find((item) => item.id === importId);
    if (!importJob) {
      setSaveError("Import progress could not be loaded. Refresh the page to resume.");
      return undefined;
    }

    while ((importJob.processedRows ?? 0) < importJob.totalRows && importJob.status === "PREVIEWED") {
      const batchResult = await store.processNextImportBatch(importJob.id);
      if (!batchResult.ok) {
        setSaveError(batchResult.message ?? "Import paused. Previously completed batches were preserved.");
        return importJob;
      }
      importJob = batchResult.state?.importHistory.find((item) => item.id === importJob?.id);
      if (!importJob) {
        setSaveError("Import progress could not be reloaded. Refresh the page to resume.");
        return undefined;
      }
    }

    return importJob;
  }

  const activeImport = activeImportId
    ? state.importHistory.find((item) => item.id === activeImportId)
    : state.importHistory.find((item) => item.status === "PREVIEWED");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Import Data</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Bring customer, vehicle, service history, declined work, and appointment exports into Maintiva.
          </p>
        </div>
        <button
          onClick={() => downloadCsv("maintiva-import-template.csv", maintivaCsvTemplate)}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-800"
        >
          <Download className="h-4 w-4" />
          Template
        </button>
      </div>

      <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Upload and Map</h2>
            <p className="mt-1 text-sm text-zinc-500">CSV files are previewed before anything is accepted.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
              <FileUp className="h-8 w-8 text-violet-800" />
              <span className="mt-3 text-sm font-semibold">{fileName || "Choose CSV file"}</span>
              <span className="mt-1 text-xs text-zinc-500">Export from a POS, CRM, or spreadsheet.</span>
              <input type="file" accept=".csv,text/csv" onChange={handleFile} className="sr-only" />
            </label>
            <label className="text-sm font-medium">
              Import type
              <select
                value={importType}
                onChange={(event) => setImportType(event.target.value as ImportType)}
                className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
              >
                {importTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">
              Duplicate handling
              <select
                value={duplicateMode}
                onChange={(event) => setDuplicateMode(event.target.value as DuplicateImportMode)}
                className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
              >
                <option value="SKIP">Skip duplicate rows</option>
                <option value="UPDATE">Update matching customers and vehicles</option>
                <option value="IMPORT_AS_NEW">Import duplicate rows as new</option>
              </select>
            </label>
            {headers.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Column mapping</p>
                {headers.map((header) => (
                  <label key={header} className="block text-sm">
                    <span className="mb-1 block truncate text-zinc-600">{header}</span>
                    <select
                      value={mapping[header] ?? "ignore"}
                      onChange={(event) => setMapping({ ...mapping, [header]: event.target.value as MaintivaField })}
                      className="h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
                    >
                      {fields.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Preview</h2>
            <p className="mt-1 text-sm text-zinc-500">Rows are validated for required fields, duplicates, and service economics.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["Rows", summary.totalRows],
                ["Ready", summary.readyRows],
                ["Customers", `${summary.customersToCreate} new / ${summary.customersMatched} matched`],
                ["Vehicles", `${summary.vehiclesToCreate} new / ${summary.vehiclesMatched} matched`],
                ["Errors", summary.failedRows],
                ["Services", summary.servicesToImport],
                ["Declined", summary.declinedWorkToImport],
                ["Appointments", summary.appointmentsToImport],
                ["Held/skipped", `${summary.heldRows}/${summary.skippedRows}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-zinc-200 p-3">
                  <p className="text-xs text-zinc-500">{label}</p>
                  <p className="mt-1 text-xl font-semibold">{value}</p>
                </div>
              ))}
            </div>

            <div className="max-h-[34rem] overflow-auto rounded-lg border border-zinc-200">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Row</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Vehicle</th>
                    <th className="px-4 py-3">Child record</th>
                    <th className="px-4 py-3">Issue</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {preview.rows.slice(0, 50).map((row) => (
                    <tr key={row.rowNumber}>
                      <td className="px-4 py-3">{row.rowNumber}</td>
                      <td className="px-4 py-3">
                        <Badge variant={row.status === "VALID" ? "green" : row.status === "DUPLICATE" ? "yellow" : row.status === "INVALID" ? "red" : "neutral"}>
                          {row.status === "DUPLICATE" ? "Child duplicate" : row.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.normalized.customerFirstName} {row.normalized.customerLastName}</p>
                        <p className="text-xs text-zinc-500">{row.entities.customer.status}: {row.entities.customer.message}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.normalized.vehicleYear} {row.normalized.vehicleMake} {row.normalized.vehicleModel}</p>
                        <p className="text-xs text-zinc-500">{row.entities.vehicle.status}: {row.entities.vehicle.message}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.entities.child.entity}: {row.normalized.serviceName || row.normalized.services}</p>
                        <p className="text-xs text-zinc-500">{row.entities.child.status}: {row.entities.child.message}</p>
                      </td>
                      <td className="px-4 py-3 text-zinc-500">{row.errors[0] || row.issue}</td>
                      <td className="px-4 py-3">
                        <select
                          value={rowActions[row.rowNumber] ?? row.action}
                          onChange={(event) => setRowActions({
                            ...rowActions,
                            [row.rowNumber]: event.target.value as ImportRowAction,
                          })}
                          className="h-9 rounded-lg border border-zinc-200 px-2 text-sm outline-none focus:border-violet-500"
                        >
                          <option value="IMPORT">Import</option>
                          <option value="HOLD">Hold for review</option>
                          <option value="SKIP">Skip</option>
                          <option value="UPDATE">Resolve duplicate / update</option>
                          <option value="IMPORT_AS_NEW">Import as new</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap justify-between gap-3">
              <button
                onClick={() => downloadCsv("maintiva-import-errors.csv", buildImportErrorCsv(preview.rows))}
                disabled={summary.failedRows === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <TableProperties className="h-4 w-4" />
                Error report
              </button>
              <button
                onClick={confirmImport}
                disabled={saving || rowLimitExceeded || summary.totalRows === 0 || summary.successfulRows + summary.updatedRows === 0}
                className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {completed ? "Import complete" : saving ? "Importing..." : "Confirm import"}
              </button>
            </div>
            {activeImport && activeImport.status === "PREVIEWED" && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-900">
                <p>Importing customers</p>
                <p className="mt-1">
                  Processed {activeImport.processedRows ?? 0} of {activeImport.totalRows} rows. Imported {activeImport.successfulRows}, matched {activeImport.matchedRows ?? activeImport.updatedRows}, duplicates skipped {activeImport.duplicateRows}, needs review {activeImport.needsReviewRows ?? activeImport.skippedRows}, failed {activeImport.failedRows}.
                </p>
              </div>
            )}
            {completed && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                Import complete. Valid rows now create recovery opportunities and imported appointments where applicable.
              </div>
            )}
            {saveError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {saveError}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Import History</h2>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-3">File</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Successful</th>
                <th className="px-5 py-3">Duplicates</th>
                <th className="px-5 py-3">Failed</th>
                <th className="px-5 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {state.importHistory.map((item) => (
                <tr key={item.id}>
                  <td className="px-5 py-4 font-medium">{item.fileName}</td>
                  <td className="px-5 py-4">{item.importType}</td>
                  <td className="px-5 py-4"><Badge variant={item.status === "COMPLETED" ? "green" : "yellow"}>{item.status}</Badge></td>
                  <td className="px-5 py-4">{item.successfulRows}</td>
                  <td className="px-5 py-4">{item.duplicateRows}</td>
                  <td className="px-5 py-4">{item.failedRows}</td>
                  <td className="px-5 py-4">
                    {item.status === "PREVIEWED" ? (
                      <button
                        onClick={() => {
                          setActiveImportId(item.id);
                          setSaving(true);
                          void processImportUntilComplete(item.id).finally(() => setSaving(false));
                        }}
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-800"
                      >
                        Resume
                      </button>
                    ) : (
                      <span className="text-xs text-zinc-500">View results</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
