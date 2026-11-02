"use client";
import { useEffect, useRef, useState } from "react";
import { useDateRange, formatReportPeriod } from "@/lib/date-range-context";
import { readGadsResponse } from "@/lib/gads-client";
import { Card, CardHeader } from "@/components/ui/card";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV } from "@/lib/export";
import { exportElementToPDF } from "@/lib/export-visual";
import { Donut, Gauge } from "@/components/ui/charts";
import { MonthwiseTable } from "../seo/monthwise";
import { buildPerfModel, perfMonthRows, type PerfModel } from "./model";
import { PrintablePerformance } from "./PrintablePerformance";
import { formatINR, cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, TrendingUp, ShoppingCart, Share2, Megaphone, Target, Trophy, Layers, Sparkles } from "lucide-react";
import Link from "next/link";

function Signal({ type, metric, value, detail }: { type: "good" | "warn" | "bad"; metric: string; value: string; detail: string }) {
  const s = {
    good: { bg: "bg-[#F0FDF4] dark:bg-[#052E16]/40 border-[#86EFAC] dark:border-[#166534]", icon: <CheckCircle2 size={15} className="text-[#16A34A] shrink-0 mt-0.5" />, label: "text-[#166534] dark:text-[#4ADE80]" },
    warn: { bg: "bg-[#FFFBEB] dark:bg-[#2D1C00]/40 border-[#FCD34D] dark:border-[#92400E]", icon: <AlertTriangle size={15} className="text-[#D97706] shrink-0 mt-0.5" />, label: "text-[#92400E] dark:text-[#FCD34D]" },
    bad: { bg: "bg-[#FEF2F2] dark:bg-[#2D0A0A]/40 border-[#FCA5A5] dark:border-[#991B1B]", icon: <XCircle size={15} className="text-[#DC2626] shrink-0 mt-0.5" />, label: "text-[#991B1B] dark:text-[#FCA5A5]" },
  }[type];
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-3", s.bg)}>
      {s.icon}
      <div><div className={cn("text-[14px] font-bold", s.label)}>{metric}: {value}</div>
        <div className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] mt-0.5 leading-relaxed">{detail}</div></div>
    </div>
  );
}

