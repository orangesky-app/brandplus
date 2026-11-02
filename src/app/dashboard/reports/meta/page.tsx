"use client";
import { useEffect, useState } from "react";
import { useDateRange, rangeText } from "@/lib/date-range-context";
import { Card, CardHeader } from "@/components/ui/card";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF } from "@/lib/export";
import { formatINR, cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, BarChart3, Target, TrendingUp, Eye } from "lucide-react";
import Link from "next/link";

interface MetaKPIs {
  spend: number; roas: number; cac: number; purchases: number; purchaseValue: number;
  impressions: number; reach: number; frequency: number; cpm: number;
  clicks: number; ctr: number; cpc: number;
  atc: number; atcRatio: number;
  checkout: number; checkoutRatio: number;
  purchaseRatio: number;
}

interface MetaData {
  adAccountName: string;
  period: { from: string; to: string };
  kpis: MetaKPIs;
  campaigns: {
    id: string; name: string; status: string; objective: string;
    spend: number; impressions: number; clicks: number; ctr: number;
    cpc: number; purchases: number; purchaseValue: number; roas: number; atc: number;
  }[];
  daily: { date: string; spend: number; purchases: number; purchaseValue: number }[];
}

function Signal({ type, metric, value, detail }: { type: "good" | "warn" | "bad"; metric: string; value: string; detail: string }) {
  const s = {
    good: { bg: "bg-[#F0FDF4] dark:bg-[#052E16]/40 border-[#86EFAC]", icon: <CheckCircle2 size={14} className="text-[#16A34A] shrink-0 mt-0.5" />, label: "text-[#166534] dark:text-[#4ADE80]" },
    warn: { bg: "bg-[#FFFBEB] dark:bg-[#2D1C00]/40 border-[#FCD34D]", icon: <AlertTriangle size={14} className="text-[#D97706] shrink-0 mt-0.5" />, label: "text-[#92400E] dark:text-[#FCD34D]" },
    bad:  { bg: "bg-[#FEF2F2] dark:bg-[#2D0A0A]/40 border-[#FCA5A5]", icon: <XCircle size={14} className="text-[#DC2626] shrink-0 mt-0.5" />, label: "text-[#991B1B] dark:text-[#FCA5A5]" },
  }[type];
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-3", s.bg)}>
      {s.icon}
      <div>
        <div className={cn("text-[14px] font-bold", s.label)}>{metric}: {value}</div>
        <div className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] mt-0.5 leading-relaxed">{detail}</div>
      </div>
    </div>
  );
}

