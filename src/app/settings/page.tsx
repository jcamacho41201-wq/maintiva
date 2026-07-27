import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Tenant, security, automation, provider, import, and deployment configuration.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {[
          ["Tenant isolation", "All application queries must derive shopId from the authenticated session."],
          ["Communication rules", "Minimum 14 days between outreach, stop after booking, escalate SMS to email or call after no response."],
          ["Provider adapters", "Mock VIN, simulated SMS, email, and call providers are the active demo adapters."],
          ["CSV imports", "Customer, vehicle, repair order, mileage, service history, and declined-work imports are modeled with preview and rollback states."],
        ].map(([title, copy]) => (
          <Card key={title}>
            <CardHeader className="flex flex-row items-center justify-between">
              <h2 className="text-lg font-semibold">{title}</h2>
              <Badge variant="purple">Prepared</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-zinc-600">{copy}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
