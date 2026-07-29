import { calculateAppointmentDuration } from "@/lib/appointment";

export const asOfDate = new Date("2026-07-28T12:00:00-04:00");

export type ContactMethod = "SMS" | "EMAIL" | "CALL";
export type CustomerStatus = "ACTIVE" | "WATCHLIST" | "PAUSED" | "ARCHIVED";
export type MaintenanceStatus = "HEALTHY" | "DUE_SOON" | "DUE" | "OVERDUE";
export type OutreachStatus =
  | "NEEDS_OUTREACH"
  | "DRAFTED"
  | "MANUALLY_SENT"
  | "SCHEDULED"
  | "RESPONDED"
  | "SNOOZED"
  | "DECLINED"
  | "STOPPED";
export type OutreachChannel =
  | "PHONE"
  | "TEXT"
  | "EMAIL"
  | "CALL"
  | "IN_PERSON"
  | "OTHER";
export type CustomerResponseStatus =
  | "NO_RESPONSE"
  | "INTERESTED"
  | "WANTS_CALLBACK"
  | "BOOKED"
  | "DECLINED"
  | "NOT_NOW"
  | "WRONG_CONTACT"
  | "DO_NOT_CONTACT";
export type AppointmentStatus =
  | "REQUESTED"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";
export type TimeIntervalUnit = "DAYS" | "MONTHS" | "YEARS";
export type OutreachThresholdType = "MILES_BEFORE_DUE" | "DAYS_BEFORE_DUE" | "PERCENT_REMAINING";

export type Shop = {
  id: string;
  name: string;
  slug: string;
  phone: string;
  email: string;
  address: string;
  timezone: string;
  dailyBayHours: number;
  isDemo: boolean;
  onboardingCompletedAt: string | null;
};

export type User = {
  id: string;
  shopId: string;
  name: string;
  email: string;
  role: "OWNER" | "MANAGER" | "SERVICE_ADVISOR" | "TECHNICIAN";
};

export type Customer = {
  id: string;
  shopId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  preferredContact: ContactMethod;
  smsConsent: boolean;
  emailConsent: boolean;
  callConsent: boolean;
  address: string;
  notes: string;
  status: CustomerStatus;
  customerScore: number;
  lifetimeRevenueCents: number;
  lastVisit: string;
  archivedAt?: string;
};

export type Vehicle = {
  id: string;
  shopId: string;
  customerId: string;
  year: number;
  make: string;
  model: string;
  vin: string;
  engine: string;
  trim: string;
  vehicleType: string;
  currentMileage: number;
  estimatedAnnualMileage: number;
  overallHealth: number;
  lastServiceDate: string;
  licensePlate?: string;
  archivedAt?: string;
};

export type MaintenanceService = {
  id: string;
  shopId: string;
  name: string;
  category: string;
  defaultMileageInterval: number | null;
  defaultTimeIntervalMonths?: number | null;
  defaultTimeIntervalValue: number | null;
  defaultTimeIntervalUnit: TimeIntervalUnit;
  defaultNotificationThreshold: number;
  estimatedLaborMinutes: number;
  defaultPriceCents: number;
  description: string;
  isActive: boolean;
};

export type VehicleMaintenanceRecord = {
  id: string;
  shopId: string;
  vehicleId: string;
  serviceId?: string | null;
  serviceName: string;
  customServiceName?: string;
  customCategory?: string;
  lastCompletedDate: string;
  lastCompletedMileage: number;
  recommendedMileageInterval?: number | null;
  recommendedTimeIntervalMonths?: number | null;
  mileageIntervalOverride?: number | null;
  timeIntervalValueOverride?: number | null;
  timeIntervalUnitOverride?: TimeIntervalUnit | null;
  priceCents: number;
  laborHours: number;
  priceOverrideCents?: number | null;
  laborMinutesOverride?: number | null;
  notificationThreshold: number;
  outreachThresholdType?: OutreachThresholdType;
  outreachThresholdValue?: number;
  outreachStatus: OutreachStatus;
  outreachRecordId?: string;
  appointmentId?: string;
  isActive?: boolean;
  notes?: string;
  createdByUserId?: string;
  updatedByUserId?: string;
};

export type ServiceRecord = {
  id: string;
  shopId: string;
  customerId: string;
  vehicleId: string;
  serviceName: string;
  completedAt: string;
  mileage: number;
  priceCents: number;
  notes: string;
};

