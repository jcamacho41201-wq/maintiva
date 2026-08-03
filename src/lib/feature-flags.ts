export function isCustomerBookingEnabled() {
  return process.env.NEXT_PUBLIC_MAINTIVA_CUSTOMER_BOOKING_ENABLED === "true";
}

export function isSmartMaintenanceBlocksEnabled() {
  return (
    process.env.SMART_MAINTENANCE_BLOCKS_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_SMART_MAINTENANCE_BLOCKS_ENABLED === "true"
  );
}

export function customerBookingDisabledResponse() {
  return {
    code: "CUSTOMER_BOOKING_DISABLED",
    message: "Customer booking is not available.",
  };
}
