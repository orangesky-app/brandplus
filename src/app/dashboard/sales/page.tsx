"use client";
import { useEffect, useState } from "react";
import { KPICard } from "@/components/ui/kpi-card";
import { Card, CardHeader } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useDateRange, rangeText } from "@/lib/date-range-context";
import { fetchGoogleAds, gadsIssueText, type GadsIssue, type GadsKpis } from "@/lib/gads-client";
import { ShoppingCart, Share2, Megaphone, TrendingUp, Package, MapPin } from "lucide-react";
import Link from "next/link";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF, ExportSection } from "@/lib/export";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface SalesMonthRow { ym: string; label: string; revenue: number; orders: number; aov: number; newCustomers: number; returningCustomers: number; codOrders: number; codPct: number; prepaidRevenue: number }
const SALES_MONTHLY_KPIS: { key: keyof SalesMonthRow; label: string; fmt: (v: number) => string; higher: boolean }[] = [
  { key: "revenue", label: "Revenue", fmt: v => formatINR(v), higher: true },
  { key: "orders", label: "Orders", fmt: v => v.toLocaleString("en-IN"), higher: true },
  { key: "aov", label: "AOV", fmt: v => formatINR(v), higher: true },
  { key: "newCustomers", label: "New Customers", fmt: v => v.toLocaleString("en-IN"), higher: true },
  { key: "returningCustomers", label: "Returning Customers", fmt: v => v.toLocaleString("en-IN"), higher: true },
  { key: "prepaidRevenue", label: "Prepaid Revenue (cash)", fmt: v => formatINR(v), higher: true },
  { key: "codPct", label: "COD %", fmt: v => `${v}%`, higher: false },
];

/* ─── Types ───────────────────────────────────────────────────── */
interface SalesData {
  kpis: { grossSales: number; totalOrders: number; aov: number; newCustomers: number; returningCustomers: number; codOrders: number; prepaidOrders: number; avgItemsPerOrder: number };
  topByQty: { name: string; qty: number; revenue: number }[];
  topByRevenue: { name: string; qty: number; revenue: number }[];
  allBySku: { name: string; qty: number; revenue: number }[];
  topCities: { city: string; orders: number; revenue: number }[];
  topStates: { state: string; orders: number; revenue: number }[];
  recentOrders: { name: string; total: number; status: string; gateway: string; city: string; isCod: boolean; date: string }[];
  period: { days: number };
}
interface MetaKPIs { spend: number; roas: number; purchases: number; purchaseValue: number; ctr: number; cac: number; atc: number; checkout: number; impressions: number; clicks: number }
interface Ga4KPIs { sessions: number; users: number; bounceRate: number; newUsers?: number; avgSessionMin?: string }
interface Ga4Ecom { itemsViewed: number; itemsAddedToCart: number; itemsCheckedOut: number; itemsPurchased: number; purchases: number; revenue: number }

