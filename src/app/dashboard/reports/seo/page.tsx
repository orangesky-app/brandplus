"use client";
import { useEffect, useRef, useState } from "react";
import { useDateRange, rangeText, formatDateSpan } from "@/lib/date-range-context";
import { Card, CardHeader } from "@/components/ui/card";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV } from "@/lib/export";
import { exportElementToPDF } from "@/lib/export-visual";
import { PrintableSEO } from "./PrintableSEO";
import type { GSCData, GA4Data, MonthlyMonth, GA4MonthlyMonth } from "./types";
import { buildGscRows, buildGa4Rows, MonthwiseTable } from "./monthwise";
import { Donut, Gauge } from "@/components/ui/charts";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { CheckCircle2, AlertTriangle, XCircle, Search, TrendingUp, MousePointerClick, Eye, Users, IndianRupee, Filter } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

function shortUrl(url: string) {
  return url.replace(/^https?:\/\/[^/]+/, "").replace(/^$/, "/") || "/";
}
function normPath(p: string) {
  let s = (p || "").split("?")[0];
  if (s.length > 1) s = s.replace(/\/$/, "");
  return s || "/";
}
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function SignalCard({ type, metric, value, detail }: { type: "good" | "warn" | "bad"; metric: string; value: string; detail: string }) {
  const styles = {
    good: { bg: "bg-[#F0FDF4] dark:bg-[#052E16]/40", border: "border-[#86EFAC] dark:border-[#166534]", icon: <CheckCircle2 size={15} className="text-[#16A34A]" />, label: "text-[#166534] dark:text-[#4ADE80]" },
    warn: { bg: "bg-[#FFFBEB] dark:bg-[#2D1C00]/40", border: "border-[#FCD34D] dark:border-[#92400E]", icon: <AlertTriangle size={15} className="text-[#D97706]" />, label: "text-[#92400E] dark:text-[#FCD34D]" },
    bad: { bg: "bg-[#FEF2F2] dark:bg-[#2D0A0A]/40", border: "border-[#FCA5A5] dark:border-[#991B1B]", icon: <XCircle size={15} className="text-[#DC2626]" />, label: "text-[#991B1B] dark:text-[#FCA5A5]" },
  }[type];
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-3", styles.bg, styles.border)}>
      <div className="mt-0.5 shrink-0">{styles.icon}</div>
      <div>
        <div className={cn("text-[14px] font-bold", styles.label)}>{metric}: {value}</div>
        <div className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] mt-0.5 leading-relaxed">{detail}</div>
      </div>
    </div>
  );
}

