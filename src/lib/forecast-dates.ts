import { currentDateInTimeZone } from "@/lib/utils";

export const DEFAULT_SHOP_TIMEZONE = "America/New_York";

const dayMs = 86_400_000;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export function resolveForecastAsOfDate({
  shopTimezone,
  now,
}: {
  shopTimezone?: string | null;
  now?: Date | string;
} = {}) {
  if (typeof now === "string" && dateOnlyPattern.test(now)) return now;
  return currentDateInTimeZone(shopTimezone || DEFAULT_SHOP_TIMEZONE, now instanceof Date ? now : now ? new Date(now) : new Date());
}

export function normalizeDateOnly(value: Date | string, shopTimezone?: string | null) {
  if (typeof value === "string" && dateOnlyPattern.test(value)) return value;
  return resolveForecastAsOfDate({ shopTimezone, now: value });
}

function calendarDayNumber(value: Date | string, shopTimezone?: string | null) {
  const date = normalizeDateOnly(value, shopTimezone);
  const [year, month, day] = date.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / dayMs);
}

export function calendarDaysBetween(start: Date | string, end: Date | string, shopTimezone?: string | null) {
  return calendarDayNumber(end, shopTimezone) - calendarDayNumber(start, shopTimezone);
}

export function addCalendarDays(date: Date | string, days: number) {
  const normalized = normalizeDateOnly(date);
  const [year, month, day] = normalized.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return next.toISOString().slice(0, 10);
}

export function dateOnlyToUtcNoon(value: Date | string) {
  return new Date(`${normalizeDateOnly(value)}T12:00:00Z`);
}
