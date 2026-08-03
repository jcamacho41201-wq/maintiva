import { describe, expect, it } from "vitest";
import { createInitialDemoState } from "@/lib/demo-data";
import {
  classifyImportRowEvent,
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

  it("preserves missing mileage separately from explicit zero and valid mileage", () => {
    const rows = parseCsv(
      [
        "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours,Status",
        "Blank,Mileage,blank@example.com,WA1EAAF45LA100001,2021,Honda,CR-V,,Check Engine Diagnostic,2026-07-02,,160,1,Completed",
        "Whitespace,Mileage,space@example.com,WA1EAAF45LA100002,2021,Honda,CR-V,   ,Check Engine Diagnostic,2026-07-02,   ,160,1,Completed",
        "Zero,Mileage,zero@example.com,WA1EAAF45LA100003,2021,Honda,CR-V,0,Check Engine Diagnostic,2026-07-02,0,160,1,Completed",
        "Valid,Mileage,valid@example.com,WA1EAAF45LA100004,2021,Honda,CR-V,\"58,420\",Check Engine Diagnostic,2026-07-02,\"58,420\",160,1,Completed",
      ].join("\n"),
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });

    expect(preview.rows[0].normalized.currentMileage).toBeNull();
    expect(preview.rows[0].normalized.serviceMileage).toBeNull();
    expect(preview.rows[1].normalized.currentMileage).toBeNull();
    expect(preview.rows[1].normalized.serviceMileage).toBeNull();
    expect(preview.rows[2].normalized.currentMileage).toBe(0);
    expect(preview.rows[2].normalized.serviceMileage).toBe(0);
    expect(preview.rows[3].normalized.currentMileage).toBe(58_420);
    expect(preview.rows[3].normalized.serviceMileage).toBe(58_420);
  });

  it("marks invalid mileage without coercing it to zero", () => {
    const rows = parseCsv(
      "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours,Status\nInvalid,Mileage,invalid@example.com,WA1EAAF45LA100001,2021,Honda,CR-V,ABC,Check Engine Diagnostic,2026-07-02,ABC,160,1,Completed",
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });

    expect(preview.rows[0].status).toBe("INVALID");
    expect(preview.rows[0].errors).toEqual(expect.arrayContaining([
      "Mileage must be non-negative.",
      "Service mileage must be non-negative.",
    ]));
    expect(Number.isNaN(preview.rows[0].normalized.currentMileage)).toBe(true);
    expect(Number.isNaN(preview.rows[0].normalized.serviceMileage)).toBe(true);
  });

  it("does not match missing service mileage to an existing zero-mile service", () => {
    const state = createInitialDemoState();
    state.serviceRecords.push({
      id: "hist-jeep-zero-mile-diagnostic",
      shopId: state.shop.id,
      customerId: "cust-justin",
      vehicleId: "veh-jeep",
      serviceName: "Check Engine Diagnostic",
      completedAt: "2026-07-02",
      mileage: 0,
      priceCents: 16000,
      notes: "Explicit zero-mile QA fixture.",
    });
    const rows = parseCsv(
      [
        "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours,Status",
        "Justin,Camacho,justin@example.com,1J4FA49S03P123456,2003,Jeep,Wrangler,,Check Engine Diagnostic,2026-07-02,,160,1,Completed",
        "Justin,Camacho,justin@example.com,1J4FA49S03P123456,2003,Jeep,Wrangler,0,Check Engine Diagnostic,2026-07-02,0,160,1,Completed",
      ].join("\n"),
    );

    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state,
    });

    expect(preview.rows[0].normalized.serviceMileage).toBeNull();
    expect(preview.rows[0].entities.child.status).toBe("CREATE");
    expect(preview.rows[1].normalized.serviceMileage).toBe(0);
    expect(preview.rows[1].entities.child.status).toBe("DUPLICATE");
  });

  it("describes service-date mileage as historical evidence in the preview", () => {
    const rows = parseCsv(
      [
        "First Name,Last Name,Email,VIN,Year,Make,Model,Mileage,Service Name,Service Date,Price,Labor Hours,Status",
        "Alex,History,alex-history@example.com,WA1EAAF45LA100099,2019,Toyota,Tacoma,45000,Oil Change,2025-01-15,90,0.5,Completed",
      ].join("\n"),
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });

    expect(preview.rows[0].normalized.currentMileage).toBe(45_000);
    expect(preview.rows[0].entities.child.message).toContain("historical mileage reading dated 2025-01-15");
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
    expect(preview.rows[0].entities.customer.message).toBe("Matched existing customer using email.");
    expect(preview.rows[0].entities.vehicle.status).toBe("MATCH");
    expect(preview.rows[0].entities.vehicle.message).toBe("Matched existing vehicle using VIN.");
    expect(preview.rows[0].entities.child.status).toBe("DUPLICATE");
    expect(summarizeImport(preview.rows, "SKIP")).toMatchObject({
      skippedRows: 1,
      successfulRows: 0,
      importedRows: 0,
      duplicateSkippedRows: 1,
      updatedRows: 0,
      totalProcessedRows: 1,
      resultMessage: "Skipped 1 duplicate row.",
    });
    expect(summarizeImport(preview.rows, "SKIP", { [preview.rows[0].rowNumber]: "IMPORT" })).toMatchObject({
      skippedRows: 1,
      successfulRows: 0,
      importedRows: 0,
      duplicateSkippedRows: 1,
      updatedRows: 0,
      totalProcessedRows: 1,
    });
    expect(summarizeImport(preview.rows, "UPDATE")).toMatchObject({
      skippedRows: 0,
      successfulRows: 0,
      updatedRows: 1,
      totalProcessedRows: 1,
    });
    expect(summarizeImport(preview.rows, "IMPORT_AS_NEW")).toMatchObject({
      skippedRows: 0,
      successfulRows: 1,
      importedRows: 1,
      updatedRows: 0,
      totalProcessedRows: 1,
    });
  });

  it("reports exact phone and vehicle-detail match identifiers", () => {
    const rows = parseCsv(
      "First Name,Last Name,Email,Phone,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours\nJustin,Camacho,,(404) 555-0187,,2003,Jeep,Wrangler,,Coolant Flush,2026-07-10,,180,1.0",
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });

    expect(preview.rows[0].status).toBe("VALID");
    expect(preview.rows[0].entities.customer.message).toBe("Matched existing customer using phone.");
    expect(preview.rows[0].entities.vehicle.message).toBe("Matched existing vehicle using customer-scoped year, make, and model.");
  });

  it("holds conflicting customer identifiers for review instead of silently attaching", () => {
    const rows = parseCsv(
      "First Name,Last Name,Email,Phone,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours\nWrong,Name,justin@example.com,(404) 555-9999,,2021,Honda,CR-V,,Check Engine Diagnostic,2026-07-03,,160,1.01",
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });

    expect(preview.rows[0].status).toBe("HELD");
    expect(preview.rows[0].action).toBe("HOLD");
    expect(preview.rows[0].entities.customer.message).toBe("Matched existing customer using email.");
    expect(preview.rows[0].errors).toContain("Customer identity conflict: email matches an existing customer, but phone and name differ.");
    expect(summarizeImport(preview.rows)).toMatchObject({
      readyRows: 0,
      heldRows: 1,
      totalProcessedRows: 1,
      resultMessage: "Held 1 row for review.",
    });
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

  it("holds service-history mileage rows when the historical reading date is missing", () => {
    const rows = parseCsv(
      "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Mileage,Price,Labor Hours\nNia,Stone,nia@example.com,1FMCU0GD5KUA00001,2019,Ford,Escape,50000,Oil Change,50000,90,0.5",
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });

    expect(preview.rows[0].status).toBe("INVALID");
    expect(preview.rows[0].errors).toContain("Reading Date is required when importing mileage history.");
    expect(summarizeImport(preview.rows).heldRows).toBe(1);
  });

  it("holds ambiguous completed-and-declined service cycles for review", () => {
    const rows = parseCsv(
      [
        "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours,Status,Declined Date",
        "Heather,Reed,heather@example.com,WA1EAAF45LA100001,2020,Audi,Q5,50000,Check Engine Diagnostic,2026-05-26,50000,160,1.0167,Declined,2026-05-26",
      ].join("\n"),
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });
    const [row] = preview.rows;

    expect(row.status).toBe("HELD");
    expect(row.action).toBe("HOLD");
    expect(row.entities.child.entity).toBe("Service");
    expect(row.errors).toContain("Row 2 marks Check Engine Diagnostic as both completed and declined on May 26, 2026.");
    expect(summarizeImport(preview.rows)).toMatchObject({
      heldRows: 1,
      reviewRows: 1,
      invalidRows: 0,
      servicesToImport: 0,
      declinedWorkToImport: 0,
    });
  });

  it("keeps ready rows importable when a mixed file has a needs-review row", () => {
    const rows = parseCsv(
      [
        "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours,Status,Declined Date",
        "QA,Complete,qa.complete@example.com,WA1EAAF45LA100001,2020,Audi,Q5,50000,Oil Change,2026-07-01,50000,95,0.5,Completed,",
        "QA,Declined,qa.declined@example.com,WA1EAAF45LA100002,2020,Audi,Q5,50000,Brake Fluid,,,160,1.0,Declined,2026-07-01",
        "QA,Ambiguous,qa.ambiguous@example.com,WA1EAAF45LA100003,2020,Audi,Q5,50000,Check Engine Diagnostic,2026-07-01,50000,160,1.01,Declined,2026-07-01",
      ].join("\n"),
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });

    expect(preview.rows.map((row) => row.status)).toEqual(["VALID", "VALID", "HELD"]);
    expect(summarizeImport(preview.rows)).toMatchObject({
      readyRows: 2,
      heldRows: 1,
      reviewRows: 1,
      invalidRows: 0,
      servicesToImport: 1,
      declinedWorkToImport: 1,
    });
  });

  it("classifies completed, declined, and appointment import events separately", () => {
    expect(classifyImportRowEvent("SERVICE_HISTORY", {
      serviceName: "Check Engine Diagnostic",
      serviceDate: "2026-05-26",
      status: "Completed",
    })).toMatchObject({
      importsCompletedService: true,
      importsDeclinedWork: false,
      importsAppointment: false,
      ambiguousConflict: false,
    });
    expect(classifyImportRowEvent("DECLINED_WORK", {
      serviceName: "Check Engine Diagnostic",
      declinedDate: "2026-05-26",
      status: "Declined",
    })).toMatchObject({
      importsCompletedService: false,
      importsDeclinedWork: true,
      importsAppointment: false,
      ambiguousConflict: false,
    });
    expect(classifyImportRowEvent("APPOINTMENTS", {
      serviceName: "Check Engine Diagnostic",
      appointmentDate: "2026-08-05",
      appointmentTime: "09:00",
    })).toMatchObject({
      importsCompletedService: false,
      importsDeclinedWork: false,
      importsAppointment: true,
      ambiguousConflict: false,
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

  it("exports needs-review rows in the result report", () => {
    const rows = parseCsv(
      [
        "First Name,Last Name,Email,VIN,Year,Make,Model,Current Mileage,Service Name,Service Date,Service Mileage,Price,Labor Hours,Status,Declined Date",
        "QA,Ambiguous,qa.ambiguous@example.com,WA1EAAF45LA100003,2020,Audi,Q5,50000,Check Engine Diagnostic,2026-07-01,50000,160,1.01,Declined,2026-07-01",
      ].join("\n"),
    );
    const preview = previewImport({
      rows,
      mapping: detectColumnMapping(Object.keys(rows[0])),
      importType: "COMBINED",
      state: createInitialDemoState(),
    });

    expect(buildImportErrorCsv(preview.rows)).toContain("NEEDS_REVIEW");
    expect(buildImportErrorCsv(preview.rows)).toContain("Check Engine Diagnostic");
  });
});
