"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Stethoscope, AlertTriangle, CheckCircle2, RefreshCw, Target, ListChecks, Info, ArrowRight, XCircle,
  BarChart3, MapPin, CalendarCheck, Megaphone, Share2, Layers,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { RangeText } from "@/components/ui/period";
import { useDateRange, getComparisonRange, rangeDays } from "@/lib/date-range-context";
import { fetchGoogleAds, gadsIssueText } from "@/lib/gads-client";
import { buildDiagnosis, type DiagnosisInput, type Severity, type SegmentLite, type ShopDiagnosis, type MetaKpisLite, type MetaCampaignLite, type MetaAdLite } from "@/lib/diagnosis";
import type { KeywordsData, OverviewData } from "@/lib/gads-analysis";
import {
  availableScopes, buildAnalysis, buildChecks, buildGoal, buildPlan, buildResult, defaultScope,
  type GoalPlan, type GoalSettings, type Phase, type PlanStep, type Scope, type ScoreBlock, type ScopedResult, type Verdict, type WeeklyCheck,
} from "@/lib/growth-plan";
import { formatINR, cn } from "@/lib/utils";

const GOAL_KEY = "skylitee-diag-goal";
const OLD_TARGET_KEY = "skylitee-diag-target";
const SCOPE_KEY = "skylitee-diag-scope";

const SEV_STYLE: Record<Severity, string> = {
  high: "bg-[#FEE2E2] text-[#B91C1C] dark:bg-[#3A1414] dark:text-[#FCA5A5]",
  medium: "bg-[#FEF3C7] text-[#92400E] dark:bg-[#33270C] dark:text-[#FCD34D]",
  low: "bg-[#F4F4F5] text-[#52525B] dark:bg-[#262626] dark:text-[#A1A1AA]",
};
const SEV_LABEL: Record<Severity, string> = { high: "Big problem", medium: "Problem", low: "Watch" };
const VERDICT_STYLE: Record<Verdict, { pill: string; text: string; label: string }> = {
  good: { pill: "bg-[#DCFCE7] text-[#15803D] dark:bg-[#0F2416] dark:text-[#86EFAC]", text: "text-[#16A34A]", label: "Good" },
  watch: { pill: "bg-[#FEF3C7] text-[#92400E] dark:bg-[#33270C] dark:text-[#FCD34D]", text: "text-[#B45309] dark:text-[#FCD34D]", label: "Weak" },
  bad: { pill: "bg-[#FEE2E2] text-[#B91C1C] dark:bg-[#3A1414] dark:text-[#FCA5A5]", text: "text-[#DC2626]", label: "Bad" },
  na: { pill: "bg-[#F4F4F5] text-[#52525B] dark:bg-[#262626] dark:text-[#A1A1AA]", text: "text-[#18181B] dark:text-[#F4F4F5]", label: "Info" },
};
const PHASES: { key: Phase; title: string; sub: string }[] = [
  { key: "week1", title: "Week 1", sub: "Stop losing money" },
  { key: "weeks2to4", title: "Weeks 2-4", sub: "Fix what sells, test new ads" },
  { key: "months2to3", title: "Months 2-3", sub: "Scale to the goal, step by step" },
];
const SCOPE_META: Record<Scope, { label: string; icon: typeof Share2 }> = {
  meta: { label: "Meta Ads", icon: Share2 },
  google: { label: "Google Ads", icon: Megaphone },
  both: { label: "Both", icon: Layers },
};

type Json = Record<string, unknown> & { error?: string };
async function getJson(url: string): Promise<Json | null> {
  try {
    const r = await fetch(url);
    const d = await r.json() as Json;
    return d && !d.error ? d : null;
  } catch { return null; }
}

function loadGoal(): GoalSettings {
  const fallback: GoalSettings = { type: "orders", target: 25, months: 3 };
  try {
    const raw = localStorage.getItem(GOAL_KEY);
    if (raw) {
      const g = JSON.parse(raw) as GoalSettings;
      if ((g.type === "orders" || g.type === "revenue") && g.target > 0 && [1, 2, 3, 6].includes(g.months)) return g;
    }
    const old = parseInt(localStorage.getItem(OLD_TARGET_KEY) ?? "");
    if (old > 0) return { ...fallback, target: old };
  } catch { /* ignore */ }
  return fallback;
}

