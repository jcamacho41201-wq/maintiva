import Link from "next/link";
import { Mail, MessageSquare, Phone, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  communications,
  customerLookup,
  maintenanceItems,
  vehicleLookup,
} from "@/lib/demo-data";
import {
  buildBundledMaintenanceMessage,
  canContactCustomer,
  groupAutomationItems,
} from "@/lib/automation";
import { formatCurrency, formatDate, formatHours } from "@/lib/utils";

const groups = groupAutomationItems(
  maintenanceItems.map((item) => ({
    id: item.id,
    name: item.serviceName,
    customerId: item.customerId,
    vehicleId: item.vehicleId,
    remainingLife: item.finalLife,
    threshold: item.notificationThreshold,
    estimatedRevenueCents: item.estimatedPriceCents,
    estimatedLaborMinutes: item.estimatedLaborMinutes,
    status: item.status as "HEALTHY" | "DUE_SOON" | "OVERDUE",
  })),
  customerLookup,
  vehicleLookup,
);

export default function AutomationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Automation Queue</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Eligible services are grouped by customer and vehicle so outreach recommends one bundled appointment.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-wrap gap-2">
          {[
            "Due soon",
            "Overdue",
            "Never contacted",
            "Contacted",
            "Appointment booked",
            "No response",
            "Highest revenue",
            "Highest urgency",
          ].map((filter) => (
            <Badge key={filter} variant="neutral">{filter}</Badge>
          ))}
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-2">
          {groups.map((group) => {
            const allowed = canContactCustomer({
              history: communications.map((communication) => ({
                ...communication,
                responseStatus: communication.responseStatus as
                  | "NONE"
                  | "REPLIED"
                  | "BOOKED"
                  | "NO_RESPONSE"
                  | "OPTED_OUT",
              })),
              customerId: group.customerId,
              vehicleId: group.vehicleId,
              minDaysBetweenContacts: 14,
              asOf: "2026-07-27",
            });
            const firstName = customerLookup[group.customerId].firstName;
            const message = buildBundledMaintenanceMessage({
              firstName,
              vehicleLabel: group.vehicleLabel,
              services: group.services.map((service) => service.name.toLowerCase()),
            });
            const lastContact = communications
              .filter((communication) => communication.vehicleId === group.vehicleId)
              .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())[0];

            return (
              <Card key={group.id} className="shadow-none">
                <CardContent className="space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">{group.customerName}</h2>
                      <p className="text-sm text-zinc-500">{group.vehicleLabel}</p>
                    </div>
                    <Badge variant={group.urgency <= 0 ? "red" : "orange"}>
                      {group.urgency <= 0 ? "Overdue" : "Due soon"}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    {group.services.map((service) => (
                      <div key={service.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                        <span>{service.name}</span>
                        <span className="font-semibold">
                          {service.remainingLife <= 0 ? "Overdue" : `${service.remainingLife}% remaining`}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <p className="text-zinc-500">Revenue</p>
                      <p className="font-semibold">{formatCurrency(group.estimatedRevenueCents)}</p>
                    </div>
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <p className="text-zinc-500">Labor</p>
                      <p className="font-semibold">{formatHours(group.estimatedLaborMinutes)}</p>
                    </div>
                    <div className="rounded-lg border border-zinc-200 p-3">
                      <p className="text-zinc-500">Appointment</p>
                      <p className="font-semibold">{formatHours(group.recommendedMinutes)}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
                    {message}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-zinc-500">
                      Last contact: {lastContact ? formatDate(lastContact.sentAt) : "Never"} · {allowed.reason}
                    </div>
                    <div className="flex gap-2">
                      <button className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200" title="Simulate SMS">
                        <MessageSquare className="h-4 w-4" />
                      </button>
                      <button className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200" title="Simulate email">
                        <Mail className="h-4 w-4" />
                      </button>
                      <button className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200" title="Simulate call">
                        <Phone className="h-4 w-4" />
                      </button>
                      <Link
                        href={`/vehicles/${group.vehicleId}`}
                        className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-3 py-2 text-sm font-semibold text-white"
                      >
                        <Send className="h-4 w-4" />
                        Open
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
