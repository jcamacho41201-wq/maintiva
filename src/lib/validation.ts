import { z } from "zod";

export const customerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().optional(),
  email: z.email().optional().or(z.literal("")),
  preferredContact: z.enum(["SMS", "EMAIL", "CALL"]),
  smsConsent: z.boolean(),
  emailConsent: z.boolean(),
  callConsent: z.boolean(),
  address: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["ACTIVE", "WATCHLIST", "PAUSED", "ARCHIVED"]),
});

export const vehicleSchema = z.object({
  customerId: z.string().min(1),
  year: z.number().int().min(1900).max(2100),
  make: z.string().min(1),
  model: z.string().min(1),
  vin: z.string().optional(),
  currentMileage: z.number().int().nonnegative(),
});

export const mileageReadingSchema = z.object({
  vehicleId: z.string().min(1),
  mileage: z.number().int().nonnegative(),
  recordedAt: z.coerce.date(),
  source: z.enum([
    "SHOP_REPAIR_ORDER",
    "CUSTOMER_SMS",
    "CUSTOMER_PORTAL",
    "MANUAL_ENTRY",
    "IMPORTED",
    "ESTIMATED",
  ]),
  confidence: z.enum([
    "VERIFIED",
    "CUSTOMER_CONFIRMED",
    "IMPORTED",
    "ESTIMATED",
  ]),
  notes: z.string().optional(),
});