/** Horizontal "pole" bar - track + fill, with a label and value. */
function PoleBar({ label, value, pct, color, sub }: { label: string; value: string; pct: number; color: string; sub?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[14px] font-medium text-[#18181B] dark:text-[#F4F4F5]">{label}</span>
        <span className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5] tabular-nums">{value}{sub && <span className="text-[12px] font-medium text-[#A1A1AA] ml-1.5">{sub}</span>}</span>
      </div>
      <div className="h-2.5 rounded-full bg-[#F1F1F0] dark:bg-[#262626] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }} />
      </div>
    </div>
  );
}

export default function SEOReportPage() {
  const { range } = useDateRange();
  const printRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<GSCData | null>(null);
  const [ga4, setGa4] = useState<GA4Data | null>(null);
  const [monthly, setMonthly] = useState<MonthlyMonth[]>([]);
  const [ga4Monthly, setGa4Monthly] = useState<GA4MonthlyMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [notConnected, setNotConnected] = useState(false);
  const generatedAt = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    setLoading(true);
    setNotConnected(false);
    Promise.all([
      fetch(`/api/gsc?from=${range.from}&to=${range.to}`).then(r => r.json()).catch(() => ({ error: "fetch" })),
      fetch(`/api/ga4?organic=1&from=${range.from}&to=${range.to}`).then(r => r.json()).catch(() => null),
      fetch(`/api/gsc/monthly?months=6`).then(r => r.json()).catch(() => null),
      fetch(`/api/ga4/monthly?months=6`).then(r => r.json()).catch(() => null),
    ]).then(([gsc, ga, mo, gaMo]) => {
      if (gsc?.error === "not_connected") { setNotConnected(true); return; }
      if (gsc && !gsc.error) setData(gsc);
      if (ga && !ga.error) setGa4(ga);
      if (mo && !mo.error && Array.isArray(mo.months)) setMonthly(mo.months);
      if (gaMo && !gaMo.error && Array.isArray(gaMo.months)) setGa4Monthly(gaMo.months);
    }).finally(() => setLoading(false));
  }, [range.from, range.to]);

  function buildSections() {
    if (!data) return [];
    const secs = [
      { title: "SEO KPIs", headers: ["Metric", "Value", "Benchmark"], rows: [
        ["Total Clicks", data.kpis.clicks, "-"],
        ["Total Impressions", data.kpis.impressions, "-"],
        ["CTR", `${data.kpis.ctr}%`, "Target: > 2%"],
        ["Avg Position", data.kpis.avgPosition.toFixed(1), "Target: < 10"],
        ["Site", data.site, "-"],
        ["Period", formatDateSpan(data.period.startDate, data.period.endDate), "-"],
      ]},
    ];
    if (ga4?.organic) secs.push({ title: "Organic (GA4)", headers: ["Metric", "Value", "Benchmark"], rows: [
      ["Organic Sessions", ga4.organic.sessions, "-"],
      ["Organic Orders", ga4.organic.purchases, "-"],
      ["Organic Revenue", inr(ga4.organic.revenue), "-"],
      ["Engagement Rate", `${ga4.organic.engagementRate}%`, "Target: > 55%"],
      ["Bounce Rate", `${ga4.organic.bounceRate}%`, "Lower is better"],
    ]});
    secs.push(
      { title: "Branded vs Non-branded", headers: ["Segment", "Clicks", "Impressions"], rows: [
        [`Branded (${data.branded.brandLabel})`, data.branded.brandedClicks, data.branded.brandedImpr],
        ["Non-branded", data.branded.nonBrandedClicks, data.branded.nonBrandedImpr],
      ]},
      { title: "Clicks by Position", headers: ["Position", "Clicks", "Impressions", "Keywords"], rows: data.positionBuckets.map(b => [b.label, b.clicks, b.impressions, b.keywords]) },
      { title: "Top Keywords", headers: ["Keyword", "Clicks", "Impressions", "CTR", "Position"], rows: data.keywords.map(k => [k.query, k.clicks, k.impressions, `${k.ctr}%`, k.position.toFixed(1)]) },
      { title: "Top Pages", headers: ["Page", "Clicks", "CTR", "Position"], rows: data.pages.map(p => [shortUrl(p.page), p.clicks, `${p.ctr}%`, p.position.toFixed(1)]) },
      { title: "Devices", headers: ["Device", "Clicks", "CTR"], rows: data.devices.map(d => [d.device, d.clicks, `${d.ctr}%`]) },
      { title: "Countries", headers: ["Country", "Clicks", "CTR"], rows: data.countries.map(c => [c.country, c.clicks, `${c.ctr}%`]) },
    );
    return secs;
  }

  if (loading) return <div className="text-[16px] text-[#A1A1AA] py-20 text-center">Loading SEO data…</div>;
  if (notConnected) return (
    <div className="text-center py-20">
      <Search size={32} className="text-[#A1A1AA] mx-auto mb-3" />
      <h2 className="text-[18px] font-bold mb-2 dark:text-[#F4F4F5]">Google Search Console not connected</h2>
      <Link href="/api/auth/google?service=gsc" className="px-5 py-2.5 bg-[#4285F4] text-white rounded-xl text-[15px] font-semibold">Connect Search Console →</Link>
    </div>
  );
  if (!data) return <div className="text-[16px] text-[#EF4444] py-8 text-center">Could not load SEO data.</div>;

  const k = data.kpis;
  const ctrGood = k.ctr >= 2;
  const posGood = k.avgPosition <= 10;
  const posWarn = k.avgPosition <= 20;
  const org = ga4?.organic ?? null;

  const topKeyword = data.keywords[0];
  const top10kws = data.keywords.filter(kw => kw.position <= 10).length;
  const highImpLowClick = data.keywords.filter(kw => kw.impressions > 100 && kw.ctr < 1).length;

  // CTR opportunity keywords - visible (high impressions) but under-clicked (low CTR), still close-ish to page 1.
  const opportunities = data.keywords
    .filter(kw => kw.impressions >= 100 && kw.ctr < 2)
    .map(kw => ({ ...kw, potential: Math.max(0, Math.round(kw.impressions * 0.03) - kw.clicks) }))
    .sort((a, b) => b.potential - a.potential)
    .slice(0, 8);

  // GA4 organic overlay on top pages, matched by normalized path.
  const gaMap = new Map((ga4?.organicLandingPages ?? []).map(l => [normPath(l.page), l]));

  // Branded split
  const b = data.branded;
  const brandedTotal = b.brandedClicks + b.nonBrandedClicks;

  // SEO → Revenue funnel stages (counts), scaled to impressions.
  const impr = k.impressions || 1;
  const funnel = [
    { label: "Impressions", value: k.impressions, color: "#94A3B8", sub: "" },
    { label: "Clicks", value: k.clicks, color: "#4285F4", sub: `${k.ctr}% CTR` },
    ...(org ? [
      { label: "Organic sessions", value: org.sessions, color: "#F97316", sub: k.clicks > 0 ? `${Math.round((org.sessions / k.clicks) * 100)}% of clicks` : "" },
      { label: "Organic orders", value: org.purchases, color: "#22C55E", sub: org.sessions > 0 ? `${((org.purchases / org.sessions) * 100).toFixed(1)}% CVR` : "" },
    ] : []),
  ];

  // Signals
  const workingSignals: { metric: string; value: string; detail: string }[] = [];
  const attentionSignals: { metric: string; value: string; detail: string; type: "warn" | "bad" }[] = [];

  if (ctrGood) workingSignals.push({ metric: "CTR", value: `${k.ctr}%`, detail: "Above the 2% benchmark - your titles and meta descriptions are compelling enough to earn clicks." });
  if (posGood) workingSignals.push({ metric: "Avg Position", value: k.avgPosition.toFixed(1), detail: "Top-10 rankings - your content is on page 1 for most queries." });
  if (top10kws > 0) workingSignals.push({ metric: "Page-1 Keywords", value: `${top10kws} keywords`, detail: `${top10kws} tracked keywords rank on page 1 - strong presence for these terms.` });
  if (org && org.revenue > 0) workingSignals.push({ metric: "Organic Revenue", value: inr(org.revenue), detail: `Search is driving real money - ${org.purchases} orders from organic visits, ${inr(org.revenue / Math.max(org.purchases, 1))} avg order.` });
  if (org && org.engagementRate >= 55) workingSignals.push({ metric: "Engagement", value: `${org.engagementRate}%`, detail: "Organic visitors are engaged - your landing pages match search intent well." });
  if (topKeyword) workingSignals.push({ metric: "Best Keyword", value: `"${topKeyword.query}"`, detail: `${topKeyword.clicks} clicks at position ${topKeyword.position.toFixed(1)} - your top organic traffic driver.` });

  if (!ctrGood) attentionSignals.push({ type: k.ctr < 1 ? "bad" : "warn", metric: "CTR", value: `${k.ctr}%`, detail: "Below the 2% target. Rewrite title tags with action words and search intent; add review/product schema to stand out." });
  if (!posWarn) attentionSignals.push({ type: "bad", metric: "Avg Position", value: k.avgPosition.toFixed(1), detail: "Beyond page 2. Focus link-building and on-page work on your top 5 keywords." });
  else if (!posGood) attentionSignals.push({ type: "warn", metric: "Avg Position", value: k.avgPosition.toFixed(1), detail: "Page-2 territory. Push the keywords closest to position 10 - small gains can double clicks." });
  if (highImpLowClick > 0) attentionSignals.push({ type: "warn", metric: "Impression Leak", value: `${highImpLowClick} keywords`, detail: `${highImpLowClick} keywords get 100+ impressions but under 1% CTR - you're seen, not clicked. Rewrite their titles/meta.` });
  if (brandedTotal > 0 && (b.nonBrandedClicks / brandedTotal) < 0.4) attentionSignals.push({ type: "warn", metric: "Brand Dependence", value: `${Math.round((b.brandedClicks / brandedTotal) * 100)}% branded`, detail: "Most clicks come from people already searching your name. Build non-branded content to capture new demand." });
  if (org && org.engagementRate > 0 && org.engagementRate < 45) attentionSignals.push({ type: "warn", metric: "Organic Engagement", value: `${org.engagementRate}%`, detail: "Search visitors leave quickly - landing pages may not match what they searched for. Align content to query intent." });

  const monthlyChart = monthly.map(m => ({ label: m.label.replace(/ \d{4}$/, ""), Clicks: m.clicks, Impressions: m.impressions }));
  const maxBucket = Math.max(1, ...data.positionBuckets.map(x => x.clicks));
  const maxCountry = Math.max(1, ...data.countries.map(c => c.clicks));
  const ctrGaugeVal = Math.min(100, (k.ctr / 2) * 100);
  const posGaugeVal = Math.max(0, Math.min(100, ((11 - k.avgPosition) / 10) * 100));

  return (
    <>
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 bg-[#4285F4] rounded-lg flex items-center justify-center"><Search size={14} className="text-white" /></div>
            <h1 className="text-xl font-bold text-[#18181B] dark:text-[#F4F4F5]">SEO Report</h1>
          </div>
          <p className="text-[14px] text-[#A1A1AA] ml-9">{data.site} · {rangeText(range)} · GSC + GA4 · Generated {generatedAt}</p>
        </div>
        <div data-html2canvas-ignore="true">
          <ExportButton
            onExportCSV={() => exportToCSV(`skylitee-seo-report-${range.from}`, buildSections())}
            onExportPDF={() => printRef.current ? exportElementToPDF(printRef.current, `skylitee-seo-report-${range.from}`, {
              reportTitle: "SEO Report",
              subtitle: `${data.site} · ${rangeText(range)}`,
              branding: { brandName: "Skylitee", color: "#4285F4" },
            }) : Promise.resolve()}
          />
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total Clicks", value: k.clicks.toLocaleString("en-IN"), icon: <MousePointerClick size={14} className="text-[#4285F4]" /> },
          { label: "Impressions", value: k.impressions.toLocaleString("en-IN"), icon: <Eye size={14} className="text-[#A1A1AA]" /> },
          { label: "Organic Sessions", value: org ? org.sessions.toLocaleString("en-IN") : "-", icon: <Users size={14} className="text-[#F97316]" /> },
          { label: "Organic Revenue", value: org ? inr(org.revenue) : "-", icon: <IndianRupee size={14} className="text-[#22C55E]" /> },
        ].map(item => (
          <div key={item.label} className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-4">
            <div className="flex items-center gap-1.5 mb-2">{item.icon}<span className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide">{item.label}</span></div>
            <div className="text-[22px] font-black text-[#18181B] dark:text-[#F4F4F5]">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Search quality gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader title="Click-through Rate" right="target 2%" />
          <Gauge value={ctrGaugeVal} color={ctrGood ? "#22C55E" : k.ctr >= 1 ? "#EAB308" : "#EF4444"} centerValue={`${k.ctr}%`} centerLabel={ctrGood ? "above target" : "below target"} />
        </Card>
        <Card>
          <CardHeader title="Avg Position" right="page 1 = ≤10" />
          <Gauge value={posGaugeVal} color={posGood ? "#22C55E" : posWarn ? "#EAB308" : "#EF4444"} centerValue={k.avgPosition.toFixed(1)} centerLabel={posGood ? "page 1" : posWarn ? "page 2" : "beyond p2"} />
        </Card>
        <Card>
          <CardHeader title="Organic Engagement" right="GA4 · target 55%" />
          {org ? <Gauge value={org.engagementRate} color={org.engagementRate >= 55 ? "#22C55E" : org.engagementRate >= 40 ? "#EAB308" : "#EF4444"} centerValue={`${org.engagementRate}%`} centerLabel="engaged sessions" />
            : <div className="text-[13px] text-[#A1A1AA] text-center py-8">Connect GA4 for engagement</div>}
        </Card>
      </div>

      {/* SEO → Revenue funnel */}
      <Card>
        <CardHeader title="🔎 SEO → Revenue Funnel" right="GSC → GA4 organic" />
        <div className="space-y-3">
          {funnel.map(f => (
            <PoleBar key={f.label} label={f.label} value={f.value.toLocaleString("en-IN")} sub={f.sub} pct={(f.value / impr) * 100} color={f.color} />
          ))}
          {org ? (
            <div className="flex items-center justify-between rounded-xl border border-[#86EFAC] dark:border-[#166534] bg-[#F0FDF4] dark:bg-[#052E16]/40 px-4 py-3 mt-1">
              <span className="text-[14px] font-bold text-[#166534] dark:text-[#4ADE80]">Organic Revenue</span>
              <span className="text-[18px] font-black text-[#166534] dark:text-[#4ADE80]">{inr(org.revenue)} <span className="text-[12px] font-medium text-[#16A34A]">· {inr(org.revenue / Math.max(org.purchases, 1))} AOV</span></span>
            </div>
          ) : (
            <div className="text-[13px] text-[#A1A1AA] mt-1 flex items-center gap-2"><Filter size={13} /> Connect GA4 to extend the funnel to organic sessions, orders & revenue.</div>
          )}
        </div>
      </Card>

      {/* Trend + Branded split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader title="6-Month Trend" right="clicks vs impressions" />
          {monthlyChart.length >= 2 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={monthlyChart} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" strokeOpacity={0.5} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="l" tick={{ fontSize: 11, fill: "#A1A1AA" }} tickLine={false} axisLine={false} width={40} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "#A1A1AA" }} tickLine={false} axisLine={false} width={44} />
                <Tooltip contentStyle={{ fontSize: 13, borderRadius: 12, border: "1px solid #E5E5E5" }} />
                <Line yAxisId="l" type="monotone" dataKey="Clicks" stroke="#4285F4" strokeWidth={2.5} dot={false} />
                <Line yAxisId="r" type="monotone" dataKey="Impressions" stroke="#F97316" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="text-[13px] text-[#A1A1AA] py-16 text-center">Not enough history yet.</div>}
        </Card>
        <Card>
          <CardHeader title="Branded vs Non-branded" right={b.brandLabel ? `brand: ${b.brandLabel}` : undefined} />
          <Donut
            segments={[
              { label: "Non-branded (new demand)", value: b.nonBrandedClicks, color: "#F97316" },
              { label: "Branded (existing demand)", value: b.brandedClicks, color: "#3B82F6" },
            ]}
            centerValue={brandedTotal > 0 ? `${Math.round((b.nonBrandedClicks / brandedTotal) * 100)}%` : "-"}
            centerLabel="non-branded"
          />
          <p className="text-[13px] text-[#A1A1AA] mt-3 leading-relaxed">Non-branded clicks are <strong>new customers discovering you</strong>; branded clicks are people already looking for your name.</p>
        </Card>
      </div>

      {/* Month-wise progress tables */}
      {(monthly.length >= 2 || ga4Monthly.length >= 2) && (
        <p className="text-[13px] text-[#A1A1AA] -mb-1">Month-wise progress · <span className="text-[#16A34A] font-semibold">green</span> = improved vs prior month, <span className="text-[#DC2626] font-semibold">red</span> = declined (Avg Position &amp; Bounce Rate inverted - lower is better). Latest month may be partial.</p>
      )}
      {monthly.length >= 2 && (
        <Card>
          <CardHeader title="Search Console - Month-wise" right={`last ${monthly.length} months`} />
          <MonthwiseTable headers={monthly.map(m => m.label)} rows={buildGscRows(monthly)} />
        </Card>
      )}
      {ga4Monthly.length >= 2 && (
        <Card>
          <CardHeader title="Analytics - Month-wise" right={`last ${ga4Monthly.length} months`} />
          <MonthwiseTable headers={ga4Monthly.map(m => m.label)} rows={buildGa4Rows(ga4Monthly)} />
        </Card>
      )}

      {/* Signals */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader title="✅ What's Working" />
          <div className="space-y-2">
            {workingSignals.length === 0 ? <p className="text-[15px] text-[#A1A1AA]">Build traffic first.</p>
              : workingSignals.map((s, i) => <SignalCard key={i} type="good" metric={s.metric} value={s.value} detail={s.detail} />)}
          </div>
        </Card>
        <Card>
          <CardHeader title="⚠️ Needs Attention" />
          <div className="space-y-2">
            {attentionSignals.length === 0 ? <p className="text-[15px] text-[#A1A1AA]">No major issues detected.</p>
              : attentionSignals.map((s, i) => <SignalCard key={i} type={s.type} metric={s.metric} value={s.value} detail={s.detail} />)}
          </div>
        </Card>
      </div>

      {/* Position buckets + Devices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader title="Clicks by Ranking Position" right="where traffic comes from" />
          <div className="space-y-3 mt-1">
            {data.positionBuckets.map((bk, i) => (
              <PoleBar key={bk.label} label={`Position ${bk.label}`} value={bk.clicks.toLocaleString("en-IN")} sub={`${bk.keywords} kw`} pct={(bk.clicks / maxBucket) * 100} color={["#22C55E", "#84CC16", "#EAB308", "#94A3B8"][i] ?? "#94A3B8"} />
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Devices" />
          <Donut
            segments={data.devices.map((d, i) => ({ label: d.device, value: d.clicks, color: ["#3B82F6", "#F97316", "#22C55E", "#8B5CF6"][i] ?? "#94A3B8" }))}
            centerValue={k.clicks.toLocaleString("en-IN")}
            centerLabel="clicks"
          />
        </Card>
      </div>

      {/* CTR Opportunities */}
      {opportunities.length > 0 && (
        <Card>
          <CardHeader title="🎯 CTR Opportunities" right="high impressions · low CTR" />
          <p className="text-[13px] text-[#A1A1AA] mb-2">Keywords where you're already visible but under-clicked. Rewriting titles/meta to a 3% CTR could win the extra clicks shown.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead><tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                {["Keyword", "Impressions", "CTR", "Position", "Potential +clicks"].map(h => <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>)}
              </tr></thead>
              <tbody>
                {opportunities.map((kw, i) => (
                  <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                    <td className="py-2 px-2 font-medium text-[#18181B] dark:text-[#F4F4F5]">{kw.query}</td>
                    <td className="py-2 px-2 text-[#A1A1AA]">{kw.impressions.toLocaleString("en-IN")}</td>
                    <td className="py-2 px-2"><span className="font-bold text-[#EAB308]">{kw.ctr}%</span></td>
                    <td className="py-2 px-2 text-[#A1A1AA]">{kw.position.toFixed(1)}</td>
                    <td className="py-2 px-2 font-bold text-[#22C55E]">+{kw.potential}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Top Keywords */}
      <Card>
        <CardHeader title="Top Keywords" right={`${data.keywords.length} total`} />
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead><tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
              {["Keyword", "Clicks", "Impressions", "CTR", "Position"].map(h => <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>)}
            </tr></thead>
            <tbody>
              {data.keywords.slice(0, 20).map((kw, i) => (
                <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                  <td className="py-2 px-2 font-medium text-[#18181B] dark:text-[#F4F4F5]">{kw.query}</td>
                  <td className="py-2 px-2 font-bold text-[#4285F4]">{kw.clicks}</td>
                  <td className="py-2 px-2 text-[#A1A1AA]">{kw.impressions.toLocaleString("en-IN")}</td>
                  <td className="py-2 px-2"><span className={cn("font-bold", kw.ctr >= 2 ? "text-[#22C55E]" : kw.ctr >= 1 ? "text-[#EAB308]" : "text-[#EF4444]")}>{kw.ctr}%</span></td>
                  <td className="py-2 px-2"><span className={cn("px-2 py-0.5 rounded-full text-[12px] font-bold", kw.position <= 10 ? "bg-[#F0FDF4] text-[#166534] dark:bg-[#052E16] dark:text-[#4ADE80]" : kw.position <= 20 ? "bg-[#FFFBEB] text-[#92400E] dark:bg-[#2D1C00] dark:text-[#FCD34D]" : "bg-[#F5F5F4] text-[#71717A] dark:bg-[#262626]")}>{kw.position.toFixed(1)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Top Pages with GA4 overlay */}
      <Card>
        <CardHeader title="Top Pages" right={ga4?.organicLandingPages?.length ? "GSC + GA4 organic" : `${data.pages.length} pages`} />
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead><tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
              {["Page", "Clicks", "CTR", "Position", "Org. sessions", "Bounce", "Orders"].map(h => <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>)}
            </tr></thead>
            <tbody>
              {data.pages.slice(0, 15).map((p, i) => {
                const ga = gaMap.get(normPath(shortUrl(p.page)));
                return (
                  <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                    <td className="py-2 px-2 font-medium text-[#18181B] dark:text-[#F4F4F5] max-w-[240px]"><div className="truncate">{shortUrl(p.page)}</div></td>
                    <td className="py-2 px-2 font-bold text-[#4285F4]">{p.clicks}</td>
                    <td className="py-2 px-2 font-semibold">{p.ctr}%</td>
                    <td className="py-2 px-2 text-[#A1A1AA]">{p.position.toFixed(1)}</td>
                    <td className="py-2 px-2 font-semibold text-[#F97316]">{ga ? ga.sessions.toLocaleString("en-IN") : "-"}</td>
                    <td className="py-2 px-2 text-[#A1A1AA]">{ga ? `${ga.bounceRate}%` : "-"}</td>
                    <td className="py-2 px-2 font-bold text-[#22C55E]">{ga && ga.purchases > 0 ? ga.purchases : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!ga4?.organic && <p className="text-[12px] text-[#A1A1AA] mt-2 flex items-center gap-1.5"><Filter size={12} /> Connect GA4 to fill the organic sessions, bounce & orders columns.</p>}
      </Card>

      {/* Countries + Organic snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader title="Top Countries" />
          <div className="space-y-2.5 mt-1">
            {data.countries.slice(0, 8).map((c, i) => (
              <PoleBar key={i} label={c.country} value={c.clicks.toLocaleString("en-IN")} sub={`${c.ctr}% CTR`} pct={(c.clicks / maxCountry) * 100} color="#4285F4" />
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Organic Snapshot" right="GA4" />
          {org ? (
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Organic users", value: org.users.toLocaleString("en-IN"), color: "text-[#F97316]" },
                { label: "Avg session", value: `${Math.floor(org.avgSessionSec / 60)}m ${org.avgSessionSec % 60}s`, color: "text-[#3B82F6]" },
                { label: "Engagement", value: `${org.engagementRate}%`, color: org.engagementRate >= 55 ? "text-[#22C55E]" : "text-[#EAB308]" },
                { label: "Bounce rate", value: `${org.bounceRate}%`, color: "text-[#8B5CF6]" },
                { label: "Organic orders", value: org.purchases.toLocaleString("en-IN"), color: "text-[#22C55E]" },
                { label: "Conv. rate", value: org.sessions > 0 ? `${((org.purchases / org.sessions) * 100).toFixed(2)}%` : "-", color: "text-[#EC4899]" },
              ].map(s => (
                <div key={s.label} className="rounded-xl bg-[#FAFAF9] dark:bg-[#1C1C1C] p-3">
                  <div className="text-[13px] text-[#A1A1AA] mb-1">{s.label}</div>
                  <div className={cn("text-[18px] font-black", s.color)}>{s.value}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-[14px] text-[#A1A1AA] mb-3">Connect Google Analytics to see what organic visitors do after they click.</p>
              <Link href="/api/auth/google?service=ga4" className="px-4 py-2 bg-[#F97316] text-white rounded-xl text-[14px] font-semibold">Connect GA4 →</Link>
            </div>
          )}
        </Card>
      </div>

      <p className="text-[12px] text-[#A1A1AA] text-center pt-2">GSC reflects Google Search (≈3-day lag, Pacific Time). GA4 organic = Organic Search channel only. Branded split inferred from the &quot;{b.brandLabel}&quot; domain term.</p>
    </div>

    {/* Off-screen, PDF-optimized layout - captured for the PDF export (bigger fonts, color, dense). */}
    <div ref={printRef} aria-hidden style={{ position: "absolute", left: -10000, top: 0, pointerEvents: "none" }}>
      <PrintableSEO data={data} ga4={ga4} monthly={monthly} ga4Monthly={ga4Monthly} site={data.site} rangeLabel={rangeText(range)} generatedAt={generatedAt} />
    </div>
    </>
  );
}