export type DeclinedWorkRecord = {
  id: string;
  shopId: string;
  customerId: string;
  vehicleId: string;
  serviceName: string;
  declinedAt: string;
  recommendedPriceCents: number;
  laborHours: number;
  advisorNotes: string;
  status: "OPEN" | "BOOKED" | "COMPLETED" | "DECLINED" | "SNOOZED";
  outreachStatus: OutreachStatus;
  appointmentId?: string;
};

export type ImportHistoryRecord = {
  id: string;
  shopId: string;
  userId: string;
  fileName: string;
  importType: "CUSTOMERS" | "VEHICLES" | "SERVICE_HISTORY" | "DECLINED_WORK" | "APPOINTMENTS" | "COMBINED";
  status: "PREVIEWED" | "COMPLETED" | "PARTIAL" | "FAILED";
  importedAt: string;
  totalRows: number;
  successfulRows: number;
  duplicateRows: number;
  updatedRows: number;
  skippedRows: number;
  failedRows: number;
  errorReportUrl?: string;
};

export type OutreachRecord = {
  id: string;
  shopId: string;
  customerId: string;
  vehicleId: string;
  maintenanceRecordIds: string[];
  serviceNames: string[];
  message: string;
  channel: OutreachChannel;
  sentAt: string;
  copiedAt?: string;
  manuallySentAt?: string;
  responseStatus: CustomerResponseStatus;
  followUpDate?: string;
  appointmentId?: string;
  performedByUserId?: string;
  status: OutreachStatus;
};

export type Appointment = {
  id: string;
  shopId: string;
  customerId: string;
  vehicleId: string;
  maintenanceRecordIds: string[];
  serviceNames: string[];
  scheduledStart: string;
  scheduledEnd: string;
  status: AppointmentStatus;
  totalPriceCents: number;
  totalLaborHours: number;
  source: "AUTOMATION" | "CUSTOMER_BOOKING" | "MANUAL" | "IMPORTED";
  attributionSource: "MAINTIVA_OUTREACH" | "MANUAL_SHOP_ENTRY" | "IMPORTED_APPOINTMENT" | "OTHER";
  opportunityId?: string;
  outreachRecordId?: string;
  completedRevenueCents?: number;
  completedLaborHours?: number;
  completedAt?: string;
  notes: string;
};

export type DemoState = {
  shop: Shop;
  users: User[];
  customers: Customer[];
  vehicles: Vehicle[];
  services: MaintenanceService[];
  maintenanceRecords: VehicleMaintenanceRecord[];
  serviceRecords: ServiceRecord[];
  declinedWorkRecords: DeclinedWorkRecord[];
  outreachRecords: OutreachRecord[];
  appointments: Appointment[];
  importHistory: ImportHistoryRecord[];
  seededAt: string;
};

export const demoShop: Shop = {
  id: "shop-demo",
  name: "Cedar Bay Auto Works",
  slug: "cedar-bay-auto",
  phone: "(404) 555-0100",
  email: "hello@cedarbayauto.example",
  address: "1200 DeKalb Ave NE, Atlanta, GA",
  timezone: "America/New_York",
  dailyBayHours: 64,
  isDemo: true,
  onboardingCompletedAt: "2026-07-01T09:00:00-04:00",
};

export const demoUsers: User[] = [
  {
    id: "user-owner",
    shopId: demoShop.id,
    name: "Avery Stone",
    email: "owner@maintiva.dev",
    role: "OWNER",
  },
  {
    id: "user-advisor",
    shopId: demoShop.id,
    name: "Maya Torres",
    email: "advisor@maintiva.dev",
    role: "SERVICE_ADVISOR",
  },
];

const serviceSeed = [
  ["Oil Change", "Fluids", 5000, 6, 10, 30, 8500],
  ["Tire Rotation", "Tires", 7500, 6, 10, 30, 4500],
  ["Brake Pads", "Brakes", 40000, 36, 20, 90, 36000],
  ["Brake Rotors", "Brakes", 70000, 60, 15, 120, 52000],
  ["Brake Fluid", "Fluids", 30000, 24, 20, 45, 15000],
  ["Transmission Fluid", "Drivetrain", 60000, 60, 15, 90, 26000],
  ["Coolant", "Fluids", 50000, 48, 15, 60, 18000],
  ["Differential Fluid", "Drivetrain", 50000, 48, 15, 60, 19000],
  ["Spark Plugs", "Ignition", 90000, 84, 15, 120, 34000],
  ["Engine Air Filter", "Filters", 15000, 12, 10, 15, 4200],
  ["Cabin Air Filter", "Filters", 15000, 12, 10, 15, 3800],
  ["Timing Belt", "Engine", 100000, 84, 15, 240, 95000],
  ["Serpentine Belt", "Engine", 60000, 48, 15, 45, 14500],
  ["Battery", "Electrical", 50000, 48, 10, 30, 22000],
  ["Wiper Blades", "Safety", 12000, 12, 10, 10, 3200],
  ["Tires", "Tires", 50000, 60, 20, 90, 82000],
] as const;

