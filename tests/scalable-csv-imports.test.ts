import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAINTIVA_IMPORT_BATCH_SIZE,
  MAINTIVA_IMPORT_MAX_BATCH_SIZE,
  MAINTIVA_IMPORT_ROW_LIMIT,
  parseCsv,
} from "@/lib/csv-import";

const pilotStateSource = readFileSync(join(process.cwd(), "src/lib/pilot-state.ts"), "utf8");
const mutateRouteSource = readFileSync(join(process.cwd(), "src/app/api/pilot/mutate/route.ts"), "utf8");
const importPageSource = readFileSync(join(process.cwd(), "src/app/import/page.tsx"), "utf8");

function bodyOf(functionName: string) {
  const match = pilotStateSource.match(new RegExp(`export async function ${functionName}[\\s\\S]+?\\n}\\n(?=\\n(export async function|type |function)|$)`));
  expect(match, `${functionName} should exist`).not.toBeNull();
  return match?.[0] ?? "";
}

describe("scalable CSV imports", () => {
  it("uses a 25-row default batch size with a 50-row configuration ceiling", () => {
    expect(MAINTIVA_IMPORT_BATCH_SIZE).toBe(25);
    expect(MAINTIVA_IMPORT_MAX_BATCH_SIZE).toBe(50);
    expect(MAINTIVA_IMPORT_ROW_LIMIT).toBeGreaterThanOrEqual(1_000);
  });

  it("parses a single uploaded 1,000-row file without tripping the safety limit", () => {
    const csv = [
      "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours",
      ...Array.from({ length: 1_000 }, (_, index) => `Customer,${index},customer${index}@example.com,1HGCM82633A${String(index).padStart(4, "0")}1,2020,Honda,Accord,50000,Oil Change,2026-07-10,50000,95,0.5`),
    ].join("\n");

    expect(parseCsv(csv)).toHaveLength(1_000);
  });

  it("creates a durable import job and row queue before processing batches", () => {
    const createBody = bodyOf("createPilotImportJob");

    expect(createBody).toContain("tx.importHistoryRecord.create");
    expect(createBody).toContain("status: \"PREVIEWED\"");
    expect(createBody).toContain("tx.importRowRecord.createMany");
    expect(createBody).toContain("errorReport: importJobMetadataJson(metadata)");
  });

  it("processes the next server-selected batch inside its own transaction", () => {
    const processBody = bodyOf("processNextPilotImportBatch");

    expect(processBody).toContain("await prisma.$transaction");
    expect(processBody).toContain("status: \"PENDING\"");
    expect(processBody).toContain("take: metadata.batchSize");
    expect(processBody).toContain("updateImportJobProgress");
    expect(processBody).not.toContain("rows: input.rows");
  });

  it("does not route the production import action through the old whole-file transaction", () => {
    expect(mutateRouteSource).toMatch(/case "importCsvRows":[\s\S]+await createPilotImportJob\(context, body\.payload\);/);
    expect(mutateRouteSource).not.toContain("await importPilotCsvRows(context, body.payload)");
  });

  it("keeps appointment duplicate detection production-schema safe", () => {
    const rowBody = pilotStateSource.match(/async function processImportBatchRow[\s\S]+?return \{\n    status: matchedExisting/)?.[0] ?? "";

    expect(rowBody).toContain("tx.appointment.findFirst");
    expect(rowBody).toContain("select: duplicateAppointmentSelect");
    expect(rowBody).not.toContain("bookingLinkId");
  });

  it("keeps progress in persisted job state and drives multiple client requests", () => {
    expect(importPageSource).toContain("store.createImportJob");
    expect(importPageSource).toContain("store.processNextImportBatch");
    expect(importPageSource).toContain("Processed {activeImport.processedRows ?? 0} of {activeImport.totalRows} rows");
    expect(importPageSource).not.toContain("store.importCsvRows({");
  });
});
