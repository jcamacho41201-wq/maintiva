import type { DemoState, User } from "@/lib/demo-data";

export type CustomerDeletionSummary = {
  vehicles: number;
  maintenanceRecords: number;
  serviceRecords: number;
  declinedWorkRecords: number;
  revenueOpportunities: number;
  outreachRecords: number;
  appointments: number;
  appointmentRequestLinks: number;
  appointmentRequests: number;
  customerBookingLinks: number;
  mileageReadings: number;
};

export function canPermanentlyDeleteCustomers(role: User["role"] | undefined) {
  return role === "OWNER" || role === "MANAGER";
}

function deletedCustomerScope(state: DemoState, customerId: string) {
  const vehicleIds = new Set(
    state.vehicles
      .filter((vehicle) => vehicle.customerId === customerId)
      .map((vehicle) => vehicle.id),
  );

  return {
    vehicleIds,
    isCustomerVehicle: (vehicleId: string) => vehicleIds.has(vehicleId),
    isCustomerRecord: (record: { customerId: string; vehicleId?: string }) =>
      record.customerId === customerId || (record.vehicleId ? vehicleIds.has(record.vehicleId) : false),
  };
}

export function customerDeletionSummary(state: DemoState, customerId: string): CustomerDeletionSummary {
  const scope = deletedCustomerScope(state, customerId);

  return {
    vehicles: state.vehicles.filter((vehicle) => vehicle.customerId === customerId).length,
    maintenanceRecords: state.maintenanceRecords.filter((record) => scope.isCustomerVehicle(record.vehicleId)).length,
    serviceRecords: state.serviceRecords.filter(scope.isCustomerRecord).length,
    declinedWorkRecords: state.declinedWorkRecords.filter(scope.isCustomerRecord).length,
    revenueOpportunities: state.revenueOpportunities.filter(scope.isCustomerRecord).length,
    outreachRecords: state.outreachRecords.filter(scope.isCustomerRecord).length,
    appointments: state.appointments.filter(scope.isCustomerRecord).length,
    appointmentRequestLinks: state.appointmentRequestLinks.filter(scope.isCustomerRecord).length,
    appointmentRequests: state.appointmentRequests.filter(scope.isCustomerRecord).length,
    customerBookingLinks: state.customerBookingLinks.filter(scope.isCustomerRecord).length,
    mileageReadings: state.mileageReadings.filter((reading) => scope.isCustomerVehicle(reading.vehicleId)).length,
  };
}

export function removeDeletedCustomerFromState(state: DemoState, customerId: string): DemoState {
  const scope = deletedCustomerScope(state, customerId);

  return {
    ...state,
    customers: state.customers.filter((customer) => customer.id !== customerId),
    vehicles: state.vehicles.filter((vehicle) => vehicle.customerId !== customerId),
    maintenanceRecords: state.maintenanceRecords.filter((record) => !scope.isCustomerVehicle(record.vehicleId)),
    revenueOpportunities: state.revenueOpportunities.filter((record) => !scope.isCustomerRecord(record)),
    mileageReadings: state.mileageReadings.filter((reading) => !scope.isCustomerVehicle(reading.vehicleId)),
    drivingProfiles: state.drivingProfiles.filter((profile) => !scope.isCustomerVehicle(profile.vehicleId)),
    serviceRecords: state.serviceRecords.filter((record) => !scope.isCustomerRecord(record)),
    declinedWorkRecords: state.declinedWorkRecords.filter((record) => !scope.isCustomerRecord(record)),
    outreachRecords: state.outreachRecords.filter((record) => !scope.isCustomerRecord(record)),
    appointments: state.appointments.filter((appointment) => !scope.isCustomerRecord(appointment)),
    appointmentRequestLinks: state.appointmentRequestLinks.filter((link) => !scope.isCustomerRecord(link)),
    appointmentRequests: state.appointmentRequests.filter((request) => !scope.isCustomerRecord(request)),
    customerBookingLinks: state.customerBookingLinks.filter((link) => !scope.isCustomerRecord(link)),
  };
}
