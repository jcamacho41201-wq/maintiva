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

  it("imports multiple services for one new customer and vehicle without batch duplicates", () => {
    const rows = parseCsv(
      [
        "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours",
        "Emily,Carter,emily@example.com,2HKRW2H58LH600001,2020,Honda,CR-V,82500,Oil Change,2026-07-10,82500,89,0.5",
        "Emily,Carter,emily@example.com,2HKRW2H58LH600001,2020,Honda,CR-V,82500,Cabin Air Filter,2026-07-10,82500,49,0.3",
        "Emily,Carter,emily@example.com,2HKRW2H58LH600001,2020,Honda,CR-V,82500,Brake Fluid,2026-07-10,82500,165,0.9",
      ].join("\n"),
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });
    const summary = summarizeImport(preview.rows);

    expect(summary.customersToCreate).toBe(1);
    expect(summary.vehiclesToCreate).toBe(1);
    expect(summary.servicesToImport).toBe(3);
    expect(summary.duplicateRows).toBe(0);
    expect(preview.rows.slice(1).every((row) => row.entities.customer.status === "MATCH")).toBe(true);
  });

  it("imports multiple services for an existing customer and vehicle", () => {
    const rows = parseCsv(
      [
        "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours",
        "Justin,Camacho,justin@example.com,1J4FA49S03P123456,2003,Jeep,Wrangler,98600,Coolant Flush,2026-07-10,98600,180,1.0",
        "Justin,Camacho,justin@example.com,1J4FA49S03P123456,2003,Jeep,Wrangler,98600,Transfer Case Fluid,2026-07-10,98600,220,1.2",
        "Justin,Camacho,justin@example.com,1J4FA49S03P123456,2003,Jeep,Wrangler,98600,Power Steering Fluid,2026-07-10,98600,130,0.7",
      ].join("\n"),
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });
    const summary = summarizeImport(preview.rows);

    expect(summary.customersToCreate).toBe(0);
    expect(summary.customersMatched).toBe(1);
    expect(summary.vehiclesToCreate).toBe(0);
    expect(summary.vehiclesMatched).toBe(1);
    expect(summary.servicesToImport).toBe(3);
    expect(summary.skippedRows).toBe(0);
    expect(preview.rows.every((row) => row.status === "VALID")).toBe(true);
  });

  it("detects exact service duplicates when the same file is reimported", () => {
    const rows = parseCsv(
      "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours\nJohn,Doe,john.doe@example.com,1HGCV1F37KA100001,2019,Honda,Accord,64250,Oil Change,2026-02-18,62100,85,0.5",
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });

    expect(preview.rows[0].entities.customer.status).toBe("MATCH");
    expect(preview.rows[0].entities.vehicle.status).toBe("MATCH");
    expect(preview.rows[0].entities.child.status).toBe("DUPLICATE");
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

  it("detects appointment duplicates using the shop timezone", () => {
    const rows = parseCsv(
      "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Appointment Date,Appointment Time,Price,Labor Hours\nVictor,Chen,victor@example.com,5XYP3DHC5MG100008,2021,Kia,Telluride,49750,Battery,2026-07-28,13:30,250,1",
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "APPOINTMENTS",
      state: createInitialDemoState(),
      timeZone: "America/New_York",
    });

    expect(preview.rows[0].entities.customer.status).toBe("MATCH");
    expect(preview.rows[0].entities.vehicle.status).toBe("MATCH");
    expect(preview.rows[0].entities.child.status).toBe("DUPLICATE");
  });

  it("matches an existing customer while creating a new vehicle under that customer", () => {
    const rows = parseCsv(
      "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours\nJustin,Camacho,justin@example.com,5NMS3CADXLH123456,2021,Hyundai,Santa Fe,30000,Oil Change,2026-07-10,30000,90,0.5",
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });
    const summary = summarizeImport(preview.rows);

    expect(summary.customersMatched).toBe(1);
    expect(summary.vehiclesToCreate).toBe(1);
    expect(summary.servicesToImport).toBe(1);
  });

  it("reuses a new customer repeated by email inside the same file", () => {
    const rows = parseCsv(
      [
        "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours",
        "Maya,Lopez,maya@example.com,1C4RJFBG1KC100001,2019,Jeep,Grand Cherokee,55000,Oil Change,2026-07-10,55000,95,0.5",
        "Maya,Lopez,maya@example.com,3CZRU6H59KM700001,2019,Honda,HR-V,47000,Cabin Air Filter,2026-07-12,47000,55,0.3",
      ].join("\n"),
    );
    const summary = summarizeImport(previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    }).rows);

    expect(summary.customersToCreate).toBe(1);
    expect(summary.vehiclesToCreate).toBe(2);
    expect(summary.servicesToImport).toBe(2);
  });

  it("allows an ambiguous child record to be held while other rows import", () => {
    const rows = parseCsv(
      [
        "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours",
        "Nia,Stone,nia@example.com,1FMCU0GD5KUA00001,2019,Ford,Escape,50000,Oil Change,2026-07-10,50000,90,0.5",
        "Nia,Stone,nia@example.com,1FMCU0GD5KUA00001,2019,Ford,Escape,50000,Brake Fluid,2026-07-10,50000,160,0.8",
      ].join("\n"),
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });
    const summary = summarizeImport(preview.rows, "SKIP", { [preview.rows[1].rowNumber]: "HOLD" });

    expect(summary.heldRows).toBe(1);
    expect(summary.servicesToImport).toBe(1);
    expect(summary.customersToCreate).toBe(1);
    expect(summary.vehiclesToCreate).toBe(1);
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
