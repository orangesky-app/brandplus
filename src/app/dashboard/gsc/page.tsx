"use client";
import { useEffect, useState } from "react";
import { KPICard } from "@/components/ui/kpi-card";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarRow } from "@/components/ui/bar-row";
import { Search, TrendingUp, CheckCircle2, AlertTriangle, XCircle, Map } from "lucide-react";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF } from "@/lib/export";
import Link from "next/link";
import { useDateRange, formatDateSpan } from "@/lib/date-range-context";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { cn } from "@/lib/utils";

interface Sitemap {
  path: string;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  isPending: boolean;
  errors: number;
  warnings: number;
  submitted: number;
  indexed: number;
}

interface Achievement {
  icon: string;
  label: string;
  type: "good" | "warn" | "bad";
}

interface GSCData {
  site: string;
  period: { startDate: string; endDate: string };
  kpis: { clicks: number; impressions: number; ctr: number; avgPosition: number };
  keywords: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
  pages: { page: string; clicks: number; impressions: number; ctr: number; position: number }[];
  devices: { device: string; clicks: number; impressions: number; ctr: number }[];
  countries: { country: string; clicks: number; impressions: number; ctr: number }[];
  daily: { date: string; clicks: number; impressions: number }[];
  sitemaps: Sitemap[];
  achievements: Achievement[];
}

function shortUrl(url: string) {
  return url.replace(/^https?:\/\/[^/]+/, "").replace(/^$/, "/") || "/";
}

type Tab = "overview" | "keywords" | "pages" | "devices" | "countries" | "sitemap" | "monthly";

interface GscMonthRow { ym: string; label: string; clicks: number; impressions: number; ctr: number; position: number }
const GSC_MONTHLY_KPIS: { key: keyof GscMonthRow; label: string; fmt: (v: number) => string; higher: boolean }[] = [
  { key: "clicks", label: "Clicks", fmt: v => v.toLocaleString("en-IN"), higher: true },
  { key: "impressions", label: "Impressions", fmt: v => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : `${v}`, higher: true },
  { key: "ctr", label: "CTR", fmt: v => `${v}%`, higher: true },
  { key: "position", label: "Avg. Position", fmt: v => `${v}`, higher: false },
];

