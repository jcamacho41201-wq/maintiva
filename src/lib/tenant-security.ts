export class BrowserShopIdError extends Error {
  constructor() {
    super("Client requests must not provide shopId.");
    this.name = "BrowserShopIdError";
  }
}

export function rejectBrowserShopId(value: unknown) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(rejectBrowserShopId);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "shopId") {
      throw new BrowserShopIdError();
    }
    rejectBrowserShopId(child);
  }
}

export function requireTenantMatch(activeShopId: string, entityShopId: string | null | undefined) {
  if (!entityShopId || activeShopId !== entityShopId) {
    throw new Error("Authenticated user is not allowed to access this shop data.");
  }
}

export function requireAllTenantMatches(
  activeShopId: string,
  records: Array<{ shopId: string | null | undefined }>,
) {
  records.forEach((record) => requireTenantMatch(activeShopId, record.shopId));
}