export const serviceDefinitions: MaintenanceService[] = serviceSeed.map(
  ([
    name,
    category,
    defaultMileageInterval,
    defaultTimeIntervalMonths,
    defaultNotificationThreshold,
    estimatedLaborMinutes,
    defaultPriceCents,
  ]) => ({
    id: `svc-${name.toLowerCase().replaceAll(" ", "-")}`,
    shopId: demoShop.id,
    name,
    category,
    defaultMileageInterval,
    defaultTimeIntervalMonths,
    defaultTimeIntervalValue: defaultTimeIntervalMonths,
    defaultTimeIntervalUnit: "MONTHS",
    defaultNotificationThreshold,
    estimatedLaborMinutes,
    defaultPriceCents,
    description: `Default ${name} lifecycle configured for ${demoShop.name}.`,
    isActive: true,
  }),
);

type CustomerSeed = [
  string,
  string,
  string,
  string,
  string,
  ContactMethod,
  boolean,
  boolean,
  boolean,
  CustomerStatus,
  number,
  number,
  string,
  string,
];

const customerSeed: CustomerSeed[] = [
  ["cust-justin", "Justin", "Camacho", "(404) 555-0187", "justin@example.com", "SMS", true, true, true, "ACTIVE", 94, 642500, "2026-05-09", "Prefers morning appointments and consolidated work."],
  ["cust-john", "John", "Doe", "(404) 555-0142", "john.doe@example.com", "SMS", true, true, false, "WATCHLIST", 88, 391500, "2026-02-18", "No response to last brake-fluid recommendation."],
  ["cust-priya", "Priya", "Nair", "(404) 555-0124", "priya@example.com", "EMAIL", false, true, true, "ACTIVE", 79, 214900, "2026-06-03", "Fleet-lite family account with two vehicles."],
  ["cust-marcus", "Marcus", "Bell", "(404) 555-0181", "marcus@example.com", "CALL", true, true, true, "ACTIVE", 73, 182000, "2025-12-12", "High-mileage commuter."],
  ["cust-elena", "Elena", "Park", "(404) 555-0162", "elena@example.com", "SMS", true, false, false, "ACTIVE", 69, 98000, "2026-01-21", "Newer customer. Needs trust-building reminders."],
  ["cust-sam", "Sam", "Rivera", "(404) 555-0109", "sam@example.com", "EMAIL", true, true, true, "ACTIVE", 83, 456000, "2026-04-15", "Usually approves bundled preventative work."],
  ["cust-lydia", "Lydia", "Morgan", "(404) 555-0156", "lydia@example.com", "SMS", true, true, true, "ACTIVE", 61, 87500, "2026-07-01", "Recently completed inspection."],
  ["cust-noah", "Noah", "Kim", "(404) 555-0173", "noah@example.com", "SMS", true, true, false, "ACTIVE", 77, 264000, "2026-03-30", "Asks for clear price estimates before booking."],
  ["cust-amara", "Amara", "Lewis", "(404) 555-0133", "amara@example.com", "EMAIL", false, true, true, "ACTIVE", 81, 301000, "2026-05-27", "Warranty-sensitive."],
  ["cust-owen", "Owen", "Reed", "(404) 555-0198", "owen@example.com", "CALL", true, true, true, "ACTIVE", 72, 176500, "2026-06-19", "Needs tire replacement education."],
  ["cust-nina", "Nina", "Patel", "(404) 555-0104", "nina@example.com", "SMS", true, true, true, "PAUSED", 58, 73500, "2025-09-16", "Automation paused by advisor until September."],
  ["cust-ethan", "Ethan", "Brooks", "(404) 555-0191", "ethan@example.com", "EMAIL", true, true, false, "ACTIVE", 86, 337000, "2026-02-05", "Good candidate for bundled scheduling."],
  ["cust-carmen", "Carmen", "Soto", "(404) 555-0112", "carmen@example.com", "SMS", true, true, true, "ACTIVE", 67, 129900, "2026-04-02", "Prefers text confirmations."],
  ["cust-victor", "Victor", "Chen", "(404) 555-0167", "victor@example.com", "EMAIL", true, true, true, "ACTIVE", 91, 502500, "2026-06-24", "Approves proactive work when bundled well."],
  ["cust-zoe", "Zoe", "Harris", "(404) 555-0144", "zoe@example.com", "SMS", true, false, false, "ACTIVE", 74, 228000, "2026-01-09", "College commuter."],
];