export default function GSCPage() {
  const { range } = useDateRange();
  const [data, setData] = useState<GSCData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notConnected, setNotConnected] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [months, setMonths] = useState(6);
  const [monthly, setMonthly] = useState<GscMonthRow[] | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/gsc?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then(d => {
        if (d.error === "not_connected" || d.error === "no_site_selected") { setNotConnected(true); return; }
        if (!d.error) setData(d);
      })
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  // Month-wise - lazy load on tab open / window change.
  useEffect(() => {
    if (tab !== "monthly") return;
    setMonthlyLoading(true);
    fetch(`/api/gsc/monthly?months=${months}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setMonthly(d.months ?? []); })
      .finally(() => setMonthlyLoading(false));
  }, [tab, months]);

  if (loading) return <div className="text-[16px] text-[#A1A1AA] dark:text-[#71717A] py-16 text-center">Loading Search Console data…</div>;

  if (notConnected) return (
    <div className="text-center py-20">
      <Search size={32} className="text-[#A1A1AA] mx-auto mb-3" />
      <h2 className="text-[18px] font-bold mb-1 dark:text-[#F4F4F5]">Google Search Console not connected</h2>
      <p className="text-[15px] text-[#71717A] mb-4">Connect to see keyword rankings, clicks, impressions and sitemap status.</p>
      <Link href="/api/auth/google?service=gsc" className="px-5 py-2.5 bg-[#4285F4] text-white rounded-xl text-[15px] font-semibold hover:bg-[#3367d6] transition-colors">
        Connect Search Console →
      </Link>
    </div>
  );

  if (!data) return <div className="text-[16px] text-[#EF4444] py-8 text-center">Could not load GSC data.</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "keywords", label: `Keywords (${data.keywords.length})` },
    { key: "pages", label: `Pages (${data.pages.length})` },
    { key: "devices", label: "Devices" },
    { key: "countries", label: "Countries" },
    { key: "sitemap", label: `Sitemap${data.sitemaps.length > 0 ? ` (${data.sitemaps.length})` : ""}` },
    { key: "monthly", label: "Month-wise" },
  ];

  const maxClicks = Math.max(...(data.devices ?? []).map(d => d.clicks), 1);
  const maxCountryClicks = Math.max(...(data.countries ?? []).map(c => c.clicks), 1);
  const dailyFormatted = (data.daily ?? []).map(d => ({ ...d, label: d.date.slice(5) }));
  const good = data.achievements.filter(a => a.type === "good");
  const warns = data.achievements.filter(a => a.type === "warn");
  const bad = data.achievements.filter(a => a.type === "bad");

  function buildSections() {
    if (!data) return [];
    return [
      {
        title: "GSC KPIs",
        headers: ["Metric", "Value"],
        rows: [
          ["Total Clicks", data.kpis.clicks],
          ["Total Impressions", data.kpis.impressions],
          ["CTR", `${data.kpis.ctr}%`],
          ["Avg Position", data.kpis.avgPosition.toFixed(1)],
          ["Site", data.site],
          ["Period", formatDateSpan(data.period.startDate, data.period.endDate)],
        ],
      },
      {
        title: "Top Keywords",
        headers: ["Keyword", "Clicks", "Impressions", "CTR", "Avg Position"],
        rows: data.keywords.map(k => [k.query, k.clicks, k.impressions, `${k.ctr}%`, k.position.toFixed(1)]),
      },
      {
        title: "Top Pages",
        headers: ["Page URL", "Clicks", "Impressions", "CTR", "Avg Position"],
        rows: data.pages.map(p => [shortUrl(p.page), p.clicks, p.impressions, `${p.ctr}%`, p.position.toFixed(1)]),
      },
      {
        title: "Devices",
        headers: ["Device", "Clicks", "Impressions", "CTR"],
        rows: data.devices.map(d => [d.device, d.clicks, d.impressions, `${d.ctr}%`]),
      },
      {
        title: "Countries",
        headers: ["Country", "Clicks", "Impressions", "CTR"],
        rows: data.countries.map(c => [c.country, c.clicks, c.impressions, `${c.ctr}%`]),
      },
      {
        title: "Daily Trend",
        headers: ["Date", "Clicks", "Impressions"],
        rows: (data.daily ?? []).map(d => [d.date, d.clicks, d.impressions]),
      },
    ];
  }

  function handleExportCSV() { exportToCSV(`skylitee-gsc-${range.from}`, buildSections()); }
  async function handleExportPDF() {
    if (!data) return;
    await exportToPDF(
      `skylitee-gsc-${range.from}`,
      "Google Search Console Report",
      `${data.site} · ${formatDateSpan(data.period.startDate, data.period.endDate)}`,
      buildSections()
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold dark:text-[#F4F4F5]">Google Search Console</h2>
          <p className="text-[15px] text-[#A1A1AA] mt-0.5">{data.site} · {formatDateSpan(data.period.startDate, data.period.endDate)} · Google shares search data 2-3 days late</p>
        </div>
        <ExportButton onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
        <KPICard label="Total Clicks" value={data.kpis.clicks.toLocaleString("en-IN")} />
        <KPICard
          label="Impressions"
          value={data.kpis.impressions >= 1000 ? `${(data.kpis.impressions / 1000).toFixed(1)}K` : data.kpis.impressions.toString()}
        />
        <KPICard
          label="Avg. CTR"
          value={`${data.kpis.ctr}%`}
          change={data.kpis.ctr >= 3 ? 1 : -1}
          changeLabel={data.kpis.ctr >= 5 ? "Excellent" : data.kpis.ctr >= 3 ? "Above avg · Avg: 3%" : "Below avg · Avg: 3%"}
        />
        <KPICard
          label="Avg. Position"
          value={data.kpis.avgPosition.toString()}
          change={data.kpis.avgPosition > 0 && data.kpis.avgPosition <= 10 ? 1 : -1}
          changeLabel={data.kpis.avgPosition <= 3 ? "Top 3!" : data.kpis.avgPosition <= 10 ? "Page 1" : "Not on page 1 yet"}
        />
      </div>

      {/* Achievements + Health */}
      {data.achievements.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
          {good.length > 0 && (
            <Card>
              <div className="flex items-center gap-1.5 mb-2">
                <CheckCircle2 size={14} className="text-[#22C55E]" />
                <span className="text-[13px] font-bold uppercase tracking-wider text-[#15803D] dark:text-[#86EFAC]">What&apos;s Working</span>
              </div>
              <div className="space-y-1">
                {good.map((a, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[14px] text-[#18181B] dark:text-[#F4F4F5]">
                    <span>{a.icon}</span><span>{a.label}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {warns.length > 0 && (
            <Card>
              <div className="flex items-center gap-1.5 mb-2">
                <AlertTriangle size={14} className="text-[#EAB308]" />
                <span className="text-[13px] font-bold uppercase tracking-wider text-[#92400E] dark:text-[#FCD34D]">Opportunities</span>
              </div>
              <div className="space-y-1">
                {warns.map((a, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[14px] text-[#18181B] dark:text-[#F4F4F5]">
                    <span>{a.icon}</span><span>{a.label}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {bad.length > 0 && (
            <Card>
              <div className="flex items-center gap-1.5 mb-2">
                <XCircle size={14} className="text-[#EF4444]" />
                <span className="text-[13px] font-bold uppercase tracking-wider text-[#991B1B] dark:text-[#FCA5A5]">Issues to Fix</span>
              </div>
              <div className="space-y-1">
                {bad.map((a, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[14px] text-[#18181B] dark:text-[#F4F4F5]">
                    <span>{a.icon}</span><span>{a.label}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
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

      {tab === "overview" && (
        <div className="space-y-3">
          {dailyFormatted.length > 0 && (
            <Card>
              <CardHeader title="Daily clicks & impressions" right={formatDateSpan(data.period.startDate, data.period.endDate)} />
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyFormatted} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" strokeOpacity={0.5} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#A1A1AA" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, border: "1px solid #E5E5E5", borderRadius: 10 }} />
                    <Line type="monotone" dataKey="clicks" stroke="#4285F4" strokeWidth={2.5} dot={false} name="Clicks" />
                    <Line type="monotone" dataKey="impressions" stroke="#A1A1AA" strokeWidth={1.5} dot={false} name="Impressions" strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Top keywords" right="Top 10 by clicks - see Keywords tab for all" />
            <div className="overflow-x-auto">
              <table className="w-full text-[15px] border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                    {["Query", "Clicks", "Impr.", "CTR", "Position"].map(h => (
                      <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.keywords.slice(0, 10).map((k, i) => (
                    <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                      <td className="py-2 px-2 max-w-[200px] truncate dark:text-[#F4F4F5]">{k.query}</td>
                      <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{k.clicks}</td>
                      <td className="py-2 px-2 text-[#71717A]">{k.impressions}</td>
                      <td className="py-2 px-2 text-[#71717A]">{k.ctr}%</td>
                      <td className="py-2 px-2">
                        <Badge variant={k.position <= 5 ? "green" : k.position <= 10 ? "amber" : "red"}>{k.position}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === "keywords" && (
        <Card>
          <CardHeader title={`All keywords (${data.keywords.length})`} right="By clicks" />
          <div className="overflow-x-auto">
            <table className="w-full text-[15px] border-collapse">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                  {["Query", "Clicks", "Impressions", "CTR", "Position"].map(h => (
                    <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.keywords.map((k, i) => (
                  <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                    <td className="py-2 px-2 max-w-[260px] truncate dark:text-[#F4F4F5]">{k.query}</td>
                    <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{k.clicks}</td>
                    <td className="py-2 px-2 text-[#71717A]">{k.impressions}</td>
                    <td className="py-2 px-2 text-[#71717A]">{k.ctr}%</td>
                    <td className="py-2 px-2">
                      <Badge variant={k.position <= 5 ? "green" : k.position <= 10 ? "amber" : "red"}>{k.position}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.keywords.filter(k => k.impressions > 50 && k.ctr < 3).length > 0 && (
            <div className="mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-3">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={13} className="text-[#EAB308]" />
                <span className="text-[14px] font-bold text-[#92400E] dark:text-[#FCD34D]">CTR Opportunities</span>
                <span className="text-[14px] text-[#A1A1AA]">High impressions, low clicks - fix title/description</span>
              </div>
              <table className="w-full text-[14px] border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                    {["Query", "Impressions", "CTR now", "Potential extra clicks (at 3% CTR)"].map(h => (
                      <th key={h} className="text-left py-1 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.keywords.filter(k => k.impressions > 50 && k.ctr < 3).slice(0, 8).map((k, i) => (
                    <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                      <td className="py-1.5 px-2 max-w-[220px] truncate dark:text-[#F4F4F5]">{k.query}</td>
                      <td className="py-1.5 px-2 text-[#71717A]">{k.impressions}</td>
                      <td className="py-1.5 px-2 text-[#EF4444]">{k.ctr}%</td>
                      <td className="py-1.5 px-2 text-[#F97316]">+{Math.round(k.impressions * (3 - k.ctr) / 100)} clicks/period</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "pages" && (
        <Card>
          <CardHeader title={`Top pages (${data.pages.length})`} right="By clicks" />
          <div className="overflow-x-auto">
            <table className="w-full text-[15px] border-collapse">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                  {["Page", "Clicks", "Impressions", "CTR", "Position"].map(h => (
                    <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.pages.map((p, i) => (
                  <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                    <td className="py-2 px-2 max-w-[220px] truncate font-medium text-[#4285F4]">{shortUrl(p.page)}</td>
                    <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{p.clicks}</td>
                    <td className="py-2 px-2 text-[#71717A]">{p.impressions}</td>
                    <td className="py-2 px-2 text-[#71717A]">{p.ctr}%</td>
                    <td className="py-2 px-2">
                      <Badge variant={p.position <= 5 ? "green" : p.position <= 10 ? "amber" : "red"}>{p.position}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "devices" && (
        <Card>
          <CardHeader title="Device breakdown" right="By clicks" />
          <div className="space-y-2 py-2 mb-3">
            {data.devices.map((d, i) => (
              <BarRow key={i}
                label={d.device.charAt(0).toUpperCase() + d.device.slice(1)}
                pct={Math.round((d.clicks / maxClicks) * 100)}
                value={`${d.clicks} clicks · CTR ${d.ctr}%`}
                color={(["green", "blue", "amber"] as const)[i] ?? "teal"}
              />
            ))}
          </div>
          <table className="w-full text-[15px] border-collapse">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                {["Device", "Clicks", "Impressions", "CTR"].map(h => (
                  <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.devices.map((d, i) => (
                <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                  <td className="py-2 px-2 capitalize dark:text-[#F4F4F5]">{d.device}</td>
                  <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{d.clicks}</td>
                  <td className="py-2 px-2 text-[#71717A]">{d.impressions}</td>
                  <td className="py-2 px-2 text-[#71717A]">{d.ctr}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "countries" && (
        <Card>
          <CardHeader title="Country breakdown" right="By clicks" />
          <div className="space-y-1.5 py-2 mb-3">
            {data.countries.slice(0, 8).map((c, i) => (
              <BarRow key={i} label={c.country}
                pct={Math.round((c.clicks / maxCountryClicks) * 100)}
                value={`${c.clicks} clicks`}
                color={(["green", "blue", "amber", "teal", "purple"] as const)[i % 5]}
              />
            ))}
          </div>
          <table className="w-full text-[15px] border-collapse">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                {["Country", "Clicks", "Impressions", "CTR"].map(h => (
                  <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.countries.map((c, i) => (
                <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                  <td className="py-2 px-2 dark:text-[#F4F4F5]">{c.country}</td>
                  <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">{c.clicks}</td>
                  <td className="py-2 px-2 text-[#71717A]">{c.impressions}</td>
                  <td className="py-2 px-2 text-[#71717A]">{c.ctr}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "sitemap" && (
        <div className="space-y-3">
          {data.sitemaps.length === 0 ? (
            <Card>
              <div className="flex flex-col items-center py-10 gap-2">
                <Map size={28} className="text-[#A1A1AA]" />
                <div className="text-[15px] text-[#71717A]">No sitemaps submitted to Search Console.</div>
                <div className="text-[14px] text-[#A1A1AA]">Submit your sitemap at search.google.com/search-console → Sitemaps.</div>
              </div>
            </Card>
          ) : (
            data.sitemaps.map((sm, i) => {
              const indexRatio = sm.submitted > 0 ? Math.round((sm.indexed / sm.submitted) * 100) : 0;
              const hasIssues = sm.errors > 0 || sm.warnings > 0;
              return (
                <Card key={i}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-[15px] font-semibold dark:text-[#F4F4F5] truncate max-w-[380px]">{sm.path}</div>
                      {sm.lastSubmitted && (
                        <div className="text-[13px] text-[#A1A1AA] mt-0.5">
                          Submitted: {new Date(sm.lastSubmitted).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          {sm.lastDownloaded && ` · Last crawled: ${new Date(sm.lastDownloaded).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                        </div>
                      )}
                    </div>
                    <span className={cn(
                      "text-[13px] font-bold px-2.5 py-1 rounded-full",
                      sm.isPending ? "bg-[#FFFBEB] text-[#92400E] dark:bg-[#2D1C00] dark:text-[#FCD34D]"
                        : hasIssues ? "bg-[#FEF2F2] text-[#DC2626] dark:bg-[#2D0A0A] dark:text-[#FCA5A5]"
                        : "bg-[#F0FDF4] text-[#15803D] dark:bg-[#052E16] dark:text-[#86EFAC]"
                    )}>
                      {sm.isPending ? "Pending" : hasIssues ? "Has Issues" : "OK"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-3 text-center">
                      <div className="text-[13px] text-[#A1A1AA] mb-1">Submitted</div>
                      <div className="text-[22px] font-black dark:text-[#F4F4F5]">{sm.submitted.toLocaleString()}</div>
                      <div className="text-[13px] text-[#A1A1AA]">URLs</div>
                    </div>
                    <div className="bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-3 text-center">
                      <div className="text-[13px] text-[#A1A1AA] mb-1">Indexed</div>
                      <div className={cn("text-[22px] font-black", indexRatio >= 80 ? "text-[#22C55E]" : indexRatio >= 50 ? "text-[#EAB308]" : "text-[#EF4444]")}>
                        {sm.indexed.toLocaleString()}
                      </div>
                      <div className="text-[13px] text-[#A1A1AA]">{indexRatio}% indexed</div>
                    </div>
                    <div className={cn("rounded-xl p-3 text-center", sm.errors > 0 ? "bg-[#FEF2F2] dark:bg-[#2D0A0A]" : "bg-[#F5F5F4] dark:bg-[#1C1C1C]")}>
                      <div className="text-[13px] text-[#A1A1AA] mb-1">Errors</div>
                      <div className={cn("text-[22px] font-black", sm.errors > 0 ? "text-[#EF4444]" : "text-[#22C55E]")}>
                        {sm.errors}
                      </div>
                      <div className="text-[13px] text-[#A1A1AA]">{sm.errors > 0 ? "Fix required" : "No errors"}</div>
                    </div>
                    <div className={cn("rounded-xl p-3 text-center", sm.warnings > 0 ? "bg-[#FFFBEB] dark:bg-[#2D1C00]" : "bg-[#F5F5F4] dark:bg-[#1C1C1C]")}>
                      <div className="text-[13px] text-[#A1A1AA] mb-1">Warnings</div>
                      <div className={cn("text-[22px] font-black", sm.warnings > 0 ? "text-[#EAB308]" : "text-[#22C55E]")}>
                        {sm.warnings}
                      </div>
                      <div className="text-[13px] text-[#A1A1AA]">{sm.warnings > 0 ? "Review needed" : "All clear"}</div>
                    </div>
                  </div>
                  {sm.submitted > 0 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-[13px] text-[#A1A1AA] mb-1">
                        <span>Indexed</span><span>{indexRatio}%</span>
                      </div>
                      <div className="h-2 bg-[#F5F5F4] dark:bg-[#262626] rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", indexRatio >= 80 ? "bg-[#22C55E]" : indexRatio >= 50 ? "bg-[#EAB308]" : "bg-[#EF4444]")}
                          style={{ width: `${indexRatio}%` }}
                        />
                      </div>
                      {indexRatio < 80 && (
                        <div className="text-[13px] text-[#A1A1AA] mt-1.5">
                          {sm.submitted - sm.indexed} URL{sm.submitted - sm.indexed > 1 ? "s" : ""} not indexed - check Google Search Console for coverage errors.
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })
          )}
          <div className="text-[14px] text-[#A1A1AA] bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-3">
            Note: For broken links (404s) and detailed crawl errors, visit{" "}
            <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="text-[#4285F4] underline">
              Google Search Console → Pages → Not Found (404)
            </a>. The GSC API does not expose crawl error lists.
          </div>
        </div>
      )}

      {/* ── MONTH-WISE ── */}
      {tab === "monthly" && (
        <Card>
          <CardHeader
            title="Month-wise search performance"
            right={
              <div className="flex items-center gap-1.5 text-[14px]">
                <span className="text-[#A1A1AA]">Last</span>
                <select value={months} onChange={e => setMonths(parseInt(e.target.value, 10))}
                  className="bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-lg px-2 py-1 text-[14px] dark:text-[#F4F4F5] outline-none focus:border-[#4285F4]">
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
              {monthly.length > 1 && (
                <div className="h-56 mb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthly.map(m => ({ label: m.label, Clicks: m.clicks, Impressions: m.impressions }))} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" strokeOpacity={0.5} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="l" tick={{ fontSize: 12, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 12, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ fontSize: 13, borderRadius: 12, border: "1px solid #E5E5E5" }} />
                      <Line yAxisId="l" type="monotone" dataKey="Clicks" stroke="#4285F4" strokeWidth={2.5} dot={false} />
                      <Line yAxisId="r" type="monotone" dataKey="Impressions" stroke="#F97316" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-[14px] border-collapse min-w-[560px]">
                  <thead>
                    <tr className="border-b border-black/[0.08] dark:border-white/[0.08]">
                      <th className="text-left py-2 px-2 text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider sticky left-0 bg-white dark:bg-[#171717]">KPI</th>
                      {monthly.map(m => <th key={m.ym} className="text-right py-2 px-3 text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider whitespace-nowrap">{m.label}</th>)}
                      {monthly.length > 1 && <th className="text-right py-2 px-3 text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider">MoM</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {GSC_MONTHLY_KPIS.map(row => {
                      const last = monthly[monthly.length - 1];
                      const prev = monthly[monthly.length - 2];
                      const cur = last[row.key] as number;
                      const pv = prev ? (prev[row.key] as number) : undefined;
                      const mom = pv && pv !== 0 ? ((cur - pv) / pv) * 100 : null;
                      const good = mom === null ? null : (row.higher ? mom >= 0 : mom <= 0);
                      return (
                        <tr key={row.key} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                          <td className="py-2 px-2 font-semibold text-[#18181B] dark:text-[#F4F4F5] sticky left-0 bg-white dark:bg-[#171717]">{row.label}</td>
                          {monthly.map(m => <td key={m.ym} className="py-2 px-3 text-right tabular-nums dark:text-[#F4F4F5]">{row.fmt(m[row.key] as number)}</td>)}
                          {monthly.length > 1 && (
                            <td className={cn("py-2 px-3 text-right tabular-nums font-bold", mom === null ? "text-[#A1A1AA]" : good ? "text-[#16A34A]" : "text-[#EF4444]")}>
                              {mom === null ? "-" : `${mom >= 0 ? "▲" : "▼"} ${Math.abs(mom).toFixed(0)}%`}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[13px] text-[#A1A1AA] mt-2">MoM = latest month ({monthly[monthly.length - 1]?.label}) vs previous. Green = better (for Avg. Position, lower is better so a drop is green). Position is impression-weighted. The current month is partial; GSC also lags ~3 days.</p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
