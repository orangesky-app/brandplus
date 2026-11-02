"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useDateRange, rangeText } from "@/lib/date-range-context";
import { RangeText } from "@/components/ui/period";
import { fetchGoogleAds, gadsIssueText } from "@/lib/gads-client";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF, ExportSection } from "@/lib/export";
import { Donut } from "@/components/ui/charts";
import { BarChart3 } from "lucide-react";

/* ── Types ── */
interface ShopDaily { date: string; revenue: number; orders: number }
interface MetaDaily { date: string; spend: number; impressions: number; clicks: number; purchases: number; purchaseValue: number }
interface GadsDaily { date: string; spend: number; impressions: number; clicks: number; conversions: number; convValue: number }
interface MetaCampaign { objective: string; spend: number }
interface MetaKpis { spend: number; roas: number; cac: number; purchases: number; purchaseValue: number; leads: number; costPerLead: number; leadsByType?: { form: number; messaging: number; calls: number }; ctr: number; cpc: number; cpm: number; impressions: number; reach: number; clicks: number; lpv: number; frequency: number; aov?: number }

type Source = "store" | "meta" | "google" | "organic";
type Freq = "daily" | "weekly" | "monthly";
const SOURCES: { id: Source; label: string }[] = [
  { id: "store", label: "Store (all)" }, { id: "meta", label: "Meta" }, { id: "google", label: "Google" }, { id: "organic", label: "Organic" },
];
const ASSUMED_LEAD_CONV = 0.12;

/* ── Objective detection ── */
type Obj = "SALES" | "LEADS" | "TRAFFIC" | "AWARENESS" | "OTHER";
function normObj(raw: string): Obj {
  const r = (raw || "").toUpperCase();
  if (r.includes("SALES") || r.includes("CONVERSION")) return "SALES";
  if (r.includes("LEAD")) return "LEADS";
  if (r.includes("TRAFFIC") || r.includes("LINK_CLICK")) return "TRAFFIC";
  if (r.includes("AWARENESS") || r.includes("REACH") || r.includes("BRAND") || r.includes("VIDEO")) return "AWARENESS";
  return "OTHER";
}

