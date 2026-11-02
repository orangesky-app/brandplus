"use client";
import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { formatDateSpan, toLocalYMD } from "@/lib/date-range-context";
import { fetchGoogleAds, type GadsResult } from "@/lib/gads-client";
import { Lightbulb, Target, TrendingUp, TrendingDown, Calendar, CheckCircle2, XCircle, Clock } from "lucide-react";

/* ─── Types ──────────────────────────────────────────────────── */
interface LiveData { grossSales: number; totalOrders: number; aov: number; roas: number | null; spend: number | null }

// One month's numbers across every ad platform that's connected. Null means no ad platform answered.
function toLiveData(s: { kpis?: { grossSales?: number; totalOrders?: number; aov?: number } } | null, m: { kpis?: { spend?: number; purchaseValue?: number } } | null, g: GadsResult): LiveData {
  const hasAds = !!m?.kpis || !!g.data;
  const spend = (m?.kpis?.spend ?? 0) + (g.data?.kpis.spend ?? 0);
  const value = (m?.kpis?.purchaseValue ?? 0) + (g.data?.kpis.conversionValue ?? 0);
  return {
    grossSales: s?.kpis?.grossSales ?? 0, totalOrders: s?.kpis?.totalOrders ?? 0, aov: s?.kpis?.aov ?? 0,
    roas: hasAds ? (spend > 0 ? +(value / spend).toFixed(2) : 0) : null,
    spend: hasAds ? spend : null,
  };
}
interface GoalRecord {
  month: string;
  salesTarget: number; roasTarget: number; aovTarget: number; ordersTarget: number; spendBudget: number;
  savedAt: string;
  actuals?: { grossSales: number; totalOrders: number; aov: number; roas: number | null; spend: number | null };
}

