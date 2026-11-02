"use client";
import { useEffect, useState } from "react";
import { BarChart2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { InsightCard } from "@/components/ui/insight-card";
import { BarRow } from "@/components/ui/bar-row";
import { PeriodNote } from "@/components/ui/period";
import { formatDateSpan } from "@/lib/date-range-context";
import { formatINR } from "@/lib/utils";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF } from "@/lib/export";

interface CohortRow {
  month: string;
  customers: number;
  retention: (number | null)[];
  revenue: number;
}

interface RevenueBar {
  month: string;
  revenue: number;
  pct: number;
}

interface CohortInsights {
  bestMonth1: { month: string; val: number } | null;
  avgMonth2: number | null;
  totalCustomers: number;
  avgOrderValue: number;
}

interface CohortData {
  matrix: CohortRow[];
  revenueByMonth: RevenueBar[];
  insights: CohortInsights;
  period: { from: string; to: string };
}

function retentionColor(val: number | null): string {
  if (val === null) return "bg-[#f7f7f5] dark:bg-white/[0.04] text-[#9e9e9a] dark:text-[#52525B]";
  if (val === 100) return "bg-[#e0f5ee] dark:bg-[#14532D]/40 font-semibold text-[#181816] dark:text-[#F4F4F5]";
  if (val >= 28) return "bg-[#9FE1CB] dark:bg-[#166534]/60 text-[#181816] dark:text-[#F4F4F5]";
  if (val >= 18) return "bg-[#C8EEE2] dark:bg-[#166534]/40 text-[#181816] dark:text-[#F4F4F5]";
  if (val >= 12) return "bg-[#D8F2EC] dark:bg-[#166534]/30 text-[#181816] dark:text-[#F4F4F5]";
  if (val >= 9) return "bg-[#E0F5EE] dark:bg-[#166534]/20 text-[#181816] dark:text-[#F4F4F5]";
  return "bg-[#EBF8F3] dark:bg-[#166534]/10 text-[#181816] dark:text-[#F4F4F5]";
}

