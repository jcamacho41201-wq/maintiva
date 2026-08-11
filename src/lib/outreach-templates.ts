import type { Customer, Shop, Vehicle } from "@/lib/demo-data";
import type { RevenueQueueGroup } from "@/lib/revenue-recovery";

export type OutreachTemplateChannel = "TEXT" | "EMAIL";
export type OutreachTemplateReason = "DECLINED_WORK" | "DUE_SOON" | "OVERDUE" | "INSPECTION_RECOMMENDATION";

export type OutreachDraft = {
  subject: string;
  body: string;
};

export const outreachTemplateReasons: { value: OutreachTemplateReason; label: string }[] = [
  { value: "DECLINED_WORK", label: "Declined work" },
  { value: "DUE_SOON", label: "Due soon" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "INSPECTION_RECOMMENDATION", label: "Inspection recommendation" },
];

export function groupedServiceNamesForTemplate(group: RevenueQueueGroup) {
  const anchorShopId = group.opportunities.find((opportunity) =>
    opportunity.customerId === group.customerId && opportunity.vehicleId === group.vehicleId,
  )?.shopId;
  const opportunityNames = group.opportunities
    .filter((opportunity) =>
      opportunity.customerId === group.customerId &&
      opportunity.vehicleId === group.vehicleId &&
      (!anchorShopId || opportunity.shopId === anchorShopId),
    )
    .flatMap((opportunity) => opportunity.serviceNames);
  const sourceNames = opportunityNames.length > 0 ? opportunityNames : group.recommendedServices;
  const seen = new Set<string>();

  return sourceNames.reduce<string[]>((names, name) => {
    const trimmed = name.trim();
    const key = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(key)) return names;
    seen.add(key);
    names.push(trimmed);
    return names;
  }, []);
}

