import { describe, expect, it } from "vitest";
import {
  BrowserShopIdError,
  rejectBrowserShopId,
  requireAllTenantMatches,
  requireTenantMatch,
} from "@/lib/tenant-security";

describe("pilot tenant security", () => {
  it("rejects browser payloads that try to set shopId", () => {
    expect(() =>
      rejectBrowserShopId({
        action: "updateCustomer",
        payload: {
          firstName: "Avery",
          shopId: "shop-attacker",
        },
      }),
    ).toThrow(BrowserShopIdError);
  });

  it("rejects nested shopId values in arrays", () => {
    expect(() =>
      rejectBrowserShopId({
        action: "bookAppointment",
        payload: {
          services: [{ id: "svc-1", shopId: "shop-other" }],
        },
      }),
    ).toThrow("Client requests must not provide shopId.");
  });

  it("allows payloads that only carry stable entity ids", () => {
    expect(() =>
      rejectBrowserShopId({
        action: "addMaintenanceItem",
        payload: {
          vehicleId: "veh-1",
          serviceDefinitionId: "svc-1",
          useShopDefaults: true,
        },
      }),
    ).not.toThrow();
  });

  it("requires every fetched record to match the active membership shop", () => {
    expect(() => requireTenantMatch("shop-a", "shop-b")).toThrow(
      "Authenticated user is not allowed to access this shop data.",
    );
    expect(() =>
      requireAllTenantMatches("shop-a", [
        { shopId: "shop-a" },
        { shopId: "shop-a" },
      ]),
    ).not.toThrow();
  });
});
