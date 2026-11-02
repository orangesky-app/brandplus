"use client";
import { useEffect, useState } from "react";
import { KPICard } from "@/components/ui/kpi-card";
import { Card, CardHeader } from "@/components/ui/card";
import { formatINR, cn } from "@/lib/utils";
import { useDateRange, rangeText } from "@/lib/date-range-context";
import { RangeText } from "@/components/ui/period";
import { fetchGoogleAds, gadsIssueText, type GadsData, type GadsIssue } from "@/lib/gads-client";
import { Share2, TrendingUp, Target, ArrowRight, Megaphone } from "lucide-react";
import Link from "next/link";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF, ExportSection } from "@/lib/export";

interface MetaKPIs {
  spend: number; roas: number; cac: number; purchases: number; purchaseValue: number;
  impressions: number; clicks: number; ctr: number; cpc: number;
  lpv: number; atc: number; atcRatio: number;
  checkout: number; checkoutRatio: number; purchaseRatio: number; conversionRatio: number;
}
interface MetaCampaign {
  id: string; name: string; status: string; objective: string;
  spend: number; purchases: number; purchaseValue: number; roas: number;
  clicks: number; ctr: number; atc: number;
}
interface Ga4Channel { channel: string; sessions: number; users: number; purchases: number; revenue: number; }
interface Ga4Ecommerce {
  itemsViewed: number; itemsAddedToCart: number; itemsCheckedOut: number; itemsPurchased: number;
  atcRate: number; checkoutRate: number; purchaseRate: number;
}

const CH_COLOR: Record<string, string> = {
  "Paid Social": "#1877F2", "Paid Search": "#4285F4",
  "Organic Search": "#22C55E", "Direct": "#6366F1",
  "Organic Social": "#EC4899", "Email": "#F97316", "Referral": "#8B5CF6",
};
const CH_FALLBACK = "#A1A1AA";

