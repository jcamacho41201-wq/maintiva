export function serviceCompletionBaselineUpdate(
  existing: { lastCompletedDate: Date | null },
  completedAt: Date,
  mileage: number | null,
) {
  const incomingDay = completedAt.toISOString().slice(0, 10);
  const existingDay = existing.lastCompletedDate?.toISOString().slice(0, 10);
  if (existingDay && existingDay > incomingDay) return null;
  // A partial duplicate of the same visit must not erase its known odometer.
  if (existingDay === incomingDay && mileage === null) return null;
  return {
    lastCompletedDate: completedAt,
    // A newer visit's missing mileage cannot borrow mileage from an older visit.
    lastCompletedMileage: mileage,
  };
}
