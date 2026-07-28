import Link from "next/link";
import { CalendarClock, FileUp, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600">
          Configure pilot data, communication controls, and shop capacity without replacing existing shop systems.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: "Import Mappings",
            description: "Load customer, vehicle, service, declined-work, and appointment CSV files.",
            href: "/import",
            icon: FileUp,
          },
          {
            title: "Shop Capacity",
            description: "Set daily bay-hour assumptions used by capacity planning and revenue recovery.",
            href: "/capacity",
            icon: CalendarClock,
          },
          {
            title: "Tenant Controls",
            description: "Authenticated pilot data stays scoped to the current shop context.",
            href: "/privacy",
            icon: ShieldCheck,
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.title} href={item.href}>
              <Card className="h-full transition hover:border-violet-300 hover:bg-violet-50/40">
                <CardContent>
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-violet-50 text-violet-900">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 font-semibold">{item.title}</h2>
                  <p className="mt-2 text-sm text-zinc-600">{item.description}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Pilot Configuration</h2>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {[
            ["Communication mode", "Manual copy, advisor confirmation, no live SMS/email delivery"],
            ["Revenue attribution", "Maintiva outreach source on booked and completed appointments"],
            ["Duplicate detection", "Customer email, phone, vehicle VIN, and exact customer name"],
            ["Security posture", "Server-side authenticated shop context, browser shop IDs rejected"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm text-zinc-500">{label}</p>
              <p className="mt-1 font-semibold">{value}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