export const customers: Customer[] = customerSeed.map(
  ([
    id,
    firstName,
    lastName,
    phone,
    email,
    preferredContact,
    smsConsent,
    emailConsent,
    callConsent,
    status,
    customerScore,
    lifetimeRevenueCents,
    lastVisit,
    notes,
  ]) => ({
    id,
    shopId: demoShop.id,
    firstName,
    lastName,
    phone,
    email,
    preferredContact,
    smsConsent,
    emailConsent,
    callConsent,
    address: "Atlanta, GA",
    status,
    customerScore,
    lifetimeRevenueCents,
    lastVisit,
    notes,
  }),
);

type VehicleSeed = [
  string,
  string,
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  string,
];

const vehicleSeed: VehicleSeed[] = [
  ["veh-jeep", "cust-justin", 2003, "Jeep", "Wrangler", "1J4FA49S03P123456", "4.0L I6", "Sport", 98600, 12000, 72, "2026-05-09"],
  ["veh-accord", "cust-john", 2019, "Honda", "Accord", "1HGCV1F37KA100001", "1.5L Turbo", "EX", 64250, 15500, 58, "2026-02-18"],
  ["veh-rav4", "cust-priya", 2021, "Toyota", "RAV4", "2T3P1RFV8MW100002", "2.5L", "XLE", 38400, 11200, 86, "2026-06-03"],
  ["veh-f150", "cust-priya", 2016, "Ford", "F-150", "1FTEW1EP3GFA00003", "2.7L EcoBoost", "XLT", 112300, 9000, 64, "2026-03-14"],
  ["veh-silverado", "cust-marcus", 2015, "Chevrolet", "Silverado", "3GCUKREC4FG100004", "5.3L V8", "LT", 149800, 19000, 49, "2025-12-12"],
  ["veh-outback", "cust-elena", 2018, "Subaru", "Outback", "4S4BSANC8J3100005", "2.5L", "Limited", 76200, 13400, 55, "2026-01-21"],
  ["veh-camry", "cust-sam", 2020, "Toyota", "Camry", "4T1G11AK0LU100006", "2.5L", "SE", 58900, 14200, 78, "2026-04-15"],
  ["veh-civic", "cust-lydia", 2022, "Honda", "Civic", "2HGFE2F56NH100007", "2.0L", "Sport", 24100, 11800, 92, "2026-07-01"],
  ["veh-telluride", "cust-victor", 2021, "Kia", "Telluride", "5XYP3DHC5MG100008", "3.8L V6", "EX", 49750, 12800, 81, "2026-06-24"],
];

export const vehicles: Vehicle[] = vehicleSeed.map(
  ([
    id,
    customerId,
    year,
    make,
    model,
    vin,
    engine,
    trim,
    currentMileage,
    estimatedAnnualMileage,
    overallHealth,
    lastServiceDate,
  ]) => ({
    id,
    shopId: demoShop.id,
    customerId,
    year,
    make,
    model,
    vin,
    engine,
    trim,
    vehicleType: "Passenger vehicle",
    currentMileage,
    estimatedAnnualMileage,
    overallHealth,
    lastServiceDate,
  }),
);

const serviceByName = Object.fromEntries(
  serviceDefinitions.map((service) => [service.name, service]),
);

