export type ShopRole = "OWNER" | "MANAGER" | "SERVICE_ADVISOR" | "TECHNICIAN";

export function canManageShopSettings(role: ShopRole | undefined) {
  return role === "OWNER" || role === "MANAGER";
}

export function canManageAppointments(role: ShopRole | undefined) {
  return role === "OWNER" || role === "MANAGER" || role === "SERVICE_ADVISOR";
}