function PoleBar({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[14px] font-medium text-[#18181B] dark:text-[#F4F4F5]">{label}</span>
        <span className="text-[15px] font-extrabold tabular-nums" style={{ color }}>{value}</span>
      </div>
      <div className="h-2.5 rounded-full bg-[#F1F1F0] dark:bg-[#262626] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }} />
      </div>
    </div>
  );
}

interface ExportSection { title: string; headers: string[]; rows: (string | number)[][] }
function buildCSV(M: PerfModel): ExportSection[] {
  return [
    { title: "Performance KPIs", headers: ["Metric", "Value"], rows: M.hero.map(h => [h.label, h.value]) },
    { title: "Channel Attribution", headers: ["Channel", "Orders", "Revenue", "Ad Spend", "ROAS", "CTR"], rows: M.channels.map(c => [c.channel, c.orders, formatINR(c.revenue), c.spend == null ? "-" : formatINR(c.spend), c.roas == null ? "-" : `${c.roas}x`, c.ctr == null ? "-" : `${c.ctr}%`]) },
    { title: "Payment Split", headers: ["Type", "Orders"], rows: [["Prepaid", M.payment.prepaid], ["COD", M.payment.cod]] },
    ...(M.campaigns.length ? [{ title: "Campaign Performance", headers: ["Campaign", "Objective", "Status", "Spend", "ROAS", "Orders"], rows: M.campaigns.map(c => [c.name, c.objective, c.status, formatINR(c.spend), `${c.roas}x`, c.purchases || c.leads || 0]) }] : []),
    ...(M.months.length ? [{ title: "Last 3 Months", headers: ["Month", "Gross Sales", "Orders", "AOV", "Ad Spend", "Blended ROAS", "COD %"], rows: M.months.map(m => [m.label, formatINR(m.grossSales), m.orders, formatINR(m.aov), formatINR(m.spend), `${m.roas}x`, `${m.codPct}%`]) }] : []),
  ];
}

export default function PerformanceReportPage() {
  const { range } = useDateRange();
  const printRef = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState<PerfModel | null>(null);
  const [site, setSite] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const generatedAt = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    setLoading(true); setFailed(false);
    Promise.allSettled([
      fetch(`/api/shopify/sales?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/meta?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/ga4?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/meta/placement?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/shopify/monthly?months=3`).then(r => r.json()),
      fetch(`/api/meta/monthly?months=3`).then(r => r.json()),
      fetch(`/api/google/ads?from=${range.from}&to=${range.to}`).then(r => r.json()).catch(() => null),
    ]).then(([sR, mR, gR, pR, smR, mmR, gaR]) => {
      const sales = sR.status === "fulfilled" && !sR.value?.error ? sR.value : null;
      if (!sales) { setFailed(true); return; }
      const meta = mR.status === "fulfilled" && !mR.value?.error ? mR.value : null;
      const ga4 = gR.status === "fulfilled" && !gR.value?.error ? gR.value : null;
      const placement = pR.status === "fulfilled" && !pR.value?.error ? pR.value : null;
      const shopMonthly = smR.status === "fulfilled" && Array.isArray(smR.value?.months) ? smR.value.months : [];
      const metaMonthly = mmR.status === "fulfilled" && Array.isArray(mmR.value?.months) ? mmR.value.months : [];
      // Goes through the shared reader so an account billing in another currency stays out of ₹ totals.
      const gads = gaR.status === "fulfilled" ? readGadsResponse(gaR.value).data : null;
      const googleSpend = gads?.kpis.spend ?? 0;
      const googleConnected = !!gads;
      setSite(ga4?.property ?? meta?.adAccountName ?? "Your store");
      setModel(buildPerfModel({ sales, meta, sessions: ga4?.kpis?.sessions ?? 0, placement, shopMonthly, metaMonthly, googleSpend, googleConnected }));
    }).finally(() => setLoading(false));
  }, [range.from, range.to]);

  if (loading) return <div className="text-[16px] text-[#A1A1AA] py-20 text-center">Loading performance data…</div>;
  if (failed || !model) return (
    <div className="text-center py-16">
      <p className="text-[16px] text-[#71717A] mb-3">Could not load performance data.</p>
      <Link href="/dashboard/connections" className="text-[#F97316] font-semibold text-[15px]">Check Shopify connection →</Link>
    </div>
  );
  const M = model;
  const period = formatReportPeriod(range);
  const revTotal = M.revenueMix.reduce((s, x) => s + x.value, 0);

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 bg-[#F97316] rounded-lg flex items-center justify-center"><TrendingUp size={14} className="text-white" /></div>
              <h1 className="text-xl font-bold text-[#18181B] dark:text-[#F4F4F5]">Performance Marketing</h1>
            </div>
            <p className="text-[14px] text-[#A1A1AA] ml-9">{period} · Generated {generatedAt}</p>
          </div>
          <div data-html2canvas-ignore="true">
            <ExportButton
              onExportCSV={() => exportToCSV(`skylitee-performance-${range.from}`, buildCSV(M))}
              onExportPDF={() => printRef.current ? exportElementToPDF(printRef.current, `skylitee-performance-${range.from}`, { reportTitle: "Performance Marketing Report", subtitle: `${site} · ${period}`, branding: { brandName: "Skylitee", color: "#F97316" } }) : Promise.resolve()}
            />
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {M.hero.map(it => (
            <div key={it.label} className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-4">
              <div className="text-[12px] font-bold uppercase tracking-wide mb-1.5" style={{ color: it.accent }}>{it.label}</div>
              <div className="text-[22px] font-black text-[#18181B] dark:text-[#F4F4F5] leading-none">{it.value}</div>
              {it.sub && <div className="text-[12px] text-[#A1A1AA] mt-1">{it.sub}</div>}
            </div>
          ))}
        </div>

        {/* Objective KPIs */}
        {M.objectives.length > 0 && (
          <Card>
            <CardHeader title="🎯 KPIs by Ad Objective" right="what each objective is buying" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {M.objectives.map(o => (
                <div key={o.key} className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-3.5" style={{ background: `${o.color}0D` }}>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="flex items-center gap-2 text-[15px] font-extrabold" style={{ color: o.color }}><span className="w-2.5 h-2.5 rounded-sm" style={{ background: o.color }} />{o.label}</span>
                    <span className="text-[12px] text-[#71717A] dark:text-[#A1A1AA]">{formatINR(o.spend)} · {o.spendPct}%</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {o.cards.map(c => (
                      <div key={c.label} className="rounded-lg bg-white/70 dark:bg-white/[0.04] px-3 py-2">
                        <div className="text-[12px] text-[#A1A1AA]">{c.label}</div>
                        <div className="text-[17px] font-black text-[#18181B] dark:text-[#F4F4F5]">{c.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Revenue mix + Payment split */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <CardHeader title="Revenue Mix" right="store sales by source" />
            <Donut segments={M.revenueMix} centerValue={formatINR(revTotal)} centerLabel="total" />
          </Card>
          <Card>
            <CardHeader title="Payment Split" />
            <Donut segments={[{ label: "Prepaid", value: M.payment.prepaid, color: "#F97316" }, { label: "COD", value: M.payment.cod, color: "#EAB308" }]} centerValue={`${100 - M.payment.codPct}%`} centerLabel="prepaid" />
            {M.payment.codPct > 50 && <div className="mt-3 bg-[#FFFBEB] dark:bg-[#2D1C00] border border-[#FCD34D] rounded-xl p-2.5 text-[13px] text-[#92400E] dark:text-[#FCD34D]">High COD ({M.payment.codPct}%) - offer a prepaid discount to reduce RTO risk.</div>}
          </Card>
        </div>

        {/* Blended ROAS gauge + Meta funnel */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <CardHeader title="Blended ROAS" right="store ÷ total ad spend" />
            <Gauge value={Math.min(100, (M.blendedRoas / 3) * 100)} color={M.blendedRoas >= 2 ? "#22C55E" : M.blendedRoas >= 1 ? "#EAB308" : "#EF4444"} centerValue={M.blendedRoas ? `${M.blendedRoas}x` : "-"} centerLabel={M.blendedRoas >= 2 ? "profitable" : "below target"} />
            <p className="text-[13px] text-[#A1A1AA] text-center mt-1">Total ad spend {formatINR(M.totalSpend)}{M.googlePending ? " · Google pending" : ""}</p>
          </Card>
          {M.funnel && (
            <Card>
              <CardHeader title="Meta Funnel" right="clicks → purchase" />
              <div className="space-y-2.5">{M.funnel.map(f => <PoleBar key={f.label} label={f.label} value={f.value.toLocaleString("en-IN")} pct={f.pct} color={f.color} />)}</div>
            </Card>
          )}
        </div>

        {/* Channel attribution */}
        <Card>
          <CardHeader title="Channel Attribution" right="Orders & Revenue by source" />
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead><tr className="border-b border-black/[0.06] dark:border-white/[0.06]">{["Channel", "Orders", "Revenue", "Ad Spend", "ROAS", "CTR"].map((h, i) => <th key={h} className={cn("py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase", i ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
              <tbody>
                {M.channels.map((c, i) => (
                  <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                    <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]"><span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.color }} />{c.channel}</span></td>
                    <td className="py-2 px-2 text-right">{c.orders.toLocaleString("en-IN")}</td>
                    <td className="py-2 px-2 text-right font-semibold dark:text-[#F4F4F5]">{formatINR(c.revenue)}</td>
                    <td className="py-2 px-2 text-right text-[#A1A1AA]">{c.spend == null ? "-" : formatINR(c.spend)}</td>
                    <td className="py-2 px-2 text-right font-bold" style={{ color: c.roas == null ? "#A1A1AA" : c.roas >= 2 ? "#22C55E" : "#EF4444" }}>{c.roas == null ? "-" : `${c.roas}x`}</td>
                    <td className="py-2 px-2 text-right text-[#A1A1AA]">{c.ctr == null ? "-" : `${c.ctr}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Placement winners */}
        {M.winners.length > 0 && (
          <Card>
            <CardHeader title="🏆 What's Winning in Ads" right="best-performing segments" />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {M.winners.map(w => (
                <div key={w.title} className="rounded-xl border border-[#86EFAC] dark:border-[#166534] bg-[#F0FDF4] dark:bg-[#052E16]/40 p-3">
                  <div className="text-[12px] font-bold text-[#16A34A] uppercase tracking-wide mb-1">{w.icon} {w.title}</div>
                  <div className="text-[16px] font-black text-[#166534] dark:text-[#4ADE80] leading-tight">{w.value}</div>
                  <div className="text-[12px] text-[#15803D] dark:text-[#86EFAC] mt-0.5">{w.detail}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Campaign performance */}
        {M.campaigns.length > 0 && (
          <Card>
            <CardHeader title="Campaign Performance" right={`${M.campaigns.length} campaigns`} />
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead><tr className="border-b border-black/[0.06] dark:border-white/[0.06]">{["Campaign", "Objective", "Status", "Spend", "ROAS", "Orders"].map((h, i) => <th key={h} className={cn("py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase", i >= 3 ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
                <tbody>
                  {M.campaigns.map((c, i) => (
                    <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                      <td className="py-2 px-2 font-medium dark:text-[#F4F4F5] max-w-[220px]"><div className="truncate">{c.name}</div></td>
                      <td className="py-2 px-2 text-[#71717A] dark:text-[#A1A1AA]">{c.objective}</td>
                      <td className="py-2 px-2"><span className={cn("px-2 py-0.5 rounded-full text-[12px] font-bold", c.status === "ACTIVE" ? "bg-[#FFF7ED] text-[#EA580C]" : "bg-[#F5F5F4] text-[#71717A] dark:bg-[#262626]")}>{c.status}</span></td>
                      <td className="py-2 px-2 text-right font-semibold dark:text-[#F4F4F5]">{formatINR(c.spend)}</td>
                      <td className="py-2 px-2 text-right font-black" style={{ color: c.roas >= 2 ? "#22C55E" : c.roas >= 1 ? "#EAB308" : "#EF4444" }}>{c.roas}x</td>
                      <td className="py-2 px-2 text-right dark:text-[#F4F4F5]">{c.purchases || c.leads || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* 3-month comparison */}
        {M.months.length >= 2 && (
          <Card>
            <CardHeader title="Last 3 Months - Progress" right="vs previous month" />
            <MonthwiseTable headers={M.months.map(m => m.label)} rows={perfMonthRows(M.months)} />
          </Card>
        )}

        {/* Working / Attention */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <CardHeader title="✅ What's Working" />
            <div className="space-y-2">{M.working.length ? M.working.map((s, i) => <Signal key={i} {...s} />) : <p className="text-[15px] text-[#A1A1AA]">Connect Meta Ads for performance signals.</p>}</div>
          </Card>
          <Card>
            <CardHeader title="⚠️ Needs Improvement" />
            <div className="space-y-2">{M.attention.length ? M.attention.map((s, i) => <Signal key={i} {...s} />) : <p className="text-[15px] text-[#A1A1AA]">No major issues detected.</p>}</div>
          </Card>
        </div>

        {/* Conclusion */}
        <Card>
          <CardHeader title="✨ Conclusion" right="the bottom line" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-[#F0FDF4] dark:bg-[#052E16]/40 border border-[#86EFAC] dark:border-[#166534] p-3.5">
              <div className="text-[15px] font-extrabold text-[#16A34A] mb-2">Working &amp; positive</div>
              <ul className="space-y-1.5">{M.conclusion.positives.map((p, i) => <li key={i} className="text-[14px] text-[#3F3F46] dark:text-[#D4D4D8] leading-snug">• {p}</li>)}</ul>
            </div>
            <div className="rounded-xl bg-[#FEF2F2] dark:bg-[#2D0A0A]/40 border border-[#FCA5A5] dark:border-[#991B1B] p-3.5">
              <div className="text-[15px] font-extrabold text-[#DC2626] mb-2">To improve</div>
              <ul className="space-y-1.5">{M.conclusion.improvements.length ? M.conclusion.improvements.map((p, i) => <li key={i} className="text-[14px] text-[#3F3F46] dark:text-[#D4D4D8] leading-snug">• {p}</li>) : <li className="text-[14px] text-[#A1A1AA]">Nothing critical - keep scaling what works.</li>}</ul>
            </div>
          </div>
        </Card>
      </div>

      {/* Off-screen PDF layout */}
      <div ref={printRef} aria-hidden style={{ position: "absolute", left: -10000, top: 0, pointerEvents: "none" }}>
        <PrintablePerformance model={M} site={site} rangeLabel={period} generatedAt={generatedAt} />
      </div>
    </>
  );
}
