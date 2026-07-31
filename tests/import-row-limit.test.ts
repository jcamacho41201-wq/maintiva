import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  importRowLimitMessage,
  isImportRowLimitExceeded,
  MAINTIVA_IMPORT_ROW_LIMIT,
  parseCsv,
} from "@/lib/csv-import";

const pilotStateSource = readFileSync(join(process.cwd(), "src/lib/pilot-state.ts"), "utf8");
const importPageSource = readFileSync(join(process.cwd(), "src/app/import/page.tsx"), "utf8");

function makeCsv(rowCount: number, trailingLines = "") {
  return [
    "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours",
    ...Array.from({ length: rowCount }, (_, index) => {
      const row = String(index + 1).padStart(4, "0");
      return `Customer,${row},customer${row}@example.com,1HGCM82633A${row}001,2020,Honda,Accord,${50_000 + index},Oil Change,2026-07-10,${50_000 + index},95,0.5`;
    }),
  ].join("\n") + trailingLines;
}

describe("temporary CSV import row limit", () => {
  it("accepts 50 parsed data rows", () => {
    const rows = parseCsv(makeCsv(MAINTIVA_IMPORT_ROW_LIMIT));

    expect(rows).toHaveLength(50);
    expect(isImportRowLimitExceeded(rows.length)).toBe(false);
  });

  it("rejects 51 parsed data rows with the safe message", () => {
    const rows = parseCsv(makeCsv(MAINTIVA_IMPORT_ROW_LIMIT + 1));

    expect(rows).toHaveLength(51);
    expect(isImportRowLimitExceeded(rows.length)).toBe(true);
    expect(importRowLimitMessage(rows.length)).toBe(
      "This import contains 51 rows. Maintiva currently supports up to 50 rows per import. Split the file into smaller batches and try again.",
    );
  });

  it("does not count the header row", () => {
    const rows = parseCsv(makeCsv(1));

    expect(rows).toHaveLength(1);
    expect(rows[0]["First Name"]).toBe("Customer");
  });

  it("does not count empty trailing lines", () => {
    const rows = parseCsv(makeCsv(MAINTIVA_IMPORT_ROW_LIMIT, "\n\n\n"));

    expect(rows).toHaveLength(50);
    expect(isImportRowLimitExceeded(rows.length)).toBe(false);
  });

  it("enforces the server limit before reads, writes, or import history creation", () => {
    const guardIndex = pilotStateSource.indexOf("if (isImportRowLimitExceeded(rowCount))");
    const stateLoadIndex = pilotStateSource.indexOf("const state = await buildPilotState(context);", guardIndex);
    const transactionIndex = pilotStateSource.indexOf("await prisma.$transaction", guardIndex);
    const customerWriteIndex = pilotStateSource.indexOf("tx.customer.create", guardIndex);
    const vehicleWriteIndex = pilotStateSource.indexOf("tx.vehicle.create", guardIndex);
    const appointmentWriteIndex = pilotStateSource.indexOf("tx.appointment.create", guardIndex);
    const importHistoryWriteIndex = pilotStateSource.indexOf("tx.importHistoryRecord.create", guardIndex);

    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(stateLoadIndex);
    expect(guardIndex).toBeLessThan(transactionIndex);
    expect(guardIndex).toBeLessThan(customerWriteIndex);
    expect(guardIndex).toBeLessThan(vehicleWriteIndex);
    expect(guardIndex).toBeLessThan(appointmentWriteIndex);
    expect(guardIndex).toBeLessThan(importHistoryWriteIndex);
  });

  it("adds matching client-side feedback without relying on it for enforcement", () => {
    expect(importPageSource).toContain("const rowLimitExceeded = isImportRowLimitExceeded(summary.totalRows);");
    expect(importPageSource).toContain("setSaveError(rowLimitError);");
    expect(importPageSource).toContain("disabled={saving || rowLimitExceeded");
    expect(pilotStateSource).toContain('code: "IMPORT_ROW_LIMIT_EXCEEDED"');
  });
});
