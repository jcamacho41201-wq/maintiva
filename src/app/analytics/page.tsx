"use client";

import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useDemoStore } from "@/lib/demo-store";
import { getRevenueFunnel, getRoiReport } from "@/lib/revenue-recovery";
import { formatCurrency } from "@/lib/utils";

function downloadCsv(rows: string[][]) {
  const content = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "maintiva-roi-report.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AnalyticsPage() {
  const { state } = useDemoStore();
  const [range, setRange] = useState("This month");
  const report = getRoiReport(state);
  const funnel = getRevenueFunnel(state);
  const cards = [
    ["Opportunities identified", report.opportunitiesIdentified.toString()],
    ["Value identified", formatCurrency(report.opportunityValueIdentified)],
    ["Customers contacted", report.customersContacted.toString()],
    ["Customer responses", report.customerResponses.toString()],
    ["Appointments booked", report.appointmentsBookedThroughMaintiva.toString()],
    ["Booked revenue", formatCurrency(report.bookedMaintivaRevenue)],
    ["Completed revenue", formatCurrency(report.completedMaintivaRevenue)],
    ["Average recovered RO", formatCurrency(report.averageRecoveredRepairOrder)],
  ];
  const csvRows = [
    ["Metric", "Value"],
    ...cards,
    ["Outreach to response rate", `${report.outreachToResponseRate}%`],
    ["Response to booking rate", `${report.responseToBookingRate}%`],
    ["Overall outreach to booking rate", `${report.overallOutreachToBookingRate}%`],
    ["Labor hours booked", `${report.laborHoursBookedThroughMaintiva}`],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">ROI Report</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Attribution for maintenance revenue Maintiva helped identify, book, and recover.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={range}
            onChange={(event) => setRange(event.target.value)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold outline-none focus:border-violet-500"
          >
            <option>This month</option>
            <option>Last 30 days</option>
            <option>Quarter to date</option>
            <option>Pilot to date</option>
          </select>
          <button
            onClick={() => downloadCsv(csvRows)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-800"
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => (
          <Card key={label}>
            <CardContent>
              <p className="text-sm text-zinc-500">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.85fr]">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Revenue Funnel</h2>
            <p className="mt-1 text-sm text-zinc-500">{range}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {funnel.map((item) => (
              <div key={item.stage} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
                <span className="font-medium">{item.label}</span>
                <div className="h-3 rounded-full bg-zinc-100">
                  <div
                    className="h-3 rounded-full bg-violet-800"
                    style={{ width: `${Math.min(100, item.count * 18)}%` }}
                  />
                </div>
                <span className="text-right font-semibold">{item.count} · {formatCurrency(item.valueCents)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Conversion</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              ["Outreach to response", report.outreachToResponseRate],
              ["Response to booking", report.responseToBookingRate],
              ["Outreach to booking", report.overallOutreachToBookingRate],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{label}</span>
                  <span className="font-semibold">{value}%</span>
                </div>
                <div className="mt-3 h-3 rounded-full bg-zinc-100">
                  <div className="h-3 rounded-full bg-violet-800" style={{ width: `${value}%` }} />
                </div>
              </div>
            ))}
            <div className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm text-zinc-500">Labor hours booked through Maintiva</p>
              <p className="mt-1 text-xl font-semibold">{report.laborHoursBookedThroughMaintiva} hrs</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