export default function DiagnosisPage() {
  const { range, setPreset } = useDateRange();
  const days = rangeDays(range);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState<DiagnosisInput | null>(null);
  const [goal, setGoal] = useState<GoalSettings>({ type: "orders", target: 25, months: 3 });
  const [scope, setScope] = useState<Scope | null>(null);

  useEffect(() => { setGoal(loadGoal()); }, []);
  function updateGoal(g: GoalSettings) {
    setGoal(g);
    try { localStorage.setItem(GOAL_KEY, JSON.stringify(g)); } catch { /* ignore */ }
  }
  function pickScope(s: Scope) {
    setScope(s);
    try { localStorage.setItem(SCOPE_KEY, s); } catch { /* ignore */ }
  }

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setInput(null);
    const q = `from=${range.from}&to=${range.to}`;
    const prev = getComparisonRange(range, "prev_period");
    const pq = prev ? `from=${prev.from}&to=${prev.to}` : null;

    Promise.allSettled([
      getJson(`/api/shopify/diagnosis?${q}`),
      pq ? getJson(`/api/shopify/diagnosis?${pq}`) : Promise.resolve(null),
      getJson(`/api/meta?${q}`),
      pq ? getJson(`/api/meta?${pq}`) : Promise.resolve(null),
      getJson(`/api/meta/placement?${q}`),
      getJson(`/api/meta/ads?${q}`),
      fetchGoogleAds(range.from, range.to),
      getJson(`/api/ga4?${q}`),
      getJson(`/api/shopify/cogs?${q}`),
      getJson(`/api/google/ads/insights?section=overview&${q}`),
      getJson(`/api/google/ads/insights?section=keywords&${q}`),
    ]).then(res => {
      if (stale) return;
      const val = <T,>(i: number): T | null => (res[i].status === "fulfilled" ? (res[i] as PromiseFulfilledResult<T>).value : null);
      const shop = val<ShopDiagnosis>(0);
      const prevShop = val<ShopDiagnosis>(1);
      const meta = val<{ kpis: MetaKpisLite; campaigns: MetaCampaignLite[] }>(2);
      const prevMeta = val<{ kpis: MetaKpisLite }>(3);
      const placement = val<{ placements?: SegmentLite[]; breakdowns?: { age?: SegmentLite[]; gender?: SegmentLite[]; device?: SegmentLite[] } }>(4);
      const ads = val<{ ads?: MetaAdLite[] }>(5);
      const gads = val<Awaited<ReturnType<typeof fetchGoogleAds>>>(6);
      const ga4 = val<{ kpis?: { sessions: number }; ecommerce?: { itemsViewed: number; itemsAddedToCart: number; itemsCheckedOut: number; purchases: number } | null }>(7);
      const cogs = val<{ status: string; cogs: { perOrder: number } }>(8);
      const overview = val<OverviewData>(9);
      const keywords = val<KeywordsData>(10);

      let costs: DiagnosisInput["costs"] = null;
      try { const c = localStorage.getItem("skylitee-pl-inputs"); if (c) costs = JSON.parse(c); } catch { /* ignore */ }
      const gadsData = gads?.data ? { ...gads.data.kpis, campaigns: gads.data.campaigns } : null;
      const hasG = (gadsData?.spend ?? 0) > 0;

      setInput({
        days,
        shop: shop?.orders ? shop : null,
        prevShop: prevShop?.orders ? prevShop : null,
        meta: meta?.kpis ? { kpis: meta.kpis, campaigns: meta.campaigns ?? [] } : null,
        prevMeta: prevMeta?.kpis ? { kpis: prevMeta.kpis } : null,
        segments: placement?.breakdowns ? {
          gender: placement.breakdowns.gender ?? [], age: placement.breakdowns.age ?? [],
          device: placement.breakdowns.device ?? [], placement: placement.placements ?? [],
        } : null,
        ads: ads?.ads ?? null,
        gads: gadsData,
        gadsNote: gads ? gadsIssueText(gads.issue) : null,
        gadsInsights: hasG && (overview?.campaigns || keywords?.keywords) ? {
          overview: overview?.campaigns ? overview : null,
          keywords: keywords?.keywords ? keywords : null,
        } : null,
        ga4: ga4?.kpis ? {
          sessions: ga4.kpis.sessions,
          itemsViewed: ga4.ecommerce?.itemsViewed ?? 0, itemsAddedToCart: ga4.ecommerce?.itemsAddedToCart ?? 0,
          itemsCheckedOut: ga4.ecommerce?.itemsCheckedOut ?? 0, purchases: ga4.ecommerce?.purchases ?? 0,
        } : null,
        cogsPerOrder: cogs && cogs.status !== "none" ? cogs.cogs.perOrder : null,
        costs,
      });
      setLoading(false);
    });
    return () => { stale = true; };
  }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const dx = useMemo(() => (input ? buildDiagnosis(input) : null), [input]);
  const avail = useMemo(() => (input ? availableScopes(input) : { meta: false, google: false }), [input]);

  // Saved choice if that channel has spend, otherwise whatever channels are running.
  const activeScope: Scope = useMemo(() => {
    if (!input) return "meta";
    const ok = (s: Scope) => (s === "meta" ? avail.meta : s === "google" ? avail.google : avail.meta && avail.google);
    if (scope && ok(scope)) return scope;
    try { const saved = localStorage.getItem(SCOPE_KEY) as Scope | null; if (saved && ok(saved)) return saved; } catch { /* ignore */ }
    return defaultScope(input);
  }, [input, scope, avail]);

  const view = useMemo(() => {
    if (!dx || !input) return null;
    const g = buildGoal(dx, goal);
    const c = { dx, inp: input, goal: g };
    return {
      goal: g,
      analysis: buildAnalysis(c, activeScope),
      result: buildResult(dx, activeScope),
      plan: buildPlan(c, activeScope),
      checks: buildChecks(c, activeScope),
    };
  }, [dx, input, goal, activeScope]);

  const noShop = !!input && !input.shop;
  const noAds = !!input && !avail.meta && !avail.google;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-[#18181B] dark:text-[#F4F4F5] flex items-center gap-2"><Stethoscope size={18} className="text-[#F97316]" /> Growth Diagnosis</h2>
        <p className="text-[15px] text-[#A1A1AA] mt-0.5">Your goal, what's stopping it, and the exact steps to get there · <RangeText /></p>
      </div>

      {days < 14 && (
        <div className="flex items-center justify-between flex-wrap gap-2 rounded-xl border border-[#FCD34D] bg-[#FFFBEB] dark:bg-[#2A2210] dark:border-[#78350F] px-3 py-2 text-[14px] text-[#92400E] dark:text-[#FCD34D]">
          <span className="flex items-center gap-1.5"><Info size={14} /> Only {days} day{days > 1 ? "s" : ""} picked. A diagnosis needs at least 2-4 weeks of data to be reliable.</span>
          <button onClick={() => setPreset("28d")} className="px-3 py-1 rounded-lg bg-[#F97316] text-white font-semibold hover:bg-[#EA580C]">Use last 28 days</button>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-[15px] text-[#A1A1AA] flex items-center justify-center gap-2"><RefreshCw size={14} className="animate-spin" /> Checking your store, Meta, Google and Analytics…</div>
      ) : noShop ? (
        <Card>
          <div className="py-10 text-center">
            <p className="text-[16px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">Shopify data is needed for the diagnosis</p>
            <p className="text-[15px] text-[#71717A] mt-1">Orders, COD results and offers all come from your store.</p>
            <Link href="/dashboard/connections" className="inline-block mt-4 px-5 py-2 bg-[#F97316] text-white rounded-xl text-[15px] font-semibold hover:bg-[#EA580C]">Go to Connections</Link>
          </div>
        </Card>
      ) : dx && view && (
        <>
          <GoalSection plan={view.goal} goal={goal} onChange={updateGoal} />
          {noAds ? (
            <Card>
              <div className="py-8 text-center">
                <p className="text-[16px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">No Meta or Google ad spend in this period</p>
                <p className="text-[15px] text-[#71717A] mt-1">Connect an ad account, or pick a date range when ads were running.</p>
                <Link href="/dashboard/connections" className="inline-block mt-4 px-5 py-2 bg-[#F97316] text-white rounded-xl text-[15px] font-semibold hover:bg-[#EA580C]">Go to Connections</Link>
              </div>
            </Card>
          ) : (
            <>
              <AnalysisSection scope={activeScope} avail={avail} onPick={pickScope} blocks={view.analysis} />
              <ResultSection scope={activeScope} result={view.result} />
              <PlanSection scope={activeScope} steps={view.plan} />
              <ChecksSection scope={activeScope} checks={view.checks} />
            </>
          )}
          {dx.dataNotes.length > 0 && (
            <div className="rounded-xl bg-[#F5F5F4] dark:bg-[#1C1C1C] px-3 py-2.5 space-y-1">
              {dx.dataNotes.map(n => <p key={n} className="text-[13px] text-[#71717A] dark:text-[#A1A1AA] flex gap-1.5"><Info size={13} className="shrink-0 mt-0.5" /> {n}</p>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────── shared bits ─────────── */

function SectionHead({ n, icon: Icon, title, sub, right }: { n: string; icon: typeof Target; title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
      <div className="flex items-start gap-2.5">
        <span className="w-9 h-9 rounded-xl bg-[#FFF7ED] dark:bg-[#2A1A0E] text-[#EA580C] text-[14px] font-bold flex items-center justify-center shrink-0">{n}</span>
        <div>
          <h3 className="text-[17px] font-bold text-[#18181B] dark:text-[#F4F4F5] flex items-center gap-1.5"><Icon size={16} className="text-[#F97316]" /> {title}</h3>
          <p className="text-[14px] text-[#71717A] dark:text-[#A1A1AA]">{sub}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl bg-[#F5F5F4] dark:bg-[#1C1C1C] p-2.5">
      <p className="text-[13px] text-[#71717A] dark:text-[#A1A1AA]">{label}</p>
      <p className={cn("text-[18px] font-bold leading-tight mt-0.5", tone === "good" ? "text-[#16A34A]" : tone === "bad" ? "text-[#DC2626]" : "text-[#18181B] dark:text-[#F4F4F5]")}>{value}</p>
      {sub && <p className="text-[12px] text-[#A1A1AA] mt-0.5">{sub}</p>}
    </div>
  );
}

/* ─────────── 01 GOAL ─────────── */

function GoalSection({ plan, goal, onChange }: { plan: GoalPlan; goal: GoalSettings; onChange: (g: GoalSettings) => void }) {
  const [draft, setDraft] = useState(String(goal.target));
  useEffect(() => { setDraft(String(goal.target)); }, [goal.target, goal.type]);
  const setTarget = (v: string) => {
    setDraft(v);
    const n = Number(v);
    if (n > 0 && n <= 1e9) onChange({ ...goal, target: n });
  };
  const switchType = (type: GoalSettings["type"]) => {
    if (type === goal.type) return;
    // Convert the current goal so switching doesn't throw away the number.
    const target = type === "revenue" ? Math.round(plan.targetRevenuePerMonth / 1000) * 1000 || 500000 : Math.max(Math.round(plan.targetOrdersPerDay), 1);
    onChange({ ...goal, type, target });
  };
  const tone = plan.feasibility === "realistic" || plan.feasibility === "reached" ? "good" : plan.feasibility === "stretch" ? "watch" : plan.feasibility === "unrealistic" ? "bad" : "na";
  const cpaTone = plan.costPerKept != null && plan.targetCpa != null ? (plan.costPerKept <= plan.targetCpa ? "good" : "bad") : undefined;

  return (
    <Card>
      <SectionHead n="01" icon={Target} title="Goal" sub="What you want to achieve, and what it takes" />
      <div className="flex flex-wrap items-center gap-2 text-[15px] text-[#52525B] dark:text-[#A1A1AA]">
        <span>I want</span>
        <div className="inline-flex rounded-lg bg-[#F5F5F4] dark:bg-[#1C1C1C] p-0.5">
          {(["orders", "revenue"] as const).map(t => (
            <button key={t} onClick={() => switchType(t)} className={cn("px-2.5 py-1 rounded-md text-[14px] font-semibold", goal.type === t ? "bg-white dark:bg-[#262626] text-[#18181B] dark:text-[#F4F4F5] shadow-sm" : "text-[#71717A]")}>
              {t === "orders" ? "Orders a day" : "Sales a month"}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1">
          {goal.type === "revenue" && <span className="font-bold text-[#18181B] dark:text-[#F4F4F5]">₹</span>}
          <input type="number" min={1} value={draft} onChange={e => setTarget(e.target.value)}
            className={cn("bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-md px-2 py-1 text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5] outline-none focus:ring-1 focus:ring-[#F97316]", goal.type === "revenue" ? "w-32" : "w-20")} />
        </span>
        <span>in</span>
        <select value={goal.months} onChange={e => onChange({ ...goal, months: Number(e.target.value) })}
          className="bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-md px-2 py-1 text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5] outline-none focus:ring-1 focus:ring-[#F97316]">
          {[1, 2, 3, 6].map(m => <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>)}
        </select>
      </div>

      <div className={cn("mt-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold flex gap-2",
        tone === "good" ? "bg-[#F0FDF4] text-[#166534] dark:bg-[#0F2416] dark:text-[#BBF7D0]" :
        tone === "watch" ? "bg-[#FFFBEB] text-[#92400E] dark:bg-[#2A2210] dark:text-[#FCD34D]" :
        tone === "bad" ? "bg-[#FEF2F2] text-[#B91C1C] dark:bg-[#2A1212] dark:text-[#FCA5A5]" :
        "bg-[#F5F5F4] text-[#52525B] dark:bg-[#1C1C1C] dark:text-[#A1A1AA]")}>
        {tone === "good" ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : tone === "na" ? <Info size={16} className="shrink-0 mt-0.5" /> : <AlertTriangle size={16} className="shrink-0 mt-0.5" />}
        <span>{plan.verdict}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        <Stat label="Now" value={`${plan.nowOrdersPerDay.toFixed(1)} orders/day`} sub={`${formatINR(plan.nowRevenuePerMonth)} kept sales a month`} />
        <Stat label="Goal" value={`${plan.targetOrdersPerDay.toFixed(1)} orders/day`} sub={`${formatINR(plan.targetRevenuePerMonth)} a month`} />
        <Stat label="Ad cost per kept order" value={plan.costPerKept != null ? formatINR(plan.costPerKept) : "-"} tone={cpaTone}
          sub={plan.targetCpa ? `healthy: under ${formatINR(plan.targetCpa)}${plan.cpaIsEstimate ? " (est.)" : ""}` : undefined} />
        <Stat label="ROAS you need" value={plan.roasNeeded ? `${plan.roasNeeded.toFixed(2)}x` : "-"} sub={plan.breakEvenRoas ? `break-even ${plan.breakEvenRoas.toFixed(2)}x` : undefined} />
      </div>

      {plan.targetOrdersPerDay > plan.nowOrdersPerDay && (
        <div className="mt-3 rounded-xl border border-black/[0.06] dark:border-white/[0.06] divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          <div className="flex items-center justify-between gap-2 p-2.5">
            <span className="text-[14px] text-[#52525B] dark:text-[#A1A1AA]">Ad budget for the goal at today's cost per order</span>
            <span className={cn("text-[16px] font-bold", cpaTone === "bad" ? "text-[#DC2626]" : "text-[#18181B] dark:text-[#F4F4F5]")}>{plan.budgetAtTodayCost != null ? `${formatINR(plan.budgetAtTodayCost)}/day` : "-"}</span>
          </div>
          <div className="flex items-center justify-between gap-2 p-2.5">
            <span className="text-[14px] text-[#52525B] dark:text-[#A1A1AA]">Ad budget after the fixes{plan.targetCpa ? ` (${formatINR(plan.targetCpa)} per order)` : ""}</span>
            <span className="text-[16px] font-bold text-[#16A34A]">{plan.budgetAtHealthyCost != null ? `${formatINR(plan.budgetAtHealthyCost)}/day` : "-"}</span>
          </div>
          <div className="flex items-center justify-between gap-2 p-2.5">
            <span className="text-[14px] text-[#52525B] dark:text-[#A1A1AA]">Spending now</span>
            <span className="text-[16px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{plan.spendNowPerDay > 0 ? `${formatINR(plan.spendNowPerDay)}/day` : "-"}</span>
          </div>
        </div>
      )}

      {plan.path.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[14px] min-w-[480px]">
            <thead>
              <tr className="text-left text-[13px] text-[#71717A] dark:text-[#A1A1AA] border-b border-black/[0.06] dark:border-white/[0.06]">
                <th className="py-1.5 pr-2 font-semibold">Month</th>
                <th className="py-1.5 px-2 font-semibold">Kept orders / day</th>
                <th className="py-1.5 px-2 font-semibold">Ad cost per order</th>
                <th className="py-1.5 px-2 font-semibold">Ad budget / day</th>
                <th className="py-1.5 pl-2 font-semibold">Sales / month</th>
              </tr>
            </thead>
            <tbody>
              {plan.path.map(p => (
                <tr key={p.month} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 text-[#18181B] dark:text-[#E4E4E7]">
                  <td className="py-1.5 pr-2 font-semibold">Month {p.month}</td>
                  <td className="py-1.5 px-2">{p.ordersPerDay.toFixed(1)}</td>
                  <td className="py-1.5 px-2">{formatINR(p.cpa)}</td>
                  <td className="py-1.5 px-2 font-semibold">{formatINR(p.budgetPerDay)}</td>
                  <td className="py-1.5 pl-2">{formatINR(p.revenuePerMonth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[12px] text-[#A1A1AA] mt-1.5">"Kept" = not cancelled or returned. Month 1 is mostly fixing, so cost per order should drop before budget goes up.</p>
        </div>
      )}
    </Card>
  );
}

/* ─────────── 02 ANALYSIS ─────────── */

function AnalysisSection({ scope, avail, onPick, blocks }: { scope: Scope; avail: { meta: boolean; google: boolean }; onPick: (s: Scope) => void; blocks: ScoreBlock[] }) {
  const enabled: Record<Scope, boolean> = { meta: avail.meta, google: avail.google, both: avail.meta && avail.google };
  return (
    <Card>
      <SectionHead n="02" icon={BarChart3} title="Analysis" sub="Pick what to analyse. Everything below (result, plan, weekly checks) follows this choice." />
      <div className="grid grid-cols-3 gap-2 mb-3">
        {(["google", "meta", "both"] as Scope[]).map(s => {
          const M = SCOPE_META[s];
          return (
            <button key={s} disabled={!enabled[s]} onClick={() => onPick(s)}
              title={enabled[s] ? undefined : s === "both" ? "Needs spend on both Meta and Google in this period" : `No ${M.label} spend in this period`}
              className={cn("flex items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-2 text-[15px] font-semibold transition-colors",
                scope === s ? "border-[#F97316] bg-[#FFF7ED] text-[#EA580C] dark:bg-[#2A1A0E]" : "border-black/[0.06] dark:border-white/[0.06] text-[#52525B] dark:text-[#A1A1AA] hover:border-[#FDBA74]",
                !enabled[s] && "opacity-40 cursor-not-allowed hover:border-black/[0.06]")}>
              <M.icon size={15} /> {s === "both" ? "Both" : `${M.label} only`}
            </button>
          );
        })}
      </div>
      <div className="space-y-4">
        {blocks.map(b => (
          <div key={b.title}>
            {blocks.length > 1 && <p className="text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5] mb-1.5">{b.title}</p>}
            {b.rows.length === 0 ? (
              <p className="text-[14px] text-[#71717A] dark:text-[#A1A1AA] flex items-center gap-1.5"><Info size={13} /> {b.note}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[14px] min-w-[620px]">
                  <thead>
                    <tr className="text-left text-[13px] text-[#71717A] dark:text-[#A1A1AA] border-b border-black/[0.06] dark:border-white/[0.06]">
                      <th className="py-1.5 pr-2 font-semibold">Number</th>
                      <th className="py-1.5 px-2 font-semibold">You</th>
                      <th className="py-1.5 px-2 font-semibold">Healthy</th>
                      <th className="py-1.5 pl-2 font-semibold">What it means</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map(r => {
                      const v = VERDICT_STYLE[r.verdict];
                      return (
                        <tr key={r.metric} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 align-top">
                          <td className="py-2 pr-2 font-semibold text-[#18181B] dark:text-[#F4F4F5]">{r.metric}</td>
                          <td className="py-2 px-2 whitespace-nowrap">
                            <span className={cn("font-bold", v.text)}>{r.you}</span>
                            {r.verdict !== "na" && <span className={cn("ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full", v.pill)}>{v.label}</span>}
                          </td>
                          <td className="py-2 px-2 text-[#52525B] dark:text-[#A1A1AA]">{r.healthy}</td>
                          <td className="py-2 pl-2 text-[#52525B] dark:text-[#A1A1AA]">{r.why}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {b.rows.length > 0 && b.note && <p className="text-[12px] text-[#A1A1AA] mt-1.5">{b.note}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ─────────── 03 RESULT ─────────── */

function ResultSection({ scope, result }: { scope: Scope; result: ScopedResult }) {
  const b = result.biggest;
  return (
    <Card>
      <SectionHead n="03" icon={MapPin} title="Result" sub={`What's wrong in ${scope === "both" ? "Meta + Google" : SCOPE_META[scope].label}, where it is, and what to do`}
        right={result.total > 0 ? <span className="text-[14px] text-[#71717A]">Total: <b className="text-[#DC2626] text-[16px]">{formatINR(result.total)}</b>/month lost</span> : undefined} />

      {b ? (
        <div className="rounded-xl border border-[#FCA5A5] dark:border-[#7F1D1D] bg-gradient-to-br from-[#FEF2F2] to-white dark:from-[#2A1212] dark:to-[#171717] p-3.5">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold uppercase tracking-wide text-[#DC2626] flex items-center gap-1.5"><AlertTriangle size={14} /> Fix this first</p>
              <p className="text-[18px] font-bold text-[#18181B] dark:text-[#F4F4F5] mt-1 leading-snug">{b.title}</p>
              <p className="text-[13px] text-[#71717A] mt-0.5 flex items-center gap-1"><MapPin size={12} /> {b.where}</p>
            </div>
            {b.impact > 0 && (
              <div className="text-right shrink-0">
                <p className="text-[22px] font-bold text-[#DC2626] leading-none">{formatINR(b.impact)}</p>
                <p className="text-[12px] text-[#71717A] mt-1">lost per month</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[#86EFAC] dark:border-[#14532D] bg-[#F0FDF4] dark:bg-[#0F2416] p-3.5 flex gap-2">
          <CheckCircle2 size={18} className="text-[#16A34A] shrink-0 mt-0.5" />
          <p className="text-[15px] text-[#166534] dark:text-[#BBF7D0]"><b>No major leak found.</b> The numbers available look healthy. Follow the plan to scale and keep the weekly checks green.</p>
        </div>
      )}

      {result.findings.length > 0 && (
        <div className="mt-3 space-y-2">
          {result.findings.map((f, i) => (
            <div key={f.id} className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="text-[13px] font-bold text-[#A1A1AA]">{i + 1}.</span>
                  <span className={cn("text-[12px] font-bold px-2 py-0.5 rounded-full", SEV_STYLE[f.severity])}>{SEV_LABEL[f.severity]}</span>
                  <span className="text-[15px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">{f.title}</span>
                </div>
                {f.impact > 0 && <span className="text-[14px] font-bold text-[#DC2626] shrink-0">{formatINR(f.impact)}/mo</span>}
              </div>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[14px]">
                <span className="font-semibold text-[#71717A]">Problem</span>
                <span className="text-[#52525B] dark:text-[#A1A1AA] leading-relaxed">{f.detail}</span>
                <span className="font-semibold text-[#71717A]">Where</span>
                <span className="text-[#52525B] dark:text-[#A1A1AA]">{f.where}</span>
                <span className="font-semibold text-[#16A34A]">What to do</span>
                <span className="text-[#18181B] dark:text-[#E4E4E7] leading-relaxed">{f.fix}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {result.wins.length > 0 && (
        <div className="mt-3 rounded-xl bg-[#F0FDF4] dark:bg-[#0F2416] border border-[#BBF7D0] dark:border-[#14532D] p-2.5">
          <p className="text-[13px] font-bold text-[#15803D] dark:text-[#86EFAC] mb-1">What's working - keep it</p>
          {result.wins.map(w => <p key={w.area + w.text} className="text-[14px] text-[#166534] dark:text-[#BBF7D0] flex gap-1.5"><CheckCircle2 size={13} className="shrink-0 mt-0.5" /> <span><b>{w.area}:</b> {w.text}</span></p>)}
        </div>
      )}
      {result.missing.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {result.missing.map(m => <p key={m} className="text-[13px] text-[#71717A] dark:text-[#A1A1AA] flex gap-1.5"><Info size={13} className="shrink-0 mt-0.5" /> {m}</p>)}
        </div>
      )}
    </Card>
  );
}

/* ─────────── 04 PLAN ─────────── */

function PlanSection({ scope, steps }: { scope: Scope; steps: PlanStep[] }) {
  let n = 0;
  return (
    <Card>
      <SectionHead n="04" icon={ListChecks} title="Plan of action" sub={`For ${scope === "both" ? "Meta + Google together" : SCOPE_META[scope].label}. Do them in order - each step says when it's done.`} />
      <div className="space-y-4">
        {PHASES.map(ph => {
          const list = steps.filter(s => s.phase === ph.key);
          return (
            <div key={ph.key}>
              <div className="flex items-baseline gap-2 border-b border-black/[0.06] dark:border-white/[0.06] pb-1 mb-2">
                <p className="text-[16px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{ph.title}</p>
                <p className="text-[13px] text-[#71717A]">{ph.sub}</p>
              </div>
              {list.length === 0 ? <p className="text-[14px] text-[#A1A1AA]">Nothing urgent here.</p> : (
                <div className="space-y-2">
                  {list.map(s => {
                    n += 1;
                    return (
                      <div key={ph.key + s.action} className="rounded-xl bg-[#F5F5F4] dark:bg-[#1C1C1C] p-3">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <p className="text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5] flex gap-2 min-w-0">
                            <span className="text-[#EA580C] shrink-0">{n}.</span>
                            <span>{s.action}</span>
                          </p>
                          <div className="flex items-center gap-2 shrink-0">
                            {s.saves != null && s.saves > 0 && <span className="text-[13px] font-bold text-[#16A34A]">saves ~{formatINR(s.saves)}/mo</span>}
                            <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-white dark:bg-[#262626] text-[#52525B] dark:text-[#A1A1AA]">{s.area}</span>
                          </div>
                        </div>
                        <ul className="mt-1.5 space-y-1 pl-5">
                          {s.how.map(h => <li key={h} className="text-[14px] text-[#52525B] dark:text-[#D4D4D8] leading-relaxed list-disc marker:text-[#F97316]">{h}</li>)}
                        </ul>
                        <p className="mt-2 text-[14px] text-[#166534] dark:text-[#BBF7D0] flex gap-1.5"><CheckCircle2 size={14} className="shrink-0 mt-0.5 text-[#16A34A]" /><span><b>Done when:</b> {s.doneWhen}</span></p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ─────────── 05 WEEKLY CHECKS ─────────── */

function ChecksSection({ scope, checks }: { scope: Scope; checks: WeeklyCheck[] }) {
  return (
    <Card>
      <SectionHead n="05" icon={CalendarCheck} title="Check this every week" sub={`Every Monday, last 7 days${scope === "both" ? "" : ` - ${SCOPE_META[scope].label} + store`}`} />
      <div className="overflow-x-auto">
        <table className="w-full text-[14px] min-w-[600px]">
          <thead>
            <tr className="text-left text-[13px] text-[#71717A] dark:text-[#A1A1AA] border-b border-black/[0.06] dark:border-white/[0.06]">
              <th className="py-2 pr-2 font-semibold">Number</th>
              <th className="py-2 px-2 font-semibold">Now</th>
              <th className="py-2 px-2 font-semibold">Week 4 target</th>
              <th className="py-2 pl-2 font-semibold">OK to raise budget when</th>
            </tr>
          </thead>
          <tbody>
            {checks.map(c => (
              <tr key={c.metric} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                <td className="py-2 pr-2">
                  <p className="font-semibold text-[#18181B] dark:text-[#F4F4F5]">{c.metric}</p>
                  <p className="text-[12px] text-[#A1A1AA]">{c.where}</p>
                </td>
                <td className={cn("py-2 px-2 font-bold whitespace-nowrap", c.ok === true ? "text-[#16A34A]" : c.ok === false ? "text-[#DC2626]" : "text-[#18181B] dark:text-[#F4F4F5]")}>
                  <span className="inline-flex items-center gap-1">{c.ok === true && <CheckCircle2 size={13} />}{c.ok === false && <XCircle size={13} />}{c.now}</span>
                </td>
                <td className="py-2 px-2 text-[#52525B] dark:text-[#A1A1AA]">{c.week4}</td>
                <td className="py-2 pl-2 text-[#52525B] dark:text-[#A1A1AA]">{c.scaleWhen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 rounded-xl bg-[#FEF2F2] dark:bg-[#2A1212] text-[#B91C1C] dark:text-[#FCA5A5] text-[14px] font-semibold px-3 py-2 flex gap-1.5">
        <XCircle size={15} className="shrink-0 mt-0.5" /> If the week's numbers miss their target, don't raise the budget. Fix first, then scale.
      </p>
      <p className="mt-2 text-[13px] text-[#71717A] flex gap-1.5"><ArrowRight size={13} className="shrink-0 mt-0.5" /> Green = already at the healthy level. Red = work on it with the plan above.</p>
    </Card>
  );
}
