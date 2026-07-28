export type AppointmentServiceInput = {
  name: string;
  laborMinutes: number;
  priceCents: number;
};

export function calculateAppointmentDuration(services: AppointmentServiceInput[]) {
  const estimatedLaborMinutes = services.reduce(
    (total, service) => total + service.laborMinutes,
    0,
  );
  const estimatedRevenueCents = services.reduce(
    (total, service) => total + service.priceCents,
    0,
  );
  const recommendedMinutes = Math.ceil(estimatedLaborMinutes / 30) * 30;

  return {
    estimatedLaborMinutes,
    estimatedRevenueCents,
    recommendedMinutes,
  };
}

export function hasActiveVehicleAppointmentAt(
  appointments: Array<{
    vehicleId: string;
    scheduledStart: string;
    status: string;
  }>,
  input: {
    vehicleId: string;
    scheduledStart: string;
  },
) {
  return appointments.some(
    (appointment) =>
      appointment.vehicleId === input.vehicleId &&
      appointment.scheduledStart === input.scheduledStart &&
      !["CANCELLED", "NO_SHOW"].includes(appointment.status),
  );
}
