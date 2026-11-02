"use client";
import { useEffect, useState } from "react";
import { KPICard } from "@/components/ui/kpi-card";
import { Card, CardHeader } from "@/components/ui/card";
import { InsightCard } from "@/components/ui/insight-card";
import { BarRow } from "@/components/ui/bar-row";
import { formatINR } from "@/lib/utils";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF } from "@/lib/export";
import { useDateRange, formatDateSpan, rangeText } from "@/lib/date-range-context";
import { RangeText } from "@/components/ui/period";
import { RefreshCw, Users } from "lucide-react";
import { Donut } from "@/components/ui/charts";

type Mode = "all" | "period";

interface AllTimeData {
  kpis: { totalCustomers: number; repeat: number; oneTime: number; avgLTV: number; newThisMonth: number };
  topCities: { city: string; count: number; pct: number }[];
}
interface PeriodData {
  kpis: { activeBuyers: number; newBuyers: number; returningBuyers: number; repeatShare: number; spendPerBuyer: number; revenue: number; orders: number };
  topCities: { city: string; count: number; pct: number }[];
}

const cityColors = ["green", "blue", "amber", "purple", "teal", "green", "blue", "amber"] as const;

export default function CustomersPage() {
  const { range } = useDateRange();
  const [mode, setMode] = useState<Mode>("all");

  const [allData, setAllData] = useState<AllTimeData | null>(null);
  const [loadingAll, setLoadingAll] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [periodData, setPeriodData] = useState<PeriodData | null>(null);
  const [loadingPeriod, setLoadingPeriod] = useState(false);

  // All-time base - lifetime data, served from a short cache. `refresh` forces a live pull.
  const loadAll = (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoadingAll(true);
    fetch(`/api/shopify/customers${refresh ? "?refresh=1" : ""}`)
      .then(r => r.json())
      .then(d => { if (d.kpis) setAllData(d); })
      .finally(() => { setLoadingAll(false); setRefreshing(false); });
  };
  useEffect(() => { loadAll(); }, []);

  // Period view - refetched whenever the range changes, only while that tab is active.
  useEffect(() => {
    if (mode !== "period") return;
    setLoadingPeriod(true);
    setPeriodData(null);
    fetch(`/api/shopify/customers/period?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then(d => { if (d.kpis) setPeriodData(d); })
      .finally(() => setLoadingPeriod(false));
  }, [mode, range.from, range.to]);

  const loading = mode === "all" ? loadingAll : loadingPeriod;
  const data = mode === "all" ? allData : periodData;
  const topCities = data?.topCities ?? [];
  const maxCity = topCities.length ? Math.max(...topCities.map(c => c.count), 1) : 1;

  const repeatRate = allData ? Math.round((allData.kpis.repeat / Math.max(allData.kpis.totalCustomers, 1)) * 100) : 0;

  /* ── Export ── */
  function buildSections() {
    if (mode === "all") {
      if (!allData) return [];
      const k = allData.kpis;
      return [
        { title: "Customer KPIs (All-time)", headers: ["Metric", "Value"], rows: [
          ["Total Customers", k.totalCustomers],
          ["Avg LTV (Revenue per customer)", formatINR(k.avgLTV)],
          ["Repeat Rate", `${repeatRate}%`],
          ["Repeat Buyers", k.repeat],
          ["One-time Buyers", k.oneTime],
          ["New This Month", k.newThisMonth],
        ] },
        { title: "Top Cities by Customers", headers: ["#", "City", "Customers", "% of Total"],
          rows: allData.topCities.map((c, i) => [i + 1, c.city, c.count, `${c.pct}%`]) },
      ];
    }
    if (!periodData) return [];
    const k = periodData.kpis;
    return [
      { title: `Customer KPIs (${rangeText(range)})`, headers: ["Metric", "Value"], rows: [
        ["Active Buyers", k.activeBuyers],
        ["New Buyers", k.newBuyers],
        ["Returning Buyers", k.returningBuyers],
        ["Returning Share", `${k.repeatShare}%`],
        ["Spend / Buyer", formatINR(k.spendPerBuyer)],
        ["Revenue", formatINR(k.revenue)],
        ["Orders", k.orders],
      ] },
      { title: "Top Cities by Buyers", headers: ["#", "City", "Buyers", "% of Buyers"],
        rows: periodData.topCities.map((c, i) => [i + 1, c.city, c.count, `${c.pct}%`]) },
    ];
  }
  function handleExportCSV() { exportToCSV("skylitee-customers", buildSections()); }
  async function handleExportPDF() {
    await exportToPDF(
      "skylitee-customers", "Customer Intelligence",
      mode === "all" ? "Shopify live data · All-time" : `Shopify live data · ${rangeText(range)}`,
      buildSections()
    );
  }

  /* ── Segments per mode ── */
  const segments = mode === "all" && allData ? [
    { name: "Repeat buyers", icon: "🏆", count: allData.kpis.repeat, color: "text-[#0d6b4f]", border: "border-[#e0f5ee]", desc: "Ordered more than once" },
    { name: "One-time", icon: "🛍️", count: allData.kpis.oneTime, color: "text-[#5c3608]", border: "border-[#faecd7]", desc: "Only one order so far" },
    { name: "New this month", icon: "🆕", count: allData.kpis.newThisMonth, color: "text-[#0a3d7a]", border: "border-[#e4eef9]", desc: "Joined this month" },
  ] : mode === "period" && periodData ? [
    { name: "New buyers", icon: "🆕", count: periodData.kpis.newBuyers, color: "text-[#0a3d7a]", border: "border-[#e4eef9]", desc: "First-time customers" },
    { name: "Returning buyers", icon: "🏆", count: periodData.kpis.returningBuyers, color: "text-[#0d6b4f]", border: "border-[#e0f5ee]", desc: "Ordered before this period" },
    { name: "Orders", icon: "🛍️", count: periodData.kpis.orders, color: "text-[#5c3608]", border: "border-[#faecd7]", desc: "Placed in this period" },
  ] : [];

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold flex items-center gap-2"><Users size={18} className="text-[#F97316]" /> Customer Intelligence</h2>
            <span className="text-[13px] font-semibold text-[#0d6b4f] bg-[#e0f5ee] px-2 py-0.5 rounded-full">
              {mode === "all" ? "All-time" : <RangeText />}
            </span>
          </div>
          <p className="text-[17px] text-[#686864] mt-0.5">
            {mode === "all"
              ? <>Lifetime customer data from Shopify · cached up to 10 min <span className="text-[#a3a39e]">(not affected by the date range - hit Refresh for live)</span></>
              : <>Customers who ordered during <span className="font-medium text-[#181816]"><RangeText /></span> · change the date range up top</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mode === "all" && (
            <button
              onClick={() => loadAll(true)}
              disabled={refreshing}
              title="Pull the latest customer data live from Shopify"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[15px] font-semibold bg-[#F5F5F4] dark:bg-[#262626] text-[#52525B] dark:text-[#A1A1AA] hover:text-[#F97316] transition-colors disabled:opacity-60"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
          <ExportButton onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} disabled={!data} />
        </div>
      </div>

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-[#e6e6e3] bg-white p-0.5 mb-3">
        {(["all", "period"] as Mode[]).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 text-[15px] font-medium rounded-md transition-colors ${
              mode === m ? "bg-[#181816] text-white" : "text-[#686864] hover:text-[#181816]"
            }`}
          >
            {m === "all" ? "All-time" : "By date range"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-[17px] text-[#686864] py-8 text-center">Loading customer data...</div>
      ) : !data ? (
        <div className="text-[17px] text-[#d94040] py-8 text-center">Could not load customer data. Check Shopify connection.</div>
      ) : mode === "period" && periodData && periodData.kpis.activeBuyers === 0 ? (
        <div className="text-[17px] text-[#686864] py-8 text-center">No customers ordered during <RangeText />.</div>
      ) : mode === "all" && allData ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <KPICard label="Total Customers" value={allData.kpis.totalCustomers.toLocaleString()} />
            <KPICard label="Avg LTV" value={formatINR(allData.kpis.avgLTV)} sub="Revenue per customer" />
            <KPICard
              label="Repeat Rate"
              value={`${repeatRate}%`}
              change={repeatRate >= 25 ? 1 : -1}
              changeLabel={repeatRate >= 25 ? "Above 25% benchmark" : "Below 25% benchmark"}
            />
            <KPICard label="New This Month" value={allData.kpis.newThisMonth.toString()} sub="New customers acquired" />
          </div>
          {renderSegments()}
          {renderActionsAndCities("all")}
        </>
      ) : mode === "period" && periodData ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <KPICard label="Active Buyers" value={periodData.kpis.activeBuyers.toLocaleString()} sub={`Ordered in ${formatDateSpan(range.from, range.to)}`} />
            <KPICard label="New Buyers" value={periodData.kpis.newBuyers.toLocaleString()} sub="First-time customers" />
            <KPICard
              label="Returning Buyers"
              value={periodData.kpis.returningBuyers.toLocaleString()}
              change={periodData.kpis.repeatShare >= 25 ? 1 : -1}
              changeLabel={`${periodData.kpis.repeatShare}% of buyers`}
            />
            <KPICard label="Spend / Buyer" value={formatINR(periodData.kpis.spendPerBuyer)} sub="Avg revenue per buyer" />
          </div>
          {renderSegments()}
          {renderActionsAndCities("period")}
        </>
      ) : null}
    </div>
  );

  function renderSegments() {
    const total = mode === "all" ? (allData?.kpis.totalCustomers ?? 0) : (periodData?.kpis.activeBuyers ?? 0);
    const totalLabel = mode === "all" ? `${total.toLocaleString()} total customers` : `${total.toLocaleString()} buyers in ${formatDateSpan(range.from, range.to)}`;
    const donutColors = ["#22C55E", "#F97316", "#3B82F6"];
    const donutSegments = segments.map((s, i) => ({ label: s.name, value: s.count, color: donutColors[i % donutColors.length] }));
    return (
      <Card className="mb-2">
        <CardHeader title="Customer Segments" right={totalLabel} />
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 mt-1 items-center">
          <Donut segments={donutSegments} centerValue={total.toLocaleString()} centerLabel={mode === "all" ? "customers" : "buyers"} size={150} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {segments.map(seg => (
              <div key={seg.name} className={`border rounded-xl p-4 text-center ${seg.border}`}>
                <div className="text-2xl mb-1.5">{seg.icon}</div>
                <div className="text-[16px] font-semibold text-[#181816]">{seg.name}</div>
                <div className={`text-2xl font-bold mt-1 ${seg.color}`}>{seg.count.toLocaleString()}</div>
                <div className="text-[15px] text-[#686864] mt-1">{seg.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  function renderActionsAndCities(m: Mode) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Card>
          <CardHeader title="AI actions" />
          {m === "all" && allData && (
            <>
              {allData.kpis.repeat > 0 && (
                <InsightCard title={`${allData.kpis.repeat} repeat buyers - reward them`} body="Send a WhatsApp or email with early access to new drops. Repeat buyers spend 3× more on average." />
              )}
              {allData.kpis.oneTime > 0 && (
                <InsightCard type="info" title={`${allData.kpis.oneTime} one-time buyers - trigger 2nd purchase`} body="Email Day 7 post-purchase with complementary product suggestion. 2nd purchase rate increases from ~18% → 31% with this nudge." />
              )}
              {allData.kpis.newThisMonth > 0 && (
                <InsightCard type="purple" title={`${allData.kpis.newThisMonth} new customers this month`} body="Welcome flow: send a personalised thank-you with brand story + product care tips. Sets the tone for long-term loyalty." />
              )}
              {repeatRate < 25 && (
                <InsightCard type="warning" title={`Repeat rate ${repeatRate}% - below 25% benchmark`} body="Focus on post-purchase flows: 7-day follow-up email, loyalty points, or a small discount on the next order." />
              )}
            </>
          )}
          {m === "period" && periodData && (
            <>
              {periodData.kpis.newBuyers > 0 && (
                <InsightCard type="purple" title={`${periodData.kpis.newBuyers} new buyers in ${formatDateSpan(range.from, range.to)}`} body="Trigger a welcome flow now while they're warm: thank-you note, brand story, and a small nudge toward a 2nd order." />
              )}
              {periodData.kpis.returningBuyers > 0 && (
                <InsightCard title={`${periodData.kpis.returningBuyers} returning buyers - keep them loyal`} body="Returning buyers drove repeat revenue this period. Reward with early access or loyalty points to protect retention." />
              )}
              {periodData.kpis.repeatShare < 25 && periodData.kpis.activeBuyers > 0 && (
                <InsightCard type="warning" title={`Only ${periodData.kpis.repeatShare}% of buyers were returning`} body="Acquisition is carrying this period. Strengthen post-purchase flows so more of these buyers come back." />
              )}
            </>
          )}
        </Card>

        <Card>
          <CardHeader title={m === "all" ? "Top cities by customers" : "Top cities by buyers"} />
          {topCities.length === 0 ? (
            <div className="text-[17px] text-[#686864] py-4 text-center">No location data available</div>
          ) : (
            topCities.map((c, i) => (
              <BarRow
                key={i}
                label={c.city}
                pct={Math.round((c.count / maxCity) * 100)}
                value={`${c.count} ${m === "all" ? "customers" : "buyers"} (${c.pct}%)`}
                color={cityColors[i]}
              />
            ))
          )}
        </Card>
      </div>
    );
  }
}
