import { describe, expect, it } from "vitest";
import { createInitialDemoState } from "@/lib/demo-data";
import {
  buildImportErrorCsv,
  detectColumnMapping,
  parseCsv,
  previewImport,
  summarizeImport,
} from "@/lib/csv-import";

describe("CSV import workflow", () => {
  it("parses quoted CSV cells and detects common columns", () => {
    const rows = parseCsv('Full Name,Email,Services\n"Jordan Lee",jordan@example.com,"Oil Change; Brake Fluid"');
    const mapping = detectColumnMapping(Object.keys(rows[0]));

    expect(rows[0].Services).toBe("Oil Change; Brake Fluid");
    expect(mapping["Full Name"]).toBe("customerFullName");
    expect(mapping.Email).toBe("customerEmail");
  });

  it("validates customers, vehicles, service values, and VIN length", () => {
    const rows = parseCsv(
      "Full Name,Email,Phone,VIN,Year,Make,Model,Current Mileage,Service Name,Price,Labor Hours\nBad Email,bad-email,404,SHORT,1800,Honda,Accord,-1,Oil Change,-5,0",
    );
    const mapping = detectColumnMapping(Object.keys(rows[0]));
    const preview = previewImport({
      rows,
      mapping,
      importType: "COMBINED",
      state: createInitialDemoState(),
    });

    expect(preview.rows[0].status).toBe("INVALID");
    expect(preview.rows[0].errors).toEqual(expect.arrayContaining([
      "Email format is invalid.",
      "Phone number is invalid.",
      "Vehicle year is invalid.",
      "VIN must be 17 characters.",
      "Service price must be positive.",
      "Labor hours must be positive.",
    ]));
  });

  it("detects duplicate customers and vehicles without silently overwriting", () => {
    const rows = parseCsv(
      "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Price,Labor Hours\nJustin,Camacho,justin@example.com,1J4FA49S03P123456,2003,Jeep,Wrangler,98600,Brake Pads,360,1.5",
    );
    const mapping = detectColumnMapping(Object.keys(rows[0]));
    const preview = previewImport({
      rows,
      mapping,
      importType: "COMBINED",
      state: createInitialDemoState(),
    });

    expect(preview.rows[0].status).toBe("DUPLICATE");
    expect(preview.summary.skippedRows).toBe(1);
  });

  it("summarizes skip, update, and import-as-new duplicate choices", () => {
    const rows = parseCsv(
      "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Price,Labor Hours\nJustin,Camacho,justin@example.com,1J4FA49S03P123456,2003,Jeep,Wrangler,98600,Brake Pads,360,1.5",
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });

    expect(summarizeImport(preview.rows, "SKIP")).toMatchObject({
      skippedRows: 1,
      successfulRows: 0,
      updatedRows: 0,
    });
    expect(summarizeImport(preview.rows, "UPDATE")).toMatchObject({
      skippedRows: 0,
      successfulRows: 0,
      updatedRows: 1,
    });
    expect(summarizeImport(preview.rows, "IMPORT_AS_NEW")).toMatchObject({
      skippedRows: 0,
      successfulRows: 1,
      updatedRows: 0,
    });
  });

  it("exports rejected rows as a downloadable error report", () => {
    const rows = parseCsv("Full Name,Email\nBroken,bad-email");
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "CUSTOMERS",
      state: createInitialDemoState(),
    });

    expect(buildImportErrorCsv(preview.rows)).toContain("Email format is invalid");
  });
});
