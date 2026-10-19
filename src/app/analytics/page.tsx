"use client";

import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useDemoStore } from "@/lib/demo-store";
import { retentionReport, type ReportRange } from "@/lib/retention";
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
  const { state, ready, loadError } = useDemoStore();
  const [range, setRange] = useState<ReportRange>("MONTH");
  const report = retentionReport(state, range);
  if (!ready) return <p>Loading revenue report…</p>;
  if (loadError) return <p role="alert">Revenue report could not be loaded.</p>;
  const funnel = [
    { stage: "contact", label: "Contacted", count: report.customersContacted },
    { stage: "response", label: "Responded", count: report.customerResponses },
    { stage: "request", label: "Requests", count: report.requestCount },
    { stage: "appointment", label: "Appointments", count: report.appointmentsGenerated },
    { stage: "return", label: "Returned", count: report.customersReturned },
  ];
  const cards = [
    ["Recovered revenue", formatCurrency(report.recoveredRevenueCents)],
    ["Customers returned", report.customersReturned.toString()],
    ["Customers contacted", report.customersContacted.toString()],
    ["Customer responses", report.customerResponses.toString()],
    ["Appointments scheduled", report.appointmentsGenerated.toString()],
    ["Appointment requests", report.requestCount.toString()],
    ["Estimated open opportunity (current)", formatCurrency(report.estimatedOpportunityCents)],
    ["Estimated scheduled value (current)", formatCurrency(report.estimatedScheduledCents)],
  ];
  const csvRows = [
    ["Metric", "Value"],
    ...cards,
    ["Period start", report.from],
    ["Period end", report.through],
    ["Revenue missing", String(report.missingRevenueCount)],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Recovered Revenue & Retention</h1>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Recorded revenue from completed Maintiva-attributed appointments. Estimates remain separate.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as ReportRange)}
            aria-label="Report period"
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold outline-none focus:border-violet-500"
          >
            <option value="MONTH">This month</option>
            <option value="30_DAYS">Last 30 days</option>
            <option value="QUARTER">Quarter to date</option>
            <option value="ALL">All time</option>
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
            <p className="mt-1 text-sm text-zinc-500">{report.from === "0000-01-01" ? "All time" : report.from} through {report.through}. Appointments use scheduled date; returns use completion date.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {funnel.map((item) => (
              <div key={item.stage} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
                <span className="font-medium">{item.label}</span>
                <div className="h-3 rounded-full bg-zinc-100">
                  <div
                    className="h-3 rounded-full bg-violet-800"
                    style={{ width: `${item.count / Math.max(1, ...funnel.map((entry) => entry.count)) * 100}%` }}
                  />
                </div>
                <span className="text-right font-semibold">{item.count}</span>
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
              ["Contacted customers who responded", report.responseRate],
              ["Contacted customers with appointments", report.bookingRate],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{label}</span>
                  <span className="font-semibold">{value === null ? "Not available" : `${value}%`}</span>
                </div>
                <div className="mt-3 h-3 rounded-full bg-zinc-100">
                  <div className="h-3 rounded-full bg-violet-800" style={{ width: `${value ?? 0}%` }} />
                </div>
              </div>
            ))}
            <div className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm text-zinc-500">Subscription ROI</p>
              <p className="mt-1 font-semibold">Not available: subscription cost not recorded.</p>
              <p className="mt-3 text-sm text-zinc-500">{report.missingRevenueCount} completed appointments excluded from revenue because the completion amount is missing.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