export default function MetaReportPage() {
  const { range } = useDateRange();
  const [data, setData] = useState<MetaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notConnected, setNotConnected] = useState(false);
  const generatedAt = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    setLoading(true);
    fetch(`/api/meta?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then(d => {
        if (d.error === "not_connected") { setNotConnected(true); return; }
        if (!d.error) setData(d);
      })
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  function buildSections() {
    if (!data) return [];
    const k = data.kpis;
    return [
      { title: "Meta Ads KPIs", headers: ["Metric", "Value", "Benchmark"], rows: [
        ["Ad Spend", formatINR(k.spend), "-"],
        ["ROAS", `${k.roas}x`, "Target: > 3x"],
        ["Purchases", k.purchases, "-"],
        ["Purchase Revenue", formatINR(k.purchaseValue), "-"],
        ["CAC", formatINR(k.cac), "-"],
        ["Impressions", k.impressions.toLocaleString("en-IN"), "-"],
        ["Reach", k.reach.toLocaleString("en-IN"), "-"],
        ["Frequency", k.frequency.toFixed(2), "Target: < 3"],
        ["Clicks", k.clicks.toLocaleString("en-IN"), "-"],
        ["CTR", `${k.ctr}%`, "Target: > 1%"],
        ["CPC", formatINR(k.cpc), "-"],
        ["CPM", formatINR(k.cpm), "-"],
        ["Add to Cart", k.atc, "-"],
        ["ATC Rate", `${k.atcRatio}%`, "Target: > 30%"],
        ["Checkout", k.checkout, "-"],
        ["Checkout Rate", `${k.checkoutRatio}%`, "Target: > 40%"],
        ["Purchase Rate", `${k.purchaseRatio}%`, "-"],
      ]},
      { title: "Campaigns", headers: ["Campaign", "Status", "Objective", "Spend", "ROAS", "Orders", "CTR"], rows:
        data.campaigns.map(c => [c.name, c.status, c.objective, formatINR(c.spend), `${c.roas}x`, c.purchases, `${c.ctr}%`])
      },
      { title: "Daily Trend", headers: ["Date", "Spend", "Purchases", "Revenue"], rows:
        data.daily.map(d => [d.date, formatINR(d.spend), d.purchases, formatINR(d.purchaseValue)])
      },
    ];
  }

  if (loading) return <div className="text-[16px] text-[#A1A1AA] py-20 text-center">Loading Meta Ads data…</div>;
  if (notConnected) return (
    <div className="text-center py-20">
      <BarChart3 size={32} className="text-[#A1A1AA] mx-auto mb-3" />
      <h2 className="text-[18px] font-bold mb-2 dark:text-[#F4F4F5]">Meta Ads not connected</h2>
      <Link href="/dashboard/connections" className="px-5 py-2.5 bg-[#1877F2] text-white rounded-xl text-[15px] font-semibold">Connect Meta Ads →</Link>
    </div>
  );
  if (!data) return <div className="text-[16px] text-[#EF4444] py-8 text-center">Could not load Meta Ads data.</div>;

  const k = data.kpis;

  const working: { metric: string; value: string; detail: string }[] = [];
  const attention: { type: "warn" | "bad"; metric: string; value: string; detail: string }[] = [];

  if (k.roas >= 3) working.push({ metric: "ROAS", value: `${k.roas}x`, detail: "Above the 3x profitability benchmark - campaigns are generating strong returns and are eligible for budget scaling." });
  else if (k.roas >= 2) working.push({ metric: "ROAS", value: `${k.roas}x`, detail: "Between 2–3x - ads are profitable. Optimise creative and audience to push past 3x before scaling spend." });
  if (k.ctr >= 1) working.push({ metric: "CTR", value: `${k.ctr}%`, detail: "Strong click-through rate - your ad creatives and copy are resonating with your target audience." });
  if (k.atcRatio >= 30) working.push({ metric: "ATC Rate", value: `${k.atcRatio}%`, detail: "Good add-to-cart signal from landing pages - product pages are converting interest into intent." });
  if (k.frequency < 3) working.push({ metric: "Frequency", value: k.frequency.toFixed(2), detail: "Healthy ad frequency - your audience is not being over-exposed. Creative fatigue risk is low." });
  if (k.purchases > 0) working.push({ metric: "Purchases", value: k.purchases.toString(), detail: `${k.purchases} Meta-attributed purchases generating ${formatINR(k.purchaseValue)} in revenue from ${formatINR(k.spend)} spend.` });

  if (k.roas < 2) attention.push({ type: "bad", metric: "ROAS", value: `${k.roas}x`, detail: "Below 2x - ads are not profitable. Pause low-performing campaigns, refresh creatives, and narrow audience targeting." });
  if (k.ctr < 1) attention.push({ type: "warn", metric: "CTR", value: `${k.ctr}%`, detail: "Low click-through rate - ad creative or copy may not be resonating. Test new hooks, angles, and formats." });
  if (k.frequency >= 3) attention.push({ type: "warn", metric: "Frequency", value: k.frequency.toFixed(2), detail: "High frequency - your audience is seeing ads too often. Expand audience size or refresh creatives to prevent fatigue." });
  if (k.atcRatio < 20) attention.push({ type: "warn", metric: "ATC Rate", value: `${k.atcRatio}%`, detail: "Low add-to-cart rate from ad traffic - landing pages may have friction. Improve hero image, CTA, and social proof." });
  if (k.checkoutRatio < 40) attention.push({ type: "warn", metric: "Checkout Drop-off", value: `${k.checkoutRatio}%`, detail: "Many shoppers add to cart but don't proceed to checkout. Show total cost upfront and offer COD/EMI options." });

  const activeCampaigns = data.campaigns.filter(c => c.status === "ACTIVE");
  const topCampaign = [...data.campaigns].sort((a, b) => b.roas - a.roas)[0];
  const totalDailySpend = data.daily.reduce((s, d) => s + d.spend, 0);
  const avgDailySpend = data.daily.length ? totalDailySpend / data.daily.length : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 bg-[#1877F2] rounded-lg flex items-center justify-center"><BarChart3 size={14} className="text-white" /></div>
            <h1 className="text-xl font-bold text-[#18181B] dark:text-[#F4F4F5]">Meta Ads Report</h1>
          </div>
          <p className="text-[14px] text-[#A1A1AA] ml-9">{data.adAccountName} · {rangeText(range)} · Generated {generatedAt}</p>
        </div>
        <ExportButton
          onExportCSV={() => exportToCSV(`skylitee-meta-report-${range.from}`, buildSections())}
          onExportPDF={() => exportToPDF(`skylitee-meta-report-${range.from}`, "Meta Ads Report", `${data.adAccountName} · ${rangeText(range)}`, buildSections())}
        />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Ad Spend", value: formatINR(k.spend), icon: <Target size={13} className="text-[#1877F2]" /> },
          { label: "ROAS", value: `${k.roas}x`, icon: <TrendingUp size={13} className={k.roas >= 3 ? "text-[#22C55E]" : k.roas >= 2 ? "text-[#EAB308]" : "text-[#EF4444]"} /> },
          { label: "Purchases", value: k.purchases.toLocaleString("en-IN"), icon: <BarChart3 size={13} className="text-[#1877F2]" /> },
          { label: "CTR", value: `${k.ctr}%`, icon: <Eye size={13} className={k.ctr >= 1 ? "text-[#22C55E]" : "text-[#EF4444]"} /> },
        ].map(item => (
          <div key={item.label} className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-4">
            <div className="flex items-center gap-1.5 mb-2">{item.icon}<span className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide">{item.label}</span></div>
            <div className="text-[22px] font-black text-[#18181B] dark:text-[#F4F4F5]">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Signals */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader title="✅ What's Working" />
          <div className="space-y-2">
            {working.length === 0
              ? <p className="text-[15px] text-[#A1A1AA]">No strong signals yet - run campaigns to generate data.</p>
              : working.map((s, i) => <Signal key={i} type="good" {...s} />)}
          </div>
        </Card>
        <Card>
          <CardHeader title="⚠️ Needs Attention" />
          <div className="space-y-2">
            {attention.length === 0
              ? <p className="text-[15px] text-[#A1A1AA]">No major issues detected.</p>
              : attention.map((s, i) => <Signal key={i} {...s} />)}
          </div>
        </Card>
      </div>

      {/* Ad Funnel */}
      <Card>
        <CardHeader title="Ad Funnel" right="Impressions → Purchase" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Impressions", value: k.impressions.toLocaleString("en-IN"), color: "#6366F1", sub: `Reach: ${k.reach.toLocaleString("en-IN")}` },
            { label: "Clicks", value: k.clicks.toLocaleString("en-IN"), color: "#1877F2", sub: `CTR: ${k.ctr}%` },
            { label: "Add to Cart", value: k.atc.toLocaleString("en-IN"), color: "#EAB308", sub: `Rate: ${k.atcRatio}%` },
            { label: "Purchases", value: k.purchases.toLocaleString("en-IN"), color: "#22C55E", sub: formatINR(k.purchaseValue) },
          ].map(step => (
            <div key={step.label} className="bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-3 text-center">
              <div className="text-[13px] font-bold text-[#A1A1AA] uppercase mb-1">{step.label}</div>
              <div className="text-[20px] font-black" style={{ color: step.color }}>{step.value}</div>
              <div className="text-[13px] text-[#71717A] mt-0.5">{step.sub}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[
            { label: "Frequency", value: k.frequency.toFixed(2), warn: k.frequency > 3 },
            { label: "CPM", value: formatINR(k.cpm), warn: false },
            { label: "CPC", value: formatINR(k.cpc), warn: false },
          ].map(item => (
            <div key={item.label} className={cn("rounded-xl p-3 border text-center", item.warn ? "bg-[#FFFBEB] border-[#FCD34D]" : "bg-[#F5F5F4] dark:bg-[#1C1C1C] border-transparent")}>
              <div className="text-[13px] font-bold text-[#A1A1AA] uppercase mb-1">{item.label}</div>
              <div className={cn("text-[18px] font-black", item.warn ? "text-[#92400E] dark:text-[#FCD34D]" : "text-[#18181B] dark:text-[#F4F4F5]")}>{item.value}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Summary stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-4">
          <div className="text-[13px] font-bold text-[#A1A1AA] uppercase mb-1">Active Campaigns</div>
          <div className="text-[28px] font-black text-[#1877F2]">{activeCampaigns.length}</div>
          <div className="text-[14px] text-[#A1A1AA] mt-0.5">of {data.campaigns.length} total</div>
        </div>
        <div className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-4">
          <div className="text-[13px] font-bold text-[#A1A1AA] uppercase mb-1">Best Campaign</div>
          {topCampaign ? <>
            <div className="text-[16px] font-black text-[#18181B] dark:text-[#F4F4F5] leading-tight truncate">{topCampaign.name}</div>
            <div className="text-[14px] text-[#22C55E] font-bold mt-0.5">{topCampaign.roas}x ROAS · {formatINR(topCampaign.spend)} spend</div>
          </> : <div className="text-[15px] text-[#A1A1AA]">No campaigns</div>}
        </div>
        <div className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-4">
          <div className="text-[13px] font-bold text-[#A1A1AA] uppercase mb-1">Avg Daily Spend</div>
          <div className="text-[28px] font-black text-[#18181B] dark:text-[#F4F4F5]">{formatINR(Math.round(avgDailySpend))}</div>
          <div className="text-[14px] text-[#A1A1AA] mt-0.5">over {data.daily.length} days</div>
        </div>
      </div>

      {/* Campaigns table */}
      {data.campaigns.length > 0 && (
        <Card>
          <CardHeader title="Campaign Performance" right={`${data.campaigns.length} campaigns`} />
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                  {["Campaign", "Status", "Spend", "ROAS", "Orders", "Revenue", "CTR"].map(h => (
                    <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...data.campaigns].sort((a, b) => b.roas - a.roas).map((c, i) => (
                  <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                    <td className="py-2 px-2 font-medium dark:text-[#F4F4F5] max-w-[200px]"><div className="truncate">{c.name}</div></td>
                    <td className="py-2 px-2">
                      <span className={cn("px-2 py-0.5 rounded-full text-[12px] font-bold", c.status === "ACTIVE" ? "bg-[#FFF7ED] text-[#EA580C]" : "bg-[#F5F5F4] text-[#71717A]")}>{c.status}</span>
                    </td>
                    <td className="py-2 px-2 font-semibold">{formatINR(c.spend)}</td>
                    <td className="py-2 px-2">
                      <span className={cn("font-black", c.roas >= 3 ? "text-[#22C55E]" : c.roas >= 2 ? "text-[#EAB308]" : "text-[#EF4444]")}>{c.roas}x</span>
                    </td>
                    <td className="py-2 px-2">{c.purchases}</td>
                    <td className="py-2 px-2 font-semibold">{formatINR(c.purchaseValue)}</td>
                    <td className="py-2 px-2 text-[#A1A1AA]">{c.ctr}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
