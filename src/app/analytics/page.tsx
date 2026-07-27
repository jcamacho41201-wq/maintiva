import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { RevenueForecastChart } from "@/components/charts/revenue-forecast-chart";

export default function AnalyticsPage() {
  const metrics = [
    ["Maintiva attributed revenue", "$28.4k"],
    ["Customer retention", "74%"],
    ["Booking conversion", "19.8%"],
    ["Average repair order", "$486"],
    ["Customer response rate", "31%"],
    ["Automation success rate", "22%"],
    ["Overdue maintenance value", "$42.7k"],
    ["Technician capacity", "68%"],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Forecast revenue, conversion, retention, service mix, and bay utilization.
        </p>
      </div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <Card key={label}>
            <CardContent>
              <p className="text-sm text-zinc-500">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </section>
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Predicted vs Scheduled Revenue</h2>
        </CardHeader>
        <CardContent>
          <RevenueForecastChart />
        </CardContent>
      </Card>
    </div>
  );
}