/* ─── Progress bar ───────────────────────────────────────────── */
function PaceBar({ label, current, target, projected, unit = "₹" }: {
  label: string; current: number; target: number; projected: number; unit?: string;
}) {
  if (!target) return null;
  const pct = Math.min(Math.round((current / target) * 100), 100);
  const projPct = Math.min(Math.round((projected / target) * 100), 100);
  const onTrack = projected >= target;
  const fmt = (v: number) => unit === "₹" ? formatINR(v) : unit === "x" ? `${v}x` : `${v}`;
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[15px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[14px] text-[#A1A1AA]">{fmt(current)} / {fmt(target)}</span>
          <span className={cn("text-[13px] font-bold px-2 py-0.5 rounded-full",
            pct >= 100 ? "bg-[#F0FDF4] text-[#166534]" :
            onTrack ? "bg-[#FFF7ED] text-[#EA580C]" :
            "bg-[#FEF2F2] text-[#DC2626]"
          )}>{pct}%</span>
        </div>
      </div>
      <div className="relative h-2.5 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-full overflow-hidden">
        <div className="absolute h-full rounded-full transition-all bg-[#F97316]" style={{ width: `${pct}%` }} />
        {projPct > pct && projPct <= 100 && (
          <div className="absolute h-full rounded-full opacity-30 bg-[#F97316]" style={{ left: `${pct}%`, width: `${projPct - pct}%` }} />
        )}
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[13px] text-[#A1A1AA]">
          Projected: <span className={cn("font-semibold", onTrack ? "text-[#22C55E]" : "text-[#EF4444]")}>{fmt(projected)}</span>
        </span>
        {onTrack
          ? <span className="text-[13px] text-[#22C55E] font-semibold flex items-center gap-0.5"><CheckCircle2 size={10} /> On track</span>
          : <span className="text-[13px] text-[#EF4444] font-semibold flex items-center gap-0.5"><XCircle size={10} /> Behind pace</span>}
      </div>
    </div>
  );
}

/* ─── Month label ────────────────────────────────────────────── */
function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", { month: "short", year: "numeric" });
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function GoalsPage() {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const daysLeft = daysInMonth - dayOfMonth;
  const monthPct = Math.round((dayOfMonth / daysInMonth) * 100);

  /* ── state ── */
  const [current, setCurrent] = useState<LiveData | null>(null);
  const [lastMonth, setLastMonth] = useState<LiveData | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(true);
  const [loadingLast, setLoadingLast] = useState(true);

  const [salesTarget, setSalesTarget] = useState(0);
  const [roasTarget, setRoasTarget] = useState(2.0);
  const [aovTarget, setAovTarget] = useState(0);
  const [ordersTarget, setOrdersTarget] = useState(0);
  const [spendBudget, setSpendBudget] = useState(0);

  const [history, setHistory] = useState<GoalRecord[]>([]);
  const [toast, setToast] = useState("");

  /* ── Load saved goals ── */
  useEffect(() => {
    try {
      const stored = localStorage.getItem("skylitee-goals");
      if (stored) {
        const records: GoalRecord[] = JSON.parse(stored);
        setHistory(records.sort((a, b) => b.month.localeCompare(a.month)));
        const saved = records.find(r => r.month === thisMonth);
        if (saved) {
          setSalesTarget(saved.salesTarget);
          setRoasTarget(saved.roasTarget);
          setAovTarget(saved.aovTarget);
          setOrdersTarget(saved.ordersTarget);
          setSpendBudget(saved.spendBudget);
        }
      }
    } catch {}
  }, []);

  /* ── Fetch current month live data ── */
  const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const today = toLocalYMD(now);
  const lmFrom = toLocalYMD(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lmTo = toLocalYMD(new Date(now.getFullYear(), now.getMonth(), 0));

  useEffect(() => {
    setLoadingCurrent(true);
    Promise.allSettled([
      fetch(`/api/shopify/dashboard?from=${firstDay}&to=${today}`).then(r => r.json()),
      fetch(`/api/meta?from=${firstDay}&to=${today}`).then(r => r.json()),
      fetchGoogleAds(firstDay, today),
    ]).then(([sRes, mRes, gRes]) => {
      const s = sRes.status === "fulfilled" && !sRes.value?.error ? sRes.value : null;
      const m = mRes.status === "fulfilled" && !mRes.value?.error ? mRes.value : null;
      setCurrent(toLiveData(s, m, gRes.status === "fulfilled" ? gRes.value : { data: null, issue: null }));
    }).finally(() => setLoadingCurrent(false));
  }, [firstDay, today]);

  /* ── Fetch last month data ── */
  useEffect(() => {
    setLoadingLast(true);
    Promise.allSettled([
      fetch(`/api/shopify/dashboard?from=${lmFrom}&to=${lmTo}`).then(r => r.json()),
      fetch(`/api/meta?from=${lmFrom}&to=${lmTo}`).then(r => r.json()),
      fetchGoogleAds(lmFrom, lmTo),
    ]).then(([sRes, mRes, gRes]) => {
      const s = sRes.status === "fulfilled" && !sRes.value?.error ? sRes.value : null;
      const m = mRes.status === "fulfilled" && !mRes.value?.error ? mRes.value : null;
      setLastMonth(toLiveData(s, m, gRes.status === "fulfilled" ? gRes.value : { data: null, issue: null }));
    }).finally(() => setLoadingLast(false));
  }, [lmFrom, lmTo]);

  /* ── Apply last month as baseline ── */
  function applyLastMonth(mult: number) {
    if (!lastMonth) return;
    setSalesTarget(Math.round(lastMonth.grossSales * mult / 1000) * 1000 || Math.round(lastMonth.grossSales * mult));
    setRoasTarget(+((lastMonth.roas ?? 2.0) * mult).toFixed(1));
    setAovTarget(Math.round(lastMonth.aov * mult));
    setOrdersTarget(Math.round(lastMonth.totalOrders * mult));
    if (lastMonth.spend) setSpendBudget(Math.round(lastMonth.spend * mult / 1000) * 1000);
  }

  /* ── Save goals ── */
  function saveGoals() {
    try {
      const stored = localStorage.getItem("skylitee-goals");
      const records: GoalRecord[] = stored ? JSON.parse(stored) : [];
      const filtered = records.filter(r => r.month !== thisMonth);
      const newRecord: GoalRecord = {
        month: thisMonth, salesTarget, roasTarget, aovTarget, ordersTarget, spendBudget,
        savedAt: new Date().toISOString(),
        actuals: current ?? undefined,
      };
      const updated = [...filtered, newRecord].sort((a, b) => b.month.localeCompare(a.month));
      localStorage.setItem("skylitee-goals", JSON.stringify(updated));
      setHistory(updated);
      setToast("Goals saved!");
      setTimeout(() => setToast(""), 2500);
    } catch { setToast("Save failed"); setTimeout(() => setToast(""), 2500); }
  }

  /* ── Projections ── */
  const project = (val: number) => dayOfMonth > 0 ? Math.round((val / dayOfMonth) * daysInMonth) : 0;
  const projSales = current ? project(current.grossSales) : 0;
  const projOrders = current ? project(current.totalOrders) : 0;
  const dailyNeeded = salesTarget > 0 && current ? Math.max(0, Math.round((salesTarget - current.grossSales) / Math.max(daysLeft, 1))) : 0;
  const paceColor = projSales >= salesTarget ? "text-[#22C55E]" : projSales >= salesTarget * 0.8 ? "text-[#EAB308]" : "text-[#EF4444]";

  const lmMonthName = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString("default", { month: "long" });

  return (
    <div className="space-y-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#18181B] dark:text-[#F4F4F5] flex items-center gap-2"><Target size={18} className="text-[#F97316]" /> Monthly Goals</h2>
          <p className="text-[14px] text-[#A1A1AA] mt-0.5">
            {now.toLocaleString("default", { month: "long", year: "numeric" })} · Day {dayOfMonth} of {daysInMonth} · {daysLeft} days left
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-[13px] text-[#A1A1AA]">Month progress</div>
            <div className="text-[16px] font-black text-[#F97316]">{monthPct}%</div>
          </div>
          <div className="w-12 h-12 relative">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#FED7AA" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#F97316" strokeWidth="3"
                strokeDasharray={`${monthPct} ${100 - monthPct}`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <Calendar size={12} className="text-[#F97316]" />
            </div>
          </div>
        </div>
      </div>

      {/* Last month suggestion banner */}
      {!loadingLast && lastMonth && (
        <div className="bg-[#FFF7ED] dark:bg-[#2A1A0E] border border-[#FED7AA] dark:border-[#7C2D12] rounded-2xl p-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Lightbulb size={13} className="text-[#F97316]" />
                <span className="text-[14px] font-bold text-[#EA580C] uppercase tracking-[0.1em]">{lmMonthName} Actuals ({formatDateSpan(lmFrom, lmTo)}) - use as baseline</span>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                {[
                  { label: "Gross Sales", value: formatINR(lastMonth.grossSales) },
                  { label: "Total Orders", value: lastMonth.totalOrders.toString() },
                  { label: "AOV", value: formatINR(lastMonth.aov) },
                  ...(lastMonth.roas !== null ? [{ label: "ROAS", value: `${lastMonth.roas}x` }] : []),
                  ...(lastMonth.spend !== null ? [{ label: "Ad Spend", value: formatINR(lastMonth.spend) }] : []),
                ].map(item => (
                  <div key={item.label}>
                    <div className="text-[12px] text-[#A1A1AA] uppercase tracking-wide">{item.label}</div>
                    <div className="text-[16px] font-black text-[#18181B] dark:text-[#F4F4F5]">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 shrink-0">
              {[
                { label: "Match", mult: 1.0 },
                { label: "+10%", mult: 1.1 },
                { label: "+20%", mult: 1.2 },
                { label: "+30%", mult: 1.3 },
              ].map(btn => (
                <button key={btn.label} onClick={() => applyLastMonth(btn.mult)}
                  className="px-2.5 py-1.5 bg-white dark:bg-[#171717] border border-[#FED7AA] dark:border-[#7C2D12] rounded-xl text-[14px] font-bold text-[#EA580C] dark:text-[#FB923C] hover:bg-[#F97316] hover:text-white hover:border-[#F97316] transition-all">
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Goal config + Pace tracker */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

        {/* Goal Configuration */}
        <Card>
          <CardHeader title="Set Monthly Goals" right={
            <span className="text-[13px] text-[#A1A1AA]">{now.toLocaleString("default", { month: "short", year: "numeric" })}</span>
          } />

          <div className="space-y-3">
            {[
              { label: "Gross Sales Target (₹)", value: salesTarget, set: setSalesTarget, type: "number", hint: lastMonth ? `Last month: ${formatINR(lastMonth.grossSales)}` : "" },
              { label: "Total Orders Target", value: ordersTarget, set: setOrdersTarget, type: "number", hint: lastMonth ? `Last month: ${lastMonth.totalOrders} orders` : "" },
              { label: "AOV Target (₹)", value: aovTarget, set: setAovTarget, type: "number", hint: lastMonth ? `Last month: ${formatINR(lastMonth.aov)}` : "" },
              { label: "ROAS Target", value: roasTarget, set: setRoasTarget, type: "number", step: "0.1", hint: lastMonth?.roas !== null ? `Last month: ${lastMonth?.roas}x` : "Connect Meta for data" },
              { label: "Ad Spend Budget (₹)", value: spendBudget, set: setSpendBudget, type: "number", hint: lastMonth?.spend !== null ? `Last month: ${formatINR(lastMonth?.spend ?? 0)}` : "Connect Meta for data" },
            ].map(field => (
              <div key={field.label}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[14px] font-semibold text-[#71717A] dark:text-[#A1A1AA]">{field.label}</label>
                  {field.hint && <span className="text-[12px] text-[#A1A1AA]">{field.hint}</span>}
                </div>
                <input
                  type={field.type}
                  step={"step" in field ? field.step : "1"}
                  value={field.value || ""}
                  placeholder="0"
                  onChange={e => field.set(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl text-[16px] font-bold text-[#18181B] dark:text-[#F4F4F5] focus:outline-none focus:border-[#F97316] transition-colors"
                />
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-4">
            <button onClick={() => { setSalesTarget(0); setRoasTarget(2.0); setAovTarget(0); setOrdersTarget(0); setSpendBudget(0); }}
              className="px-3 py-2 border border-black/[0.08] dark:border-white/[0.08] rounded-xl text-[14px] text-[#71717A] dark:text-[#A1A1AA] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors">
              Reset
            </button>
            <button onClick={saveGoals}
              className="flex-1 py-2 bg-[#F97316] text-white rounded-xl text-[15px] font-bold hover:bg-[#EA580C] transition-colors">
              Save Goals
            </button>
          </div>
          {toast && (
            <div className="mt-2 text-[14px] text-[#EA580C] bg-[#FFF7ED] dark:bg-[#2A1A0E] rounded-xl px-3 py-2 font-semibold">{toast}</div>
          )}
        </Card>

        {/* Pace Tracker */}
        <Card>
          <CardHeader title="Pace Tracker" right={
            <span className="flex items-center gap-1 text-[13px] text-[#A1A1AA]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse" /> Live
            </span>
          } />

          {loadingCurrent ? (
            <div className="text-[14px] text-[#A1A1AA] py-6 text-center">Loading live data…</div>
          ) : !current ? (
            <div className="text-[14px] text-[#A1A1AA] py-6 text-center">Connect Shopify to track pace</div>
          ) : (
            <>
              {/* Day progress */}
              <div className="mb-4 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-3 flex items-center gap-3">
                <Clock size={14} className="text-[#A1A1AA] shrink-0" />
                <div className="flex-1">
                  <div className="flex justify-between text-[14px] mb-1">
                    <span className="font-semibold text-[#18181B] dark:text-[#F4F4F5]">Day {dayOfMonth} of {daysInMonth}</span>
                    <span className="text-[#A1A1AA]">{daysLeft} days left</span>
                  </div>
                  <div className="h-1.5 bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                    <div className="h-full bg-[#F97316] rounded-full" style={{ width: `${monthPct}%` }} />
                  </div>
                </div>
                <span className="text-[14px] font-black text-[#F97316] shrink-0">{monthPct}%</span>
              </div>

              {/* Projection highlight */}
              {salesTarget > 0 && (
                <div className={cn("mb-4 rounded-xl p-3 border", projSales >= salesTarget
                  ? "bg-[#F0FDF4] dark:bg-[#052E16] border-[#86EFAC]/40"
                  : projSales >= salesTarget * 0.8
                  ? "bg-[#FFFBEB] dark:bg-[#2D1C00] border-[#FCD34D]/40"
                  : "bg-[#FEF2F2] dark:bg-[#2D0A0A] border-[#FCA5A5]/40"
                )}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[13px] text-[#A1A1AA] uppercase tracking-wide mb-0.5">Projected end-of-month</div>
                      <div className={cn("text-[20px] font-black", paceColor)}>{formatINR(projSales)}</div>
                      <div className="text-[13px] text-[#A1A1AA]">vs target {formatINR(salesTarget)}</div>
                    </div>
                    <div className="text-right">
                      {projSales >= salesTarget
                        ? <div className="flex items-center gap-1 text-[#22C55E] font-bold text-[14px]"><CheckCircle2 size={14} /> On track!</div>
                        : <div>
                            <div className="text-[13px] text-[#A1A1AA]">Need per day</div>
                            <div className="text-[18px] font-black text-[#EF4444]">{formatINR(dailyNeeded)}</div>
                          </div>
                      }
                    </div>
                  </div>
                </div>
              )}

              {/* Metric progress bars */}
              <PaceBar label="Gross Sales" current={current.grossSales} target={salesTarget} projected={projSales} />
              <PaceBar label="Total Orders" current={current.totalOrders} target={ordersTarget} projected={projOrders} unit="" />
              {current.aov > 0 && aovTarget > 0 && (
                <PaceBar label="Avg Order Value" current={current.aov} target={aovTarget} projected={current.aov} />
              )}
              {current.roas !== null && roasTarget > 0 && (
                <PaceBar label="ROAS" current={current.roas} target={roasTarget} projected={current.roas} unit="x" />
              )}
              {current.spend !== null && spendBudget > 0 && (
                <PaceBar label="Ad Spend" current={current.spend} target={spendBudget} projected={project(current.spend)} />
              )}

              {/* Current actuals grid */}
              <div className="mt-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.06] grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { label: "Gross Sales", value: formatINR(current.grossSales) },
                  { label: "Orders", value: current.totalOrders.toString() },
                  { label: "AOV", value: formatINR(current.aov) },
                  ...(current.roas !== null ? [{ label: "ROAS", value: `${current.roas}x` }] : []),
                  ...(current.spend !== null ? [{ label: "Spend", value: formatINR(current.spend) }] : []),
                ].map(kpi => (
                  <div key={kpi.label} className="bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-2 text-center">
                    <div className="text-[14px] font-black text-[#18181B] dark:text-[#F4F4F5]">{kpi.value}</div>
                    <div className="text-[12px] text-[#A1A1AA] mt-0.5">{kpi.label}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Goal History */}
      {history.length > 0 && (
        <Card>
          <CardHeader title="Goal History" right={<span className="text-[13px] text-[#A1A1AA]">{history.length} months saved</span>} />
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                  {["Month", "Sales Target", "Actual Sales", "Achiev.", "Orders Target", "Actual Orders", "ROAS Target", "Actual ROAS"].map(h => (
                    <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((rec, i) => {
                  const isThisMonth = rec.month === thisMonth;
                  const actualSales = isThisMonth ? (current?.grossSales ?? rec.actuals?.grossSales) : rec.actuals?.grossSales;
                  const actualOrders = isThisMonth ? (current?.totalOrders ?? rec.actuals?.totalOrders) : rec.actuals?.totalOrders;
                  const actualRoas = isThisMonth ? (current?.roas ?? rec.actuals?.roas) : rec.actuals?.roas;
                  const achPct = actualSales && rec.salesTarget ? Math.round((actualSales / rec.salesTarget) * 100) : null;
                  return (
                    <tr key={rec.month} className={cn("border-b border-black/[0.04] dark:border-white/[0.04] last:border-0", isThisMonth && "bg-[#FFF7ED] dark:bg-[#2A1A0E]")}>
                      <td className="py-2 px-2 font-bold text-[#18181B] dark:text-[#F4F4F5]">
                        <div className="flex items-center gap-1.5">
                          {isThisMonth && <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse" />}
                          {monthLabel(rec.month)}
                          {isThisMonth && <span className="text-[12px] text-[#EA580C] font-bold bg-[#FFF7ED] dark:bg-transparent px-1 rounded">Live</span>}
                        </div>
                      </td>
                      <td className="py-2 px-2">{formatINR(rec.salesTarget)}</td>
                      <td className="py-2 px-2 font-semibold">{actualSales !== undefined ? formatINR(actualSales) : <span className="text-[#A1A1AA]">-</span>}</td>
                      <td className="py-2 px-2">
                        {achPct !== null ? (
                          <span className={cn("px-2 py-0.5 rounded-full text-[12px] font-black",
                            achPct >= 100 ? "bg-[#F0FDF4] text-[#166534]" :
                            achPct >= 80 ? "bg-[#FFF7ED] text-[#EA580C]" :
                            "bg-[#FEF2F2] text-[#DC2626]"
                          )}>{achPct}%</span>
                        ) : <span className="text-[#A1A1AA]">-</span>}
                      </td>
                      <td className="py-2 px-2">{rec.ordersTarget || <span className="text-[#A1A1AA]">-</span>}</td>
                      <td className="py-2 px-2 font-semibold">{actualOrders !== undefined ? actualOrders : <span className="text-[#A1A1AA]">-</span>}</td>
                      <td className="py-2 px-2">{rec.roasTarget}x</td>
                      <td className="py-2 px-2">
                        {actualRoas !== null && actualRoas !== undefined ? (
                          <span className={cn("font-bold", actualRoas >= rec.roasTarget ? "text-[#22C55E]" : "text-[#EF4444]")}>{actualRoas}x</span>
                        ) : <span className="text-[#A1A1AA]">-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

    </div>
  );
}
