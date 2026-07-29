import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const vehiclePage = readFileSync(
  join(process.cwd(), "src/app/vehicles/[vehicleId]/page.tsx"),
  "utf8",
);
const customerPage = readFileSync(
  join(process.cwd(), "src/app/customers/[customerId]/page.tsx"),
  "utf8",
);

describe("vehicle mileage workflow labels", () => {
  it("presents Add Odometer Reading as the primary mileage action", () => {
    expect(vehiclePage).toContain("Add Odometer Reading");
    expect(vehiclePage).toContain("Records a dated odometer reading and updates the vehicle&apos;s driving profile.");
    expect(vehiclePage).toContain("Mileage");
    expect(vehiclePage).toContain("Reading Date");
    expect(vehiclePage).toContain("Source");
    expect(vehiclePage).toContain("Verification status");
    expect(vehiclePage).toContain("Optional notes");
    expect(vehiclePage).not.toContain("Update mileage");
  });

  it("keeps annual estimate controls secondary and renamed", () => {
    expect(vehiclePage).toContain("Customer&apos;s Driving Estimate");
    expect(vehiclePage).toContain("Set Temporary Driving Estimate");
    expect(vehiclePage).toContain("Use Maintiva Calculation");
    expect(vehiclePage).toContain("Owners and managers can edit driving estimates.");
    expect(vehiclePage).not.toContain("Customer-reported annual mileage");
    expect(vehiclePage).not.toContain("Manual annual override");
    expect(vehiclePage).not.toContain("Save reported mileage");
    expect(vehiclePage).not.toContain("Save override");
  });

  it("keeps customer intake annual mileage separate from odometer readings", () => {
    expect(customerPage).toContain("Customer's Driving Estimate");
    expect(customerPage).toContain("About how many miles do you drive each year?");
    expect(customerPage).toContain("initialMileageReadingDate");
  });
});
