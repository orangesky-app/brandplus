"use client";
import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR } from "@/lib/utils";
import { useDateRange, rangeText } from "@/lib/date-range-context";
import { RangeText } from "@/components/ui/period";
import { exportToPDF, exportToCSV, ExportSection } from "@/lib/export";
import { ExportButton } from "@/components/ui/export-button";

/* Category reference benchmarks for Indian ethnic-wear D2C. These are industry reference
   values (competitors don't share live numbers) - only the "Your store" column is live. */
type Dir = "higher" | "lower";
interface MetricDef { key: string; label: string; dir: Dir; avg: number; top10: number; fmt: (v: number) => string }
const fmtX = (v: number) => `${v}x`;
const fmtPct = (v: number) => `${v}%`;
const fmtINR = (v: number) => formatINR(Math.round(v));
const METRICS: MetricDef[] = [
  { key: "roas",    label: "Meta ROAS",            dir: "higher", avg: 1.4,  top10: 2.8,  fmt: fmtX },
  { key: "ctr",     label: "CTR (Meta)",           dir: "higher", avg: 2.1,  top10: 5.0,  fmt: fmtPct },
  { key: "cpm",     label: "CPM",                  dir: "lower",  avg: 420,  top10: 200,  fmt: fmtINR },
  { key: "cac",     label: "CAC",                  dir: "lower",  avg: 650,  top10: 350,  fmt: fmtINR },
  { key: "aov",     label: "AOV",                  dir: "higher", avg: 980,  top10: 1600, fmt: fmtINR },
  { key: "organic", label: "Organic % revenue",   dir: "higher", avg: 18,   top10: 40,   fmt: fmtPct },
  { key: "cod",     label: "COD ratio",            dir: "lower",  avg: 45,   top10: 25,   fmt: fmtPct },
  { key: "repeat",  label: "Repeat purchase rate", dir: "higher", avg: 25,   top10: 40,   fmt: fmtPct },
];

const rankMeta: Record<string, { label: string; variant: "green" | "amber" | "red" | "blue" }> = {
  top20:    { label: "Top 20%",   variant: "green" },
  top30:    { label: "Top 30%",   variant: "green" },
  aboveavg: { label: "Above avg", variant: "blue" },
  mid40:    { label: "Mid 40%",   variant: "amber" },
  belowavg: { label: "Below avg", variant: "red" },
  bottom30: { label: "Bottom 30%", variant: "red" },
};
function rankFor(value: number, m: MetricDef): keyof typeof rankMeta {
  const { avg, top10, dir } = m;
  if (dir === "higher") {
    if (value >= top10) return "top20";
    if (value >= avg * 1.15) return "top30";
    if (value >= avg) return "aboveavg";
    if (value >= avg * 0.85) return "mid40";
    if (value >= avg * 0.6) return "belowavg";
    return "bottom30";
  }
  if (value <= top10) return "top20";
  if (value <= avg * 0.85) return "top30";
  if (value <= avg) return "aboveavg";
  if (value <= avg * 1.15) return "mid40";
  if (value <= avg * 1.4) return "belowavg";
  return "bottom30";
}

interface Row { def: MetricDef; value: number | null }
interface RoadItem { action: string; effort: "Low" | "Med" | "High"; impact: string; priority: "P1" | "P2" | "P3" }