/* ─── Page ────────────────────────────────────────────────────── */
export default function SalesPage() {
  const { range } = useDateRange();
  const [sales, setSales] = useState<SalesData | null>(null);
  const [meta, setMeta] = useState<MetaKPIs | null>(null);
  const [ga4, setGa4] = useState<Ga4KPIs | null>(null);
  const [ga4Ecom, setGa4Ecom] = useState<Ga4Ecom | null>(null);
  const [metaConnected, setMetaConnected] = useState(false);
  const [metaSalesCac, setMetaSalesCac] = useState<number | null>(null);
  const [ga4Connected, setGa4Connected] = useState(false);
  const [gads, setGads] = useState<GadsKpis | null>(null);
  const [gadsIssue, setGadsIssue] = useState<GadsIssue | null>(null);
  const [loading, setLoading] = useState(true);
  const [adsLoading, setAdsLoading] = useState(true);
  const [months, setMonths] = useState(6);
  const [monthly, setMonthly] = useState<SalesMonthRow[] | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setAdsLoading(true);
    // A date change must not leave the last period's numbers next to the new dates.
    setSales(null); setMeta(null); setGa4(null); setGa4Ecom(null); setMetaSalesCac(null);
    setMetaConnected(false); setGa4Connected(false); setGads(null); setGadsIssue(null);
    // Shopify drives the page - render as soon as it lands; Meta/Google/GA4 fill in when they arrive
    // instead of the slowest of them holding the whole page on "Loading…".
    fetch(`/api/shopify/sales?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then(s => { if (!stale && !s?.error) setSales(s); })
      .catch(() => {})
      .finally(() => { if (!stale) setLoading(false); });
    Promise.allSettled([
      fetch(`/api/meta?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/ga4?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetchGoogleAds(range.from, range.to),
    ]).then(([mRes, gRes, adsRes]) => {
      if (stale) return;
      if (adsRes.status === "fulfilled") { setGads(adsRes.value.data?.kpis ?? null); setGadsIssue(adsRes.value.issue); }
      if (mRes.status === "fulfilled" && !mRes.value?.error) {
        setMeta(mRes.value.kpis ?? null); setMetaConnected(true);
        // CAC scoped to SALES-objective campaigns (not blended account spend) - awareness/
        // traffic spend shouldn't inflate the cost-per-order figure.
        const camps = (mRes.value.campaigns ?? []) as { objective: string; spend: number; purchases: number }[];
        const salesC = camps.filter(c => /SALES|CONVERSION/i.test(c.objective ?? ""));
        const sSpend = salesC.reduce((s, c) => s + (c.spend || 0), 0);
        const sPurch = salesC.reduce((s, c) => s + (c.purchases || 0), 0);
        setMetaSalesCac(sPurch > 0 ? Math.round(sSpend / sPurch) : null);
      }
      if (gRes.status === "fulfilled" && !gRes.value?.error) { setGa4(gRes.value.kpis ?? null); setGa4Ecom(gRes.value.ecommerce ?? null); setGa4Connected(true); }
    }).finally(() => { if (!stale) setAdsLoading(false); });
    return () => { stale = true; };
  }, [range.from, range.to]);

  // Month-wise store performance (independent of the global range).
  useEffect(() => {
    setMonthlyLoading(true);
    fetch(`/api/shopify/monthly?months=${months}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setMonthly(d.months ?? []); })
      .finally(() => setMonthlyLoading(false));
  }, [months]);

  /* ── Derived ── */
  const codPct = sales ? Math.round((sales.kpis.codOrders / Math.max(sales.kpis.totalOrders, 1)) * 100) : 0;
  const prepaidPct = 100 - codPct;
  const metaOrders = meta?.purchases ?? 0;
  const metaRevenue = meta?.purchaseValue ?? 0;
  const googleConversions = Math.round(gads?.conversions ?? 0);
  const googleRevenue = gads?.conversionValue ?? 0;
  const organicOrders = sales ? Math.max(0, sales.kpis.totalOrders - metaOrders - googleConversions) : 0;
  const organicRevenue = sales ? Math.max(0, sales.kpis.grossSales - metaRevenue - googleRevenue) : 0;
  // Across every connected ad platform, so the headline ROAS isn't Meta-only.
  const adSpend = (meta?.spend ?? 0) + (gads?.spend ?? 0);
  const adRoas = adSpend > 0 ? +((metaRevenue + googleRevenue) / adSpend).toFixed(2) : null;
  const fp = (n: number, d: number) => d ? Math.round((n / d) * 100) : 0;
  // Prefer the sales-objective CAC; fall back to account-level only if no sales campaigns.
  const cacValue = metaSalesCac ?? meta?.cac ?? null;
  const cacIsSalesScoped = metaSalesCac !== null;
  // Website funnel = one source, GA4 (on-site behaviour) - not Meta-tracked events stitched in.
  // GA4 needs ecommerce events configured; if absent we show a clear empty state.
  const sessions = ga4?.sessions ?? 0;
  const hasWebsiteFunnel = !!ga4Ecom && (ga4Ecom.itemsViewed > 0 || ga4Ecom.itemsAddedToCart > 0 || ga4Ecom.itemsPurchased > 0);

  function buildSections(): ExportSection[] {
    if (!sales) return [];
    const sections: ExportSection[] = [
      {
        title: "KPIs",
        headers: ["Metric", "Value"],
        rows: [
          ["Gross Sales", formatINR(sales.kpis.grossSales)],
          ["Total Orders", sales.kpis.totalOrders],
          ["Avg Order Value", formatINR(sales.kpis.aov)],
          ["New Customers", sales.kpis.newCustomers],
          ["Returning Customers", sales.kpis.returningCustomers],
          ["Prepaid Orders", sales.kpis.prepaidOrders],
          ["COD Orders", sales.kpis.codOrders],
          ["Avg Items / Order", sales.kpis.avgItemsPerOrder],
          ...(meta ? [
            ["Meta Spend", formatINR(meta.spend)] as [string, string],
            ["ROAS", `${meta.roas}x`] as [string, string],
            ["CAC", formatINR(meta.cac)] as [string, string],
            ["Meta Purchases", meta.purchases] as [string, number],
            ["Meta Revenue", formatINR(meta.purchaseValue)] as [string, string],
            ["CTR", `${meta.ctr}%`] as [string, string],
          ] : []),
          ...(gads ? [
            ["Google Ads Spend", formatINR(gads.spend)] as [string, string],
            ["Google Ads ROAS", `${gads.roas}x`] as [string, string],
            ["Google Ads Conversions", googleConversions] as [string, number],
            ["Google Ads Revenue", formatINR(googleRevenue)] as [string, string],
          ] : []),
        ],
      },
      {
        title: "Channel Attribution",
        headers: ["Channel", "Orders", "Revenue", "Ad Spend", "ROAS", "CTR"],
        rows: [
          ["Shopify Total", sales.kpis.totalOrders, formatINR(sales.kpis.grossSales), "-", "-", "-"],
          ["Meta Ads", metaConnected ? metaOrders : "-", metaConnected ? formatINR(metaRevenue) : "-", metaConnected && meta ? formatINR(meta.spend) : "-", metaConnected && meta ? `${meta.roas}x` : "-", metaConnected && meta ? `${meta.ctr}%` : "-"],
          ["Google Ads", gads ? `${googleConversions} conversions` : "-", gads ? formatINR(googleRevenue) : "-", gads ? formatINR(gads.spend) : "-", gads ? `${gads.roas}x` : "-", gads ? `${gads.ctr}%` : "-"],
          ["Organic / Direct", organicOrders, formatINR(organicRevenue), "-", "-", "-"],
        ],
      },
      {
        title: "Payment Split",
        headers: ["Type", "Orders", "Percentage"],
        rows: [
          ["Prepaid", sales.kpis.prepaidOrders, `${prepaidPct}%`],
          ["COD", sales.kpis.codOrders, `${codPct}%`],
        ],
      },
      {
        title: "Conversion Funnel",
        headers: ["Stage", "Count", "Source", "% of Sessions"],
        rows: funnel.map(f => [f.label, f.value, f.source, `${f.barPct}%`]),
      },
      {
        title: "Top Products by Qty",
        headers: ["#", "Product", "Qty Sold", "Revenue"],
        rows: sales.topByQty.map((p, i) => [i + 1, p.name, p.qty, formatINR(p.revenue)]),
      },
      {
        title: "Top Products by Revenue",
        headers: ["#", "Product", "Revenue", "Qty Sold"],
        rows: sales.topByRevenue.map((p, i) => [i + 1, p.name, formatINR(p.revenue), p.qty]),
      },
      {
        title: "All SKUs Performance",
        headers: ["#", "Product", "Qty Sold", "Revenue", "% of Sales"],
        rows: sales.allBySku.map((p, i) => {
          const pct = sales.kpis.grossSales ? +(p.revenue / sales.kpis.grossSales * 100).toFixed(1) : 0;
          return [i + 1, p.name, p.qty, formatINR(p.revenue), `${pct}%`];
        }),
      },
      {
        title: "Recent Orders",
        headers: ["Order", "Date", "Amount", "Payment", "City", "Status"],
        rows: sales.recentOrders.map(o => [o.name, o.date, formatINR(o.total), o.isCod ? "COD" : "Prepaid", o.city || "-", o.status]),
      },
      {
        title: "Top Cities by Revenue",
        headers: ["#", "City", "Orders", "Revenue"],
        rows: sales.topCities.map((c, i) => [i + 1, c.city, c.orders, formatINR(c.revenue)]),
      },
      {
        title: "Top States by Orders",
        headers: ["State", "Orders", "Revenue"],
        rows: sales.topStates.map(s => [s.state, s.orders, formatINR(s.revenue)]),
      },
    ];
    return sections.filter(s => s.rows.length > 0);
  }

  function handleExportCSV() {
    exportToCSV(`skylitee-sales-${range.from}`, buildSections());
  }

  async function handleExportPDF() {
    await exportToPDF(
      `skylitee-sales-${range.from}`,
      "Sales Report",
      `${rangeText(range)} · ${sales?.period.days ?? 0} days`,
      buildSections()
    );
  }

  if (loading) return <div className="flex items-center justify-center py-24 text-[15px] text-[#A1A1AA]">Loading sales data…</div>;
  if (!sales) return (
    <div className="text-center py-16">
      <p className="text-[16px] text-[#71717A] mb-2">Could not load sales data.</p>
      <Link href="/dashboard/connections" className="text-[15px] text-[#F97316] font-semibold underline">Check Shopify connection →</Link>
    </div>
  );

  const channels = [
    { label: "Shopify Total", icon: ShoppingCart, color: "text-[#F97316]", bg: "bg-[#FFF7ED] dark:bg-[#2A1A0E]", orders: sales.kpis.totalOrders, unit: "orders", revenue: sales.kpis.grossSales, spend: null as number | null, roas: null as number | null },
    { label: "Meta Ads", icon: Share2, color: "text-[#1877F2]", bg: "bg-[#EFF6FF] dark:bg-[#0F172A]", orders: metaConnected ? metaOrders : null, unit: "orders", revenue: metaConnected ? metaRevenue : null, spend: metaConnected ? (meta?.spend ?? null) : null, roas: metaConnected ? (meta?.roas ?? null) : null },
    { label: "Google Ads", icon: Megaphone, color: "text-[#4285F4]", bg: "bg-[#EFF6FF] dark:bg-[#0F172A]", orders: gads ? googleConversions : null, unit: "conversions", revenue: gads ? googleRevenue : null, spend: gads?.spend ?? null, roas: gads && googleRevenue > 0 ? gads.roas : null },
    { label: "Organic/Direct", icon: TrendingUp, color: "text-[#22C55E]", bg: "bg-[#F0FDF4] dark:bg-[#052E16]", orders: organicOrders, unit: "orders", revenue: organicRevenue, spend: null, roas: null },
  ];

  // Pure GA4 website funnel - every step measured on-site by Google Analytics (no Meta mixing).
  const funnel = hasWebsiteFunnel && ga4Ecom ? [
    { label: "Website Sessions", value: sessions, color: "#6366F1", source: "GA4", barPct: 100 },
    { label: "Product Views", value: ga4Ecom.itemsViewed, color: "#8B5CF6", source: "GA4", barPct: fp(ga4Ecom.itemsViewed, Math.max(sessions, 1)) },
    { label: "Add to Cart", value: ga4Ecom.itemsAddedToCart, color: "#F97316", source: "GA4", barPct: fp(ga4Ecom.itemsAddedToCart, Math.max(sessions, 1)) },
    { label: "Reached Checkout", value: ga4Ecom.itemsCheckedOut, color: "#EAB308", source: "GA4", barPct: fp(ga4Ecom.itemsCheckedOut, Math.max(sessions, 1)) },
    { label: "Purchased", value: ga4Ecom.itemsPurchased, color: "#22C55E", source: "GA4", barPct: fp(ga4Ecom.itemsPurchased, Math.max(sessions, 1)) },
  ] : [];

  return (
    <div className="space-y-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#18181B] dark:text-[#F4F4F5] flex items-center gap-2"><ShoppingCart size={18} className="text-[#F97316]" /> Sales Report</h2>
          <p className="text-[14px] text-[#A1A1AA] mt-0.5">{rangeText(range)} · {sales.period.days} days · Live</p>
        </div>
        <ExportButton onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <KPICard label="Gross Sales" value={formatINR(sales.kpis.grossSales)} />
        <KPICard label="Total Orders" value={sales.kpis.totalOrders.toString()} />
        <KPICard label="Avg Order Value" value={formatINR(sales.kpis.aov)} />
        <KPICard label={meta && gads ? "ROAS (all ads)" : "ROAS"} value={adRoas !== null ? `${adRoas}x` : "-"}
          change={adRoas !== null ? (adRoas >= 2 ? 1 : -1) : undefined}
          changeLabel={adRoas !== null ? (adRoas >= 3 ? "Strong" : adRoas >= 2 ? "Average" : "Below target") : adsLoading ? "Loading…" : meta || gads ? "No ad spend" : "Connect Meta or Google Ads"} />
        <KPICard label="CAC" value={cacValue !== null ? formatINR(cacValue) : "-"}
          sub={metaConnected ? (cacIsSalesScoped ? "Per order · Sales ads only" : "Cost per acquisition") : adsLoading ? "Loading…" : "Connect Meta Ads"} />
      </div>

      {/* Channel Attribution + COD/Prepaid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* Channel Attribution */}
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader title="Channel Attribution" right={<span className="text-[13px] text-[#A1A1AA]">{gads ? "Meta + Google + Organic" : "Meta + Organic"} = Shopify total</span>} />
          {gadsIssue && <p className="text-[13px] text-[#92400E] dark:text-[#FCD34D] mb-2">Google Ads isn&apos;t in these numbers, so organic may look higher than it is. {gadsIssueText(gadsIssue)}</p>}

          {/* Channel mini-cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {channels.map(ch => (
              <div key={ch.label} className={cn("rounded-2xl p-3 border border-black/[0.04] dark:border-white/[0.04]", ch.bg)}>
                <div className="flex items-center gap-1.5 mb-2">
                  <ch.icon size={11} className={ch.color} />
                  <span className="text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wide truncate">{ch.label}</span>
                </div>
                <div className="text-[18px] font-black text-[#18181B] dark:text-[#F4F4F5]">
                  {ch.revenue !== null ? formatINR(ch.revenue) : <span className="text-[#A1A1AA] text-[15px]">-</span>}
                </div>
                <div className="text-[13px] text-[#A1A1AA]">{ch.orders !== null ? `${ch.orders} ${ch.unit}` : adsLoading ? "Loading…" : <Link href="/dashboard/connections" className="text-[#F97316] font-semibold">Connect →</Link>}</div>
                {ch.spend !== null && (
                  <div className="mt-1.5 pt-1.5 border-t border-black/[0.06] dark:border-white/[0.06] space-y-0.5">
                    <div className="text-[12px] text-[#A1A1AA]">Spend: <span className="font-semibold text-[#18181B] dark:text-[#F4F4F5]">{formatINR(ch.spend)}</span></div>
                    {ch.roas !== null && <div className="text-[12px] text-[#A1A1AA]">ROAS: <span className={cn("font-black", ch.roas >= 3 ? "text-[#22C55E]" : ch.roas >= 2 ? "text-[#EAB308]" : "text-[#EF4444]")}>{ch.roas}x</span></div>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Channel table */}
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                {["Channel", "Orders", "Revenue", "Ad Spend", "ROAS", "CTR"].map(h => (
                  <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Shopify Total", Icon: ShoppingCart, ic: "text-[#F97316]", orders: sales.kpis.totalOrders, revenue: sales.kpis.grossSales, spend: "-", roas: "-", ctr: "-" },
                { label: "Meta Ads", Icon: Share2, ic: "text-[#1877F2]", orders: metaConnected ? metaOrders : "-", revenue: metaConnected ? formatINR(metaRevenue) : "-", spend: metaConnected && meta ? formatINR(meta.spend) : "-", roas: metaConnected && meta ? meta.roas : "-", ctr: metaConnected && meta ? `${meta.ctr}%` : "-" },
                { label: "Google Ads", Icon: Megaphone, ic: "text-[#4285F4]", orders: gads ? `${googleConversions} conv.` : "-", revenue: gads ? formatINR(googleRevenue) : "-", spend: gads ? formatINR(gads.spend) : "-", roas: gads && googleRevenue > 0 ? gads.roas : "-", ctr: gads ? `${gads.ctr}%` : "-" },
                { label: "Organic/Direct", Icon: TrendingUp, ic: "text-[#22C55E]", orders: organicOrders, revenue: formatINR(organicRevenue), spend: "-", roas: "-", ctr: "-" },
              ].map((row, i) => (
                <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors">
                  <td className="py-2 px-2 font-semibold text-[#18181B] dark:text-[#F4F4F5]">
                    <span className="flex items-center gap-1.5"><row.Icon size={10} className={row.ic} />{row.label}</span>
                  </td>
                  <td className="py-2 px-2">{typeof row.orders === "number" ? row.orders : row.orders}</td>
                  <td className="py-2 px-2 font-semibold">{typeof row.revenue === "number" ? formatINR(row.revenue) : row.revenue}</td>
                  <td className="py-2 px-2 text-[#A1A1AA]">{row.spend}</td>
                  <td className="py-2 px-2">
                    {row.roas === "-" ? <span className="text-[#A1A1AA]">-</span> :
                      <span className={cn("font-bold", Number(row.roas) >= 3 ? "text-[#22C55E]" : Number(row.roas) >= 2 ? "text-[#EAB308]" : "text-[#EF4444]")}>{row.roas}x</span>}
                  </td>
                  <td className="py-2 px-2 text-[#A1A1AA]">{row.ctr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Payment Split */}
        <Card>
          <CardHeader title="Payment Split" />
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#FFF7ED] dark:bg-[#2A1A0E] rounded-2xl p-3 text-center border border-[#FED7AA] dark:border-[#7C2D12]">
                <div className="text-[28px] font-black text-[#F97316]">{sales.kpis.prepaidOrders}</div>
                <div className="text-[13px] text-[#A1A1AA] mt-0.5">Prepaid</div>
                <div className="text-[14px] font-bold text-[#EA580C]">{prepaidPct}%</div>
              </div>
              <div className="bg-[#FFFBEB] dark:bg-[#2D1C00] rounded-2xl p-3 text-center border border-[#FCD34D] dark:border-[#92400E]">
                <div className="text-[28px] font-black text-[#EAB308]">{sales.kpis.codOrders}</div>
                <div className="text-[13px] text-[#A1A1AA] mt-0.5">COD</div>
                <div className="text-[14px] font-bold text-[#92400E] dark:text-[#FCD34D]">{codPct}%</div>
              </div>
            </div>
            <div className="h-2 flex rounded-full overflow-hidden">
              <div className="bg-[#F97316]" style={{ width: `${prepaidPct}%` }} />
              <div className="bg-[#EAB308]" style={{ width: `${codPct}%` }} />
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="flex items-center gap-1 text-[#A1A1AA]"><span className="w-2 h-2 rounded-full bg-[#F97316]" /> Prepaid</span>
              <span className="flex items-center gap-1 text-[#A1A1AA]"><span className="w-2 h-2 rounded-full bg-[#EAB308]" /> COD</span>
            </div>
            <div className="pt-2 border-t border-black/[0.06] dark:border-white/[0.06] space-y-2">
              {[
                { label: "Avg items/order", value: sales.kpis.avgItemsPerOrder },
                { label: "New customers", value: sales.kpis.newCustomers },
                { label: "Returning customers", value: sales.kpis.returningCustomers },
                { label: "Total orders", value: sales.kpis.totalOrders },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between">
                  <span className="text-[14px] text-[#A1A1AA]">{row.label}</span>
                  <span className="text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{row.value}</span>
                </div>
              ))}
            </div>
            {codPct > 50 && (
              <div className="bg-[#FFFBEB] dark:bg-[#2D1C00] border border-[#FCD34D] dark:border-[#92400E] rounded-xl p-2.5 text-[13px] text-[#92400E] dark:text-[#FCD34D] leading-relaxed">
                High COD ratio - consider a ₹75 prepaid discount to shift buyers and reduce return risk.
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Top 5 by Qty + Top 5 by Revenue */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader title="Top 5 Products by Qty" right={<span className="flex items-center gap-1 text-[#A1A1AA]"><Package size={11} /> Units sold</span>} />
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                {["#", "Product", "Qty", "Revenue"].map(h => (
                  <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sales.topByQty.map((p, i) => (
                <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                  <td className="py-2 px-2">
                    <span className={cn("w-5 h-5 rounded-full text-[12px] font-black inline-flex items-center justify-center",
                      i === 0 ? "bg-[#F97316] text-white" : i === 1 ? "bg-[#FED7AA] text-[#EA580C]" : "bg-[#F5F5F4] dark:bg-[#1C1C1C] text-[#A1A1AA]"
                    )}>{i + 1}</span>
                  </td>
                  <td className="py-2 px-2 font-medium text-[#18181B] dark:text-[#F4F4F5] max-w-[160px]"><div className="truncate">{p.name}</div></td>
                  <td className="py-2 px-2 font-black text-[#F97316]">{p.qty}</td>
                  <td className="py-2 px-2 text-[#71717A]">{formatINR(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader title="Top 5 Products by Revenue" right={<span className="flex items-center gap-1 text-[#A1A1AA]"><TrendingUp size={11} /> Best earners</span>} />
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                {["#", "Product", "Revenue", "Qty"].map(h => (
                  <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sales.topByRevenue.map((p, i) => (
                <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                  <td className="py-2 px-2">
                    <span className={cn("w-5 h-5 rounded-full text-[12px] font-black inline-flex items-center justify-center",
                      i === 0 ? "bg-[#F97316] text-white" : i === 1 ? "bg-[#FED7AA] text-[#EA580C]" : "bg-[#F5F5F4] dark:bg-[#1C1C1C] text-[#A1A1AA]"
                    )}>{i + 1}</span>
                  </td>
                  <td className="py-2 px-2 font-medium text-[#18181B] dark:text-[#F4F4F5] max-w-[160px]"><div className="truncate">{p.name}</div></td>
                  <td className="py-2 px-2 font-black text-[#F97316]">{formatINR(p.revenue)}</td>
                  <td className="py-2 px-2 text-[#71717A]">{p.qty} units</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Funnel + Geography */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

        {/* Conversion Funnel - website behaviour, single source (GA4) */}
        <Card>
          <CardHeader title="Website Funnel" right={<span className="text-[13px] text-[#A1A1AA]">{ga4Connected ? "GA4 · website" : adsLoading ? "Loading…" : "Connect GA4"}</span>} />
          {adsLoading && !hasWebsiteFunnel && (
            <div className="text-[14px] text-[#A1A1AA] py-4 text-center">Loading website funnel…</div>
          )}
          {!adsLoading && !hasWebsiteFunnel && (
            <div className="text-[14px] text-[#A1A1AA] py-4 text-center">
              {ga4Connected
                ? "GA4 is connected but has no ecommerce events yet - enable GA4 Enhanced Ecommerce (view_item / add_to_cart / begin_checkout / purchase) to see the website funnel."
                : <>Connect GA4 to see the website session → cart → checkout → purchase funnel. <Link href="/dashboard/connections" className="text-[#F97316] font-semibold">Connect →</Link></>}
            </div>
          )}
          <div className="space-y-2 mb-3">
            {funnel.map((step) => (
              <div key={step.label} className={cn("rounded-xl p-2.5", step.color === "#EF4444" ? "bg-[#FEF2F2] dark:bg-[#2D0A0A]" : "bg-[#F5F5F4] dark:bg-[#1C1C1C]")}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[14px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">{step.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-[#A1A1AA]">{step.source}</span>
                    <span className="text-[16px] font-black" style={{ color: step.color }}>{step.value.toLocaleString("en-IN")}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${step.barPct}%`, backgroundColor: step.color, opacity: 0.75 }} />
                </div>
                <div className="text-[12px] text-[#A1A1AA] mt-0.5 text-right">{step.barPct}%</div>
              </div>
            ))}
          </div>
          {metaConnected && meta && (
            <div className="pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
              <div className="text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wide mb-1.5">Meta ads · source: Meta</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {[
                { label: cacIsSalesScoped ? "CAC (Sales)" : "CAC", value: formatINR(cacValue ?? meta.cac) },
                { label: "CTR", value: `${meta.ctr}%` },
                { label: "Clicks", value: meta.clicks.toLocaleString("en-IN") },
                { label: "Impressions", value: (meta.impressions >= 1000 ? `${(meta.impressions / 1000).toFixed(0)}k` : meta.impressions.toString()) },
              ].map(kpi => (
                <div key={kpi.label} className="text-center bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-2">
                  <div className="text-[14px] font-black text-[#18181B] dark:text-[#F4F4F5]">{kpi.value}</div>
                  <div className="text-[12px] text-[#A1A1AA] mt-0.5">{kpi.label}</div>
                </div>
              ))}
              </div>
            </div>
          )}
          {ga4Connected && ga4 && (
            <div className="mt-2">
              <div className="text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wide mb-1.5">Website · source: GA4</div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-3">
              {[
                { label: "Users", value: ga4.users.toLocaleString("en-IN") },
                { label: "Bounce (GA4)", value: `${ga4.bounceRate.toFixed(0)}%` },
                { label: "Avg session", value: ga4.avgSessionMin ?? "-" },
              ].map(kpi => (
                <div key={kpi.label} className="text-center bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-2">
                  <div className="text-[14px] font-black text-[#18181B] dark:text-[#F4F4F5]">{kpi.value}</div>
                  <div className="text-[12px] text-[#A1A1AA] mt-0.5">{kpi.label}</div>
                </div>
              ))}
              </div>
            </div>
          )}
        </Card>

        {/* Geography */}
        <Card>
          <CardHeader title="Top Cities & States" right={<MapPin size={12} className="text-[#A1A1AA]" />} />
          <div className="mb-4">
            <div className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-[0.1em] mb-2">Cities by Revenue</div>
            {sales.topCities.slice(0, 6).map((c, i) => {
              const maxRev = sales.topCities[0]?.revenue ?? 1;
              return (
                <div key={c.city} className="flex items-center gap-2 mb-1.5">
                  <span className="text-[12px] text-[#A1A1AA] w-3 text-right shrink-0">{i + 1}</span>
                  <span className="text-[14px] font-medium text-[#18181B] dark:text-[#F4F4F5] w-24 shrink-0 truncate">{c.city}</span>
                  <div className="flex-1 h-1.5 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-full overflow-hidden">
                    <div className="h-full bg-[#F97316] rounded-full" style={{ width: `${Math.round((c.revenue / maxRev) * 100)}%`, opacity: 1 - i * 0.12 }} />
                  </div>
                  <span className="text-[13px] text-[#A1A1AA] w-12 text-right shrink-0">{c.orders}ord</span>
                  <span className="text-[13px] font-semibold text-[#18181B] dark:text-[#F4F4F5] w-20 text-right shrink-0">{formatINR(c.revenue)}</span>
                </div>
              );
            })}
          </div>
          {sales.topStates.length > 0 && (
            <>
              <div className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-[0.1em] mb-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">States by Orders</div>
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-black/[0.04] dark:border-white/[0.04]">
                    {["State", "Orders", "Revenue"].map(h => (
                      <th key={h} className="text-left py-1 px-1 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sales.topStates.map(s => (
                    <tr key={s.state} className="border-b border-black/[0.03] dark:border-white/[0.03] last:border-0">
                      <td className="py-1.5 px-1 font-medium text-[#18181B] dark:text-[#F4F4F5]">{s.state}</td>
                      <td className="py-1.5 px-1 text-[#71717A]">{s.orders}</td>
                      <td className="py-1.5 px-1 font-semibold text-[#18181B] dark:text-[#F4F4F5]">{formatINR(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>
      </div>

      {/* SKU Performance */}
      <Card>
        <CardHeader title="SKU Performance" right={<span className="text-[13px] text-[#A1A1AA]">Avg {sales.kpis.avgItemsPerOrder} items/order · {sales.allBySku.length} products sold</span>} />
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                {["#", "Product Name", "Qty Sold", "Revenue", "% of Sales"].map(h => (
                  <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sales.allBySku.map((p, i) => {
                const pct = sales.kpis.grossSales ? +(p.revenue / sales.kpis.grossSales * 100).toFixed(1) : 0;
                return (
                  <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors">
                    <td className="py-2 px-2 text-[#A1A1AA] font-semibold">{i + 1}</td>
                    <td className="py-2 px-2 font-medium text-[#18181B] dark:text-[#F4F4F5] max-w-[260px]"><div className="truncate">{p.name}</div></td>
                    <td className="py-2 px-2 font-black text-[#F97316]">{p.qty}</td>
                    <td className="py-2 px-2 font-bold text-[#18181B] dark:text-[#F4F4F5]">{formatINR(p.revenue)}</td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-full overflow-hidden">
                          <div className="h-full bg-[#F97316] rounded-full" style={{ width: `${Math.min(pct * 3, 100)}%` }} />
                        </div>
                        <span className="text-[#A1A1AA]">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent Orders */}
      <Card>
        <CardHeader title="Recent Orders" right={<span className="text-[13px] text-[#A1A1AA]">Last {sales.recentOrders.length} orders</span>} />
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                {["Order", "Date", "Amount", "Payment", "City", "Status"].map(h => (
                  <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sales.recentOrders.map((o, i) => (
                <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors">
                  <td className="py-2 px-2 font-bold text-[#18181B] dark:text-[#F4F4F5]">{o.name}</td>
                  <td className="py-2 px-2 text-[#A1A1AA]">{o.date}</td>
                  <td className="py-2 px-2 font-bold text-[#F97316]">{formatINR(o.total)}</td>
                  <td className="py-2 px-2">
                    <span className={cn("px-2 py-0.5 rounded-full text-[12px] font-bold",
                      o.isCod ? "bg-[#FFFBEB] dark:bg-[#2D1C00] text-[#92400E] dark:text-[#FCD34D]" : "bg-[#FFF7ED] dark:bg-[#2A1A0E] text-[#EA580C] dark:text-[#FB923C]"
                    )}>{o.isCod ? "COD" : "Prepaid"}</span>
                  </td>
                  <td className="py-2 px-2 text-[#71717A]">{o.city || "-"}</td>
                  <td className="py-2 px-2">
                    <span className={cn("px-2 py-0.5 rounded-full text-[12px] font-bold capitalize",
                      o.status === "paid" ? "bg-[#F0FDF4] dark:bg-[#052E16] text-[#166534] dark:text-[#4ADE80]" :
                      o.status === "pending" ? "bg-[#FFFBEB] dark:bg-[#2D1C00] text-[#92400E] dark:text-[#FCD34D]" :
                      "bg-[#F5F5F4] dark:bg-[#1C1C1C] text-[#71717A]"
                    )}>{o.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Month-wise store performance ── */}
      <Card>
        <CardHeader
          title="Month-wise performance"
          right={
            <div className="flex items-center gap-1.5 text-[14px]">
              <span className="text-[#A1A1AA]">Last</span>
              <select value={months} onChange={e => setMonths(parseInt(e.target.value, 10))}
                className="bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-lg px-2 py-1 text-[14px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => <option key={n} value={n}>{n} month{n > 1 ? "s" : ""}</option>)}
              </select>
            </div>
          }
        />
        {monthlyLoading ? (
          <div className="text-[15px] text-[#71717A] py-10 text-center">Loading month-wise data…</div>
        ) : !monthly || monthly.length === 0 ? (
          <div className="text-[15px] text-[#71717A] py-10 text-center">No monthly data yet.</div>
        ) : (
          <>
            {monthly.length > 1 && (
              <div className="h-56 mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthly.map(m => ({ label: m.label, Revenue: m.revenue, Orders: m.orders }))} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" strokeOpacity={0.5} vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="l" tick={{ fontSize: 12, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 12, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ fontSize: 13, borderRadius: 12, border: "1px solid #E5E5E5" }} />
                    <Line yAxisId="l" type="monotone" dataKey="Revenue" stroke="#F97316" strokeWidth={2.5} dot={false} />
                    <Line yAxisId="r" type="monotone" dataKey="Orders" stroke="#3B82F6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-[14px] border-collapse min-w-[560px]">
                <thead>
                  <tr className="border-b border-black/[0.08]">
                    <th className="text-left py-2 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider sticky left-0 bg-white">KPI</th>
                    {monthly.map(m => <th key={m.ym} className="text-right py-2 px-3 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider whitespace-nowrap">{m.label}</th>)}
                    {monthly.length > 1 && <th className="text-right py-2 px-3 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">MoM</th>}
                  </tr>
                </thead>
                <tbody>
                  {SALES_MONTHLY_KPIS.map(row => {
                    const last = monthly[monthly.length - 1];
                    const prev = monthly[monthly.length - 2];
                    const cv = last[row.key] as number;
                    const pv = prev ? (prev[row.key] as number) : undefined;
                    const mom = pv && pv !== 0 ? ((cv - pv) / pv) * 100 : null;
                    const good = mom === null ? null : (row.higher ? mom >= 0 : mom <= 0);
                    return (
                      <tr key={row.key} className="border-b border-black/[0.04] last:border-0 hover:bg-[#f7f7f5]">
                        <td className="py-2 px-2 font-semibold text-[#181816] sticky left-0 bg-white">{row.label}</td>
                        {monthly.map(m => <td key={m.ym} className="py-2 px-3 text-right tabular-nums">{row.fmt(m[row.key] as number)}</td>)}
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
            <p className="text-[13px] text-[#A1A1AA] mt-2">MoM = latest month ({monthly[monthly.length - 1]?.label}) vs previous. Green = better (COD% is lower-is-better). The current month is partial until it ends.</p>
          </>
        )}
      </Card>

    </div>
  );
}