function maintenanceRecord(
  vehicleId: string,
  serviceName: string,
  lastCompletedDate: string,
  lastCompletedMileage: number,
  overrides: Partial<VehicleMaintenanceRecord> = {},
): VehicleMaintenanceRecord {
  const service = serviceByName[serviceName];

  return {
    id: `item-${vehicleId}-${serviceName.toLowerCase().replaceAll(" ", "-")}`,
    shopId: demoShop.id,
    vehicleId,
    serviceId: service.id,
    serviceName,
    lastCompletedDate,
    lastCompletedMileage,
    recommendedMileageInterval: service.defaultMileageInterval,
    recommendedTimeIntervalMonths: service.defaultTimeIntervalMonths,
    mileageIntervalOverride: null,
    timeIntervalValueOverride: null,
    timeIntervalUnitOverride: null,
    priceCents: service.defaultPriceCents,
    laborHours: service.estimatedLaborMinutes / 60,
    priceOverrideCents: null,
    laborMinutesOverride: null,
    notificationThreshold: service.defaultNotificationThreshold,
    outreachThresholdType: "MILES_BEFORE_DUE",
    outreachThresholdValue: 500,
    outreachStatus: "NEEDS_OUTREACH",
    isActive: true,
    ...overrides,
  };
}

export const maintenanceItems: VehicleMaintenanceRecord[] = [
  maintenanceRecord("veh-jeep", "Oil Change", "2026-05-09", 93600),
  maintenanceRecord("veh-jeep", "Brake Pads", "2024-07-09", 61200),
  maintenanceRecord("veh-jeep", "Cabin Air Filter", "2025-07-10", 84200),
  maintenanceRecord("veh-jeep", "Tire Rotation", "2026-06-12", 97600, {
    outreachStatus: "SCHEDULED",
    appointmentId: "appt-1",
  }),
  maintenanceRecord("veh-accord", "Oil Change", "2026-02-18", 62100),
  maintenanceRecord("veh-accord", "Brake Fluid", "2024-03-12", 38200),
  maintenanceRecord("veh-accord", "Cabin Air Filter", "2025-02-18", 48100),
  maintenanceRecord("veh-rav4", "Oil Change", "2026-06-03", 37800),
  maintenanceRecord("veh-f150", "Transmission Fluid", "2021-04-04", 68900),
  maintenanceRecord("veh-silverado", "Spark Plugs", "2020-03-16", 58800),
  maintenanceRecord("veh-outback", "Brake Pads", "2024-07-21", 51200),
  maintenanceRecord("veh-camry", "Tire Rotation", "2026-04-15", 56100),
  maintenanceRecord("veh-civic", "Oil Change", "2026-07-01", 23800),
  maintenanceRecord("veh-telluride", "Battery", "2022-06-24", 18200, {
    outreachStatus: "SCHEDULED",
    appointmentId: "appt-1",
  }),
  maintenanceRecord("veh-telluride", "Coolant", "2023-06-24", 24700, {
    outreachStatus: "SCHEDULED",
    appointmentId: "appt-1",
  }),
];

export const serviceRecords: ServiceRecord[] = [
  {
    id: "hist-jeep-oil",
    shopId: demoShop.id,
    customerId: "cust-justin",
    vehicleId: "veh-jeep",
    serviceName: "Oil Change",
    completedAt: "2026-05-09",
    mileage: 96800,
    priceCents: 8500,
    notes: "Synthetic oil service and inspection.",
  },
  {
    id: "hist-jeep-brakes",
    shopId: demoShop.id,
    customerId: "cust-justin",
    vehicleId: "veh-jeep",
    serviceName: "Brake Inspection",
    completedAt: "2025-11-12",
    mileage: 90200,
    priceCents: 0,
    notes: "Pads wearing unevenly. Follow up before next trip.",
  },
  {
    id: "hist-accord-oil",
    shopId: demoShop.id,
    customerId: "cust-john",
    vehicleId: "veh-accord",
    serviceName: "Oil Change",
    completedAt: "2026-02-18",
    mileage: 62100,
    priceCents: 8500,
    notes: "Customer declined cabin air filter.",
  },
];