export default function BenchmarkingPage() {
  const { range } = useDateRange();
  const [rows, setRows] = useState<Row[]>([]);
  const [roadmap, setRoadmap] = useState<RoadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [gadsConnected, setGadsConnected] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      fetch(`/api/meta?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/shopify/dashboard?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch("/api/shopify/customers").then(r => r.json()),
      fetch(`/api/google/ads?from=${range.from}&to=${range.to}`).then(r => r.json()),
    ]).then(([metaR, shopR, custR, gadsR]) => {
      const meta = metaR.status === "fulfilled" && !metaR.value?.error ? metaR.value.kpis : null;
      const shop = shopR.status === "fulfilled" && !shopR.value?.error ? shopR.value.kpis : null;
      const cust = custR.status === "fulfilled" && !custR.value?.error ? custR.value.kpis : null;
      const gads = gadsR.status === "fulfilled" && !gadsR.value?.error ? gadsR.value.kpis : null;
      setGadsConnected(!!gads);

      const codPct = shop ? Math.round((shop.codOrders / Math.max(shop.totalOrders, 1)) * 100) : null;
      const organicPct = shop && meta && shop.grossSales > 0 ? Math.max(0, Math.round((1 - meta.purchaseValue / shop.grossSales) * 100)) : null;
      const repeatPct = cust && cust.totalCustomers > 0 ? Math.round((cust.repeat / cust.totalCustomers) * 100) : null;

      const valueOf: Record<string, number | null> = {
        roas: meta?.roas ?? null,
        ctr: meta?.ctr ?? null,
        cpm: meta?.cpm ?? null,
        cac: meta && meta.purchases > 0 ? meta.cac : null,
        aov: shop?.aov ?? null,
        organic: organicPct,
        cod: codPct,
        repeat: repeatPct,
      };
      setRows(METRICS.map(def => ({ def, value: valueOf[def.key] })));

      // ── Roadmap generated from real gaps, ordered by priority ──
      const out: RoadItem[] = [];
      if (codPct !== null && codPct > 45) {
        const save = Math.round((shop!.codOrders) * 0.25 * 80); // est. RTO savings at ~25% RTO × ₹80
        out.push({ action: "Launch a ₹75 prepaid incentive (free ship / discount on prepaid)", effort: "Low", impact: `COD ${codPct}% → cut RTO, est. ${formatINR(save)}/period saved`, priority: "P1" });
      }
      if (repeatPct !== null && repeatPct < 25) {
        out.push({ action: "Post-purchase flow: Day-7 email/WhatsApp + loyalty points", effort: "Med", impact: `Repeat ${repeatPct}% → 25% benchmark = more revenue with zero ad spend`, priority: "P1" });
      }
      if (meta && meta.roas < 1.4) {
        out.push({ action: "Fix the weakest funnel stage & pause sub-1x campaigns", effort: "Med", impact: `ROAS ${meta.roas}x → lift toward 1.4x category avg`, priority: "P1" });
      }
      if (meta && meta.purchases > 0 && meta.cac > 650) {
        out.push({ action: "Tighten targeting / refresh creative to lower CAC", effort: "Med", impact: `CAC ${formatINR(meta.cac)} vs ₹650 avg - aim −15%`, priority: "P2" });
      }
      if (shop && shop.aov < 980) {
        out.push({ action: "Bundles & cart upsell to raise AOV", effort: "Low", impact: `AOV ${formatINR(shop.aov)} → ₹980 avg lifts ROAS too`, priority: "P2" });
      }
      if (!gads) {
        out.push({ action: "Connect Google Ads (capture high-intent search demand)", effort: "Med", impact: "New profitable channel + true blended ROAS", priority: "P2" });
      }
      if (organicPct !== null && organicPct < 40) {
        out.push({ action: "Publish SEO content for ethnic-wear keywords", effort: "High", impact: `Organic ${organicPct}% → 40% top-tier reduces ad dependence`, priority: "P3" });
      }
      const pOrder = { P1: 0, P2: 1, P3: 2 };
      setRoadmap(out.sort((a, b) => pOrder[a.priority] - pOrder[b.priority]));
    }).finally(() => setLoading(false));
  }, [range.from, range.to]);

  function buildSections(): ExportSection[] {
    return [
      { title: `Benchmarks vs D2C category - ${rangeText(range)}`, headers: ["Metric", "Your store", "Category avg", "Top 10%", "Rank"],
        rows: rows.map(r => [r.def.label, r.value !== null ? r.def.fmt(r.value) : "-", r.def.fmt(r.def.avg), r.def.fmt(r.def.top10), r.value !== null ? rankMeta[rankFor(r.value, r.def)].label : "-"]) },
      { title: "90-day improvement roadmap", headers: ["Action", "Effort", "Expected impact", "Priority"],
        rows: roadmap.map(r => [r.action, r.effort, r.impact, r.priority]) },
    ];
  }
  const handleCSV = () => exportToCSV("skylitee-benchmarking", buildSections());
  const handlePDF = () => exportToPDF("skylitee-benchmarking", "Competitor Benchmarking", `Your store vs Indian ethnic D2C · ${rangeText(range)}`, buildSections());

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Trophy size={18} className="text-[#F97316]" /> Competitor Benchmarking</h2>
          <p className="text-[17px] text-[#686864] mt-0.5">
            Your <span className="font-medium text-[#181816]">live</span> store metrics (<RangeText />) vs Indian ethnic-wear D2C category reference averages
          </p>
        </div>
        <ExportButton onExportCSV={handleCSV} onExportPDF={handlePDF} disabled={rows.length === 0} />
      </div>

      {loading ? (
        <div className="text-[17px] text-[#686864] py-10 text-center">Loading your live metrics…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {/* Key metric comparison */}
          <Card>
            <CardHeader title="Key metric comparison" right="Your store = live" />
            <div className="overflow-x-auto">
              <table className="w-full text-[17px] border-collapse">
                <thead>
                  <tr className="border-b border-black/[0.09]">
                    {["Metric", "Your store", "Category avg", "Top 10%", "Your rank"].map(h => (
                      <th key={h} className="text-left py-1.5 px-1.5 text-[16px] font-semibold text-[#686864]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const rank = r.value !== null ? rankFor(r.value, r.def) : null;
                    return (
                      <tr key={i} className="border-b border-black/[0.06] last:border-0 hover:bg-[#f7f7f5]">
                        <td className="py-2 px-2">{r.def.label}</td>
                        <td className="py-1.5 px-1.5 font-bold text-[#181816]">{r.value !== null ? r.def.fmt(r.value) : <span className="text-[#a3a39e] font-normal">connect platform</span>}</td>
                        <td className="py-1.5 px-1.5 text-[#686864]">{r.def.fmt(r.def.avg)}</td>
                        <td className="py-1.5 px-1.5 text-[#686864]">{r.def.fmt(r.def.top10)}{r.def.dir === "lower" ? "↓" : "+"}</td>
                        <td className="py-2 px-2">{rank ? <Badge variant={rankMeta[rank].variant}>{rankMeta[rank].label}</Badge> : <span className="text-[#a3a39e] text-[15px]">-</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[14px] text-[#a3a39e] mt-2">Category avg / Top 10% are D2C-India reference benchmarks (competitors don&apos;t publish live data). Only &quot;Your store&quot; is live.</p>
          </Card>

          {/* Roadmap generated from gaps */}
          <Card>
            <CardHeader title="90-day improvement roadmap" right="From your gaps" />
            {roadmap.length === 0 ? (
              <div className="text-[17px] text-[#686864] py-8 text-center">You&apos;re at or above category benchmarks across the board - keep scaling. 🎯</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[17px] border-collapse">
                  <thead>
                    <tr className="border-b border-black/[0.09]">
                      {["Action", "Effort", "Expected impact", "P"].map(h => (
                        <th key={h} className="text-left py-1.5 px-1.5 text-[16px] font-semibold text-[#686864]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roadmap.map((r, i) => (
                      <tr key={i} className="border-b border-black/[0.06] last:border-0 hover:bg-[#f7f7f5]">
                        <td className="py-1.5 px-1.5 text-[15px]">{r.action}</td>
                        <td className="py-2 px-2"><Badge variant={r.effort === "Low" ? "green" : r.effort === "Med" ? "amber" : "red"}>{r.effort}</Badge></td>
                        <td className="py-1.5 px-1.5 text-[15px]">{r.impact}</td>
                        <td className="py-2 px-2"><Badge variant={r.priority === "P1" ? "red" : r.priority === "P2" ? "amber" : "blue"}>{r.priority}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