export default function AttributionPage() {
  const { range } = useDateRange();
  const [meta, setMeta] = useState<{ kpis: MetaKPIs; campaigns: MetaCampaign[] } | null>(null);
  const [ga4, setGa4] = useState<{ kpis: { sessions: number; users: number; bounceRate: number; newUsers: number }; channels: Ga4Channel[]; ecommerce: Ga4Ecommerce | null } | null>(null);
  const [sales, setSales] = useState<{ kpis: { grossSales: number; totalOrders: number; aov: number } } | null>(null);
  const [metaOk, setMetaOk] = useState(false);
  const [ga4Ok, setGa4Ok] = useState(false);
  const [shopOk, setShopOk] = useState(false);
  const [gads, setGads] = useState<GadsData | null>(null);
  const [gadsIssue, setGadsIssue] = useState<GadsIssue | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setMeta(null); setGa4(null); setSales(null); setGads(null); setGadsIssue(null);
    setMetaOk(false); setGa4Ok(false); setShopOk(false);
    Promise.allSettled([
      fetch(`/api/meta?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/ga4?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/shopify/sales?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetchGoogleAds(range.from, range.to),
    ]).then(([mR, gR, sR, adsR]) => {
      if (stale) return;
      if (mR.status === "fulfilled" && !mR.value?.error) { setMeta({ kpis: mR.value.kpis, campaigns: mR.value.campaigns ?? [] }); setMetaOk(true); }
      if (gR.status === "fulfilled" && !gR.value?.error) { setGa4({ kpis: gR.value.kpis, channels: gR.value.channels ?? [], ecommerce: gR.value.ecommerce ?? null }); setGa4Ok(true); }
      if (sR.status === "fulfilled" && !sR.value?.error) { setSales(sR.value); setShopOk(true); }
      if (adsR.status === "fulfilled") { setGads(adsR.value.data); setGadsIssue(adsR.value.issue); }
    }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [range.from, range.to]);

  if (loading) return <div className="flex items-center justify-center py-24 text-[15px] text-[#A1A1AA]">Loading attribution data…</div>;

  if (!metaOk && !ga4Ok && !gads) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-2xl flex items-center justify-center mx-auto mb-3">
          <Target size={20} className="text-[#A1A1AA]" />
        </div>
        <p className="text-[16px] font-semibold text-[#71717A] mb-1">Connect a platform to see attribution</p>
        <p className="text-[15px] text-[#A1A1AA] max-w-sm mx-auto mb-4">{gadsIssue ? gadsIssueText(gadsIssue) : "Attribution uses Meta Ads + Google Ads + GA4 + Shopify to show which channels drive your revenue."}</p>
        <Link href="/dashboard/connections" className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#F97316] text-white rounded-xl text-[15px] font-bold hover:bg-[#EA580C] transition-colors">
          Connect Platforms <ArrowRight size={13} />
        </Link>
      </div>
    );
  }

  /* ── Derived ── */
  const totalRevenue = sales?.kpis.grossSales ?? 0;
  const metaRevenue  = meta?.kpis.purchaseValue ?? 0;
  const g = gads?.kpis;
  const googleRevenue = g?.conversionValue ?? 0;
  const organicRevenue = Math.max(0, totalRevenue - metaRevenue - googleRevenue);
  const metaPct    = totalRevenue > 0 ? Math.round(metaRevenue / totalRevenue * 100) : 0;
  const googlePct  = totalRevenue > 0 ? Math.round(googleRevenue / totalRevenue * 100) : 0;
  const organicPct = Math.max(0, 100 - metaPct - googlePct);
  const metaOrders = meta?.kpis.purchases ?? 0;
  const googleConversions = Math.round(g?.conversions ?? 0);
  const shopOrders = sales?.kpis.totalOrders ?? 0;
  const adSpendAll = (meta?.kpis.spend ?? 0) + (g?.spend ?? 0);
  const roasAll = adSpendAll > 0 ? +((metaRevenue + googleRevenue) / adSpendAll).toFixed(2) : 0;

  const ga4Channels = [...(ga4?.channels ?? [])].sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions);
  const totalGa4Rev = ga4Channels.reduce((s, c) => s + c.revenue, 0);
  const totalGa4Sess = ga4Channels.reduce((s, c) => s + c.sessions, 0);

  /* ── Export ── */
  function buildSections(): ExportSection[] {
    const sections: ExportSection[] = [];
    if (meta) {
      sections.push({
        title: "Meta Attribution",
        headers: ["Metric", "Value"],
        rows: [
          ["Ad Spend", formatINR(meta.kpis.spend)], ["ROAS", `${meta.kpis.roas}x`],
          ["Purchases", meta.kpis.purchases], ["Revenue", formatINR(meta.kpis.purchaseValue)],
          ["CAC", formatINR(meta.kpis.cac)], ["CTR", `${meta.kpis.ctr}%`],
          ["Add to Cart", meta.kpis.atc], ["Checkout", meta.kpis.checkout],
        ],
      });
      if (meta.campaigns.length > 0) {
        sections.push({
          title: "Campaigns",
          headers: ["Campaign", "Spend", "Purchases", "Revenue", "ROAS", "CTR"],
          rows: meta.campaigns.map(c => [c.name, formatINR(c.spend), c.purchases, formatINR(c.purchaseValue), `${c.roas}x`, `${c.ctr}%`]),
        });
      }
    }
    if (gads && g) {
      sections.push({
        title: "Google Ads Attribution",
        headers: ["Metric", "Value"],
        rows: [
          ["Ad Spend", formatINR(g.spend)], ["ROAS", `${g.roas}x`],
          ["Conversions", googleConversions], ["Conversion Value", formatINR(g.conversionValue)],
          ["Clicks", g.clicks], ["CTR", `${g.ctr}%`], ["Avg CPC", formatINR(g.avgCpc)],
        ],
      });
      if (gads.campaigns.length > 0) {
        sections.push({
          title: "Google Ads Campaigns",
          headers: ["Campaign", "Spend", "Conversions", "Value", "ROAS", "CTR"],
          rows: gads.campaigns.map(c => [c.name, formatINR(c.spend), Math.round(c.conversions), formatINR(c.conversionValue), `${c.roas}x`, `${c.ctr}%`]),
        });
      }
    }
    if (ga4 && ga4.channels.length > 0) {
      sections.push({
        title: "GA4 Channel Attribution",
        headers: ["Channel", "Sessions", "Purchases", "Revenue", "% of Sessions"],
        rows: ga4.channels.map(c => [c.channel, c.sessions, c.purchases, formatINR(c.revenue), totalGa4Sess > 0 ? `${Math.round(c.sessions / totalGa4Sess * 100)}%` : "-"]),
      });
    }
    return sections;
  }
  function handleExportCSV() { exportToCSV(`skylitee-attribution-${range.from}`, buildSections()); }
  async function handleExportPDF() {
    await exportToPDF(`skylitee-attribution-${range.from}`, "Attribution Report", rangeText(range), buildSections());
  }

  return (
    <div className="space-y-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#18181B] dark:text-[#F4F4F5] flex items-center gap-2"><Share2 size={18} className="text-[#F97316]" /> Channel Attribution</h2>
          <p className="text-[14px] text-[#A1A1AA] mt-0.5">
            <RangeText /> · Last-click model · {[metaOk && "Meta", gads && "Google Ads", ga4Ok && "GA4", shopOk && "Shopify"].filter(Boolean).join(" + ")}
          </p>
        </div>
        <ExportButton onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} />
      </div>

      {gadsIssue && (
        <div className="text-[14px] text-[#92400E] dark:text-[#FCD34D] bg-[#FFFBEB] dark:bg-[#2D1C00] border border-[#FCD34D] rounded-xl px-3 py-2">
          Google Ads isn&apos;t in these numbers, so organic may look higher than it is. {gadsIssueText(gadsIssue)}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <KPICard label="Total Revenue" value={shopOk ? formatINR(totalRevenue) : "-"} />
        <KPICard label="Meta Revenue" value={metaOk ? formatINR(metaRevenue) : "-"} sub={metaOk ? `${metaPct}% of total` : "Connect Meta"} />
        <KPICard label="Google Ads Revenue" value={g ? formatINR(googleRevenue) : "-"} sub={g ? `${googlePct}% of total` : "Connect Google Ads"} />
        <KPICard label="Organic Revenue" value={shopOk ? formatINR(organicRevenue) : "-"} sub={shopOk ? `${organicPct}% of total` : "-"} />
        <KPICard label={metaOk && g ? "ROAS (all ads)" : "ROAS"}
          value={adSpendAll > 0 ? `${roasAll}x` : "-"}
          change={adSpendAll > 0 ? (roasAll >= 2 ? 1 : -1) : undefined}
          changeLabel={adSpendAll > 0 ? (roasAll >= 3 ? "Strong" : roasAll >= 2 ? "Average" : "Below target") : undefined} />
        <KPICard label="Ad Spend" value={metaOk || g ? formatINR(adSpendAll) : "-"} sub={metaOk && g ? `Meta ${formatINR(meta!.kpis.spend)} · Google ${formatINR(g.spend)}` : metaOk ? `CAC ${formatINR(meta!.kpis.cac)}` : g ? "Google Ads" : "Connect Meta or Google Ads"} />
      </div>

      {/* GA4 Channel Breakdown + Paid vs Organic */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        <Card className="col-span-1 lg:col-span-2">
          <CardHeader title="Channel Breakdown" right={<span className="text-[13px] text-[#A1A1AA]">GA4 last-click · {ga4Channels.length} channels</span>} />
          {!ga4Ok ? (
            <div className="py-8 text-center">
              <p className="text-[15px] text-[#A1A1AA]">Connect GA4 to see channel breakdown</p>
              <Link href="/dashboard/connections" className="text-[14px] text-[#F97316] font-semibold mt-1 inline-block">Connect →</Link>
            </div>
          ) : ga4Channels.length === 0 ? (
            <div className="py-8 text-center text-[14px] text-[#A1A1AA]">No channel data for this period</div>
          ) : (
            <>
              {/* Stacked bar */}
              <div className="flex h-3 rounded-full overflow-hidden mt-3 gap-px">
                {ga4Channels.slice(0, 7).map(ch => {
                  const w = totalGa4Sess > 0 ? (ch.sessions / totalGa4Sess * 100) : 0;
                  return w > 0.5 ? (
                    <div key={ch.channel} title={`${ch.channel}: ${Math.round(w)}%`}
                      style={{ width: `${w}%`, backgroundColor: CH_COLOR[ch.channel] ?? CH_FALLBACK }} />
                  ) : null;
                })}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 mb-3">
                {ga4Channels.slice(0, 7).map(ch => (
                  <div key={ch.channel} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CH_COLOR[ch.channel] ?? CH_FALLBACK }} />
                    <span className="text-[12px] text-[#A1A1AA]">{ch.channel}</span>
                  </div>
                ))}
              </div>

              {/* Table */}
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                    {["Channel", "Sessions", "% Sessions", "Purchases", "Revenue"].map(h => (
                      <th key={h} className="text-left py-1.5 px-1.5 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ga4Channels.map(ch => {
                    const sessPct = totalGa4Sess > 0 ? Math.round(ch.sessions / totalGa4Sess * 100) : 0;
                    return (
                      <tr key={ch.channel} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors">
                        <td className="py-2 px-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CH_COLOR[ch.channel] ?? CH_FALLBACK }} />
                            <span className="font-medium text-[#18181B] dark:text-[#F4F4F5]">{ch.channel}</span>
                          </div>
                        </td>
                        <td className="py-2 px-1.5 text-[#71717A]">{ch.sessions.toLocaleString("en-IN")}</td>
                        <td className="py-2 px-1.5">
                          <div className="flex items-center gap-1.5">
                            <div className="w-14 h-1.5 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${sessPct}%`, backgroundColor: CH_COLOR[ch.channel] ?? CH_FALLBACK }} />
                            </div>
                            <span className="text-[13px] text-[#A1A1AA]">{sessPct}%</span>
                          </div>
                        </td>
                        <td className="py-2 px-1.5 font-semibold text-[#18181B] dark:text-[#F4F4F5]">{ch.purchases}</td>
                        <td className="py-2 px-1.5 font-semibold text-[#F97316]">{ch.revenue > 0 ? formatINR(ch.revenue) : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </Card>

        {/* Paid vs Organic */}
        <Card>
          <CardHeader title="Paid vs Organic" />
          <div className="mt-2 space-y-3">
            <div className={cn("rounded-2xl p-3.5 border", metaOk
              ? "bg-[#EFF6FF] dark:bg-[#0D1E3D] border-[#BFDBFE] dark:border-[#1E3A5F]"
              : "bg-[#F5F5F4] dark:bg-[#1C1C1C] border-black/[0.06] dark:border-white/[0.06]")}>
              <div className="flex items-center gap-2 mb-2">
                <Share2 size={12} className="text-[#1877F2]" />
                <span className="text-[13px] font-bold text-[#1877F2]">Meta Paid</span>
                {metaOk && <span className="ml-auto text-[15px] font-black text-[#1877F2]">{metaPct}%</span>}
              </div>
              <div className="text-[20px] font-black text-[#18181B] dark:text-[#F4F4F5]">{metaOk ? formatINR(metaRevenue) : "-"}</div>
              {metaOk && (
                <div className="mt-1.5 space-y-0.5">
                  <div className="text-[13px] text-[#A1A1AA]">Spend: <span className="font-semibold text-[#18181B] dark:text-[#F4F4F5]">{formatINR(meta!.kpis.spend)}</span></div>
                  <div className="text-[13px] text-[#A1A1AA]">ROAS: <span className={cn("font-black", meta!.kpis.roas >= 3 ? "text-[#22C55E]" : meta!.kpis.roas >= 2 ? "text-[#EAB308]" : "text-[#EF4444]")}>{meta!.kpis.roas}x</span></div>
                  <div className="text-[13px] text-[#A1A1AA]">Purchases: <span className="font-semibold text-[#18181B] dark:text-[#F4F4F5]">{meta!.kpis.purchases}</span></div>
                </div>
              )}
            </div>

            {g && (
              <div className="rounded-2xl p-3.5 bg-[#FEFCE8] dark:bg-[#2D1C00] border border-[#FDE68A] dark:border-[#713F12]">
                <div className="flex items-center gap-2 mb-2">
                  <Megaphone size={12} className="text-[#A16207]" />
                  <span className="text-[13px] font-bold text-[#A16207] dark:text-[#FCD34D]">Google Ads</span>
                  <span className="ml-auto text-[15px] font-black text-[#A16207] dark:text-[#FCD34D]">{googlePct}%</span>
                </div>
                <div className="text-[20px] font-black text-[#18181B] dark:text-[#F4F4F5]">{formatINR(googleRevenue)}</div>
                <div className="mt-1.5 space-y-0.5">
                  <div className="text-[13px] text-[#A1A1AA]">Spend: <span className="font-semibold text-[#18181B] dark:text-[#F4F4F5]">{formatINR(g.spend)}</span></div>
                  {googleRevenue > 0 && <div className="text-[13px] text-[#A1A1AA]">ROAS: <span className={cn("font-black", g.roas >= 3 ? "text-[#22C55E]" : g.roas >= 2 ? "text-[#EAB308]" : "text-[#EF4444]")}>{g.roas}x</span></div>}
                  <div className="text-[13px] text-[#A1A1AA]">Conversions: <span className="font-semibold text-[#18181B] dark:text-[#F4F4F5]">{googleConversions}</span></div>
                </div>
              </div>
            )}

            <div className="rounded-2xl p-3.5 bg-[#F0FDF4] dark:bg-[#052E16] border border-[#BBF7D0] dark:border-[#166534]">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={12} className="text-[#22C55E]" />
                <span className="text-[13px] font-bold text-[#22C55E]">Organic / Direct</span>
                {shopOk && <span className="ml-auto text-[15px] font-black text-[#22C55E]">{organicPct}%</span>}
              </div>
              <div className="text-[20px] font-black text-[#18181B] dark:text-[#F4F4F5]">{shopOk ? formatINR(organicRevenue) : "-"}</div>
              {shopOk && (
                <div className="mt-1.5">
                  <div className="text-[13px] text-[#A1A1AA]">Est. orders: <span className="font-semibold text-[#18181B] dark:text-[#F4F4F5]">{Math.max(0, shopOrders - metaOrders - googleConversions)}</span></div>
                </div>
              )}
            </div>

            {(metaOk || g || shopOk) && (
              <div>
                <div className="flex h-2 rounded-full overflow-hidden">
                  <div className="bg-[#1877F2]" style={{ width: `${metaPct}%` }} />
                  {g && <div className="bg-[#EAB308]" style={{ width: `${googlePct}%` }} />}
                  <div className="bg-[#22C55E] flex-1" />
                </div>
                <div className="flex justify-between gap-2 mt-1.5">
                  <span className="text-[12px] text-[#A1A1AA] flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#1877F2]" />Meta {metaPct}%</span>
                  {g && <span className="text-[12px] text-[#A1A1AA] flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#EAB308]" />Google {googlePct}%</span>}
                  <span className="text-[12px] text-[#A1A1AA] flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#22C55E]" />Organic {organicPct}%</span>
                </div>
              </div>
            )}

            {/* Mini Meta funnel rates */}
            {metaOk && (
              <div className="pt-2 border-t border-black/[0.06] dark:border-white/[0.06] space-y-1.5">
                <div className="text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider">Meta Pixel Rates</div>
                {[
                  { label: "LPV → ATC", value: meta!.kpis.atcRatio },
                  { label: "ATC → Checkout", value: meta!.kpis.checkoutRatio },
                  { label: "Checkout → Purchase", value: meta!.kpis.purchaseRatio },
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between">
                    <span className="text-[13px] text-[#A1A1AA]">{r.label}</span>
                    <span className={cn("text-[14px] font-bold", r.value >= 50 ? "text-[#22C55E]" : r.value >= 20 ? "text-[#EAB308]" : "text-[#EF4444]")}>{r.value}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Cross-Platform Conversion Funnel */}
      {(metaOk || ga4Ok) && (() => {
        const steps = [
          ga4Ok && { label: "Website Sessions", value: ga4!.kpis.sessions, source: "GA4", color: "#6366F1" },
          metaOk && { label: "Ad Clicks", value: meta!.kpis.clicks, source: "Meta", color: "#1877F2" },
          metaOk && meta!.kpis.lpv > 0 && { label: "Landing Page Views", value: meta!.kpis.lpv, source: "Meta Pixel", color: "#3B82F6" },
          metaOk && { label: "Add to Cart", value: meta!.kpis.atc, source: "Meta Pixel", color: "#F97316" },
          metaOk && { label: "Checkout Started", value: meta!.kpis.checkout, source: "Meta Pixel", color: "#EAB308" },
          metaOk && { label: "Purchases (Meta)", value: meta!.kpis.purchases, source: "Meta Pixel", color: "#22C55E" },
          shopOk && { label: "Total Shopify Orders", value: shopOrders, source: "Shopify", color: "#96F3C5" },
        ].filter((s): s is { label: string; value: number; source: string; color: string } => !!s && s.value > 0);
        if (steps.length < 2) return null;
        const maxVal = Math.max(...steps.map(s => s.value));
        return (
          <Card>
            <CardHeader title="Cross-Platform Conversion Funnel"
              right={<span className="text-[13px] text-[#A1A1AA]">{[ga4Ok && "GA4", metaOk && "Meta Pixel", shopOk && "Shopify"].filter(Boolean).join(" + ")}</span>} />
            <div className="mt-3 space-y-2">
              {steps.map((step, i) => {
                const barPct = maxVal > 0 ? Math.round(step.value / maxVal * 100) : 0;
                const dropOff = i > 0 && steps[i - 1].value > 0 ? Math.round((1 - step.value / steps[i - 1].value) * 100) : 0;
                return (
                  <div key={step.label} className="flex items-center gap-3">
                    <div className="w-40 shrink-0">
                      <div className="text-[14px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">{step.label}</div>
                      <div className="text-[12px] text-[#A1A1AA]">{step.source}</div>
                    </div>
                    <div className="flex-1 h-5 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-lg overflow-hidden">
                      <div className="h-full rounded-lg flex items-center px-2"
                        style={{ width: `${Math.max(barPct, 3)}%`, backgroundColor: step.color, opacity: 0.85 }}>
                        <span className="text-[12px] font-bold text-white whitespace-nowrap">
                          {step.value.toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>
                    <div className="w-14 text-right shrink-0">
                      {i > 0 && dropOff > 0
                        ? <span className="text-[13px] text-[#EF4444] font-semibold">-{dropOff}%</span>
                        : <span className="text-[13px] text-[#A1A1AA]">base</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })()}

      {/* Campaigns + GA4 Ecommerce */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

        {metaOk && (
          <Card>
            <CardHeader title="Meta Campaign Attribution" right={<span className="text-[13px] text-[#A1A1AA]">{meta!.campaigns.length} campaigns</span>} />
            <table className="w-full text-[14px] mt-2">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                  {["Campaign", "Spend", "Purchases", "Revenue", "ROAS"].map(h => (
                    <th key={h} className="text-left py-1.5 px-1 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {meta!.campaigns.length === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-[14px] text-[#A1A1AA]">No campaigns this period</td></tr>
                ) : meta!.campaigns.slice(0, 8).map(c => (
                  <tr key={c.id} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors">
                    <td className="py-2 px-1 max-w-[160px]">
                      <div className="truncate font-medium text-[#18181B] dark:text-[#F4F4F5]">{c.name}</div>
                      <div className="text-[12px] text-[#A1A1AA] capitalize">{c.status.toLowerCase()} · {c.atc} ATC</div>
                    </td>
                    <td className="py-2 px-1 text-[#A1A1AA]">{formatINR(c.spend)}</td>
                    <td className="py-2 px-1 font-semibold text-[#18181B] dark:text-[#F4F4F5]">{c.purchases}</td>
                    <td className="py-2 px-1 font-semibold text-[#F97316]">{formatINR(c.purchaseValue)}</td>
                    <td className="py-2 px-1">
                      <span className={cn("font-black text-[15px]",
                        c.roas >= 3 ? "text-[#22C55E]" : c.roas >= 2 ? "text-[#EAB308]" : "text-[#EF4444]")}>
                        {c.roas}x
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {gads && gads.campaigns.length > 0 && (
          <Card>
            <CardHeader title="Google Ads Campaign Attribution" right={<span className="text-[13px] text-[#A1A1AA]">{gads.campaigns.length} campaigns</span>} />
            <table className="w-full text-[14px] mt-2">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                  {["Campaign", "Spend", "Conversions", "Value", "ROAS"].map(h => (
                    <th key={h} className="text-left py-1.5 px-1 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gads.campaigns.slice(0, 8).map(c => (
                  <tr key={c.id} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors">
                    <td className="py-2 px-1 max-w-[160px]">
                      <div className="truncate font-medium text-[#18181B] dark:text-[#F4F4F5]">{c.name}</div>
                      <div className="text-[12px] text-[#A1A1AA] capitalize">{c.status.toLowerCase()} · {c.clicks.toLocaleString("en-IN")} clicks</div>
                    </td>
                    <td className="py-2 px-1 text-[#A1A1AA]">{formatINR(c.spend)}</td>
                    <td className="py-2 px-1 font-semibold text-[#18181B] dark:text-[#F4F4F5]">{Math.round(c.conversions)}</td>
                    <td className="py-2 px-1 font-semibold text-[#F97316]">{formatINR(c.conversionValue)}</td>
                    <td className="py-2 px-1">
                      {c.conversionValue > 0
                        ? <span className={cn("font-black text-[15px]", c.roas >= 3 ? "text-[#22C55E]" : c.roas >= 2 ? "text-[#EAB308]" : "text-[#EF4444]")}>{c.roas}x</span>
                        : <span className="text-[#A1A1AA]">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {ga4Ok && ga4?.ecommerce && ga4.ecommerce.itemsViewed > 0 && (
          <Card>
            <CardHeader title="GA4 Ecommerce Funnel" right={<span className="text-[13px] text-[#A1A1AA]">Native GA4 tracking</span>} />
            <div className="mt-3 space-y-3">
              {[
                { label: "Items Viewed", value: ga4.ecommerce.itemsViewed, color: "#6366F1", rate: "" },
                { label: "Add to Cart", value: ga4.ecommerce.itemsAddedToCart, color: "#F97316", rate: `${ga4.ecommerce.atcRate}% of views` },
                { label: "Checkout Started", value: ga4.ecommerce.itemsCheckedOut, color: "#EAB308", rate: `${ga4.ecommerce.checkoutRate}% of ATC` },
                { label: "Purchased", value: ga4.ecommerce.itemsPurchased, color: "#22C55E", rate: `${ga4.ecommerce.purchaseRate}% of checkout` },
              ].map(step => {
                const barPct = ga4.ecommerce!.itemsViewed > 0 ? Math.round(step.value / ga4.ecommerce!.itemsViewed * 100) : 0;
                return (
                  <div key={step.label}>
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <span className="text-[14px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">{step.label}</span>
                        {step.rate && <span className="text-[12px] text-[#A1A1AA] ml-2">{step.rate}</span>}
                      </div>
                      <span className="text-[16px] font-black" style={{ color: step.color }}>
                        {step.value.toLocaleString("en-IN")}
                      </span>
                    </div>
                    <div className="h-1.5 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(barPct, 2)}%`, backgroundColor: step.color, opacity: 0.8 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {/* Meta Pixel Detail */}
      {metaOk && (
        <Card>
          <CardHeader title="Meta Pixel Detail" right={<span className="text-[13px] text-[#A1A1AA]">7d click · 1d view attribution window</span>} />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mt-2">
            {[
              { label: "Impressions", value: (meta!.kpis.impressions / 1000).toFixed(0) + "k" },
              { label: "Clicks", value: meta!.kpis.clicks.toLocaleString("en-IN") },
              { label: "CTR", value: `${meta!.kpis.ctr}%` },
              { label: "CPC", value: formatINR(meta!.kpis.cpc) },
              { label: "LPV", value: meta!.kpis.lpv.toLocaleString("en-IN") },
              { label: "ATC", value: meta!.kpis.atc.toLocaleString("en-IN") },
              { label: "Checkout", value: meta!.kpis.checkout.toLocaleString("en-IN") },
              { label: "Purchases", value: meta!.kpis.purchases.toLocaleString("en-IN") },
            ].map(kpi => (
              <div key={kpi.label} className="bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-2.5 text-center">
                <div className="text-[16px] font-black text-[#18181B] dark:text-[#F4F4F5]">{kpi.value}</div>
                <div className="text-[12px] text-[#A1A1AA] mt-0.5">{kpi.label}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

    </div>
  );
}
