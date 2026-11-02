"use client";
import { useEffect, useState } from "react";
import { KPICard } from "@/components/ui/kpi-card";
import { Card, CardHeader } from "@/components/ui/card";
import { BarRow } from "@/components/ui/bar-row";
import { BarChart3, ArrowRight } from "lucide-react";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF } from "@/lib/export";
import Link from "next/link";
import { useDateRange, formatDateSpan } from "@/lib/date-range-context";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { cn, formatINR } from "@/lib/utils";

interface GA4Data {
  property: string;
  period: { startDate: string; endDate: string };
  kpis: { sessions: number; users: number; pageviews: number; bounceRate: number; avgSessionMin: string; newUsers: number };
  channels: { channel: string; sessions: number; users: number; purchases: number; revenue: number }[];
  pages: { page: string; views: number; sessions: number; bounceRate: number }[];
  devices: { device: string; sessions: number; users: number }[];
  countries: { country: string; sessions: number; users: number }[];
  daily: { date: string; sessions: number; users: number }[];
  landingPages: { page: string; sessions: number; bounceRate: number; newUsers: number }[];
  ecommerce: {
    itemsViewed: number; itemsAddedToCart: number; itemsCheckedOut: number; itemsPurchased: number;
    purchases: number; revenue: number; atcRate: number; checkoutRate: number; purchaseRate: number;
  } | null;
  items: { name: string; viewed: number; addedToCart: number; checkedOut: number; purchased: number; revenue: number }[];
  newVsReturning: { type: string; sessions: number; users: number; purchases: number; revenue: number }[];
  cities: { city: string; sessions: number; users: number }[];
  regions: { region: string; sessions: number; users: number }[];
}

type Tab = "overview" | "traffic" | "ecommerce" | "audience" | "geo" | "landing" | "monthly";

interface MonthRow {
  ym: string; label: string; sessions: number; users: number; newUsers: number; returningUsers: number;
  pageviews: number; bounceRate: number; avgDurationSec: number; engagementRate: number;
  purchases: number; revenue: number; organic: number; convRate: number;
}
const fmtDur = (s: number) => s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
const MONTHLY_KPIS: { key: keyof MonthRow; label: string; fmt: (v: number) => string; higher: boolean }[] = [
  { key: "sessions", label: "Sessions", fmt: v => v.toLocaleString("en-IN"), higher: true },
  { key: "users", label: "Users", fmt: v => v.toLocaleString("en-IN"), higher: true },
  { key: "newUsers", label: "New Visitors", fmt: v => v.toLocaleString("en-IN"), higher: true },
  { key: "returningUsers", label: "Returning Visitors", fmt: v => v.toLocaleString("en-IN"), higher: true },
  { key: "avgDurationSec", label: "Avg. Visit Duration", fmt: v => fmtDur(v), higher: true },
  { key: "engagementRate", label: "Engagement Rate", fmt: v => `${v}%`, higher: true },
  { key: "bounceRate", label: "Bounce Rate", fmt: v => `${v}%`, higher: false },
  { key: "pageviews", label: "Pageviews", fmt: v => v.toLocaleString("en-IN"), higher: true },
  { key: "organic", label: "Organic Search", fmt: v => v.toLocaleString("en-IN"), higher: true },
  { key: "purchases", label: "Purchasers", fmt: v => v.toLocaleString("en-IN"), higher: true },
  { key: "revenue", label: "Revenue", fmt: v => formatINR(v), higher: true },
  { key: "convRate", label: "Conversion Rate", fmt: v => `${v}%`, higher: true },
];

function FunnelStep({ label, count, rate, rateLabel }: {
  label: string; count: number; rate?: number; rateLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center flex-1 min-w-0">
      <div className="text-[12px] text-[#A1A1AA] font-bold uppercase tracking-wider mb-1">{label}</div>
      <div className="text-[20px] font-black text-[#18181B] dark:text-[#F4F4F5]">{count.toLocaleString("en-IN")}</div>
      {rate !== undefined && (
        <div className={cn(
          "text-[12px] mt-0.5 px-1.5 py-0.5 rounded-full font-bold",
          rate >= 60 ? "bg-[#FFF7ED] text-[#EA580C] dark:bg-[#2A1A0E] dark:text-[#FB923C]"
            : rate >= 30 ? "bg-[#FFFBEB] text-[#92400E] dark:bg-[#2D1C00] dark:text-[#FCD34D]"
            : "bg-[#FEF2F2] text-[#991B1B] dark:bg-[#2D0A0A] dark:text-[#FCA5A5]"
        )}>{rate}% {rateLabel}</div>
      )}
    </div>
  );
}