export const declinedWorkRecords: DeclinedWorkRecord[] = [
  {
    id: "declined-accord-cabin-filter",
    shopId: demoShop.id,
    customerId: "cust-john",
    vehicleId: "veh-accord",
    serviceName: "Cabin Air Filter",
    declinedAt: "2026-02-18",
    recommendedPriceCents: 3800,
    laborHours: 0.25,
    advisorNotes: "Customer declined cabin filter during oil service.",
    status: "OPEN",
    outreachStatus: "MANUALLY_SENT",
  },
  {
    id: "declined-jeep-brake-service",
    shopId: demoShop.id,
    customerId: "cust-justin",
    vehicleId: "veh-jeep",
    serviceName: "Brake Pads",
    declinedAt: "2026-05-09",
    recommendedPriceCents: 36000,
    laborHours: 1.5,
    advisorNotes: "Pads measured low; customer wanted to wait until summer.",
    status: "OPEN",
    outreachStatus: "NEEDS_OUTREACH",
  },
  {
    id: "declined-telluride-battery",
    shopId: demoShop.id,
    customerId: "cust-victor",
    vehicleId: "veh-telluride",
    serviceName: "Battery",
    declinedAt: "2026-06-24",
    recommendedPriceCents: 22000,
    laborHours: 0.5,
    advisorNotes: "Battery tested weak and was later booked through Maintiva outreach.",
    status: "BOOKED",
    outreachStatus: "SCHEDULED",
    appointmentId: "appt-1",
  },
];

export const outreachRecords: OutreachRecord[] = [
  {
    id: "outreach-accord",
    shopId: demoShop.id,
    customerId: "cust-john",
    vehicleId: "veh-accord",
    maintenanceRecordIds: [
      "item-veh-accord-oil-change",
      "item-veh-accord-brake-fluid",
      "item-veh-accord-cabin-air-filter",
    ],
    serviceNames: ["Oil Change", "Brake Fluid", "Cabin Air Filter"],
    message:
      "Hi John, your 2019 Honda Accord is ready for a bundled maintenance visit. We can handle oil, brake fluid, and cabin filter service in one appointment.",
    channel: "TEXT",
    sentAt: "2026-07-05T10:15:00-04:00",
    copiedAt: "2026-07-05T10:13:00-04:00",
    manuallySentAt: "2026-07-05T10:15:00-04:00",
    responseStatus: "NO_RESPONSE",
    performedByUserId: "user-owner",
    status: "MANUALLY_SENT",
  },
  {
    id: "outreach-telluride",
    shopId: demoShop.id,
    customerId: "cust-victor",
    vehicleId: "veh-telluride",
    maintenanceRecordIds: [
      "item-veh-telluride-battery",
      "item-veh-telluride-coolant",
    ],
    serviceNames: ["Battery", "Coolant"],
    message:
      "Hi Victor, we can recover the battery work you deferred and complete coolant service in one visit on Tuesday.",
    channel: "PHONE",
    sentAt: "2026-07-22T11:30:00-04:00",
    copiedAt: "2026-07-22T11:28:00-04:00",
    manuallySentAt: "2026-07-22T11:30:00-04:00",
    responseStatus: "BOOKED",
    appointmentId: "appt-1",
    performedByUserId: "user-advisor",
    status: "SCHEDULED",
  },
];

export const appointments: Appointment[] = [
  {
    id: "appt-1",
    shopId: demoShop.id,
    customerId: "cust-victor",
    vehicleId: "veh-telluride",
    maintenanceRecordIds: [
      "item-veh-telluride-battery",
      "item-veh-telluride-coolant",
    ],
    serviceNames: ["Battery", "Coolant"],
    scheduledStart: "2026-07-28T13:30:00-04:00",
    scheduledEnd: "2026-07-28T15:30:00-04:00",
    status: "CONFIRMED",
    totalPriceCents: 40000,
    totalLaborHours: 2,
    source: "AUTOMATION",
    attributionSource: "MAINTIVA_OUTREACH",
    opportunityId: "opp-veh-telluride",
    outreachRecordId: "outreach-telluride",
    notes: "Booked from Maintiva revenue recovery outreach.",
  },
  {
    id: "appt-2",
    shopId: demoShop.id,
    customerId: "cust-sam",
    vehicleId: "veh-camry",
    maintenanceRecordIds: ["item-veh-camry-tire-rotation"],
    serviceNames: ["Tire Rotation", "Oil Change"],
    scheduledStart: "2026-07-14T09:00:00-04:00",
    scheduledEnd: "2026-07-14T10:00:00-04:00",
    status: "COMPLETED",
    totalPriceCents: 13000,
    totalLaborHours: 1,
    source: "AUTOMATION",
    attributionSource: "MAINTIVA_OUTREACH",
    opportunityId: "opp-veh-camry",
    completedRevenueCents: 18200,
    completedLaborHours: 1.1,
    completedAt: "2026-07-14T10:15:00-04:00",
    notes: "Completed recovered maintenance after manual text outreach.",
  },
];