export default function CohortPage() {
  const [data, setData] = useState<CohortData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/shopify/cohort")
      .then((r) => r.json())
      .then((d) => { if (d.matrix) setData(d); })
      .finally(() => setLoading(false));
  }, []);

  const ins = data?.insights;

  function buildSections() {
    if (!data) return [];
    const maxMonths = Math.max(...data.matrix.map(r => r.retention.length), 0);
    const monthHeaders = Array.from({ length: maxMonths }, (_, i) => `Month ${i}`);
    return [
      {
        title: "Cohort Summary",
        headers: ["Metric", "Value"],
        rows: [
          ["Total Customers", ins?.totalCustomers ?? 0],
          ["Avg Order Value", ins?.avgOrderValue ? formatINR(ins.avgOrderValue) : "-"],
          ["Best Month-1 Cohort", ins?.bestMonth1 ? `${ins.bestMonth1.month} (${ins.bestMonth1.val}%)` : "-"],
          ["Avg Month-2 Retention", ins?.avgMonth2 !== null && ins?.avgMonth2 !== undefined ? `${ins.avgMonth2}%` : "-"],
        ],
      },
      {
        title: "Retention Matrix (% returning customers per month)",
        headers: ["Cohort Month", "Customers", ...monthHeaders],
        rows: data.matrix.map(row => [
          row.month,
          row.customers,
          ...row.retention.map(v => v !== null ? `${v}%` : "-"),
        ]),
      },
      {
        title: "Revenue by Cohort Month",
        headers: ["Month", "Revenue", "% of Total"],
        rows: data.revenueByMonth.map(r => [r.month, formatINR(r.revenue), `${r.pct}%`]),
      },
    ];
  }

  function handleExportCSV() { exportToCSV("skylitee-cohort", buildSections()); }
  async function handleExportPDF() {
    await exportToPDF("skylitee-cohort", "Cohort Analysis", `Customer retention curves by acquisition month · Shopify${data?.period ? ` · ${formatDateSpan(data.period.from, data.period.to)}` : ""}`, buildSections());
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold dark:text-[#F4F4F5] flex items-center gap-2"><BarChart2 size={18} className="text-[#F97316]" /> Cohort Analysis</h2>
          <p className="text-[17px] text-[#686864] dark:text-[#A1A1AA] mt-0.5">
            Customer retention curves by acquisition month - real Shopify data
          </p>
          {data?.period && <PeriodNote from={data.period.from} to={data.period.to} label="Customers who first bought in the last 6 months" />}
        </div>
        <ExportButton onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} disabled={!data} />
      </div>

      {loading ? (
        <div className="text-[17px] text-[#686864] dark:text-[#A1A1AA] py-12 text-center">
          Loading cohort data from Shopify…
        </div>
      ) : !data ? (
        <div className="text-[17px] text-[#d94040] py-12 text-center">
          Could not load cohort data. Check Shopify connection.
        </div>
      ) : (
        <>
          <Card className="mb-2">
            <CardHeader title="Retention cohort matrix" right="% of customers who purchased again in that month" />
            <div className="overflow-x-auto">
              <table className="w-full text-[17px] border-collapse min-w-[560px]">
                <thead>
                  <tr className="border-b border-black/[0.09] dark:border-white/[0.06]">
                    {["Cohort", "Customers", "Month 0", "Month 1", "Month 2", "Month 3", "Month 4", "Month 5"].map((h) => (
                      <th key={h} className="text-left py-1.5 px-2 text-[16px] font-semibold text-[#686864] dark:text-[#A1A1AA]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.matrix.map((row, i) => (
                    <tr key={i} className="border-b border-black/[0.06] dark:border-white/[0.04] last:border-0">
                      <td className="py-1.5 px-2 font-medium dark:text-[#F4F4F5]">{row.month}</td>
                      <td className="py-1.5 px-2 dark:text-[#A1A1AA]">
                        {row.customers === 0 ? "-" : row.customers.toLocaleString()}
                      </td>
                      {row.retention.map((val, j) => (
                        <td key={j} className="py-1 px-1">
                          <div className={`text-center px-2 py-1 rounded text-[15px] ${retentionColor(val)}`}>
                            {val !== null ? `${val}%` : "-"}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Card>
              <CardHeader title="Retention insights" />
              {ins?.bestMonth1 ? (
                <InsightCard
                  title={`${ins.bestMonth1.month} cohort has best Month 1 retention (${ins.bestMonth1.val}%)`}
                  body="Check what was different that month: post-purchase email, product mix, or seasonal offer? Replicate this acquisition strategy."
                />
              ) : (
                <InsightCard title="Not enough repeat orders yet" body="Keep acquiring customers - cohort data will populate as repeat purchases come in." />
              )}
              {ins?.avgMonth2 !== null && ins?.avgMonth2 !== undefined ? (
                <InsightCard
                  type="warning"
                  title={`Month 2 drop (avg ${ins.avgMonth2}%) is your biggest churn point`}
                  body={`After 60 days, ${100 - ins.avgMonth2}% of customers don't return. A '60-day re-engagement' email with a personalised product recommendation at Day 55 can lift Month 2 retention significantly.`}
                />
              ) : null}
              {ins && ins.totalCustomers > 0 && ins.avgOrderValue > 0 ? (
                <InsightCard
                  type="purple"
                  title="Improving retention 5pts = more revenue with zero ad spend"
                  body={`Each 5% retention improvement at your scale (${ins.totalCustomers.toLocaleString()} customers) = ~${Math.round(ins.totalCustomers * 0.05).toLocaleString()} more repeat orders × ${formatINR(ins.avgOrderValue)} AOV = ${formatINR(Math.round(ins.totalCustomers * 0.05 * ins.avgOrderValue))}/year.`}
                />
              ) : null}
            </Card>

            <Card>
              <CardHeader title="Revenue by cohort" right="Cumulative" />
              {data.revenueByMonth.length === 0 ? (
                <div className="text-[17px] text-[#686864] dark:text-[#A1A1AA] py-4 text-center">
                  No revenue data available yet
                </div>
              ) : (
                data.revenueByMonth.map((c, i) => (
                  <BarRow
                    key={i}
                    label={c.month}
                    pct={c.pct}
                    value={formatINR(c.revenue)}
                    color={(["green", "blue", "purple", "teal", "amber"] as const)[i % 5]}
                  />
                ))
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