export function formatGroupedServiceSummary(serviceNames: string[]) {
  const names = serviceNames.length > 0 ? serviceNames : ["recommended service"];
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]}`;
  return `${names.slice(0, 3).join(", ")} + ${names.length - 3} more`;
}

function firstServiceName(group: RevenueQueueGroup) {
  return groupedServiceNamesForTemplate(group)[0] ?? "recommended service";
}

function required(value: string | number | undefined | null, token: string) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : `{{${token}}}`;
}

function render(value: string, variables: Record<string, string>) {
  return value.replace(/{{\s*([a-zA-Z0-9]+)\s*}}/g, (match, key: string) => variables[key] ?? match);
}

export function unresolvedTemplateTokens(value: string) {
  return Array.from(new Set(value.match(/{{\s*[a-zA-Z0-9]+\s*}}/g) ?? []));
}

export function templateReasonForGroup(group: RevenueQueueGroup): OutreachTemplateReason {
  if (group.opportunities.some((opportunity) => opportunity.source === "DECLINED_WORK")) return "DECLINED_WORK";
  if (group.opportunities.some((opportunity) => opportunity.source === "OVERDUE_MAINTENANCE")) return "OVERDUE";
  if (group.opportunities.some((opportunity) => /inspect/i.test(`${opportunity.sourceLabel} ${opportunity.explanation}`))) {
    return "INSPECTION_RECOMMENDATION";
  }
  return "DUE_SOON";
}

export function outreachTemplateVariables({
  customer,
  vehicle,
  shop,
  group,
  bookingUrl,
}: {
  customer: Customer;
  vehicle: Vehicle;
  shop: Pick<Shop, "name" | "phone" | "email">;
  group: RevenueQueueGroup;
  bookingUrl?: string;
}) {
  const serviceNames = groupedServiceNamesForTemplate(group);
  const serviceName = firstServiceName(group);
  const serviceSummary = formatGroupedServiceSummary(serviceNames);
  return {
    customerFirstName: required(customer.firstName, "customerFirstName"),
    customerLastName: required(customer.lastName, "customerLastName"),
    shopName: required(shop.name, "shopName"),
    shopPhone: required(shop.phone, "shopPhone"),
    shopEmail: required(shop.email, "shopEmail"),
    vehicleYear: required(vehicle.year, "vehicleYear"),
    vehicleMake: required(vehicle.make, "vehicleMake"),
    vehicleModel: required(vehicle.model, "vehicleModel"),
    serviceName,
    serviceSummary,
    serviceScheduleObject: serviceNames.length === 1 ? "it" : "them",
    opportunityReason: group.sources.join(", ") || group.explanation || "recommended maintenance",
    bookingUrl: bookingUrl?.trim() || "{{bookingUrl}}",
  };
}

function bookingLine(channel: OutreachTemplateChannel, includeBookingLink: boolean) {
  if (!includeBookingLink) return "";
  return channel === "TEXT"
    ? " Request a maintenance time here: {{bookingUrl}}"
    : "\n\nYou can request a maintenance time here: {{bookingUrl}}";
}

function templateFor(reason: OutreachTemplateReason, channel: OutreachTemplateChannel, includeBookingLink: boolean): OutreachDraft {
  const link = bookingLine(channel, includeBookingLink);
  if (channel === "TEXT") {
    if (includeBookingLink) {
      const bodyByReason: Record<OutreachTemplateReason, string> = {
        DECLINED_WORK: "Hi {{customerFirstName}}, this is {{shopName}}. We are following up on {{serviceSummary}} recommended for your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}}. You can request a maintenance time here: {{bookingUrl}}. We'll confirm the appointment after reviewing our schedule.",
        DUE_SOON: "Hi {{customerFirstName}}, this is {{shopName}}. Your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} is coming due for {{serviceSummary}}. You can request a maintenance time here: {{bookingUrl}}. We'll confirm the appointment after reviewing our schedule.",
        OVERDUE: "Hi {{customerFirstName}}, this is {{shopName}}. Your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} is overdue for {{serviceSummary}}. You can request a maintenance time here: {{bookingUrl}}. We'll confirm the appointment after reviewing our schedule.",
        INSPECTION_RECOMMENDATION: "Hi {{customerFirstName}}, this is {{shopName}}. Based on our inspection recommendation, your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} needs {{serviceSummary}}. You can request a maintenance time here: {{bookingUrl}}. We'll confirm the appointment after reviewing our schedule.",
      };
      return { subject: "", body: bodyByReason[reason] };
    }
    const bodyByReason: Record<OutreachTemplateReason, string> = {
      DECLINED_WORK: "Hi {{customerFirstName}}, this is {{shopName}}. We are following up on {{serviceSummary}} recommended for your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}}. Reply here or call {{shopPhone}} when you would like to handle {{serviceScheduleObject}}.",
      DUE_SOON: "Hi {{customerFirstName}}, this is {{shopName}}. Your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} is coming due for {{serviceSummary}}. Reply here or call {{shopPhone}} to choose a time.",
      OVERDUE: "Hi {{customerFirstName}}, this is {{shopName}}. Your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} is overdue for {{serviceSummary}}. Reply here or call {{shopPhone}} and we can help you get {{serviceScheduleObject}} scheduled.",
      INSPECTION_RECOMMENDATION: "Hi {{customerFirstName}}, this is {{shopName}}. Based on our inspection recommendation, your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} needs {{serviceSummary}}. Reply here or call {{shopPhone}} with questions.",
    };
    return { subject: "", body: `${bodyByReason[reason]}${link}` };
  }

  const subjectByReason: Record<OutreachTemplateReason, string> = {
    DECLINED_WORK: "{{serviceName}} follow-up for your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}}",
    DUE_SOON: "{{serviceName}} is coming due for your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}}",
    OVERDUE: "{{serviceName}} is overdue for your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}}",
    INSPECTION_RECOMMENDATION: "Inspection recommendation for your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}}",
  };
  const bodyByReason: Record<OutreachTemplateReason, string> = {
    DECLINED_WORK: "Hi {{customerFirstName}},\n\nThis is {{shopName}} following up on the {{serviceName}} we recommended for your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}}. We can answer questions, review timing, or help you choose an appointment that works for you.",
    DUE_SOON: "Hi {{customerFirstName}},\n\nThis is {{shopName}}. Your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} is coming due for {{serviceName}}, and we wanted to help you plan it before it turns into a more urgent visit.",
    OVERDUE: "Hi {{customerFirstName}},\n\nThis is {{shopName}}. Your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} is overdue for {{serviceName}}. We can help you get it handled and review anything else due at the same visit.",
    INSPECTION_RECOMMENDATION: "Hi {{customerFirstName}},\n\nThis is {{shopName}}. Based on our inspection recommendation, your {{vehicleYear}} {{vehicleMake}} {{vehicleModel}} needs {{serviceName}}. We can answer questions and help you plan the repair.",
  };
  return {
    subject: subjectByReason[reason],
    body: `${bodyByReason[reason]}${link}\n\nYou can reach us at {{shopPhone}} or {{shopEmail}}.\n\nThank you,\n{{shopName}}`,
  };
}

export function buildOutreachDraft({
  channel,
  reason,
  variables,
  includeBookingLink,
}: {
  channel: OutreachTemplateChannel;
  reason: OutreachTemplateReason;
  variables: Record<string, string>;
  includeBookingLink: boolean;
}) {
  const template = templateFor(reason, channel, includeBookingLink);
  return {
    subject: render(template.subject, variables),
    body: render(template.body, variables),
  };
}
