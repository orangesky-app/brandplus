"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Stethoscope, AlertTriangle, CheckCircle2, RefreshCw, Target, CalendarClock, ListChecks,
  ShoppingBag, Megaphone, Share2, Store, Wallet, Info, ArrowRight, XCircle,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { RangeText } from "@/components/ui/period";
import { useDateRange, getComparisonRange, rangeDays } from "@/lib/date-range-context";
import { fetchGoogleAds, gadsIssueText } from "@/lib/gads-client";
import { buildDiagnosis, type Diagnosis, type DiagnosisInput, type PillarKey, type Severity, type SegmentLite, type ShopDiagnosis, type MetaKpisLite, type MetaCampaignLite, type MetaAdLite } from "@/lib/diagnosis";
import { formatINR, cn } from "@/lib/utils";

const PILLAR_ICON: Record<PillarKey, typeof Store> = { offer: ShoppingBag, meta: Share2, google: Megaphone, store: Store, spend: Wallet };
const SEV_STYLE: Record<Severity, string> = {
  high: "bg-[#FEE2E2] text-[#B91C1C] dark:bg-[#3A1414] dark:text-[#FCA5A5]",
  medium: "bg-[#FEF3C7] text-[#92400E] dark:bg-[#33270C] dark:text-[#FCD34D]",
  low: "bg-[#F4F4F5] text-[#52525B] dark:bg-[#262626] dark:text-[#A1A1AA]",
};
const SEV_LABEL: Record<Severity, string> = { high: "Big problem", medium: "Problem", low: "Watch" };
const STATUS_STYLE = {
  problem: { ring: "border-[#FCA5A5] dark:border-[#7F1D1D]", text: "text-[#DC2626]", label: "Problem" },
  watch: { ring: "border-[#FCD34D] dark:border-[#78350F]", text: "text-[#B45309] dark:text-[#FCD34D]", label: "Needs work" },
  ok: { ring: "border-[#86EFAC] dark:border-[#14532D]", text: "text-[#16A34A]", label: "Healthy" },
  no_data: { ring: "border-black/[0.06] dark:border-white/[0.06]", text: "text-[#A1A1AA]", label: "No data" },
} as const;

const TARGET_KEY = "skylitee-diag-target";

type Json = Record<string, unknown> & { error?: string };
async function getJson(url: string): Promise<Json | null> {
  try {
    const r = await fetch(url);
    const d = await r.json() as Json;
    return d && !d.error ? d : null;
  } catch { return null; }
}

