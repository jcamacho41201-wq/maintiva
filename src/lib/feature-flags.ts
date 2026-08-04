export function isCustomerBookingEnabled() {
  return process.env.NEXT_PUBLIC_MAINTIVA_CUSTOMER_BOOKING_ENABLED === "true";
}

export const SMART_MAINTENANCE_BLOCKS_RELEASED = true;

type ReleaseEnv = Record<string, string | undefined>;

export function isSmartMaintenanceBlocksEnabled(env: ReleaseEnv = process.env) {
  return SMART_MAINTENANCE_BLOCKS_RELEASED && env.MAINTIVA_SMART_MAINTENANCE_BLOCKS_DISABLED !== "true";
}

export function customerBookingDisabledResponse() {
  return {
    code: "CUSTOMER_BOOKING_DISABLED",
    message: "Customer booking is not available.",
  };
}
