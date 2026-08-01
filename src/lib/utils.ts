import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatHours(minutes: number) {
  return formatLaborMinutes(minutes);
}

export function formatLaborMinutes(minutes: number) {
  const totalMinutes = Math.round(minutes);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0 min";
  const wholeHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (remainingMinutes === 0) return `${wholeHours} hr`;
  if (wholeHours === 0) return `${remainingMinutes} min`;
  return `${wholeHours} hr ${remainingMinutes} min`;
}

export function formatLaborHours(hours: number) {
  return formatLaborMinutes(hours * 60);
}

export function formatDate(date: string | Date) {
  const value = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? `${date}T12:00:00`
    : date;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(date: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

export function currentDateInTimeZone(timeZone: string, date: Date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    const year = value("year");
    const month = value("month");
    const day = value("day");
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Fall back to UTC if a saved shop timezone is no longer recognized.
  }
  return date.toISOString().slice(0, 10);
}

export function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