/* ── Date helpers (local) ── */
const toLocal = (iso: string) => new Date(`${iso}T00:00:00`);
const fmtDay = (iso: string) => toLocal(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
function mondayOf(iso: string): string {
  const d = toLocal(iso); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface DayRow { date: string; sales: number; spend: number; orders: number; impr: number; clicks: number; conv: number }

export default function SalesAnalysisPage() {
  const { range } = useDateRange();
  const [shopDaily, setShopDaily] = useState<ShopDaily[]>([]);
  const [metaDaily, setMetaDaily] = useState<MetaDaily[]>([]);
  const [gadsDaily, setGadsDaily] = useState<GadsDaily[]>([]);
  const [gadsIssue, setGadsIssue] = useState<string | null>(null);
  const [metaKpis, setMetaKpis] = useState<MetaKpis | null>(null);
  const [gadsKpis, setGadsKpis] = useState<{ spend: number; roas: number; conversions: number; conversionValue: number; ctr: number; avgCpc: number } | null>(null);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [storeAov, setStoreAov] = useState(0);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<Source>("store");
  const [freq, setFreq] = useState<Freq>("weekly");

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      fetch(`/api/shopify/dashboard?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/meta?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetchGoogleAds(range.from, range.to),
    ]).then(([shopR, metaR, gadsR]) => {
      if (shopR.status === "fulfilled" && !shopR.value?.error) { setShopDaily(shopR.value.dailyRevenue ?? []); setStoreAov(shopR.value.kpis?.aov ?? 0); }
      if (metaR.status === "fulfilled" && !metaR.value?.error) { setMetaDaily(metaR.value.daily ?? []); setMetaKpis(metaR.value.kpis ?? null); setCampaigns(metaR.value.campaigns ?? []); }
      const google = gadsR.status === "fulfilled" ? gadsR.value : null;
      setGadsDaily(google?.data?.daily ?? []);
      setGadsKpis(google?.data?.kpis ?? null);
      setGadsIssue(gadsIssueText(google?.issue ?? null));
    }).finally(() => setLoading(false));
  }, [range.from, range.to]);

  /* Merge into one per-day series keyed by ISO date (Shopify spans the full range). */
  const days: DayRow[] = useMemo(() => {
    const meta = new Map(metaDaily.map(d => [d.date, d]));
    const gads = new Map(gadsDaily.map(d => [d.date, d]));
    return shopDaily.map(s => {
      const m = meta.get(s.date); const g = gads.get(s.date);
      const metaSales = m?.purchaseValue ?? 0, gSales = g?.convValue ?? 0;
      const metaSpend = m?.spend ?? 0, gSpend = g?.spend ?? 0;
      const metaOrders = m?.purchases ?? 0, gConv = g?.conversions ?? 0;
      if (source === "meta") return { date: s.date, sales: metaSales, spend: metaSpend, orders: metaOrders, impr: m?.impressions ?? 0, clicks: m?.clicks ?? 0, conv: metaOrders };
      if (source === "google") return { date: s.date, sales: gSales, spend: gSpend, orders: gConv, impr: g?.impressions ?? 0, clicks: g?.clicks ?? 0, conv: gConv };
      if (source === "organic") return { date: s.date, sales: Math.max(0, s.revenue - metaSales - gSales), spend: 0, orders: Math.max(0, s.orders - metaOrders - Math.round(gConv)), impr: 0, clicks: 0, conv: 0 };
      // store (all)
      return { date: s.date, sales: s.revenue, spend: metaSpend + gSpend, orders: s.orders, impr: (m?.impressions ?? 0) + (g?.impressions ?? 0), clicks: (m?.clicks ?? 0) + (g?.clicks ?? 0), conv: s.orders };
    });
  }, [shopDaily, metaDaily, gadsDaily, source]);

  /* Bucket by frequency. */
  const buckets = useMemo(() => {
    const key = (iso: string) => freq === "daily" ? iso : freq === "weekly" ? mondayOf(iso) : iso.slice(0, 7);
    const label = (k: string) => freq === "daily" ? fmtDay(k) : freq === "weekly" ? `Wk ${fmtDay(k)}` : toLocal(`${k}-01`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
    const map = new Map<string, DayRow & { key: string }>();
    for (const d of days) {
      const k = key(d.date);
      const cur = map.get(k) ?? { key: k, date: k, sales: 0, spend: 0, orders: 0, impr: 0, clicks: 0, conv: 0 };
      cur.sales += d.sales; cur.spend += d.spend; cur.orders += d.orders; cur.impr += d.impr; cur.clicks += d.clicks; cur.conv += d.conv;
      map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key)).map(b => ({ ...b, label: label(b.key) }));
  }, [days, freq]);

  /* Weekday (Mon–Fri) vs Weekend (Sat–Sun) + day-of-week. */
  const dow = useMemo(() => {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const byDow = names.map(n => ({ name: n, sales: 0, spend: 0, orders: 0 }));
    let wk = { sales: 0, spend: 0, orders: 0 }, we = { sales: 0, spend: 0, orders: 0 };
    for (const d of days) {
      const i = toLocal(d.date).getDay();
      byDow[i].sales += d.sales; byDow[i].spend += d.spend; byDow[i].orders += d.orders;
      if (i === 0 || i === 6) { we.sales += d.sales; we.spend += d.spend; we.orders += d.orders; }
      else { wk.sales += d.sales; wk.spend += d.spend; wk.orders += d.orders; }
    }
    // reorder Mon..Sun
    const ordered = [1, 2, 3, 4, 5, 6, 0].map(i => byDow[i]);
    return { ordered, wk, we };
  }, [days]);

  const total = useMemo(() => buckets.reduce((a, b) => ({ sales: a.sales + b.sales, spend: a.spend + b.spend, orders: a.orders + b.orders, impr: a.impr + b.impr, clicks: a.clicks + b.clicks, conv: a.conv + b.conv }), { sales: 0, spend: 0, orders: 0, impr: 0, clicks: 0, conv: 0 }), [buckets]);

  const roas = (sales: number, spend: number) => spend > 0 ? `${(sales / spend).toFixed(2)}×` : "-";
  const aov = (sales: number, orders: number) => orders > 0 ? formatINR(Math.round(sales / orders)) : "-";

  /* Dominant Meta objective. */
  const dominantObj: Obj = useMemo(() => {
    const m: Record<Obj, number> = { SALES: 0, LEADS: 0, TRAFFIC: 0, AWARENESS: 0, OTHER: 0 };
    campaigns.forEach(c => { m[normObj(c.objective)] += c.spend || 0; });
    return (Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] as Obj) ?? "SALES";
  }, [campaigns]);

  /* Export */
  function buildSections(): ExportSection[] {
    const head = ["Period", "Spend", "Sales", "ROAS", "Orders", "AOV"];
    return [{
      title: `Sales Analysis - ${SOURCES.find(s => s.id === source)!.label} · ${freq} · ${rangeText(range)}`,
      headers: head,
      rows: [
        ...buckets.map(b => [b.label, source === "organic" ? "-" : formatINR(Math.round(b.spend)), formatINR(Math.round(b.sales)), source === "organic" ? "-" : roas(b.sales, b.spend), String(b.orders), aov(b.sales, b.orders)]),
        ["TOTAL", source === "organic" ? "-" : formatINR(Math.round(total.spend)), formatINR(Math.round(total.sales)), source === "organic" ? "-" : roas(total.sales, total.spend), String(total.orders), aov(total.sales, total.orders)],
      ],
    }];
  }

  const objLabel: Record<Obj, string> = { SALES: "Sales", LEADS: "Leads", TRAFFIC: "Traffic", AWARENESS: "Awareness", OTHER: "Mixed" };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-[#18181B] dark:text-[#F4F4F5] flex items-center gap-2"><BarChart3 size={18} className="text-[#F97316]" /> Sales Analysis</h2>
          <p className="text-[15px] text-[#A1A1AA] mt-0.5">Store vs Meta vs Google vs Organic · by day / week / month · <RangeText /></p>
        </div>
        <ExportButton onExportCSV={() => exportToCSV("skylitee-sales-analysis", buildSections())} onExportPDF={() => exportToPDF("skylitee-sales-analysis", "Sales Analysis", rangeText(range), buildSections())} disabled={loading || buckets.length === 0} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl bg-[#F5F5F4] dark:bg-[#1C1C1C] p-0.5">
          {SOURCES.map(s => (
            <button key={s.id} onClick={() => setSource(s.id)} className={cn("px-3 py-1.5 rounded-lg text-[15px] font-semibold transition-colors", source === s.id ? "bg-white dark:bg-[#262626] text-[#F97316] shadow-sm" : "text-[#71717A] dark:text-[#A1A1AA]")}>{s.label}</button>
          ))}
        </div>
        <div className="inline-flex rounded-xl bg-[#F5F5F4] dark:bg-[#1C1C1C] p-0.5">
          {(["daily", "weekly", "monthly"] as Freq[]).map(f => (
            <button key={f} onClick={() => setFreq(f)} className={cn("px-3 py-1.5 rounded-lg text-[15px] font-semibold capitalize transition-colors", freq === f ? "bg-white dark:bg-[#262626] text-[#F97316] shadow-sm" : "text-[#71717A] dark:text-[#A1A1AA]")}>{f}</button>
          ))}
        </div>
      </div>

      {loading ? <div className="py-12 text-center text-[15px] text-[#A1A1AA]">Loading…</div> : (
        <>
          {/* Revenue mix donut */}
          {(() => {
            const storeRev = shopDaily.reduce((s, d) => s + d.revenue, 0);
            const metaR = metaKpis?.purchaseValue ?? 0;
            const gR = gadsKpis?.conversionValue ?? 0;
            const organicR = Math.max(0, storeRev - metaR - gR);
            return (
              <Card>
                <CardHeader title="Revenue mix" right={<span className="text-[13px] text-[#A1A1AA]">store sales by source</span>} />
                <Donut
                  segments={[
                    { label: "Organic / Direct", value: organicR, color: "#22C55E" },
                    { label: "Meta Ads", value: metaR, color: "#3B82F6" },
                    ...(gR > 0 ? [{ label: "Google Ads", value: gR, color: "#EAB308" }] : []),
                  ]}
                  centerValue={formatINR(storeRev)} centerLabel="total" size={150}
                />
              </Card>
            );
          })()}

          {/* Source summary cards (Store / Meta / Google) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Store */}
            <Card>
              <CardHeader title="Store (all channels)" />
              <div className="grid grid-cols-3 gap-2">
                <Kpi label="Sales" value={formatINR(shopDaily.reduce((s, d) => s + d.revenue, 0))} />
                <Kpi label="Ad spend" value={formatINR(Math.round((metaKpis?.spend ?? 0) + (gadsKpis?.spend ?? 0)))} />
                <Kpi label="Blended ROAS" value={roas(shopDaily.reduce((s, d) => s + d.revenue, 0), (metaKpis?.spend ?? 0) + (gadsKpis?.spend ?? 0))} tone="accent" />
                <Kpi label="Orders" value={String(shopDaily.reduce((s, d) => s + d.orders, 0))} />
                <Kpi label="AOV" value={formatINR(storeAov)} />
                <Kpi label="Organic sales" value={formatINR(Math.max(0, shopDaily.reduce((s, d) => s + d.revenue, 0) - (metaKpis?.purchaseValue ?? 0) - (gadsKpis?.conversionValue ?? 0)))} />
              </div>
            </Card>

            {/* Meta - objective-aware */}
            <Card>
              <CardHeader title="Meta Ads" right={<span className="text-[13px] font-bold px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1D4ED8]">{objLabel[dominantObj]}</span>} />
              {!metaKpis ? <div className="py-6 text-center text-[15px] text-[#A1A1AA]">Not connected</div> : (
                <div className="grid grid-cols-3 gap-2">
                  <Kpi label="Spend" value={formatINR(metaKpis.spend)} />
                  {dominantObj === "LEADS" ? (
                    <>
                      <Kpi label="Leads" value={String(metaKpis.leads)} tone="accent" />
                      <Kpi label="Cost / Lead" value={metaKpis.leads > 0 ? formatINR(metaKpis.costPerLead) : "-"} />
                      <Kpi label="WhatsApp" value={String(metaKpis.leadsByType?.messaging ?? 0)} />
                      <Kpi label="Form" value={String(metaKpis.leadsByType?.form ?? 0)} />
                      <Kpi label="Pipeline (est.)" value={formatINR(Math.round(metaKpis.leads * ASSUMED_LEAD_CONV * (storeAov || 0)))} />
                    </>
                  ) : dominantObj === "TRAFFIC" ? (
                    <>
                      <Kpi label="LP views" value={String(metaKpis.lpv)} tone="accent" />
                      <Kpi label="Cost / visit" value={metaKpis.lpv > 0 ? formatINR(Math.round(metaKpis.spend / metaKpis.lpv)) : "-"} />
                      <Kpi label="CTR" value={`${metaKpis.ctr}%`} />
                      <Kpi label="Clicks" value={metaKpis.clicks.toLocaleString("en-IN")} />
                      <Kpi label="CPC" value={formatINR(metaKpis.cpc)} />
                    </>
                  ) : dominantObj === "AWARENESS" ? (
                    <>
                      <Kpi label="Reach" value={metaKpis.reach.toLocaleString("en-IN")} tone="accent" />
                      <Kpi label="Impressions" value={metaKpis.impressions.toLocaleString("en-IN")} />
                      <Kpi label="CPM" value={formatINR(metaKpis.cpm)} />
                      <Kpi label="Frequency" value={`${metaKpis.frequency}×`} />
                      <Kpi label="CTR" value={`${metaKpis.ctr}%`} />
                    </>
                  ) : (
                    <>
                      <Kpi label="Sales" value={formatINR(metaKpis.purchaseValue)} />
                      <Kpi label="ROAS" value={`${metaKpis.roas}×`} tone="accent" />
                      <Kpi label="Orders" value={String(metaKpis.purchases)} />
                      <Kpi label="CAC" value={metaKpis.purchases > 0 ? formatINR(metaKpis.cac) : "-"} />
                      <Kpi label="CTR" value={`${metaKpis.ctr}%`} />
                    </>
                  )}
                </div>
              )}
            </Card>

            {/* Google */}
            <Card>
              <CardHeader title="Google Ads" />
              {!gadsKpis ? <div className="py-6 text-center text-[15px] text-[#A1A1AA]">{gadsIssue ?? "Not connected yet"}</div> : (
                <div className="grid grid-cols-3 gap-2">
                  <Kpi label="Spend" value={formatINR(gadsKpis.spend)} />
                  <Kpi label="Conv. value" value={formatINR(gadsKpis.conversionValue)} />
                  <Kpi label="ROAS" value={`${gadsKpis.roas}×`} tone="accent" />
                  <Kpi label="Conv." value={String(gadsKpis.conversions)} />
                  <Kpi label="CTR" value={`${gadsKpis.ctr}%`} />
                  <Kpi label="CPC" value={formatINR(gadsKpis.avgCpc)} />
                </div>
              )}
            </Card>
          </div>

          {/* Period breakdown */}
          <Card>
            <CardHeader title={`${SOURCES.find(s => s.id === source)!.label} - ${freq} breakdown`} right={<span className="text-[13px] text-[#A1A1AA]">{buckets.length} periods</span>} />
            <div className="overflow-x-auto">
              <table className="w-full text-[15px] min-w-[640px]">
                <thead>
                  <tr className="border-b border-black/[0.08] dark:border-white/[0.08] text-[13px] uppercase tracking-wide text-[#A1A1AA]">
                    <th className="text-left py-2 pr-3">Period</th>
                    {source !== "organic" && <th className="text-right py-2 px-3">Spend</th>}
                    <th className="text-right py-2 px-3">Sales</th>
                    {source !== "organic" && <th className="text-right py-2 px-3">ROAS</th>}
                    <th className="text-right py-2 px-3">Orders</th>
                    <th className="text-right py-2 px-3">AOV</th>
                    {(source === "meta" || source === "google") && <th className="text-right py-2 px-3">CTR</th>}
                  </tr>
                </thead>
                <tbody>
                  {buckets.map(b => (
                    <tr key={b.key} className="border-b border-black/[0.04] dark:border-white/[0.04] hover:bg-[#FAFAF9] dark:hover:bg-[#1C1C1C]">
                      <td className="py-2 pr-3 font-semibold text-[#18181B] dark:text-[#F4F4F5]">{b.label}</td>
                      {source !== "organic" && <td className="py-2 px-3 text-right tabular-nums">{formatINR(Math.round(b.spend))}</td>}
                      <td className="py-2 px-3 text-right tabular-nums font-semibold">{formatINR(Math.round(b.sales))}</td>
                      {source !== "organic" && <td className={cn("py-2 px-3 text-right tabular-nums font-bold", b.spend > 0 && b.sales / b.spend >= 2 ? "text-[#16A34A]" : b.spend > 0 && b.sales / b.spend < 1 ? "text-[#EF4444]" : "")}>{roas(b.sales, b.spend)}</td>}
                      <td className="py-2 px-3 text-right tabular-nums">{b.orders}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{aov(b.sales, b.orders)}</td>
                      {(source === "meta" || source === "google") && <td className="py-2 px-3 text-right tabular-nums">{b.impr > 0 ? `${(b.clicks / b.impr * 100).toFixed(1)}%` : "-"}</td>}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-black/[0.12] dark:border-white/[0.12] font-bold">
                    <td className="py-2 pr-3">Total</td>
                    {source !== "organic" && <td className="py-2 px-3 text-right tabular-nums">{formatINR(Math.round(total.spend))}</td>}
                    <td className="py-2 px-3 text-right tabular-nums">{formatINR(Math.round(total.sales))}</td>
                    {source !== "organic" && <td className="py-2 px-3 text-right tabular-nums">{roas(total.sales, total.spend)}</td>}
                    <td className="py-2 px-3 text-right tabular-nums">{total.orders}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{aov(total.sales, total.orders)}</td>
                    {(source === "meta" || source === "google") && <td className="py-2 px-3 text-right tabular-nums">{total.impr > 0 ? `${(total.clicks / total.impr * 100).toFixed(1)}%` : "-"}</td>}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Weekday vs Weekend + day-of-week */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card>
              <CardHeader title="Weekdays vs Weekend" right={<span className="text-[13px] text-[#A1A1AA]">{SOURCES.find(s => s.id === source)!.label}</span>} />
              <div className="grid grid-cols-2 gap-2">
                {[{ n: "Mon–Fri", d: dow.wk }, { n: "Sat–Sun", d: dow.we }].map(x => (
                  <div key={x.n} className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-3">
                    <div className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5] mb-1">{x.n}</div>
                    <div className="text-[18px] font-black text-[#18181B] dark:text-[#F4F4F5]">{formatINR(Math.round(x.d.sales))}</div>
                    <div className="text-[13px] text-[#A1A1AA]">{x.d.orders} orders{source !== "organic" && ` · ${roas(x.d.sales, x.d.spend)} ROAS`}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title="By day of week" right={<span className="text-[13px] text-[#A1A1AA]">find your best day</span>} />
              <div className="space-y-1">
                {(() => {
                  const max = Math.max(...dow.ordered.map(d => d.sales), 1);
                  return dow.ordered.map(d => (
                    <div key={d.name} className="flex items-center gap-2 text-[14px]">
                      <span className="w-8 text-[#71717A] dark:text-[#A1A1AA]">{d.name}</span>
                      <div className="flex-1 h-4 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded">
                        <div className="h-full rounded bg-[#F97316]" style={{ width: `${Math.round((d.sales / max) * 100)}%` }} />
                      </div>
                      <span className="w-20 text-right tabular-nums font-semibold text-[#18181B] dark:text-[#F4F4F5]">{formatINR(Math.round(d.sales))}</span>
                      {source !== "organic" && <span className="w-12 text-right tabular-nums text-[#A1A1AA]">{roas(d.sales, d.spend)}</span>}
                    </div>
                  ));
                })()}
              </div>
            </Card>
          </div>

          {source === "organic" && <p className="text-[14px] text-[#A1A1AA]">Organic = store sales − Meta-attributed − Google-attributed. No ad spend, so ROAS doesn&apos;t apply. This is the demand you get without paying per click.</p>}
          {source === "store" && <p className="text-[14px] text-[#A1A1AA]">Store ROAS is <b>blended</b> (all store revenue ÷ total ad spend) - the truest measure of whether your marketing pays back overall.</p>}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "accent" }) {
  return (
    <div>
      <div className="text-[12px] text-[#A1A1AA] uppercase tracking-wide">{label}</div>
      <div className={cn("text-[18px] font-black tabular-nums", tone === "accent" ? "text-[#F97316]" : "text-[#18181B] dark:text-[#F4F4F5]")}>{value}</div>
    </div>
  );
}
