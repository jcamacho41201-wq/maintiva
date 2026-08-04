export type ShopRole = "OWNER" | "MANAGER" | "SERVICE_ADVISOR" | "TECHNICIAN";

export function canManageShopSettings(role: ShopRole | undefined) {
  return role === "OWNER" || role === "MANAGER";
}
