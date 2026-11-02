"use client";
import { useEffect, useState, useCallback } from "react";
import { NotConnected } from "@/components/ui/not-connected";
import { Card, CardHeader } from "@/components/ui/card";
import { useDateRange, formatDateSpan } from "@/lib/date-range-context";
import { RangeText } from "@/components/ui/period";
import { formatINR } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Clock, TrendingUp, Calendar, Zap } from "lucide-react";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF } from "@/lib/export";

interface HourRow {
  hour: number;
  label: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  ctr: number;
}

interface DowRow {
  dow: number;
  label: string;
  days: number;
  spend: number;
  spendPerDay: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
}

interface TimingData {
  adAccountName: string;
  currency: string;
  period: { from: string; to: string };
  hourly: HourRow[];
  dayOfWeek: DowRow[];
  totalSpend: number;
  peaks: {
    hour: number;
    hourLabel: string;
    hourPurchases: number;
    day: string;
    dayRoas: number;
  };
}

function roasColor(roas: number): string {
  if (roas >= 2) return "#17a773";
  if (roas >= 1.5) return "#1877F2";
  if (roas >= 1) return "#e89820";
  if (roas > 0) return "#d94040";
  return "#e0e0de";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HourTooltip({ active, payload, currency }: { active?: boolean; payload?: any[]; currency: string }) {
  if (!active || !payload?.length) return null;
  const d: HourRow = payload[0].payload;
  const fmt = (n: number) => currency === "INR" ? formatINR(n) : `$${n.toFixed(0)}`;
  return (
    <div className="bg-white border border-black/[0.09] rounded-lg px-3 py-2 shadow-sm text-[15px]">
      <div className="font-semibold text-[#181816] mb-1">{d.label}</div>
      <div className="text-[#686864]">Spend: <span className="text-[#181816] font-medium">{fmt(d.spend)}</span></div>
      <div className="text-[#686864]">ROAS: <span className="text-[#181816] font-medium">{d.roas > 0 ? `${d.roas}×` : "-"}</span></div>
      <div className="text-[#686864]">Purchases: <span className="text-[#181816] font-medium">{d.purchases}</span></div>
      <div className="text-[#686864]">CTR: <span className="text-[#181816] font-medium">{d.ctr.toFixed(2)}%</span></div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DowTooltip({ active, payload, currency }: { active?: boolean; payload?: any[]; currency: string }) {
  if (!active || !payload?.length) return null;
  const d: DowRow = payload[0].payload;
  const fmt = (n: number) => currency === "INR" ? formatINR(n) : `$${n.toFixed(0)}`;
  return (
    <div className="bg-white border border-black/[0.09] rounded-lg px-3 py-2 shadow-sm text-[15px]">
      <div className="font-semibold text-[#181816] mb-1">{d.label}</div>
      <div className="text-[#686864]">Avg spend/day: <span className="text-[#181816] font-medium">{fmt(d.spendPerDay)}</span></div>
      <div className="text-[#686864]">ROAS: <span className="text-[#181816] font-medium">{d.roas > 0 ? `${d.roas}×` : "-"}</span></div>
      <div className="text-[#686864]">Total purchases: <span className="text-[#181816] font-medium">{d.purchases}</span></div>
    </div>
  );
}

export default function TimingPage() {
  const { range } = useDateRange();
  const [checking, setChecking] = useState(true);
  const [connected, setConnected] = useState(false);
  const [data, setData] = useState<TimingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/meta/accounts")
      .then(r => r.json())
      .then(d => setConnected(!d.error))
      .catch(() => setConnected(false))
      .finally(() => setChecking(false));
  }, []);

  const load = useCallback(() => {
    if (!connected) return;
    setLoading(true);
    setError(null);
    fetch(`/api/meta/timing?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Failed to load timing data"))
      .finally(() => setLoading(false));
  }, [connected, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const currency = data?.currency ?? "INR";
  const fmt = (n: number) => currency === "INR" ? formatINR(n) : `$${n.toFixed(0)}`;

  // Determine peak hour range label
  const peakHourLabel = data
    ? (() => {
        const h = data.peaks.hour;
        const start = h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
        const end = (h + 1) === 12 ? "1pm" : (h + 1) < 12 ? `${h + 1}am` : (h + 1) === 12 ? "12pm" : `${(h + 1) - 12}pm`;
        return `${start}–${end}`;
      })()
    : "-";

  function buildSections() {
    if (!data) return [];
    return [
      {
        title: "Timing Summary",
        headers: ["Metric", "Value"],
        rows: [
          ["Peak Hour", peakHourLabel],
          ["Peak Hour Purchases", data.peaks.hourPurchases],
          ["Best Day", data.peaks.day],
          ["Best Day ROAS", `${data.peaks.dayRoas}x`],
          ["Total Spend", fmt(data.totalSpend)],
        ],
      },
      {
        title: "Hourly Breakdown",
        headers: ["Hour", "Spend", "Impressions", "Clicks", "Purchases", "Revenue", "ROAS", "CTR"],
        rows: data.hourly.map(h => [
          h.label, fmt(h.spend), h.impressions.toLocaleString("en-IN"),
          h.clicks, h.purchases, fmt(h.purchaseValue),
          h.roas > 0 ? `${h.roas}x` : "-", `${h.ctr.toFixed(2)}%`,
        ]),
      },
      {
        title: "Day of Week Breakdown",
        headers: ["Day", "Days Sampled", "Total Spend", "Spend / Day", "Purchases", "Revenue", "ROAS"],
        rows: data.dayOfWeek.map(d => [
          d.label, d.days, fmt(d.spend), fmt(d.spendPerDay),
          d.purchases, fmt(d.purchaseValue), d.roas > 0 ? `${d.roas}x` : "-",
        ]),
      },
    ];
  }

  function handleExportCSV() { exportToCSV(`skylitee-timing-${range.from}`, buildSections()); }
  async function handleExportPDF() {
    await exportToPDF(
      `skylitee-timing-${range.from}`,
      "Ad Timing Analysis",
      `${data?.adAccountName ?? "Meta Ads"} · ${formatDateSpan(range.from, range.to)}`,
      buildSections()
    );
  }

  // Top 5 hours by purchases for insight cards
  const top5Hours = data
    ? [...data.hourly].sort((a, b) => b.purchases - a.purchases).slice(0, 5).filter(h => h.purchases > 0)
    : [];

  // Worst performers (high spend, low ROAS)
  const worstHours = data
    ? [...data.hourly]
        .filter(h => h.spend > 0 && h.roas < 1)
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 3)
    : [];

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Clock size={18} className="text-[#F97316]" /> Time Intelligence</h2>
          <p className="text-[17px] text-[#686864] mt-0.5">Best hours &amp; days to run ads · based on your conversion data · <RangeText /></p>
        </div>
        {data && <ExportButton onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} />}
      </div>

      {checking ? (
        <div className="text-[17px] text-[#686864] py-16 text-center">Loading…</div>
      ) : !connected ? (
        <NotConnected
          platform="meta"
          label="Meta Business Suite"
          description="Connect Meta to see hourly conversion heatmaps and discover the best time windows to maximise your ad budget - day-parting recommendations included."
        />
      ) : loading ? (
        <div className="text-[17px] text-[#686864] py-16 text-center">Loading timing data…</div>
      ) : error ? (
        <div className="text-[17px] text-[#d94040] py-16 text-center">{error}</div>
      ) : !data ? null : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              {
                label: "Peak Purchase Hour",
                value: peakHourLabel,
                sub: `${data.peaks.hourPurchases} purchases at this hour`,
                icon: <Clock size={14} />,
              },
              {
                label: "Best Day (ROAS)",
                value: data.peaks.day,
                sub: `ROAS ${data.peaks.dayRoas > 0 ? data.peaks.dayRoas + "×" : "-"}`,
                icon: <Calendar size={14} />,
              },
              {
                label: "Total Ad Spend",
                value: fmt(data.totalSpend),
                sub: formatDateSpan(range.from, range.to),
                icon: <TrendingUp size={14} />,
              },
            ].map(k => (
              <div key={k.label} className="bg-white border border-black/[0.09] rounded-xl p-3.5">
                <div className="text-[17px] text-[#686864] mb-1.5 flex items-center gap-1 font-medium">
                  {k.icon} {k.label}
                </div>
                <div className="text-2xl font-semibold text-[#181816]">{k.value}</div>
                <div className="text-[16px] text-[#9e9e9a] mt-0.5">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Hourly spend chart */}
          <Card className="mb-3">
            <CardHeader
              title="Spend by hour of day"
              right={
                <div className="flex items-center gap-3 text-[15px]">
                  {[
                    { color: "#17a773", label: "ROAS ≥2×" },
                    { color: "#1877F2", label: "1.5–2×" },
                    { color: "#e89820", label: "1–1.5×" },
                    { color: "#d94040", label: "<1×" },
                    { color: "#e0e0de", label: "No sales" },
                  ].map(l => (
                    <div key={l.label} className="flex items-center gap-1 text-[#9e9e9a]">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
                      {l.label}
                    </div>
                  ))}
                </div>
              }
            />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.hourly} barSize={10} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#9e9e9a" }}
                  tickLine={false}
                  axisLine={false}
                  interval={1}
                />
                <YAxis hide />
                <Tooltip content={<HourTooltip currency={currency} />} />
                <Bar dataKey="spend" radius={[3, 3, 0, 0]}>
                  {data.hourly.map(h => (
                    <Cell key={h.hour} fill={roasColor(h.roas)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <div className="grid grid-cols-2 gap-2 mb-3">
            {/* Day of week chart */}
            <Card>
              <CardHeader title="ROAS by day of week" right={<span className="text-[15px] text-[#9e9e9a]">Avg over period</span>} />
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.dayOfWeek} barSize={26} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#9e9e9a" }} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Tooltip content={<DowTooltip currency={currency} />} />
                  <Bar dataKey="roas" radius={[4, 4, 0, 0]}>
                    {data.dayOfWeek.map(d => (
                      <Cell key={d.dow} fill={roasColor(d.roas)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* Day-parting insights */}
            <Card>
              <CardHeader title="Day-parting insights" />

              {top5Hours.length > 0 && (
                <div className="mb-3">
                  <div className="text-[15px] font-semibold text-[#0d6b4f] mb-1.5 flex items-center gap-1">
                    <Zap size={11} /> Best performing hours
                  </div>
                  <div className="space-y-1">
                    {top5Hours.map(h => (
                      <div key={h.hour} className="flex items-center justify-between text-[16px]">
                        <span className="text-[#686864]">{h.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[#181816] font-medium">{h.purchases} orders</span>
                          <span className={`text-[15px] font-medium ${h.roas >= 1.5 ? "text-[#0d6b4f]" : "text-[#e89820]"}`}>
                            {h.roas > 0 ? `ROAS ${h.roas}×` : "-"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {worstHours.length > 0 && (
                <div>
                  <div className="text-[15px] font-semibold text-[#d94040] mb-1.5">Worst hours (low ROAS, high spend)</div>
                  <div className="space-y-1">
                    {worstHours.map(h => (
                      <div key={h.hour} className="flex items-center justify-between text-[16px]">
                        <span className="text-[#686864]">{h.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[#181816] font-medium">{fmt(h.spend)}</span>
                          <span className="text-[15px] text-[#d94040]">
                            ROAS {h.roas > 0 ? `${h.roas}×` : "0"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {top5Hours.length === 0 && worstHours.length === 0 && (
                <div className="text-[17px] text-[#9e9e9a] py-4 text-center">
                  Not enough purchase data in this date range to show insights.
                </div>
              )}

              <div className="mt-3 bg-[#f0f5ff] rounded-lg px-3 py-2 text-[15px] text-[#1877F2]">
                <span className="font-semibold">Day-parting tip:</span> Use Meta Ad Scheduling to cap spend in your lowest-ROAS hours and reallocate budget to peak windows.
              </div>
            </Card>
          </div>

          {/* Spend vs ROAS table */}
          <Card>
            <CardHeader title="Hourly breakdown" right={<span className="text-[15px] text-[#9e9e9a]">All 24 hours</span>} />
            <div className="overflow-x-auto">
              <table className="w-full text-[16px]">
                <thead>
                  <tr className="border-b border-black/[0.06]">
                    {["Hour", "Spend", "Impressions", "Clicks", "CTR", "Purchases", "ROAS"].map(h => (
                      <th key={h} className="text-left py-2 px-2 text-[15px] text-[#9e9e9a] font-medium first:pl-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.hourly.filter(h => h.spend > 0).map(h => (
                    <tr key={h.hour} className="border-b border-black/[0.04] hover:bg-[#f7f7f5]">
                      <td className="py-1.5 pr-2 font-medium text-[#181816]">{h.label}</td>
                      <td className="py-1.5 px-2 text-[#686864]">{fmt(h.spend)}</td>
                      <td className="py-1.5 px-2 text-[#686864]">{h.impressions.toLocaleString("en-IN")}</td>
                      <td className="py-1.5 px-2 text-[#686864]">{h.clicks.toLocaleString("en-IN")}</td>
                      <td className="py-1.5 px-2 text-[#686864]">{h.ctr.toFixed(2)}%</td>
                      <td className="py-1.5 px-2 text-[#686864]">{h.purchases}</td>
                      <td className="py-1.5 px-2">
                        <span className={`font-semibold ${h.roas >= 1.5 ? "text-[#0d6b4f]" : h.roas >= 1 ? "text-[#e89820]" : h.roas > 0 ? "text-[#d94040]" : "text-[#9e9e9a]"}`}>
                          {h.roas > 0 ? `${h.roas}×` : "-"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