export default function GA4Page() {
  const { range } = useDateRange();
  const [data, setData] = useState<GA4Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [notConnected, setNotConnected] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [months, setMonths] = useState(6);
  const [monthly, setMonthly] = useState<MonthRow[] | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/ga4?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then(d => {
        if (d.error === "not_connected" || d.error === "no_properties" || d.error === "no_property_selected") { setNotConnected(true); return; }
        if (!d.error) setData(d);
      })
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  // Month-wise trend - lazy load when the tab is opened or the window changes.
  useEffect(() => {
    if (tab !== "monthly") return;
    setMonthlyLoading(true);
    fetch(`/api/ga4/monthly?months=${months}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setMonthly(d.months ?? []); })
      .finally(() => setMonthlyLoading(false));
  }, [tab, months]);

  if (loading) return <div className="text-[16px] text-[#A1A1AA] py-16 text-center">Loading GA4 data…</div>;

  if (notConnected) return (
    <div className="text-center py-20">
      <BarChart3 size={32} className="text-[#A1A1AA] mx-auto mb-3" />
      <h2 className="text-[18px] font-bold mb-1 dark:text-[#F4F4F5]">Google Analytics 4 not connected</h2>
      <p className="text-[15px] text-[#71717A] mb-4">Connect to see sessions, users, traffic sources, ecommerce funnel and geo data.</p>
      <Link href="/api/auth/google?service=ga4" className="px-5 py-2.5 bg-[#4285F4] text-white rounded-xl text-[15px] font-semibold hover:bg-[#3367d6] transition-colors">
        Connect GA4 →
      </Link>
    </div>
  );

  if (!data) return <div className="text-[16px] text-[#EF4444] py-8 text-center">Could not load GA4 data.</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "traffic", label: `Traffic (${data.channels.length})` },
    { key: "ecommerce", label: "Ecommerce" },
    { key: "audience", label: "Audience" },
    { key: "geo", label: "Geo" },
    { key: "landing", label: "Landing Pages" },
    { key: "monthly", label: "Month-wise" },
  ];

  const maxSessions = Math.max(...data.channels.map(c => c.sessions), 1);
  const maxDeviceSessions = Math.max(...(data.devices ?? []).map(d => d.sessions), 1);
  const maxCitySessions = Math.max(...(data.cities ?? []).map(c => c.sessions), 1);
  const maxRegionSessions = Math.max(...(data.regions ?? []).map(r => r.sessions), 1);
  const channelColors: ("green" | "blue" | "amber" | "purple" | "teal")[] = ["green", "blue", "amber", "purple", "teal"];
  const dailyFormatted = (data.daily ?? []).map(d => ({ ...d, label: d.date.slice(4).replace(/(\d{2})(\d{2})/, "$1/$2") }));

  const newRow = data.newVsReturning.find(r => r.type === "new");
  const retRow = data.newVsReturning.find(r => r.type === "returning");

  // Returning users from GA4's own new-vs-returning report (subtraction can go negative).
  const returningUsers = retRow?.users ?? Math.max(0, data.kpis.users - data.kpis.newUsers);
  // Totals from the dimensionless ecommerce report - channel rows are capped at 10 and
  // summing them under-reports vs GA4. Fall back to the channel sum only if ecom is missing.
  const totalPurchases = data.ecommerce?.purchases ?? data.channels.reduce((s, c) => s + c.purchases, 0);
  const totalRevenue = data.ecommerce?.revenue ?? data.channels.reduce((s, c) => s + c.revenue, 0);
  const topChannel = [...data.channels].sort((a, b) => b.sessions - a.sessions)[0];

  function buildSections() {
    if (!data) return [];
    const ec = data.ecommerce;
    return [
      {
        title: "GA4 KPIs",
        headers: ["Metric", "Value"],
        rows: [
          ["Sessions", data.kpis.sessions.toLocaleString("en-IN")],
          ["Users", data.kpis.users.toLocaleString("en-IN")],
          ["Pageviews", data.kpis.pageviews.toLocaleString("en-IN")],
          ["Bounce Rate", `${data.kpis.bounceRate.toFixed(1)}%`],
          ["Avg Session Duration", data.kpis.avgSessionMin],
          ["New Users", data.kpis.newUsers.toLocaleString("en-IN")],
          ["Returning Users", returningUsers.toLocaleString("en-IN")],
          ["Total Purchases", totalPurchases],
          ["Total Revenue", formatINR(totalRevenue)],
        ],
      },
      {
        title: "Traffic Channels",
        headers: ["Channel", "Sessions", "Users", "Purchases", "Revenue"],
        rows: data.channels.map(c => [c.channel, c.sessions, c.users, c.purchases, formatINR(c.revenue)]),
      },
      ...(ec ? [{
        title: "Ecommerce Funnel",
        headers: ["Stage", "Count", "Rate"],
        rows: [
          ["Items Viewed", ec.itemsViewed, "-"],
          ["Added to Cart", ec.itemsAddedToCart, `${ec.atcRate}%`],
          ["Checked Out", ec.itemsCheckedOut, `${ec.checkoutRate}%`],
          ["Purchased", ec.itemsPurchased, `${ec.purchaseRate}%`],
          ["Purchases (transactions)", ec.purchases, "-"],
          ["Revenue", formatINR(ec.revenue), "-"],
        ],
      }] : []),
      {
        title: "Top Pages",
        headers: ["Page", "Views", "Sessions", "Bounce Rate"],
        rows: data.pages.map(p => [p.page, p.views, p.sessions, `${p.bounceRate.toFixed(1)}%`]),
      },
      {
        title: "Devices",
        headers: ["Device", "Sessions", "Users"],
        rows: (data.devices ?? []).map(d => [d.device, d.sessions, d.users]),
      },
      {
        title: "Countries",
        headers: ["Country", "Sessions", "Users"],
        rows: (data.countries ?? []).map(c => [c.country, c.sessions, c.users]),
      },
      {
        title: "Cities",
        headers: ["City", "Sessions", "Users"],
        rows: (data.cities ?? []).map(c => [c.city, c.sessions, c.users]),
      },
      {
        title: "Landing Pages",
        headers: ["Page", "Sessions", "Bounce Rate", "New Users"],
        rows: (data.landingPages ?? []).map(p => [p.page, p.sessions, `${p.bounceRate.toFixed(1)}%`, p.newUsers]),
      },
      {
        title: "Daily Trend",
        headers: ["Date", "Sessions", "Users"],
        rows: (data.daily ?? []).map(d => [d.date, d.sessions, d.users]),
      },
    ].filter(s => s.rows.length > 0);
  }

  function handleExportCSV() { exportToCSV(`skylitee-ga4-${range.from}`, buildSections()); }
  async function handleExportPDF() {
    if (!data) return;
    await exportToPDF(
      `skylitee-ga4-${range.from}`,
      "Google Analytics 4 Report",
      `${data.property} · ${formatDateSpan(data.period.startDate, data.period.endDate)}`,
      buildSections()
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold dark:text-[#F4F4F5]">Google Analytics 4</h2>
          <p className="text-[15px] text-[#A1A1AA] mt-0.5">{data.property} · {formatDateSpan(data.period.startDate, data.period.endDate)}</p>
        </div>
        <ExportButton onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} />
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
        <KPICard label="Sessions" value={data.kpis.sessions.toLocaleString("en-IN")} />
        <KPICard label="Users" value={data.kpis.users.toLocaleString("en-IN")} />
        <KPICard label="New Users" value={data.kpis.newUsers.toLocaleString("en-IN")} sub={`${data.kpis.users > 0 ? Math.round(data.kpis.newUsers / data.kpis.users * 100) : 0}% of users`} />
        <KPICard label="Returning" value={returningUsers.toLocaleString("en-IN")} sub={`${data.kpis.users > 0 ? Math.round(returningUsers / data.kpis.users * 100) : 0}% of users`} />
        <KPICard label="Bounce Rate" value={`${data.kpis.bounceRate}%`} change={data.kpis.bounceRate < 60 ? 1 : -1} changeLabel={data.kpis.bounceRate < 60 ? "Good" : "High"} />
        <KPICard label="Avg. Session" value={data.kpis.avgSessionMin} />
      </div>

      {/* Top channel highlight */}
      {topChannel && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
          <div className="col-span-1 bg-[#F0FDF4] dark:bg-[#052E16] border border-[#22C55E]/30 rounded-2xl p-3.5">
            <div className="text-[13px] font-bold text-[#15803D] dark:text-[#86EFAC] uppercase tracking-wider mb-1">Top Traffic Channel</div>
            <div className="text-[20px] font-black text-[#18181B] dark:text-[#F4F4F5]">{topChannel.channel}</div>
            <div className="text-[14px] text-[#71717A]">{topChannel.sessions.toLocaleString()} sessions · {Math.round(topChannel.sessions / Math.max(data.kpis.sessions, 1) * 100)}% of total</div>
          </div>
          {totalPurchases > 0 && (
            <div className="col-span-1 bg-[#FFF7ED] dark:bg-[#2A1A0E] border border-[#F97316]/30 rounded-2xl p-3.5">
              <div className="text-[13px] font-bold text-[#EA580C] dark:text-[#FB923C] uppercase tracking-wider mb-1">Total GA4 Purchases</div>
              <div className="text-[20px] font-black text-[#18181B] dark:text-[#F4F4F5]">{totalPurchases.toLocaleString("en-IN")}</div>
              <div className="text-[14px] text-[#71717A]">Revenue: {formatINR(Math.round(totalRevenue))}</div>
            </div>
          )}
          <div className="col-span-1 bg-[#EFF6FF] dark:bg-[#0D1E3D] border border-[#93C5FD]/30 rounded-2xl p-3.5">
            <div className="text-[13px] font-bold text-[#1E40AF] dark:text-[#93C5FD] uppercase tracking-wider mb-1">New vs Returning</div>
            <div className="text-[20px] font-black text-[#18181B] dark:text-[#F4F4F5]">{data.kpis.users > 0 ? Math.round(data.kpis.newUsers / data.kpis.users * 100) : 0}% new</div>
            <div className="text-[14px] text-[#71717A]">{data.kpis.newUsers.toLocaleString()} new · {returningUsers.toLocaleString()} returning</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 overflow-x-auto border-b border-black/[0.06] dark:border-white/[0.06] mb-4">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-[15px] font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap",
              tab === t.key
                ? "border-[#4285F4] text-[#4285F4]"
                : "border-transparent text-[#71717A] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#F4F4F5]"
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="space-y-3">
          {dailyFormatted.length > 0 && (
            <Card>
              <CardHeader title="Daily sessions & users" right={formatDateSpan(data.period.startDate, data.period.endDate)} />
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyFormatted} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" strokeOpacity={0.5} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#A1A1AA" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, border: "1px solid #E5E5E5", borderRadius: 10 }} />
                    <Line type="monotone" dataKey="sessions" stroke="#4285F4" strokeWidth={2.5} dot={false} name="Sessions" />
                    <Line type="monotone" dataKey="users" stroke="#A1A1AA" strokeWidth={1.5} dot={false} name="Users" strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Traffic by channel" right="By sessions" />
            {data.channels.map((c, i) => (
              <BarRow key={i} label={c.channel}
                pct={Math.round((c.sessions / maxSessions) * 100)}
                value={`${c.sessions.toLocaleString("en-IN")} sessions`}
                color={channelColors[i % channelColors.length]}
              />
            ))}
          </Card>
          <Card>
            <CardHeader title="Top pages" right="By views" />
            <table className="w-full text-[15px] border-collapse">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                  {["Page", "Views", "Sessions", "Bounce"].map(h => (
                    <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.pages.slice(0, 8).map((p, i) => (
                  <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                    <td className="py-2 px-2 max-w-[200px] truncate font-medium text-[#4285F4]">{p.page}</td>
                    <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{p.views.toLocaleString("en-IN")}</td>
                    <td className="py-2 px-2 text-[#71717A]">{p.sessions.toLocaleString("en-IN")}</td>
                    <td className={cn("py-2 px-2 font-medium text-[15px]",
                      p.bounceRate > 70 ? "text-[#EF4444]" : p.bounceRate > 50 ? "text-[#EAB308]" : "text-[#22C55E]"
                    )}>{p.bounceRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* ── TRAFFIC ── */}
      {tab === "traffic" && (
        <div className="space-y-3">
          <Card>
            <CardHeader title={`Traffic channels (${data.channels.length})`} right="Sessions + purchases by source" />
            <div className="space-y-2 py-2 mb-3">
              {data.channels.map((c, i) => (
                <BarRow key={i} label={c.channel}
                  pct={Math.round((c.sessions / maxSessions) * 100)}
                  value={`${c.sessions.toLocaleString("en-IN")} sessions`}
                  color={channelColors[i % channelColors.length]}
                />
              ))}
            </div>
            <table className="w-full text-[15px] border-collapse">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                  {["Channel", "Sessions", "Users", "% of Traffic", "Purchases", "Revenue"].map(h => (
                    <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.channels.map((c, i) => (
                  <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                    <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{c.channel}</td>
                    <td className="py-2 px-2 dark:text-[#F4F4F5]">{c.sessions.toLocaleString("en-IN")}</td>
                    <td className="py-2 px-2 text-[#71717A]">{c.users.toLocaleString("en-IN")}</td>
                    <td className="py-2 px-2 text-[#71717A]">{data.kpis.sessions ? `${((c.sessions / data.kpis.sessions) * 100).toFixed(1)}%` : "-"}</td>
                    <td className="py-2 px-2 font-semibold text-[#F97316]">{c.purchases > 0 ? c.purchases : "-"}</td>
                    <td className="py-2 px-2 text-[#F97316]">{c.revenue > 0 ? formatINR(Math.round(c.revenue)) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* New vs Returning */}
          {data.newVsReturning.length > 0 && (
            <Card>
              <CardHeader title="New vs Returning Users" right="Behaviour and purchase comparison" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                {[newRow, retRow].filter(Boolean).map((row, i) => row && (
                  <div key={i} className={cn(
                    "rounded-xl p-4 border",
                    i === 0 ? "bg-[#EFF6FF] dark:bg-[#0D1E3D] border-[#93C5FD]/30" : "bg-[#FFF7ED] dark:bg-[#2A1A0E] border-[#F97316]/30"
                  )}>
                    <div className={cn("text-[13px] font-bold uppercase tracking-wider mb-1",
                      i === 0 ? "text-[#1E40AF] dark:text-[#93C5FD]" : "text-[#EA580C] dark:text-[#FB923C]"
                    )}>
                      {row.type === "new" ? "New Users" : "Returning Users"}
                    </div>
                    <div className="text-[24px] font-black dark:text-[#F4F4F5]">{row.users.toLocaleString("en-IN")}</div>
                    <div className="text-[14px] text-[#71717A] mt-1">{row.sessions.toLocaleString()} sessions</div>
                    {row.purchases > 0 && (
                      <div className="text-[14px] font-semibold text-[#F97316] mt-1">
                        {row.purchases} purchases · {formatINR(Math.round(row.revenue))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── ECOMMERCE ── */}
      {tab === "ecommerce" && (
        <div className="space-y-3">
          {!data.ecommerce || data.ecommerce.itemsViewed === 0 ? (
            <Card>
              <div className="py-10 text-center">
                <div className="text-[15px] font-semibold dark:text-[#F4F4F5] mb-1">No ecommerce data available</div>
                <div className="text-[14px] text-[#71717A]">Make sure GA4 ecommerce tracking (view_item, add_to_cart, begin_checkout, purchase) is set up on your store.</div>
              </div>
            </Card>
          ) : (
            <>
              {/* Funnel */}
              <Card>
                <CardHeader title="Purchase Journey" right={`CVR: ${data.ecommerce.itemsViewed > 0 ? ((data.ecommerce.purchases / data.ecommerce.itemsViewed) * 100).toFixed(2) : 0}%`} />
                <div className="flex items-start gap-1 mb-4">
                  <FunnelStep label="Items Viewed" count={data.ecommerce.itemsViewed} />
                  <div className="flex flex-col items-center justify-center mt-5 shrink-0">
                    <ArrowRight size={12} className="text-[#D4D4D4]" />
                    <div className={cn("text-[12px] font-bold mt-0.5",
                      data.ecommerce.atcRate >= 12 ? "text-[#F97316]" : data.ecommerce.atcRate >= 7 ? "text-[#EAB308]" : "text-[#EF4444]"
                    )}>{data.ecommerce.atcRate}%</div>
                  </div>
                  <FunnelStep label="Add to Cart" count={data.ecommerce.itemsAddedToCart} rate={data.ecommerce.atcRate} rateLabel="ATC" />
                  <div className="flex flex-col items-center justify-center mt-5 shrink-0">
                    <ArrowRight size={12} className="text-[#D4D4D4]" />
                    <div className={cn("text-[12px] font-bold mt-0.5",
                      data.ecommerce.checkoutRate >= 60 ? "text-[#F97316]" : data.ecommerce.checkoutRate >= 40 ? "text-[#EAB308]" : "text-[#EF4444]"
                    )}>{data.ecommerce.checkoutRate}%</div>
                  </div>
                  <FunnelStep label="Checkout" count={data.ecommerce.itemsCheckedOut} rate={data.ecommerce.checkoutRate} rateLabel="Chk" />
                  <div className="flex flex-col items-center justify-center mt-5 shrink-0">
                    <ArrowRight size={12} className="text-[#D4D4D4]" />
                    <div className={cn("text-[12px] font-bold mt-0.5",
                      data.ecommerce.purchaseRate >= 50 ? "text-[#F97316]" : data.ecommerce.purchaseRate >= 30 ? "text-[#EAB308]" : "text-[#EF4444]"
                    )}>{data.ecommerce.purchaseRate}%</div>
                  </div>
                  <FunnelStep label="Purchased" count={data.ecommerce.itemsPurchased} rate={data.ecommerce.purchaseRate} rateLabel="Pur" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
                  {[
                    { label: "Orders", value: data.ecommerce.purchases.toLocaleString("en-IN"), sub: "Transactions" },
                    { label: "Revenue", value: formatINR(Math.round(data.ecommerce.revenue)), sub: "Total purchase value" },
                    { label: "AOV", value: data.ecommerce.purchases > 0 ? formatINR(Math.round(data.ecommerce.revenue / data.ecommerce.purchases)) : "-", sub: "Avg order value" },
                  ].map(item => (
                    <div key={item.label} className="bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-3 text-center">
                      <div className="text-[13px] text-[#A1A1AA] mb-1">{item.label}</div>
                      <div className="text-[18px] font-black text-[#F97316]">{item.value}</div>
                      <div className="text-[13px] text-[#A1A1AA]">{item.sub}</div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Item-level ecommerce table */}
              {data.items.length > 0 && (
                <Card>
                  <CardHeader title="Ecommerce by Product" right="Item-level funnel" />
                  <div className="overflow-x-auto">
                    <table className="w-full text-[15px] border-collapse">
                      <thead>
                        <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                          {["Product", "Viewed", "Add to Cart", "Checkout", "Purchased", "Revenue"].map(h => (
                            <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((item, i) => (
                          <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                            <td className="py-2 px-2 font-semibold max-w-[180px] truncate dark:text-[#F4F4F5]">{item.name}</td>
                            <td className="py-2 px-2 text-[#71717A]">{item.viewed.toLocaleString("en-IN")}</td>
                            <td className="py-2 px-2 text-[#71717A]">
                              {item.addedToCart.toLocaleString("en-IN")}
                              {item.viewed > 0 && <span className="text-[12px] text-[#F97316] ml-1">({Math.round(item.addedToCart / item.viewed * 100)}%)</span>}
                            </td>
                            <td className="py-2 px-2 text-[#71717A]">{item.checkedOut.toLocaleString("en-IN")}</td>
                            <td className="py-2 px-2 font-semibold text-[#F97316]">{item.purchased.toLocaleString("en-IN")}</td>
                            <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{item.revenue > 0 ? formatINR(Math.round(item.revenue)) : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* ── AUDIENCE ── */}
      {tab === "audience" && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* New vs returning breakdown */}
            {data.newVsReturning.length > 0 && (
              <Card>
                <CardHeader title="New vs Returning" right="User segments" />
                {data.newVsReturning.map((row, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                    <div>
                      <div className="text-[15px] font-semibold capitalize dark:text-[#F4F4F5]">{row.type === "new" ? "New Users" : "Returning Users"}</div>
                      <div className="text-[13px] text-[#71717A]">{row.sessions.toLocaleString()} sessions</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[18px] font-black dark:text-[#F4F4F5]">{row.users.toLocaleString("en-IN")}</div>
                      {row.purchases > 0 && <div className="text-[13px] text-[#F97316]">{row.purchases} purchases</div>}
                    </div>
                  </div>
                ))}
              </Card>
            )}
            <Card>
              <CardHeader title="Devices" right="By sessions" />
              <div className="space-y-2 py-2 mb-3">
                {(data.devices ?? []).map((d, i) => (
                  <BarRow key={i}
                    label={d.device.charAt(0).toUpperCase() + d.device.slice(1)}
                    pct={Math.round((d.sessions / maxDeviceSessions) * 100)}
                    value={d.sessions.toLocaleString("en-IN")}
                    color={(["green", "blue", "amber"] as const)[i] ?? "teal"}
                  />
                ))}
              </div>
              <table className="w-full text-[15px] border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                    {["Device", "Sessions", "Users"].map(h => (
                      <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data.devices ?? []).map((d, i) => (
                    <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                      <td className="py-2 px-2 capitalize dark:text-[#F4F4F5]">{d.device}</td>
                      <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{d.sessions.toLocaleString("en-IN")}</td>
                      <td className="py-2 px-2 text-[#71717A]">{d.users.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          <Card>
            <CardHeader title="Countries" right="By sessions" />
            <div className="space-y-1.5 py-2 mb-3">
              {(data.countries ?? []).slice(0, 6).map((c, i) => (
                <BarRow key={i} label={c.country}
                  pct={Math.round((c.sessions / Math.max(...data.countries.map(x => x.sessions), 1)) * 100)}
                  value={c.sessions.toLocaleString("en-IN")}
                  color={channelColors[i % channelColors.length]}
                />
              ))}
            </div>
            <table className="w-full text-[15px] border-collapse">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                  {["Country", "Sessions", "Users"].map(h => (
                    <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.countries ?? []).map((c, i) => (
                  <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                    <td className="py-2 px-2 dark:text-[#F4F4F5]">{c.country}</td>
                    <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{c.sessions.toLocaleString("en-IN")}</td>
                    <td className="py-2 px-2 text-[#71717A]">{c.users.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* ── GEO ── */}
      {tab === "geo" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <CardHeader title="Top Cities" right="By sessions" />
            {data.cities.length === 0 ? (
              <div className="text-[15px] text-[#71717A] py-6 text-center">No city data available</div>
            ) : (
              <>
                <div className="space-y-1.5 py-2 mb-3">
                  {data.cities.slice(0, 8).map((c, i) => (
                    <BarRow key={i} label={c.city}
                      pct={Math.round((c.sessions / maxCitySessions) * 100)}
                      value={`${c.sessions.toLocaleString("en-IN")} sessions`}
                      color={channelColors[i % channelColors.length]}
                    />
                  ))}
                </div>
                <table className="w-full text-[15px] border-collapse">
                  <thead>
                    <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                      {["City", "Sessions", "Users"].map(h => (
                        <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.cities.map((c, i) => (
                      <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                        <td className="py-2 px-2 dark:text-[#F4F4F5]">{c.city}</td>
                        <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{c.sessions.toLocaleString("en-IN")}</td>
                        <td className="py-2 px-2 text-[#71717A]">{c.users.toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>
          <Card>
            <CardHeader title="Top States / Regions" right="By sessions" />
            {data.regions.length === 0 ? (
              <div className="text-[15px] text-[#71717A] py-6 text-center">No region data available</div>
            ) : (
              <>
                <div className="space-y-1.5 py-2 mb-3">
                  {data.regions.slice(0, 8).map((r, i) => (
                    <BarRow key={i} label={r.region}
                      pct={Math.round((r.sessions / maxRegionSessions) * 100)}
                      value={`${r.sessions.toLocaleString("en-IN")} sessions`}
                      color={channelColors[i % channelColors.length]}
                    />
                  ))}
                </div>
                <table className="w-full text-[15px] border-collapse">
                  <thead>
                    <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                      {["State / Region", "Sessions", "Users"].map(h => (
                        <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.regions.map((r, i) => (
                      <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                        <td className="py-2 px-2 dark:text-[#F4F4F5]">{r.region}</td>
                        <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{r.sessions.toLocaleString("en-IN")}</td>
                        <td className="py-2 px-2 text-[#71717A]">{r.users.toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>
        </div>
      )}

      {/* ── LANDING PAGES ── */}
      {tab === "landing" && (
        <Card>
          <CardHeader title="Landing pages" right="First page of each session" />
          {(data.landingPages ?? []).length === 0 ? (
            <div className="text-[15px] text-[#71717A] py-6 text-center">No landing page data</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[15px] border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                    {["Landing Page", "Sessions", "New Users", "Bounce Rate"].map(h => (
                      <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.landingPages.map((p, i) => (
                    <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                      <td className="py-2 px-2 font-medium text-[#4285F4] max-w-[220px] truncate">{p.page}</td>
                      <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{p.sessions.toLocaleString("en-IN")}</td>
                      <td className="py-2 px-2 text-[#71717A]">{p.newUsers.toLocaleString("en-IN")}</td>
                      <td className={cn("py-2 px-2 font-medium",
                        p.bounceRate > 70 ? "text-[#EF4444]" : p.bounceRate > 50 ? "text-[#EAB308]" : "text-[#22C55E]"
                      )}>{p.bounceRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── MONTH-WISE ── */}
      {tab === "monthly" && (
        <Card>
          <CardHeader
            title="Month-wise performance"
            right={
              <div className="flex items-center gap-1.5 text-[13px]">
                <span className="text-[#A1A1AA]">Last</span>
                <select value={months} onChange={e => setMonths(parseInt(e.target.value, 10))}
                  className="bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-lg px-2 py-1 text-[13px] dark:text-[#F4F4F5] outline-none focus:border-[#4285F4]">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => <option key={n} value={n}>{n} month{n > 1 ? "s" : ""}</option>)}
                </select>
              </div>
            }
          />
          {monthlyLoading ? (
            <div className="text-[15px] text-[#71717A] py-10 text-center">Loading month-wise data…</div>
          ) : !monthly || monthly.length === 0 ? (
            <div className="text-[15px] text-[#71717A] py-10 text-center">No monthly data for this window.</div>
          ) : (
            <>
              {/* Trend chart - sessions & users */}
              {monthly.length > 1 && (
                <div className="h-56 mb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthly.map(m => ({ label: m.label, Sessions: m.sessions, Users: m.users }))} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" strokeOpacity={0.5} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ fontSize: 13, borderRadius: 12, border: "1px solid #E5E5E5" }} />
                      <Line type="monotone" dataKey="Sessions" stroke="#4285F4" strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="Users" stroke="#F97316" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* KPI × month table with MoM change on the latest month */}
              <div className="overflow-x-auto">
                <table className="w-full text-[14px] border-collapse min-w-[640px]">
                  <thead>
                    <tr className="border-b border-black/[0.08] dark:border-white/[0.08]">
                      <th className="text-left py-2 px-2 text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider sticky left-0 bg-white dark:bg-[#171717]">KPI</th>
                      {monthly.map(m => (
                        <th key={m.ym} className="text-right py-2 px-3 text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider whitespace-nowrap">{m.label}</th>
                      ))}
                      {monthly.length > 1 && <th className="text-right py-2 px-3 text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider">MoM</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {MONTHLY_KPIS.map(row => {
                      const last = monthly[monthly.length - 1];
                      const prev = monthly[monthly.length - 2];
                      const cur = last[row.key] as number;
                      const pv = prev ? (prev[row.key] as number) : undefined;
                      const mom = pv && pv !== 0 ? ((cur - pv) / pv) * 100 : null;
                      const good = mom === null ? null : (row.higher ? mom >= 0 : mom <= 0);
                      return (
                        <tr key={row.key} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                          <td className="py-2 px-2 font-semibold text-[#18181B] dark:text-[#F4F4F5] sticky left-0 bg-white dark:bg-[#171717]">{row.label}</td>
                          {monthly.map(m => (
                            <td key={m.ym} className="py-2 px-3 text-right tabular-nums dark:text-[#F4F4F5]">{row.fmt(m[row.key] as number)}</td>
                          ))}
                          {monthly.length > 1 && (
                            <td className={cn("py-2 px-3 text-right tabular-nums font-bold",
                              mom === null ? "text-[#A1A1AA]" : good ? "text-[#16A34A]" : "text-[#EF4444]")}>
                              {mom === null ? "-" : `${mom >= 0 ? "▲" : "▼"} ${Math.abs(mom).toFixed(0)}%`}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[12px] text-[#A1A1AA] mt-2">MoM = latest month ({monthly[monthly.length - 1]?.label}) vs the previous month. Green = better, red = worse (bounce rate inverted). The current month is partial until it ends.</p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