export const importHistory: ImportHistoryRecord[] = [
  {
    id: "import-demo-july",
    shopId: demoShop.id,
    userId: "user-owner",
    fileName: "cedar-bay-export-july.csv",
    importType: "COMBINED",
    status: "PARTIAL",
    importedAt: "2026-07-01T10:30:00-04:00",
    totalRows: 32,
    successfulRows: 29,
    duplicateRows: 1,
    updatedRows: 2,
    skippedRows: 1,
    failedRows: 2,
    errorReportUrl: "downloadable-error-report",
  },
];

export const initialDemoState: DemoState = {
  shop: demoShop,
  users: demoUsers,
  customers,
  vehicles,
  services: serviceDefinitions,
  maintenanceRecords: maintenanceItems,
  serviceRecords,
  declinedWorkRecords,
  outreachRecords,
  appointments,
  importHistory,
  seededAt: asOfDate.toISOString(),
};

export const revenueForecast = [
  { label: "Next 7 days", predicted: 184500, scheduled: 0 },
  { label: "Next 30 days", predicted: 841000, scheduled: 0 },
  { label: "Next 60 days", predicted: 1462000, scheduled: 0 },
  { label: "Next 90 days", predicted: 2185000, scheduled: 0 },
];

export const customerLookup = Object.fromEntries(
  customers.map((customer) => [
    customer.id,
    {
      name: `${customer.firstName} ${customer.lastName}`,
      firstName: customer.firstName,
      preferredContact: customer.preferredContact,
    },
  ]),
);

export const vehicleLookup = Object.fromEntries(
  vehicles.map((vehicle) => [
    vehicle.id,
    {
      label: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      ...vehicle,
    },
  ]),
);

export const mileageReadings = Object.fromEntries(
  vehicles.map((vehicle) => [
    vehicle.id,
    [
      {
        mileage: Math.max(0, vehicle.currentMileage - 3200),
        recordedAt: "2026-01-10",
        source: "SHOP_REPAIR_ORDER",
        confidence: "VERIFIED",
      },
      {
        mileage: vehicle.currentMileage,
        recordedAt: vehicle.lastServiceDate,
        source: "SHOP_REPAIR_ORDER",
        confidence: "VERIFIED",
      },
    ],
  ]),
);

export function createInitialDemoState(): DemoState {
  return structuredClone(initialDemoState);
}

export function findCustomer(state: DemoState, customerId: string) {
  return state.customers.find((customer) => customer.id === customerId);
}

export function findVehicle(state: DemoState, vehicleId: string) {
  return state.vehicles.find((vehicle) => vehicle.id === vehicleId);
}

export function getCustomer(stateOrId: DemoState | string, customerId?: string) {
  if (typeof stateOrId === "string") {
    return findCustomer(initialDemoState, stateOrId);
  }

  return customerId ? findCustomer(stateOrId, customerId) : undefined;
}

export function getVehicle(stateOrId: DemoState | string, vehicleId?: string) {
  if (typeof stateOrId === "string") {
    return findVehicle(initialDemoState, stateOrId);
  }

  return vehicleId ? findVehicle(stateOrId, vehicleId) : undefined;
}

export function getCustomerVehicles(
  stateOrId: DemoState | string,
  customerId?: string,
) {
  if (typeof stateOrId === "string") {
    return initialDemoState.vehicles.filter(
      (vehicle) => vehicle.customerId === stateOrId,
    );
  }

  return stateOrId.vehicles.filter((vehicle) => vehicle.customerId === customerId);
}

export function getVehicleMaintenance(
  stateOrId: DemoState | string,
  vehicleId?: string,
) {
  if (typeof stateOrId === "string") {
    return initialDemoState.maintenanceRecords.filter(
      (record) => record.vehicleId === stateOrId,
    );
  }

  return stateOrId.maintenanceRecords.filter(
    (record) => record.vehicleId === vehicleId,
  );
}

export function calculateAppointmentTotals(records: VehicleMaintenanceRecord[]) {
  const totals = calculateAppointmentDuration(
    records.map((record) => ({
      name: record.serviceName,
      laborMinutes: Math.round(record.laborHours * 60),
      priceCents: record.priceCents,
    })),
  );

  return {
    totalPriceCents: totals.estimatedRevenueCents,
    totalLaborHours: totals.estimatedLaborMinutes / 60,
    recommendedHours: totals.recommendedMinutes / 60,
  };
}
