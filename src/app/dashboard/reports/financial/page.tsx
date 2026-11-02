"use client";
import { useEffect, useState } from "react";
import { useDateRange, rangeDays, rangeText } from "@/lib/date-range-context";
import { RangeText } from "@/components/ui/period";
import { fetchGoogleAds, gadsIssueText, type GadsData, type GadsIssue } from "@/lib/gads-client";
import { Card, CardHeader } from "@/components/ui/card";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF } from "@/lib/export";
import { formatINR, cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, DollarSign, ShoppingCart, TrendingUp, Info } from "lucide-react";
import Link from "next/link";

interface SalesData {
  kpis: {
    grossSales: number; totalOrders: number; aov: number;
    newCustomers: number; returningCustomers: number;
    codOrders: number; prepaidOrders: number;
  };
  allBySku: { name: string; qty: number; revenue: number }[];
  topCities: { city: string; orders: number; revenue: number }[];
  recentOrders: { name: string; total: number; status: string; gateway: string; city: string; isCod: boolean; date: string }[];
}

interface MetaData {
  kpis: { spend: number; roas: number; purchases: number; purchaseValue: number; cac: number };
  campaigns: { name: string; status: string; spend: number; roas: number; purchases: number }[];
}

function Signal({ type, metric, value, detail }: { type: "good" | "warn"; metric: string; value: string; detail: string }) {
  const s = {
    good: { bg: "bg-[#F0FDF4] dark:bg-[#052E16]/40 border-[#86EFAC]", icon: <CheckCircle2 size={14} className="text-[#16A34A] shrink-0 mt-0.5" />, label: "text-[#166534] dark:text-[#4ADE80]" },
    warn: { bg: "bg-[#FFFBEB] dark:bg-[#2D1C00]/40 border-[#FCD34D]", icon: <AlertTriangle size={14} className="text-[#D97706] shrink-0 mt-0.5" />, label: "text-[#92400E] dark:text-[#FCD34D]" },
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

export default function FinancialReportPage() {
  const { range } = useDateRange();
  const [sales, setSales] = useState<SalesData | null>(null);
  const [meta, setMeta] = useState<MetaData | null>(null);
  const [gads, setGads] = useState<GadsData | null>(null);
  const [gadsIssue, setGadsIssue] = useState<GadsIssue | null>(null);
  const [loading, setLoading] = useState(true);
  const generatedAt = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setSales(null); setMeta(null); setGads(null); setGadsIssue(null);
    Promise.allSettled([
      fetch(`/api/shopify/sales?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/meta?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetchGoogleAds(range.from, range.to),
    ]).then(([sR, mR, gR]) => {
      if (stale) return;
      if (sR.status === "fulfilled" && !sR.value?.error) setSales(sR.value);
      if (mR.status === "fulfilled" && !mR.value?.error) setMeta(mR.value);
      if (gR.status === "fulfilled") { setGads(gR.value.data); setGadsIssue(gR.value.issue); }
    }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [range.from, range.to]);

  if (loading) return <div className="text-[16px] text-[#A1A1AA] py-20 text-center">Loading financial data…</div>;
  if (!sales) return (
    <div className="text-center py-16">
      <p className="text-[16px] text-[#71717A] mb-3">Could not load financial data.</p>
      <Link href="/dashboard/connections" className="text-[#16A34A] font-semibold text-[15px]">Check Shopify connection →</Link>
    </div>
  );

  const s = sales.kpis;
  const m = meta?.kpis;
  const g = gads?.kpis;
  const adSpend = (m?.spend ?? 0) + (g?.spend ?? 0);
  const netRevenue = s.grossSales - adSpend;
  const codPct = s.totalOrders ? Math.round((s.codOrders / s.totalOrders) * 100) : 0;
  const metaRevenue = m?.purchaseValue ?? 0;
  const googleRevenue = g?.conversionValue ?? 0;
  const googleOrders = Math.round(g?.conversions ?? 0);
  const organicRevenue = Math.max(0, s.grossSales - metaRevenue - googleRevenue);
  const organicOrders = Math.max(0, s.totalOrders - (m?.purchases ?? 0) - googleOrders);
  const days = rangeDays(range);
  const dailyRevenue = s.grossSales / days;
  const dailySpend = adSpend / days;

  const working: { metric: string; value: string; detail: string }[] = [];
  const attention: { metric: string; value: string; detail: string }[] = [];

  if (s.grossSales > 0) working.push({ metric: "Gross Revenue", value: formatINR(s.grossSales), detail: `${s.totalOrders} orders at ${formatINR(s.aov)} AOV - revenue engine is active. Avg daily revenue: ${formatINR(Math.round(dailyRevenue))}.` });
  if (m?.roas && m.roas >= 3) working.push({ metric: "Ad ROAS", value: `${m.roas}x`, detail: "Meta ads return more than 3x spend - ad investment is profitable. Safe to scale budget." });
  if (g && googleRevenue > 0 && g.roas >= 3) working.push({ metric: "Google Ads ROAS", value: `${g.roas}x`, detail: "Google Ads returns more than 3x spend by its own tracking. Worth testing more budget on the best campaign." });
  if (s.returningCustomers > 0) working.push({ metric: "Returning Customers", value: s.returningCustomers.toString(), detail: `${s.returningCustomers} repeat buyers - organic repeat revenue with zero acquisition cost.` });
  if (codPct < 40) working.push({ metric: "Prepaid Rate", value: `${100 - codPct}%`, detail: "Majority of orders are prepaid - faster cash collection and lower RTO-related losses." });

  if (codPct > 50) attention.push({ metric: "COD Rate", value: `${codPct}%`, detail: "More than half your orders are COD - ties up cash and risks RTO losses. Offer Rs.75 prepaid discount to shift preference." });
  if (m && m.roas < 2) attention.push({ metric: "Ad ROAS", value: `${m.roas}x`, detail: "Below 2x - spending more on ads than the revenue they generate. Pause underperforming campaigns immediately." });
  if (g && googleRevenue > 0 && g.roas < 2) attention.push({ metric: "Google Ads ROAS", value: `${g.roas}x`, detail: "Below 2x by Google's own tracking, which usually loses money once product costs are paid. Fix or pause the weakest campaigns." });
  if (g && g.spend >= 500 && g.conversions === 0) attention.push({ metric: "Google Ads Conversions", value: "0", detail: `${formatINR(g.spend)} spent with nothing recorded. Check your conversion tag in Google Ads before judging the ads themselves.` });
  if (adSpend > 0 && adSpend / s.grossSales > 0.3) attention.push({ metric: "Ad-to-Revenue Ratio", value: `${Math.round((adSpend / s.grossSales) * 100)}%`, detail: "Ad spend is consuming more than 30% of revenue - leaves little room for COGS and margin. Improve ROAS or reduce spend." });

  function buildSections() {
    if (!sales) return [];
    return [
      { title: "Financial Summary", headers: ["Metric", "Value"], rows: [
        ["Gross Revenue", formatINR(s.grossSales)],
        ["Total Orders", s.totalOrders],
        ["AOV (Avg Order Value)", formatINR(s.aov)],
        ["Ad Spend (total)", formatINR(adSpend)],
        ["Ad Spend (Meta)", m ? formatINR(m.spend) : "N/A"],
        ["Ad Spend (Google)", g ? formatINR(g.spend) : "N/A"],
        ["Net Revenue (after ad spend)", formatINR(netRevenue)],
        ["Meta ROAS", m ? `${m.roas}x` : "N/A"],
        ["Google Ads ROAS", g ? `${g.roas}x` : "N/A"],
        ["CAC (Meta)", m ? formatINR(m.cac) : "N/A"],
        ["Avg Daily Revenue", formatINR(Math.round(dailyRevenue))],
        ["Avg Daily Ad Spend", formatINR(Math.round(dailySpend))],
        ["Period Days", days],
      ]},
      { title: "Revenue Split", headers: ["Source", "Revenue", "Orders", "%"], rows: [
        ["Meta Ads", formatINR(metaRevenue), m?.purchases ?? 0, `${s.grossSales > 0 ? Math.round((metaRevenue / s.grossSales) * 100) : 0}%`],
        ...(g ? [["Google Ads", formatINR(googleRevenue), googleOrders, `${s.grossSales > 0 ? Math.round((googleRevenue / s.grossSales) * 100) : 0}%`] as (string | number)[]] : []),
        ["Organic / Direct", formatINR(organicRevenue), organicOrders, `${s.grossSales > 0 ? Math.round((organicRevenue / s.grossSales) * 100) : 0}%`],
        ["Total", formatINR(s.grossSales), s.totalOrders, "100%"],
      ]},
      { title: "Payment Split", headers: ["Type", "Orders", "%"], rows: [
        ["Prepaid", s.prepaidOrders, `${100 - codPct}%`],
        ["COD", s.codOrders, `${codPct}%`],
      ]},
      ...(sales.allBySku?.length ? [{ title: "SKU Revenue", headers: ["Product", "Qty Sold", "Revenue", "Avg Price"], rows: sales.allBySku.map(p => [p.name, p.qty, formatINR(p.revenue), formatINR(p.qty > 0 ? Math.round(p.revenue / p.qty) : 0)]) as (string|number)[][] }] : []),
      ...(meta?.campaigns?.length ? [{ title: "Meta Campaign Spend", headers: ["Campaign", "Status", "Spend", "ROAS", "Orders"], rows: meta.campaigns.map(c => [c.name, c.status, formatINR(c.spend), `${c.roas}x`, c.purchases]) as (string|number)[][] }] : []),
      ...(gads?.campaigns?.length ? [{ title: "Google Ads Campaign Spend", headers: ["Campaign", "Status", "Spend", "ROAS", "Conversions"], rows: gads.campaigns.map(c => [c.name, c.status, formatINR(c.spend), `${c.roas}x`, Math.round(c.conversions)]) as (string|number)[][] }] : []),
    ];
  }

  const skus = sales.allBySku ?? [];
  const topSkus = [...skus].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 bg-[#16A34A] rounded-lg flex items-center justify-center"><DollarSign size={14} className="text-white" /></div>
            <h1 className="text-xl font-bold text-[#18181B] dark:text-[#F4F4F5]">Financial P&amp;L</h1>
          </div>
          <p className="text-[14px] text-[#A1A1AA] ml-9"><RangeText /> · Generated {generatedAt}</p>
        </div>
        <ExportButton
          onExportCSV={() => exportToCSV(`skylitee-financial-${range.from}`, buildSections())}
          onExportPDF={() => exportToPDF(`skylitee-financial-${range.from}`, "Financial P&L Report", rangeText(range), buildSections())}
        />
      </div>

      {gadsIssue && (
        <div className="flex items-start gap-2.5 bg-[#FFFBEB] dark:bg-[#2D1C00]/40 border border-[#FCD34D] rounded-xl p-3">
          <AlertTriangle size={14} className="text-[#D97706] shrink-0 mt-0.5" />
          <p className="text-[14px] text-[#92400E] dark:text-[#FCD34D]">Google Ads isn&apos;t in these numbers, so real ad spend may be higher. {gadsIssueText(gadsIssue)}</p>
        </div>
      )}

      {/* COGS disclaimer */}
      <div className="flex items-start gap-2.5 bg-[#EFF6FF] dark:bg-[#1E3A5F]/30 border border-[#BFDBFE] rounded-xl p-3">
        <Info size={14} className="text-[#3B82F6] shrink-0 mt-0.5" />
        <p className="text-[14px] text-[#1D4ED8] dark:text-[#93C5FD]">This report shows <strong>revenue vs. ad spend</strong>. COGS, fulfillment costs, and returns are not included - consult your accountant for a full profit and loss statement.</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Gross Revenue", value: formatINR(s.grossSales), icon: <ShoppingCart size={13} className="text-[#16A34A]" />, sub: `${s.totalOrders} orders` },
          { label: "Ad Spend", value: formatINR(adSpend), icon: <TrendingUp size={13} className="text-[#F97316]" />, sub: m && g ? `Meta ${m.roas}x · Google ${g.roas}x ROAS` : m ? `Meta ROAS ${m.roas}x` : g ? `Google ROAS ${g.roas}x` : "Not connected" },
          { label: "Net (after ads)", value: formatINR(netRevenue), icon: <DollarSign size={13} className={netRevenue >= 0 ? "text-[#22C55E]" : "text-[#EF4444]"} />, sub: adSpend > 0 ? `${Math.round((adSpend / s.grossSales) * 100)}% of revenue on ads` : "No ad data" },
          { label: "AOV", value: formatINR(s.aov), icon: <ShoppingCart size={13} className="text-[#A1A1AA]" />, sub: `${days} day period` },
        ].map(item => (
          <div key={item.label} className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-4">
            <div className="flex items-center gap-1.5 mb-1">{item.icon}<span className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide">{item.label}</span></div>
            <div className="text-[20px] font-black text-[#18181B] dark:text-[#F4F4F5]">{item.value}</div>
            <div className="text-[13px] text-[#A1A1AA] mt-0.5">{item.sub}</div>
          </div>
        ))}
      </div>

      {/* Signals */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader title="✅ What's Working" />
          <div className="space-y-2">
            {working.length === 0
              ? <p className="text-[15px] text-[#A1A1AA]">No strong signals - connect Shopify to load revenue data.</p>
              : working.map((s, i) => <Signal key={i} type="good" {...s} />)}
          </div>
        </Card>
        <Card>
          <CardHeader title="⚠️ Needs Attention" />
          <div className="space-y-2">
            {attention.length === 0
              ? <p className="text-[15px] text-[#A1A1AA]">No major financial issues detected.</p>
              : attention.map((s, i) => <Signal key={i} type="warn" {...s} />)}
          </div>
        </Card>
      </div>

      {/* Revenue split */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader title="Revenue Split by Source" />
          <div className="space-y-2 mb-3">
            {[
              { label: "Meta Ads", revenue: metaRevenue, color: "#1877F2" },
              ...(g ? [{ label: "Google Ads", revenue: googleRevenue, color: "#CA8A04" }] : []),
              { label: "Organic / Direct", revenue: organicRevenue, color: "#22C55E" },
            ].map(row => {
              const pct = s.grossSales > 0 ? Math.round((row.revenue / s.grossSales) * 100) : 0;
              return (
                <div key={row.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[14px] font-semibold dark:text-[#F4F4F5]">{row.label}</span>
                    <span className="text-[14px] font-bold" style={{ color: row.color }}>{formatINR(row.revenue)} ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: row.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Payment Collection" />
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-[#F0FDF4] dark:bg-[#052E16]/30 rounded-xl p-3 text-center border border-[#86EFAC]">
              <div className="text-[28px] font-black text-[#22C55E]">{s.prepaidOrders}</div>
              <div className="text-[13px] text-[#A1A1AA]">Prepaid</div>
              <div className="text-[15px] font-bold text-[#16A34A]">{100 - codPct}%</div>
            </div>
            <div className="bg-[#FFFBEB] dark:bg-[#2D1C00]/30 rounded-xl p-3 text-center border border-[#FCD34D]">
              <div className="text-[28px] font-black text-[#EAB308]">{s.codOrders}</div>
              <div className="text-[13px] text-[#A1A1AA]">COD</div>
              <div className="text-[15px] font-bold text-[#92400E] dark:text-[#FCD34D]">{codPct}%</div>
            </div>
          </div>
          <div className="h-2 flex rounded-full overflow-hidden">
            <div className="bg-[#22C55E]" style={{ width: `${100 - codPct}%` }} />
            <div className="bg-[#EAB308]" style={{ width: `${codPct}%` }} />
          </div>
          {codPct > 50 && <p className="mt-2.5 text-[13px] text-[#92400E] dark:text-[#FCD34D] bg-[#FFFBEB] dark:bg-[#2D1C00] border border-[#FCD34D] rounded-xl p-2.5">High COD rate risks RTO losses - offer a small prepaid discount to shift preference.</p>}
        </Card>
      </div>

      {/* Top SKUs */}
      {topSkus.length > 0 && (
        <Card>
          <CardHeader title="Top Products by Revenue" right={`${skus.length} SKUs total`} />
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                  {["Product", "Qty Sold", "Revenue", "Avg Price", "Revenue Share"].map(h => (
                    <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topSkus.map((p, i) => {
                  const share = s.grossSales > 0 ? Math.round((p.revenue / s.grossSales) * 100) : 0;
                  return (
                    <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                      <td className="py-2 px-2 font-medium dark:text-[#F4F4F5] max-w-[200px]"><div className="truncate">{p.name}</div></td>
                      <td className="py-2 px-2">{p.qty}</td>
                      <td className="py-2 px-2 font-bold text-[#16A34A]">{formatINR(p.revenue)}</td>
                      <td className="py-2 px-2 text-[#A1A1AA]">{formatINR(p.qty > 0 ? Math.round(p.revenue / p.qty) : 0)}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden max-w-[60px]">
                            <div className="h-full bg-[#16A34A] rounded-full" style={{ width: `${share}%` }} />
                          </div>
                          <span className="text-[#71717A]">{share}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Daily avg summary */}
      <Card>
        <CardHeader title="Daily Average Summary" right={`${days} day period`} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Daily Revenue", value: formatINR(Math.round(dailyRevenue)), color: "#16A34A" },
            { label: "Daily Ad Spend", value: formatINR(Math.round(dailySpend)), color: "#F97316" },
            { label: "Daily Orders", value: Math.round(s.totalOrders / days).toString(), color: "#6366F1" },
            { label: "Daily Net", value: formatINR(Math.round((s.grossSales - adSpend) / days)), color: netRevenue >= 0 ? "#22C55E" : "#EF4444" },
          ].map(item => (
            <div key={item.label} className="bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-3 text-center">
              <div className="text-[13px] font-bold text-[#A1A1AA] uppercase mb-1">{item.label}</div>
              <div className="text-[18px] font-black" style={{ color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