export default function DiagnosisPage() {
  const { range, setPreset } = useDateRange();
  const days = rangeDays(range);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState<Omit<DiagnosisInput, "targetPerDay"> | null>(null);
  const [targetPerDay, setTargetPerDay] = useState(25);
  const [targetDraft, setTargetDraft] = useState("25");

  useEffect(() => {
    try {
      const t = parseInt(localStorage.getItem(TARGET_KEY) ?? "");
      if (t > 0) { setTargetPerDay(t); setTargetDraft(String(t)); }
    } catch { /* ignore */ }
  }, []);
  function saveTarget(v: string) {
    setTargetDraft(v);
    const n = parseInt(v);
    if (n > 0 && n <= 100000) {
      setTargetPerDay(n);
      try { localStorage.setItem(TARGET_KEY, String(n)); } catch { /* ignore */ }
    }
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

      let costs: DiagnosisInput["costs"] = null;
      try { const c = localStorage.getItem("skylitee-pl-inputs"); if (c) costs = JSON.parse(c); } catch { /* ignore */ }

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
        gads: gads?.data ? { ...gads.data.kpis, campaigns: gads.data.campaigns } : null,
        gadsNote: gads ? gadsIssueText(gads.issue) : null,
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

  const dx: Diagnosis | null = useMemo(() => (input ? buildDiagnosis({ ...input, targetPerDay }) : null), [input, targetPerDay]);
  const noShop = !!input && !input.shop;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-[#18181B] dark:text-[#F4F4F5] flex items-center gap-2"><Stethoscope size={18} className="text-[#F97316]" /> Growth Diagnosis</h2>
          <p className="text-[15px] text-[#A1A1AA] mt-0.5">Where the money leaks - offer, Meta, Google or store - and what to do about it · <RangeText /></p>
        </div>
        <label className="flex items-center gap-2 text-[14px] text-[#52525B] dark:text-[#A1A1AA] bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-1.5">
          <Target size={14} className="text-[#F97316]" />
          Goal
          <input type="number" min={1} value={targetDraft} onChange={e => saveTarget(e.target.value)}
            className="w-16 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-md px-2 py-0.5 text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5] outline-none focus:ring-1 focus:ring-[#F97316]" />
          orders / day
        </label>
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
      ) : dx && (
        <>
          <BiggestProblem dx={dx} />
          <PillarGrid dx={dx} />
          <ProblemList dx={dx} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <MathCard dx={dx} />
            <TimelineCard dx={dx} />
          </div>
          <PlanCard dx={dx} />
          <ChecksCard dx={dx} />
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

function BiggestProblem({ dx }: { dx: Diagnosis }) {
  const b = dx.biggest;
  if (!b && !dx.pillars.some(p => p.status === "ok")) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <Info size={22} className="text-[#A1A1AA] shrink-0 mt-0.5" />
          <div>
            <p className="text-[17px] font-bold text-[#18181B] dark:text-[#F4F4F5]">Not enough data to diagnose yet</p>
            <p className="text-[15px] text-[#52525B] dark:text-[#A1A1AA] mt-0.5">Pick a longer date range, or connect Meta Ads, Google Ads and Google Analytics so every part can be checked.</p>
          </div>
        </div>
      </Card>
    );
  }
  if (!b) {
    return (
      <Card className="border-[#86EFAC] dark:border-[#14532D]">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={22} className="text-[#16A34A] shrink-0 mt-0.5" />
          <div>
            <p className="text-[17px] font-bold text-[#18181B] dark:text-[#F4F4F5]">No major leak found</p>
            <p className="text-[15px] text-[#52525B] dark:text-[#A1A1AA] mt-0.5">The numbers that were available look healthy. Follow the weekly checks below and grow budget step by step.</p>
          </div>
        </div>
      </Card>
    );
  }
  const pillar = dx.pillars.find(p => p.key === b.pillar)!;
  return (
    <div className="rounded-2xl border border-[#FCA5A5] dark:border-[#7F1D1D] bg-gradient-to-br from-[#FEF2F2] to-white dark:from-[#2A1212] dark:to-[#171717] p-4 shadow-sm">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold uppercase tracking-wide text-[#DC2626] flex items-center gap-1.5"><AlertTriangle size={14} /> Biggest problem · {pillar.label}</p>
          <p className="text-[20px] font-bold text-[#18181B] dark:text-[#F4F4F5] mt-1 leading-snug">{b.title}</p>
          <p className="text-[15px] text-[#52525B] dark:text-[#A1A1AA] mt-1.5 leading-relaxed">{b.detail}</p>
          <p className="text-[15px] text-[#18181B] dark:text-[#F4F4F5] mt-2 flex gap-1.5"><ArrowRight size={16} className="text-[#16A34A] shrink-0 mt-0.5" /><span><b>Fix:</b> {b.fix}</span></p>
        </div>
        <div className="text-right shrink-0">
          {b.impact > 0 && <>
            <p className="text-[26px] font-bold text-[#DC2626] leading-none">{formatINR(b.impact)}</p>
            <p className="text-[13px] text-[#71717A] mt-1">lost per month</p>
          </>}
          {dx.totalImpact > b.impact && (
            <p className="text-[13px] text-[#71717A] mt-2">All problems: <b className="text-[#DC2626]">{formatINR(dx.totalImpact)}</b>/month</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PillarGrid({ dx }: { dx: Diagnosis }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
      {dx.pillars.map((p, i) => {
        const Icon = PILLAR_ICON[p.key];
        const st = STATUS_STYLE[p.status];
        return (
          <a key={p.key} href={`#pillar-${p.key}`} className={cn("block bg-white dark:bg-[#171717] border-2 rounded-2xl p-3 hover:shadow-md transition-shadow", st.ring)}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[14px] font-semibold text-[#52525B] dark:text-[#A1A1AA]"><Icon size={14} /> {p.label}</span>
              {p.status !== "no_data" && p.status !== "ok" && <span className="text-[12px] font-bold text-[#A1A1AA]">#{i + 1}</span>}
            </div>
            <p className={cn("text-[15px] font-bold mt-1.5", st.text)}>{st.label}</p>
            <p className="text-[18px] font-bold text-[#18181B] dark:text-[#F4F4F5] leading-tight">{p.impact > 0 ? `${formatINR(p.impact)}/mo` : p.status === "no_data" ? "-" : p.findings.length ? `${p.findings.length} issue${p.findings.length > 1 ? "s" : ""}` : "OK"}</p>
            <p className="text-[13px] text-[#71717A] dark:text-[#A1A1AA] mt-1 line-clamp-2">{p.headline}</p>
          </a>
        );
      })}
    </div>
  );
}

function ProblemList({ dx }: { dx: Diagnosis }) {
  const shown = dx.pillars.filter(p => p.findings.length || p.wins.length || p.status === "no_data");
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><AlertTriangle size={16} className="text-[#DC2626]" /> Problems, biggest first</span>} right={<span>₹ = money lost or wasted per month</span>} />
      <div className="space-y-4">
        {shown.map(p => {
          const Icon = PILLAR_ICON[p.key];
          return (
            <section key={p.key} id={`pillar-${p.key}`} className="scroll-mt-20">
              <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] dark:border-white/[0.06] pb-1.5 mb-2">
                <h3 className="text-[16px] font-bold text-[#18181B] dark:text-[#F4F4F5] flex items-center gap-1.5"><Icon size={15} className="text-[#F97316]" /> {p.label}</h3>
                {p.impact > 0 && <span className="text-[15px] font-bold text-[#DC2626]">{formatINR(p.impact)}/mo</span>}
              </div>
              {p.status === "no_data" && p.findings.length === 0 && (
                <p className="text-[14px] text-[#71717A] dark:text-[#A1A1AA] flex items-center gap-1.5"><Info size={13} /> {p.missing}</p>
              )}
              <div className="space-y-2">
                {p.findings.map(f => (
                  <div key={f.id} className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className={cn("text-[12px] font-bold px-2 py-0.5 rounded-full", SEV_STYLE[f.severity])}>{SEV_LABEL[f.severity]}</span>
                        <span className="text-[15px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">{f.title}</span>
                      </div>
                      {f.impact > 0 && <span className="text-[14px] font-bold text-[#DC2626] shrink-0">{formatINR(f.impact)}/mo</span>}
                    </div>
                    <p className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] mt-1.5 leading-relaxed">{f.detail}</p>
                    <p className="text-[14px] text-[#18181B] dark:text-[#E4E4E7] mt-1.5 flex gap-1.5"><ArrowRight size={14} className="text-[#16A34A] shrink-0 mt-0.5" /><span><b>Fix:</b> {f.fix}</span></p>
                  </div>
                ))}
              </div>
              {p.wins.length > 0 && (
                <div className="mt-2 rounded-xl bg-[#F0FDF4] dark:bg-[#0F2416] border border-[#BBF7D0] dark:border-[#14532D] p-2.5">
                  <p className="text-[13px] font-bold text-[#15803D] dark:text-[#86EFAC] mb-1">What's working</p>
                  {p.wins.map(w => <p key={w} className="text-[14px] text-[#166534] dark:text-[#BBF7D0] flex gap-1.5"><CheckCircle2 size={13} className="shrink-0 mt-0.5" /> {w}</p>)}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </Card>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl bg-[#F5F5F4] dark:bg-[#1C1C1C] p-2.5">
      <p className="text-[13px] text-[#71717A] dark:text-[#A1A1AA]">{label}</p>
      <p className={cn("text-[18px] font-bold", tone === "good" ? "text-[#16A34A]" : tone === "bad" ? "text-[#DC2626]" : "text-[#18181B] dark:text-[#F4F4F5]")}>{value}</p>
      {sub && <p className="text-[12px] text-[#A1A1AA]">{sub}</p>}
    </div>
  );
}

function MathCard({ dx }: { dx: Diagnosis }) {
  const e = dx.economics, m = dx.math;
  const cpaTone = e.costPerKept != null && e.targetCpa != null ? (e.costPerKept <= e.targetCpa ? "good" : "bad") : undefined;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Target size={16} className="text-[#F97316]" /> Math for {m.targetPerDay} orders a day</span>} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Kept orders / day now" value={e.keptPerDay.toFixed(1)} sub={`${e.placedPerDay.toFixed(1)} placed`} />
        <Stat label="Average order" value={e.aov > 0 ? formatINR(e.aov) : "-"} />
        <Stat label="Ad spend / day now" value={e.adSpendPerDay > 0 ? formatINR(e.adSpendPerDay) : "-"} sub="Meta + Google" />
        <Stat label="Ad cost per kept order" value={e.costPerKept != null ? formatINR(e.costPerKept) : "-"} tone={cpaTone}
          sub={e.targetCpa ? `healthy: under ${formatINR(e.targetCpa)}${e.cpaIsEstimate ? " (est.)" : ""}` : undefined} />
      </div>
      <div className="mt-3 rounded-xl border border-black/[0.06] dark:border-white/[0.06] divide-y divide-black/[0.06] dark:divide-white/[0.06]">
        <div className="flex items-center justify-between p-2.5">
          <span className="text-[14px] text-[#52525B] dark:text-[#A1A1AA]">Spend needed at today's cost</span>
          <span className={cn("text-[16px] font-bold", cpaTone === "bad" ? "text-[#DC2626]" : "text-[#18181B] dark:text-[#F4F4F5]")}>{m.atCurrentCost != null ? `${formatINR(m.atCurrentCost)}/day` : "-"}</span>
        </div>
        <div className="flex items-center justify-between p-2.5">
          <span className="text-[14px] text-[#52525B] dark:text-[#A1A1AA]">Spend needed after fixes{e.targetCpa ? ` (${formatINR(e.targetCpa)}/order)` : ""}</span>
          <span className="text-[16px] font-bold text-[#16A34A]">{m.atTargetCost != null ? `${formatINR(m.atTargetCost)}/day` : "-"}</span>
        </div>
      </div>
      <p className="text-[13px] text-[#71717A] dark:text-[#A1A1AA] mt-2">{m.note} "Kept" = not cancelled or returned.</p>
    </Card>
  );
}

function TimelineCard({ dx }: { dx: Diagnosis }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><CalendarClock size={16} className="text-[#F97316]" /> Realistic timeline</span>} />
      <ol className="space-y-3">
        {dx.timeline.map((t, i) => (
          <li key={t.when} className="flex gap-3">
            <span className="w-7 h-7 rounded-full bg-[#FFF7ED] dark:bg-[#2A1A0E] text-[#EA580C] text-[13px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
            <div>
              <p className="text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{t.when}</p>
              <p className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] leading-relaxed">{t.expect}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 rounded-xl bg-[#FEF2F2] dark:bg-[#2A1212] text-[#B91C1C] dark:text-[#FCA5A5] text-[14px] font-semibold px-3 py-2 flex gap-1.5">
        <XCircle size={15} className="shrink-0 mt-0.5" /> If the weekly targets aren't met, don't raise the budget.
      </p>
    </Card>
  );
}

function PlanCard({ dx }: { dx: Diagnosis }) {
  const cols: { title: string; sub: string; items: Diagnosis["plan"]["week1"] }[] = [
    { title: "Week 1", sub: "Stop the losses", items: dx.plan.week1 },
    { title: "Weeks 2-4", sub: "Fix what sells", items: dx.plan.weeks2to4 },
    { title: "Months 2-3", sub: "Grow, step by step", items: dx.plan.months2to3 },
  ];
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><ListChecks size={16} className="text-[#F97316]" /> Plan of action</span>} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {cols.map(c => (
          <div key={c.title} className="rounded-xl bg-[#F5F5F4] dark:bg-[#1C1C1C] p-3">
            <p className="text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{c.title}</p>
            <p className="text-[13px] text-[#71717A] mb-2">{c.sub}</p>
            {c.items.length === 0 ? <p className="text-[14px] text-[#A1A1AA]">Nothing urgent here.</p> : (
              <ol className="space-y-2">
                {c.items.map((it, i) => (
                  <li key={i} className="flex gap-2 text-[14px] text-[#18181B] dark:text-[#E4E4E7]">
                    <span className="text-[#EA580C] font-bold shrink-0">{i + 1}.</span>
                    <span>{it.text}{it.why && <span className="block text-[12px] text-[#71717A] dark:text-[#A1A1AA] mt-0.5">Why: {it.why}</span>}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChecksCard({ dx }: { dx: Diagnosis }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><CheckCircle2 size={16} className="text-[#F97316]" /> Check these every week</span>} right={<span>Grow budget only when all are green</span>} />
      <div className="overflow-x-auto">
        <table className="w-full text-[14px] min-w-[560px]">
          <thead>
            <tr className="text-left text-[13px] text-[#71717A] dark:text-[#A1A1AA] border-b border-black/[0.06] dark:border-white/[0.06]">
              <th className="py-2 pr-2 font-semibold">Number</th>
              <th className="py-2 px-2 font-semibold">Now</th>
              <th className="py-2 px-2 font-semibold">Week 4 target</th>
              <th className="py-2 pl-2 font-semibold">OK to grow</th>
            </tr>
          </thead>
          <tbody>
            {dx.checks.map(c => (
              <tr key={c.metric} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                <td className="py-2 pr-2">
                  <p className="font-semibold text-[#18181B] dark:text-[#F4F4F5]">{c.metric}</p>
                  <p className="text-[12px] text-[#A1A1AA]">{c.hint}</p>
                </td>
                <td className={cn("py-2 px-2 font-bold", c.ok === true ? "text-[#16A34A]" : c.ok === false ? "text-[#DC2626]" : "text-[#18181B] dark:text-[#F4F4F5]")}>
                  <span className="inline-flex items-center gap-1">
                    {c.ok === true && <CheckCircle2 size={13} />}{c.ok === false && <XCircle size={13} />}{c.now}
                  </span>
                </td>
                <td className="py-2 px-2 text-[#52525B] dark:text-[#A1A1AA]">{c.target}</td>
                <td className="py-2 pl-2 text-[#52525B] dark:text-[#A1A1AA]">{c.grow}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
