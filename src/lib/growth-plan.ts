// Growth plan: turns the diagnosis into the five sections of the Growth Diagnosis page.
//   01 Goal       - where you are, the gap, whether the target is realistic, the budget it takes
//   02 Analysis   - scorecard for the chosen scope (Meta / Google / Both) against healthy numbers
//   03 Result     - the problems in that scope: what, where, the fix, ₹ per month
//   04 Plan       - week-by-week actions with exact names, ₹ amounts and a "done when" for each
//   05 Weekly     - the numbers to check every week, with the bar to clear before raising budget
// Pure functions. Every number comes from the diagnosis input; nothing is made up.

import { addImpact, isSalesObjective, type Diagnosis, type DiagnosisInput, type Finding, type PillarKey } from "./diagnosis";
import { BENCHMARKS, CHANNEL_LABEL, ROAS_TARGET, buildScorecard, judgeLost, judgeQs, judgeShare, sumMetrics, type Campaign, type Channel } from "./gads-analysis";

export type Scope = "meta" | "google" | "both";
export type GoalType = "orders" | "revenue";
export type Verdict = "good" | "watch" | "bad" | "na";

export interface GoalSettings { type: GoalType; target: number; months: number }

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const pct = (n: number, d = 0) => `${n.toFixed(d)}%`;
const x2 = (n: number) => `${n.toFixed(2)}x`;
const shortList = (names: string[], n = 3) => names.slice(0, n).map(s => `"${s.length > 45 ? s.slice(0, 45) + "..." : s}"`).join(", ") + (names.length > n ? ` and ${names.length - n} more` : "");
const up = (v: number, good: number, watch: number): Verdict => (v >= good ? "good" : v >= watch ? "watch" : "bad");
const down = (v: number, good: number, watch: number): Verdict => (v <= good ? "good" : v <= watch ? "watch" : "bad");
const round10 = (n: number) => Math.round(n / 10) * 10;

/* ═══════════════════════ 01 GOAL ═══════════════════════ */

export type Feasibility = "reached" | "realistic" | "stretch" | "unrealistic" | "no_data";
export interface PathStep { month: number; ordersPerDay: number; cpa: number; budgetPerDay: number; revenuePerMonth: number }
export interface GoalPlan {
  goal: GoalSettings;
  nowOrdersPerDay: number; nowRevenuePerMonth: number;
  targetOrdersPerDay: number; targetRevenuePerMonth: number;
  gapOrdersPerDay: number;
  monthlyGrowth: number | null;     // growth needed each month, 1.3 = +30% a month
  feasibility: Feasibility;
  achievableOrdersPerDay: number;   // what +50% a month reaches in the same time
  spendNowPerDay: number;
  budgetAtTodayCost: number | null; // target orders x today's ad cost per kept order
  budgetAtHealthyCost: number | null;
  costPerKept: number | null; targetCpa: number | null; breakEvenCpa: number | null; cpaIsEstimate: boolean;
  roasNeeded: number | null; breakEvenRoas: number | null;
  path: PathStep[];
  verdict: string;
}

export function buildGoal(dx: Diagnosis, goal: GoalSettings): GoalPlan {
  const e = dx.economics;
  const nowOrders = e.keptPerDay;
  const nowRev = nowOrders * e.aov * 30;
  const targetOrders = goal.type === "orders" ? goal.target : e.aov > 0 ? goal.target / 30 / e.aov : 0;
  const targetRev = goal.type === "revenue" ? goal.target : goal.target * e.aov * 30;
  const months = Math.max(goal.months, 1);
  const roasNeeded = e.targetCpa && e.targetCpa > 0 ? e.aov / e.targetCpa : null;
  const breakEvenRoas = e.breakEvenCpa && e.breakEvenCpa > 0 ? e.aov / e.breakEvenCpa : null;

  let feasibility: Feasibility = "no_data";
  let g: number | null = null;
  if (nowOrders > 0 && targetOrders > 0) {
    if (nowOrders >= targetOrders) feasibility = "reached";
    else {
      g = Math.pow(targetOrders / nowOrders, 1 / months);
      feasibility = g <= 1.5 ? "realistic" : g <= 2.2 ? "stretch" : "unrealistic";
    }
  }
  const achievable = nowOrders * Math.pow(1.5, months);

  // Month-by-month path. Month 1 is mostly fixing, so cost per order falls toward healthy first;
  // after that scaling usually makes each extra order a little dearer, never above the healthy cost.
  const path: PathStep[] = [];
  const cpaNow = e.costPerKept;
  const healthy = e.targetCpa;
  if (nowOrders > 0 && targetOrders > nowOrders && cpaNow != null && healthy != null) {
    const step = feasibility === "unrealistic" ? 1.5 : (g ?? 1);
    for (let i = 1; i <= months; i++) {
      const orders = i === months && feasibility !== "unrealistic" ? targetOrders : nowOrders * Math.pow(step, i);
      const cpa = cpaNow > healthy
        ? (i === 1 ? cpaNow - (cpaNow - healthy) * 0.6 : healthy)
        : Math.min(healthy, cpaNow * (1 + 0.08 * i));
      path.push({ month: i, ordersPerDay: orders, cpa, budgetPerDay: orders * cpa, revenuePerMonth: orders * e.aov * 30 });
    }
  }

  const tgtTxt = goal.type === "orders" ? `${goal.target} orders a day` : `${inr(goal.target)} sales a month`;
  let verdict = "";
  if (feasibility === "no_data") verdict = "Not enough orders in this period to plan a goal. Pick a longer date range.";
  else if (feasibility === "reached") verdict = `You're already at ${nowOrders.toFixed(1)} kept orders a day - the goal of ${tgtTxt} is met. Raise the goal, or focus on profit per order.`;
  else if (feasibility === "realistic") verdict = `Realistic. ${tgtTxt} in ${months} month${months > 1 ? "s" : ""} needs about +${Math.round((g! - 1) * 100)}% orders each month, which a fixed account can do.`;
  else if (feasibility === "stretch") verdict = `Possible but a stretch: it needs +${Math.round((g! - 1) * 100)}% orders every month. Only works if the fixes below land in the first 2-3 weeks.`;
  else verdict = `Not realistic in ${months} month${months > 1 ? "s" : ""}: it needs +${Math.round((g! - 1) * 100)}% orders every month. A strong but safe pace (+50%/month) reaches about ${achievable.toFixed(0)} orders a day. Set that as the goal, or give it more months.`;

  return {
    goal, nowOrdersPerDay: nowOrders, nowRevenuePerMonth: nowRev, targetOrdersPerDay: targetOrders, targetRevenuePerMonth: targetRev,
    gapOrdersPerDay: Math.max(targetOrders - nowOrders, 0), monthlyGrowth: g, feasibility, achievableOrdersPerDay: achievable,
    spendNowPerDay: e.adSpendPerDay,
    budgetAtTodayCost: cpaNow != null && targetOrders > 0 ? targetOrders * cpaNow : null,
    budgetAtHealthyCost: healthy != null && targetOrders > 0 ? targetOrders * healthy : null,
    costPerKept: cpaNow, targetCpa: healthy, breakEvenCpa: e.breakEvenCpa, cpaIsEstimate: e.cpaIsEstimate,
    roasNeeded, breakEvenRoas, path, verdict,
  };
}

/* ═══════════════════════ shared numbers ═══════════════════════ */

interface Ctx {
  dx: Diagnosis; inp: DiagnosisInput; goal: GoalPlan;
  days: number; month: number;
  targetCpa: number; breakEvenCpa: number; aov: number;
  metaSpendDay: number; gadsSpendDay: number;
  campaigns: Campaign[]; // Google, with impression share + bidding (from the analytics route)
}
function ctxOf(dx: Diagnosis, inp: DiagnosisInput, goal: GoalPlan): Ctx {
  const days = dx.days;
  const e = dx.economics;
  return {
    dx, inp, goal, days, month: 30 / days,
    targetCpa: e.targetCpa ?? 0, breakEvenCpa: e.breakEvenCpa ?? 0, aov: e.aov,
    metaSpendDay: (inp.meta?.kpis.spend ?? 0) / days,
    gadsSpendDay: (inp.gads?.spend ?? 0) / days,
    campaigns: (inp.gadsInsights?.overview?.campaigns ?? []).filter(c => c.status !== "REMOVED"),
  };
}

export function availableScopes(inp: DiagnosisInput): { meta: boolean; google: boolean } {
  return { meta: (inp.meta?.kpis.spend ?? 0) > 0, google: (inp.gads?.spend ?? 0) > 0 };
}
export function defaultScope(inp: DiagnosisInput): Scope {
  const a = availableScopes(inp);
  return a.meta && a.google ? "both" : a.google ? "google" : "meta";
}

/* ═══════════════════════ 02 ANALYSIS ═══════════════════════ */

export interface ScoreRow { metric: string; you: string; healthy: string; verdict: Verdict; why: string }
export interface ScoreBlock { title: string; rows: ScoreRow[]; note?: string }

function metaScore(c: Ctx): ScoreBlock {
  const m = c.inp.meta?.kpis;
  if (!m || m.spend <= 0) return { title: "Meta Ads", rows: [], note: c.inp.meta ? "No Meta ad spend in this period." : "Meta Ads isn't connected." };
  const rows: ScoreRow[] = [];
  const healthyRoas = c.goal.roasNeeded, beRoas = c.goal.breakEvenRoas;
  if (m.purchases > 0) {
    const cpp = m.spend / m.purchases;
    rows.push({
      metric: "Cost per purchase (Meta)", you: inr(cpp), healthy: c.targetCpa ? `under ${inr(c.targetCpa)}` : "-",
      verdict: c.targetCpa ? down(cpp, c.targetCpa, c.breakEvenCpa) : "na",
      why: cpp <= c.targetCpa ? "Meta buys orders for less than you can afford - room to scale." : cpp <= c.breakEvenCpa ? "Each order still makes money but very little. Cut waste before scaling." : "Every order Meta brings loses money after product and shipping costs.",
    });
    rows.push({
      metric: "ROAS (Meta)", you: x2(m.roas), healthy: healthyRoas ? `${x2(healthyRoas)}+ (break-even ${beRoas ? x2(beRoas) : "-"})` : `${ROAS_TARGET}x+`,
      verdict: healthyRoas && beRoas ? up(m.roas, healthyRoas, beRoas) : up(m.roas, ROAS_TARGET, 2),
      why: "Sales value Meta reports per ₹1 spent. Meta counts cancelled COD orders too, so the real figure is lower.",
    });
  } else if (m.leads > 0) {
    rows.push({ metric: "Cost per lead", you: inr(m.spend / m.leads), healthy: "-", verdict: "na", why: "Leads campaigns - judge them on how many leads turn into orders." });
  } else {
    rows.push({ metric: "Purchases recorded", you: "0", healthy: "1+ per target cost", verdict: "bad", why: "Meta saw no purchase. Either tracking is broken or nothing sold." });
  }
  rows.push({ metric: "Click rate (CTR)", you: pct(m.ctr, 2), healthy: "1.5%+", verdict: up(m.ctr, 1.5, 1), why: m.ctr >= 1.5 ? "Ads stop the scroll and get clicks." : "People see the ads but don't click - the hook or the offer isn't strong enough." });
  if (m.cpm && m.cpm > 0) rows.push({ metric: "Cost per 1,000 views (CPM)", you: inr(m.cpm), healthy: "₹80-200", verdict: down(m.cpm, 200, 300), why: m.cpm <= 200 ? "You're paying a normal price to reach people." : "Reach is expensive: audience too narrow, or ads Meta rates as low quality." });
  if ((m.videoViews3s ?? 0) > 0 && m.thumbStopRatio != null) rows.push({ metric: "Hook rate (3-sec views)", you: pct(m.thumbStopRatio), healthy: "25%+", verdict: up(m.thumbStopRatio, 25, 15), why: m.thumbStopRatio >= 25 ? "The first 3 seconds hold people." : "Most people scroll past before the product shows. The opening needs to change." });
  rows.push({ metric: "Frequency", you: m.frequency.toFixed(1), healthy: "under 3", verdict: down(m.frequency, 3, 4.5), why: m.frequency <= 3 ? "People aren't tired of the ads yet." : "The same people see the same ads too often - clicks drop and cost climbs." });
  if (m.outboundClicks >= 50) {
    const lp = (m.lpv / m.outboundClicks) * 100;
    rows.push({ metric: "Clicks that load the page", you: pct(lp), healthy: "75%+", verdict: up(lp, 75, 60), why: lp >= 75 ? "The page loads fast enough on mobile." : "People leave while the page loads - it's too slow on mobile." });
  }
  if (m.lpv >= 100) {
    const atc = (m.atc / m.lpv) * 100;
    rows.push({ metric: "Visitors who add to cart", you: pct(atc, 1), healthy: "8%+", verdict: up(atc, 8, 5), why: atc >= 8 ? "The product page convinces people." : "The page doesn't convince - price, proof or offer is unclear." });
    if (m.purchases > 0) {
      const cv = (m.purchases / m.lpv) * 100;
      rows.push({ metric: "Visitors who buy", you: pct(cv, 2), healthy: "1.5-2%+", verdict: up(cv, 1.5, 1), why: cv >= 1.5 ? "Visitors from Meta turn into orders well." : "Too few Meta visitors order. Fix the page before paying for more traffic." });
    }
  }
  const camps = (c.inp.meta?.campaigns ?? []).filter(x => x.spend > 0);
  if (camps.length) {
    const perDay = m.spend / c.days / camps.length;
    const need = Math.max(c.targetCpa, 500);
    rows.push({ metric: "Budget per campaign / day", you: `${inr(perDay)} (${camps.length} live)`, healthy: `${inr(need)}+`, verdict: up(perDay, need, need * 0.5), why: perDay >= need ? "Each campaign has enough budget to get daily sales and learn." : "Budget is split too thin - campaigns can't get enough sales to learn who buys." });
  }
  const dead = c.dx.findings.find(f => f.id === "meta_dead");
  const waste = dead ? dead.impact / c.month : 0;
  rows.push({ metric: "Spend on zero-sale campaigns", you: pct((waste / m.spend) * 100), healthy: "under 10%", verdict: down((waste / m.spend) * 100, 10, 20), why: waste > 0 ? "Money going to campaigns that never sold." : "Every campaign with real spend brought sales." });
  return { title: "Meta Ads", rows };
}

function googleScore(c: Ctx): ScoreBlock {
  const g = c.inp.gads;
  if (!g || g.spend <= 0) return { title: "Google Ads", rows: [], note: g ? "No Google Ads spend in this period." : (c.inp.gadsNote ?? "Google Ads isn't connected.") };
  const rows: ScoreRow[] = [];
  const o = c.inp.gadsInsights?.overview ?? null;
  const k = c.inp.gadsInsights?.keywords ?? null;
  const sales = c.campaigns.filter(x => x.objective === "SALES");
  const conv = o ? sumMetrics(sales.length ? sales : c.campaigns).conversions : g.conversions;
  const value = o ? sumMetrics(sales.length ? sales : c.campaigns).convValue : g.conversionValue;
  const spend = o ? sumMetrics(sales.length ? sales : c.campaigns).spend : g.spend;
  const tracking = c.dx.findings.some(f => f.pillar === "google" && f.where === "Google > Tracking" && f.severity === "high");
  rows.push({ metric: "Purchase tracking", you: tracking ? "Broken / mixed" : conv > 0 ? "Recording" : "0 sales", healthy: "Purchases only, with value", verdict: tracking ? "bad" : conv > 0 ? "good" : "bad", why: tracking ? "Google can't see real sales, so automated bidding guesses." : "Google sees purchases and can bid toward them." });
  if (conv > 0) {
    const cpa = spend / conv;
    rows.push({ metric: "Cost per sale (Google)", you: inr(cpa), healthy: c.targetCpa ? `under ${inr(c.targetCpa)}` : "-", verdict: c.targetCpa ? down(cpa, c.targetCpa, c.breakEvenCpa) : "na", why: cpa <= c.targetCpa ? "Google brings sales below your healthy cost." : cpa <= c.breakEvenCpa ? "Sales still make a small profit - trim waste before scaling." : "Each Google sale costs more than it earns." });
    const roas = spend > 0 ? value / spend : 0;
    const need = c.goal.roasNeeded, be = c.goal.breakEvenRoas;
    rows.push({ metric: "ROAS (Google)", you: x2(roas), healthy: need ? `${x2(need)}+ (break-even ${be ? x2(be) : "-"})` : `${ROAS_TARGET}x+`, verdict: need && be ? up(roas, need, be) : up(roas, ROAS_TARGET, 2), why: "Sales value Google reports per ₹1 spent." });
  }
  if (o) {
    for (const sc of buildScorecard(c.campaigns)) {
      for (const r of sc.rows) {
        if (r.kpi === "ROAS" || r.verdict === "na") continue;
        rows.push({ metric: `${CHANNEL_LABEL[sc.channel]} ${r.kpi === "CTR" ? "click rate" : "conversion rate"}`, you: r.you, healthy: `${r.standard}+`, verdict: r.verdict, why: r.kpi === "CTR" ? (r.verdict === "good" ? "Ads match what people search for." : "Ads don't match the searches - message or keywords are off.") : (r.verdict === "good" ? "Clicks turn into sales." : "Clicks don't turn into sales - the page or offer doesn't match the ad.") });
      }
    }
    const search = c.campaigns.filter(x => x.searchIS != null && x.spend > 0);
    const sp = search.reduce((a, x) => a + x.spend, 0);
    if (sp > 0) {
      const w = (f: (x: Campaign) => number | null) => search.reduce((a, x) => a + (f(x) ?? 0) * x.spend, 0) / sp;
      const is = w(x => x.searchIS), bl = w(x => x.searchBudgetLost), rl = w(x => x.searchRankLost);
      rows.push({ metric: "Search impression share", you: pct(is), healthy: "70%+ on brand, 40%+ others", verdict: judgeShare(is) as Verdict, why: "How often your ad shows when someone searches your keywords." });
      rows.push({ metric: "Searches lost to budget", you: pct(bl), healthy: "under 10%", verdict: judgeLost(bl) as Verdict, why: bl < 10 ? "Budget lasts the whole day." : "Budget runs out early. Only worth fixing on campaigns that make money." });
      rows.push({ metric: "Searches lost to ad rank", you: pct(rl), healthy: "under 20%", verdict: rl < 20 ? "good" : rl < 35 ? "watch" : "bad", why: rl < 20 ? "Your ads win their auctions." : "Competitors outrank you - low Quality Score or low bids." });
    }
  }
  if (k) {
    const scored = k.keywords.filter(x => x.qs != null && x.impressions > 0);
    const imp = scored.reduce((a, x) => a + x.impressions, 0);
    if (imp > 0) {
      const q = scored.reduce((a, x) => a + (x.qs ?? 0) * x.impressions, 0) / imp;
      rows.push({ metric: "Average Quality Score", you: `${q.toFixed(1)}/10`, healthy: "7+", verdict: judgeQs(q) as Verdict, why: q >= 7 ? "Google rates your ads and pages as relevant - cheaper clicks." : "Low score means you pay more per click for worse positions." });
    }
    const cpaAvg = conv > 0 ? spend / conv : 0;
    const wasted = k.searchTerms.filter(t => t.conversions === 0 && t.spend > 0 && t.spend >= Math.max(cpaAvg * 0.5, 100) && t.status !== "EXCLUDED");
    const ws = wasted.reduce((a, t) => a + t.spend, 0);
    if (g.spend > 0 && k.searchTerms.length) rows.push({ metric: "Spend on search terms that never sell", you: pct((ws / g.spend) * 100), healthy: "under 10%", verdict: down((ws / g.spend) * 100, 10, 20), why: ws > 0 ? "You pay for searches unrelated to what you sell." : "Search terms are clean." });
  }
  if (!o) return { title: "Google Ads", rows, note: "Campaign-level detail (impression share, Quality Score, search terms) couldn't be loaded, so only totals are judged." };
  return { title: "Google Ads", rows };
}

function bothScore(c: Ctx): ScoreBlock {
  const s = c.inp.shop;
  const rows: ScoreRow[] = [];
  const e = c.dx.economics;
  const spend = (c.inp.meta?.kpis.spend ?? 0) + (c.inp.gads?.spend ?? 0);
  if (e.costPerKept != null) rows.push({ metric: "Ad cost per kept order (all ads)", you: inr(e.costPerKept), healthy: c.targetCpa ? `under ${inr(c.targetCpa)}` : "-", verdict: c.targetCpa ? down(e.costPerKept, c.targetCpa, c.breakEvenCpa) : "na", why: "Total Meta + Google spend divided by orders the store actually kept. The one number that decides profit." });
  if (s && spend > 0) {
    const mer = s.orders.keptRevenue / spend;
    rows.push({ metric: "Store sales per ₹1 of ads (MER)", you: x2(mer), healthy: c.goal.roasNeeded ? `${x2(c.goal.roasNeeded)}+` : "3x+", verdict: c.goal.roasNeeded && c.goal.breakEvenRoas ? up(mer, c.goal.roasNeeded, c.goal.breakEvenRoas) : up(mer, 3, 2), why: "Real kept sales from Shopify, not what the ad platforms claim." });
    const claimed = (c.inp.meta?.kpis.purchases ?? 0) + (c.inp.gads?.conversions ?? 0);
    if (claimed > 0 && s.orders.kept > 0) {
      const ratio = claimed / s.orders.kept;
      rows.push({ metric: "Sales claimed by ads vs kept by store", you: `${Math.round(claimed)} vs ${s.orders.kept}`, healthy: "within 1.2x", verdict: down(ratio, 1.2, 1.6), why: ratio <= 1.2 ? "Ad platforms report roughly what really happened." : "Meta and Google both take credit for the same orders, or count cancelled COD. Trust the store number." });
    }
  }
  const m = c.inp.meta?.kpis, g = c.inp.gads;
  if (m && g && m.purchases > 0 && g.conversions > 0) {
    const mc = m.spend / m.purchases, gc = g.spend / g.conversions;
    rows.push({ metric: "Cost per sale: Meta vs Google", you: `${inr(mc)} vs ${inr(gc)}`, healthy: "move budget to the cheaper", verdict: "na", why: `${mc <= gc ? "Meta" : "Google"} is ${Math.round((Math.max(mc, gc) / Math.min(mc, gc) - 1) * 100)}% cheaper per reported sale.` });
    rows.push({ metric: "Budget split Meta / Google", you: `${Math.round((m.spend / (m.spend + g.spend)) * 100)}% / ${Math.round((g.spend / (m.spend + g.spend)) * 100)}%`, healthy: "more on the cheaper", verdict: "na", why: "Where your money goes today." });
  }
  if (s && s.cod.placed >= 10) rows.push({ metric: "COD orders that fail", you: pct(s.cod.failRatePct), healthy: "under 15%", verdict: down(s.cod.failRatePct, 15, 25), why: s.cod.failRatePct < 15 ? "Most COD orders get paid." : "Ad money spent on orders that never pay - affects Meta and Google alike." });
  if (c.inp.ga4 && c.inp.ga4.sessions >= 300 && s) {
    const cr = (s.orders.placed / c.inp.ga4.sessions) * 100;
    rows.push({ metric: "Store visits that order", you: pct(cr, 2), healthy: "1.5-2%+", verdict: up(cr, 1.5, 1), why: cr >= 1.5 ? "The store converts visitors well." : "The store loses most visitors - every ad channel pays for this." });
  }
  if (s && s.orders.kept >= 10) rows.push({ metric: "Items per order", you: s.orders.itemsPerOrder.toFixed(2), healthy: "1.3+", verdict: up(s.orders.itemsPerOrder, 1.3, 1.1), why: s.orders.itemsPerOrder >= 1.3 ? "Bundles and add-ons work." : "Almost every order is one item - bundles lower your ad cost per ₹ sold." });
  return { title: "Both channels together", rows };
}

export function buildAnalysis(c0: { dx: Diagnosis; inp: DiagnosisInput; goal: GoalPlan }, scope: Scope): ScoreBlock[] {
  const c = ctxOf(c0.dx, c0.inp, c0.goal);
  if (scope === "meta") return [metaScore(c)];
  if (scope === "google") return [googleScore(c)];
  return [bothScore(c), metaScore(c), googleScore(c)];
}

/* ═══════════════════════ 03 RESULT ═══════════════════════ */

// Store findings read from Meta's funnel only make sense when Meta is in scope.
const META_ONLY = new Set(["meta_overcount", "store_speed", "store_atc", "store_conv_meta"]);
export interface ScopedResult { findings: Finding[]; total: number; biggest: Finding | null; wins: { area: string; text: string }[]; missing: string[] }

export function buildResult(dx: Diagnosis, scope: Scope): ScopedResult {
  const pillarsIn: PillarKey[] = scope === "meta" ? ["meta", "offer", "store"] : scope === "google" ? ["google", "offer", "store"] : ["meta", "google", "offer", "store", "spend"];
  const findings = dx.findings
    .filter(f => pillarsIn.includes(f.pillar))
    .filter(f => scope !== "google" || !META_ONLY.has(f.id))
    .sort((a, b) => b.impact - a.impact || ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]));
  const causes = findings.filter(f => f.pillar !== "spend");
  const biggest = [...causes].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]) || b.impact - a.impact)
    .find(f => f.impact > 0) ?? causes.find(f => f.severity === "high") ?? causes[0] ?? null;
  const wins = dx.pillars.filter(p => pillarsIn.includes(p.key)).flatMap(p => p.wins.map(w => ({ area: p.label, text: w })));
  const missing = dx.pillars.filter(p => pillarsIn.includes(p.key) && p.status === "no_data" && p.missing).map(p => `${p.label}: ${p.missing}`);
  return { findings, total: addImpact(causes), biggest, wins, missing };
}

/* ═══════════════════════ 04 PLAN ═══════════════════════ */

export type Phase = "week1" | "weeks2to4" | "months2to3";
export interface PlanStep { phase: Phase; area: string; action: string; how: string[]; doneWhen: string; saves?: number }

function offerStoreSteps(c: Ctx, scope: Scope): PlanStep[] {
  const out: PlanStep[] = [];
  const has = (id: string) => c.dx.findings.find(f => f.id === id);
  const s = c.inp.shop;
  const cod = has("cod_fail");
  if (cod && s) out.push({
    phase: "week1", area: "Offer & COD", saves: cod.impact,
    action: `Confirm every COD order before it ships (COD failure is ${pct(s.cod.failRatePct)})`,
    how: [
      "Turn on an automatic WhatsApp confirmation for every COD order (apps like Shopflo, GoKwik, Wati or your courier's NDR tool do this).",
      "No reply in 24 hours: call once. Still no reply: cancel before shipping - an unshipped order costs nothing.",
      `Give 5-10% off for paying online at checkout, or take a ₹99-149 advance on COD.`,
      has("cod_risk") ? "Hold every order your courier tags as high RTO risk until it's confirmed or prepaid." : "Block repeat RTO pincodes and phone numbers in your courier panel.",
    ],
    doneWhen: "COD failure under 20% for 2 weeks in a row, and prepaid share going up.",
  });
  const aov = has("aov_drop");
  if (aov) out.push({ phase: "week1", area: "Offer & COD", saves: aov.impact, action: "Undo the price cut that didn't bring more orders", how: [aov.detail, "Bring the old price back. If you want a cheaper entry, offer it only as part of a 2-pack or 3-pack."], doneWhen: "Average order back at the old level while orders per day hold." });
  const basket = has("basket");
  if (basket) out.push({ phase: "weeks2to4", area: "Offer & COD", saves: basket.impact, action: "Launch a bundle offer to get 2+ items per order", how: [basket.fix, "Put the bundle price in the first line of the ad and at the top of the product page.", "Add a 'frequently bought together' block and a cart upsell (one click, under 30% of the cart value)."], doneWhen: "Items per order 1.3+ and average order up 10%+." });
  const disc = has("discount");
  if (disc) out.push({ phase: "weeks2to4", area: "Offer & COD", saves: disc.impact, action: "Cut the discount depth to 10-15%", how: [disc.detail, "Replace deeper % codes with a free gift or a bundle price.", "Keep one site-wide offer, not several codes."], doneWhen: "Discounts under 15% of price with orders per day holding." });

  const metaIn = scope !== "google";
  const speed = has("store_speed");
  if (speed && metaIn) out.push({ phase: "week1", area: "Store", saves: speed.impact, action: "Make the ad landing page load in under 3 seconds on mobile", how: ["Open the ad link on a phone on 4G and time it. Run it through PageSpeed Insights (mobile).", "Compress images to under 200 KB, remove apps you don't use, turn off pop-ups that load on entry.", "Send ads to the product page, not the home page."], doneWhen: "75%+ of ad clicks load the page (shown in the weekly checks)." });
  const conv = has("store_conv") ?? (metaIn ? has("store_conv_meta") : undefined);
  const atc = metaIn ? has("store_atc") : undefined;
  const checkout = has("store_checkout");
  if (conv || atc || checkout) out.push({
    phase: "weeks2to4", area: "Store", saves: (conv?.impact ?? 0),
    action: `Fix the product page so more visitors order (${conv ? conv.title.toLowerCase() : atc ? atc.title.toLowerCase() : checkout!.title.toLowerCase()})`,
    how: [
      "Above the fold on mobile: product photo, price incl. shipping, the offer, delivery date, and the Add to Cart button - no scrolling needed.",
      "Add 10+ real reviews with photos and a 15-second product video near the top.",
      "Show trust lines next to the button: COD available, easy 7-day returns, secure payment.",
      ...(checkout ? ["Show COD and shipping fees on the product page so the cart has no surprises; start WhatsApp cart-recovery messages."] : []),
    ],
    doneWhen: "1.5%+ of visits order and 8%+ of visitors add to cart.",
  });
  return out;
}

function metaSteps(c: Ctx): PlanStep[] {
  const m = c.inp.meta?.kpis;
  const out: PlanStep[] = [];
  if (!m || m.spend <= 0) return out;
  const has = (id: string) => c.dx.findings.find(f => f.id === id);
  const camps = (c.inp.meta?.campaigns ?? []).filter(x => x.spend > 0);
  const ads = c.inp.ads ?? [];
  const tcpa = c.targetCpa || (m.purchases > 0 ? m.spend / m.purchases : 500);
  const killBar = Math.max(tcpa * 2, 800);
  const dayBudget = c.metaSpendDay;

  // ---- Week 1: stop the waste ----
  const pixel = has("meta_pixel");
  if (pixel) out.push({ phase: "week1", area: "Meta", action: "Fix purchase tracking before changing anything else", how: [pixel.fix, "Check Events Manager > Overview: Purchase must fire on the thank-you page with the order value in ₹.", "Don't judge or scale any campaign until purchases show up."], doneWhen: "Meta's purchases are within 15% of Shopify orders from Meta for 3 days." });
  const dead = camps.filter(x => x.spend >= Math.max(1500, m.spend * 0.03) && x.purchases === 0 && (isSalesObjective(x.objective) || x.leads === 0));
  const loserAds = m.purchases >= 3 || m.leads < 10 ? ads.filter(a => a.spend >= killBar && a.purchases === 0) : [];
  if (dead.length || loserAds.length) {
    const waste = dead.reduce((a, x) => a + x.spend, 0) + loserAds.reduce((a, x) => a + x.spend, 0);
    out.push({
      phase: "week1", area: "Meta", saves: (has("meta_dead")?.impact ?? 0) + (dead.length ? 0 : has("meta_ads_losing")?.impact ?? 0),
      action: `Pause what spent and never sold (${inr(waste)} in this period)`,
      how: [
        ...(dead.length ? [`Campaigns: ${dead.slice(0, 5).map(x => `"${x.name}" (${inr(x.spend)}, 0 sales)`).join(", ")}.`] : []),
        ...(loserAds.length ? [`Ads: ${loserAds.slice(0, 5).map(a => `"${a.name}" (${inr(a.spend)})`).join(", ")}.`] : []),
        `Move that budget to your best campaign the same day, not all at once: +20% now, +20% in 3 days.`,
      ],
      doneWhen: `No live campaign or ad has spent ${inr(killBar)} without a sale.`,
    });
  }
  out.push({
    phase: "week1", area: "Meta", action: `Set an automatic kill rule at ${inr(killBar)}`,
    how: [
      "Ads Manager > Rules > Create rule. Apply to: all active ads.",
      `Condition: Amount spent > ${inr(killBar)} AND Purchases < 1, time range: maximum. Action: turn off ad. Check: once a day.`,
      `Second rule: Cost per purchase > ${inr(c.breakEvenCpa || tcpa * 1.4)} over the last 7 days AND amount spent > ${inr(killBar)} → turn off.`,
    ],
    doneWhen: "Both rules are active and notify you when they fire.",
  });
  const seg = has("meta_segments");
  if (seg) out.push({ phase: "week1", area: "Meta", saves: seg.impact, action: "Stop paying for audiences and placements that don't buy", how: [seg.detail, seg.fix, "Placements: in the ad set use Manual placements and untick the losing ones. Age / gender: narrow the ad set, or exclude them in Advantage+ audience controls."], doneWhen: "No segment with 8%+ of spend costs more than twice your average per sale." });

  // ---- Weeks 2-4: fix and test ----
  const sales = Math.round(dayBudget * 0.7 / 10) * 10, test = round10(dayBudget * 0.2), retarget = round10(dayBudget * 0.1);
  const minAdset = Math.max(tcpa, 500);
  const tooSmall = dayBudget < minAdset * 3;
  if (camps.length > 3 || has("meta_fragmented")) {
    out.push({
      phase: "weeks2to4", area: "Meta",
      action: tooSmall ? `Put everything into 1 sales campaign (${inr(dayBudget)}/day is too small to split)` : `Rebuild into 3 campaigns instead of ${camps.length}`,
      how: tooSmall ? [
        `One Sales campaign, Advantage+ (or broad: India, age 18-55, no interests), ${inr(dayBudget)}/day.`,
        "Put your 3-6 best ads in it (the ones with sales). Turn off the old campaigns once it's running.",
        `Split into testing + scaling once the budget reaches ${inr(minAdset * 3)}/day.`,
      ] : [
        `1. Scaling - Advantage+ Sales or broad audience, campaign budget (CBO): ${inr(sales)}/day. Only ads that already sold go here.`,
        `2. Testing - ad-set budgets (ABO), 1 ad set per new idea with 3 ads each: ${inr(test)}/day total, at least ${inr(minAdset)} per ad set.`,
        `3. Retargeting - website visitors + add to cart, last 30 days, exclude buyers: ${inr(retarget)}/day.`,
        "Turn off old campaigns once the new ones have spent for 3 days. Don't edit the scaling campaign for 7 days after launch.",
      ],
      doneWhen: "3 or fewer live campaigns, and the scaling campaign out of 'Learning' (about 50 sales a week) or getting 1+ sale a day.",
    });
  }
  const creativesPerWeek = dayBudget < 2000 ? 3 : dayBudget < 10000 ? 5 : 8;
  const hook = has("meta_hook"), fatigue = has("meta_fatigue");
  const bestAd = ads.filter(a => a.purchases >= 3).sort((a, b) => a.spend / a.purchases - b.spend / b.purchases)[0];
  out.push({
    phase: "weeks2to4", area: "Meta", saves: fatigue?.impact,
    action: `Launch ${creativesPerWeek} new ads every week in the testing campaign`,
    how: [
      bestAd ? `Start from your best ad "${bestAd.name}" (${bestAd.purchases} sales at ${inr(bestAd.spend / bestAd.purchases)} each): keep its offer, change only the first 3 seconds and the headline.` : "Start from whichever ad has the most sales: keep its offer, change only the first 3 seconds and the headline.",
      "Angles to rotate: problem → product fixes it, unboxing, customer review / UGC, offer-first (\"Buy 2 get 1\"), before/after, comparison with the usual option.",
      hook ? `Hook rate is ${pct(m.thumbStopRatio ?? 0)}: open with the product in use or the result in second 1, bold text on screen, no logo intro.` : "Every video: product visible in the first second, 9:16, captions on, offer said and shown by second 5.",
      `Kill test ads at ${inr(killBar)} with no sale; move any ad that sells at under ${inr(tcpa)} into the scaling campaign.`,
    ],
    doneWhen: `Hook rate 25%+, CTR 1.5%+, frequency under 3, and at least 1 new winner every 2 weeks.`,
  });
  if (has("meta_overcount")) out.push({ phase: "weeks2to4", area: "Meta", action: "Teach Meta to find buyers who pay, not just order", how: ["Judge campaigns on Shopify kept orders (this page) - not Meta's ROAS.", "Send Meta a 'confirmed order' event via Conversions API when COD is confirmed or the order is prepaid, and optimise campaigns for it once it has 50+ events a week.", "Keep COD confirmation (Week 1) running - it cleans the signal too."], doneWhen: "Meta's purchases are within 20% of the store's kept orders." });
  if (c.dx.scaleTargets.length) out.push({ phase: "weeks2to4", area: "Meta", action: "Put more money behind what already buys", how: [`Winners in your data: ${c.dx.scaleTargets.slice(0, 4).join(", ")}.`, "Make a 1% lookalike of your buyers (Shopify customer list upload) and test it against broad.", "Use the winning ad's angle in 2 new versions each week."], doneWhen: "Winners get 60%+ of Meta spend." });

  // ---- Months 2-3: scale to the goal ----
  const share = c.metaSpendDay + c.gadsSpendDay > 0 ? c.metaSpendDay / (c.metaSpendDay + c.gadsSpendDay) : 1;
  const path = c.goal.path;
  out.push({
    phase: "months2to3", area: "Meta",
    action: path.length ? `Scale Meta from ${inr(dayBudget)}/day to about ${inr(path[path.length - 1].budgetPerDay * share)}/day` : "Scale step by step while cost per order holds",
    how: [
      `Raise the scaling campaign budget 20% every 3 days while the 3-day ad cost per kept order is under ${inr(tcpa)}.`,
      `If it goes above ${inr(tcpa)} for 3 days in a row, step back 20% and wait for new winning ads.`,
      ...path.map(p => `Month ${p.month}: ~${inr(p.budgetPerDay * share)}/day on Meta → ${p.ordersPerDay.toFixed(0)} kept orders/day (all channels) at ~${inr(p.cpa)} each.`),
      "Above ₹10k/day: add a second scaling campaign with a new angle instead of pushing one campaign harder.",
    ],
    doneWhen: "Orders per day on the goal path with ad cost per kept order under target.",
  });
  return out;
}

function googleSteps(c: Ctx): PlanStep[] {
  const g = c.inp.gads;
  const out: PlanStep[] = [];
  if (!g || g.spend <= 0) return out;
  const o = c.inp.gadsInsights?.overview ?? null;
  const k = c.inp.gadsInsights?.keywords ?? null;
  const gf = c.dx.findings.filter(f => f.pillar === "google");
  const camps: { name: string; spend: number; conversions: number; convValue: number; roas: number; channel?: Channel; bidding?: string; dailyBudget?: number; searchBudgetLost?: number | null; objective?: string }[] =
    o ? c.campaigns.map(x => ({ name: x.name, spend: x.spend, conversions: x.conversions, convValue: x.convValue, roas: x.roas, channel: x.channel, bidding: x.bidding, dailyBudget: x.dailyBudget, searchBudgetLost: x.searchBudgetLost, objective: x.objective }))
      : g.campaigns.map(x => ({ name: x.name, spend: x.spend, conversions: x.conversions, convValue: x.conversionValue, roas: x.roas }));
  const live = camps.filter(x => x.spend > 0);
  const conv = live.reduce((a, x) => a + x.conversions, 0);
  const cpaAvg = conv > 0 ? g.spend / conv : c.targetCpa || 500;
  const tcpa = c.targetCpa || cpaAvg;
  const be = c.goal.breakEvenRoas ?? 2;

  // ---- Week 1 ----
  const track = gf.filter(f => f.where === "Google > Tracking");
  if (track.length) out.push({ phase: "week1", area: "Google", action: "Fix conversion tracking first", how: [...track.slice(0, 3).map(f => `${f.title}: ${f.fix}`), "Goals > Conversions: keep only Purchase as Primary; set Add to cart, Begin checkout and Page view to Secondary."], doneWhen: "Google's purchases match Shopify orders from Google within 15%, with order value recorded." });
  if (k) {
    const wasted = k.searchTerms.filter(t => t.conversions === 0 && t.spend > 0 && t.spend >= Math.max(cpaAvg * 0.5, 100) && t.status !== "EXCLUDED").sort((a, b) => b.spend - a.spend);
    if (wasted.length) {
      const sum = wasted.reduce((a, t) => a + t.spend, 0);
      const pmax = wasted.some(t => t.source === "pmax");
      out.push({ phase: "week1", area: "Google", saves: sum * c.month, action: `Block ${wasted.length} search terms that cost ${inr(sum)} and never sold`, how: [`Top ones: ${wasted.slice(0, 8).map(t => `"${t.term}" (${inr(t.spend)})`).join(", ")}.`, "Add the irrelevant ones as negative keywords (phrase match) in a shared negative list applied to all Search campaigns.", ...(pmax ? ["Some came from Performance Max: add them under Tools > Shared library or the account-level negative keyword list."] : []), "Repeat every Monday: Search terms report, last 7 days, sort by cost, conversions = 0."], doneWhen: "Under 10% of Google spend goes to search terms with no sale." });
    }
    const dud = k.keywords.filter(x => x.conversions === 0 && x.spend >= cpaAvg * 2).sort((a, b) => b.spend - a.spend);
    if (dud.length) out.push({ phase: "week1", area: "Google", saves: dud.reduce((a, x) => a + x.spend, 0) * c.month, action: `Pause ${dud.length} keywords that spent 2x your cost per sale with none`, how: [`${dud.slice(0, 6).map(x => `"${x.keyword}" [${x.matchType.toLowerCase()}] ${inr(x.spend)}`).join(", ")}.`, "If a keyword is core to your product, switch it to exact match with a lower bid instead of pausing."], doneWhen: `No keyword has spent ${inr(cpaAvg * 2)} without a sale.` });
  }
  const deadC = live.filter(x => x.conversions < 1 && x.spend >= Math.max(1000, g.spend * 0.05) && (x.objective ?? "SALES") === "SALES");
  const losing = live.filter(x => x.conversions >= 1 && x.convValue > 0 && x.roas < 1 && x.spend >= g.spend * 0.08);
  if (deadC.length || losing.length) out.push({
    phase: "week1", area: "Google", saves: (deadC.reduce((a, x) => a + x.spend, 0) + losing.reduce((a, x) => a + (x.spend - x.convValue) , 0)) * c.month,
    action: "Stop the campaigns that lose money",
    how: [
      ...(deadC.length ? [`Pause (no sales): ${deadC.slice(0, 4).map(x => `"${x.name}" ${inr(x.spend)}`).join(", ")}.`] : []),
      ...(losing.length ? [`Cut budget 50% (return less than they cost): ${losing.slice(0, 4).map(x => `"${x.name}" ${x2(x.roas)}`).join(", ")}.`] : []),
      "Move the freed budget to your best campaign in two steps (+20%, then +20% a week later).",
    ],
    doneWhen: `Every live sales campaign returns at least ${x2(be)} (break-even).`,
  });

  // ---- Weeks 2-4 ----
  const names = live.map(x => x.name.toLowerCase());
  const hasBrand = names.some(n => /brand/.test(n));
  const hasShopping = live.some(x => x.channel === "SHOPPING" || x.channel === "PERFORMANCE_MAX") || names.some(n => /pmax|shopping|performance/.test(n));
  const structure: string[] = [];
  if (!hasBrand) structure.push(`Brand Search: exact + phrase on your brand name, ${inr(Math.max(200, round10(c.gadsSpendDay * 0.1)))}/day, Target impression share 90%. It's your cheapest sales and stops competitors bidding on your name.`);
  if (!hasShopping) structure.push(`Performance Max (or Standard Shopping) with your Merchant Center product feed, ${inr(Math.max(500, round10(c.gadsSpendDay * 0.5)))}/day. Use your best-selling products first; titles = what people search (product + key feature).`);
  else structure.push("Performance Max / Shopping: split best sellers into their own asset group or campaign so they don't share budget with products that never sell.");
  structure.push("Non-brand Search: only terms that already converted, as exact and phrase match, one tight ad group per product type.");
  out.push({ phase: "weeks2to4", area: "Google", action: "Set up the 3 campaign types that sell for D2C", how: structure, doneWhen: "Brand, Shopping/PMax and non-brand Search are each live with their own budget." });
  const monthConv = conv * c.month;
  const smart = live.filter(x => x.bidding && /TARGET_ROAS|MAXIMIZE_CONVERSION_VALUE/.test(x.bidding));
  out.push({
    phase: "weeks2to4", area: "Google", action: monthConv < 30 ? `Bid for conversions, not value (only ~${Math.round(monthConv)} sales a month)` : "Move winning campaigns to value bidding",
    how: monthConv < 30 ? [
      "Use Maximize conversions without a target until the account has 30+ purchases a month.",
      ...(smart.length ? [`${shortList(smart.map(x => x.name), 2)} use a ROAS target - with this little data Google can't hit it and stops spending. Remove the target for now.`] : []),
      "Don't change bidding again for 14 days - each change resets learning.",
    ] : [
      `Switch campaigns with 30+ purchases a month to Maximize conversion value with a target ROAS of about ${x2(Math.max(be * 1.2, 2))} (set a little below what they do now, then raise 10-15% every 2 weeks).`,
      "Never change the target by more than 20% at a time.",
    ],
    doneWhen: "Bidding hasn't been touched for 14 days and cost per sale is stable or falling.",
  });
  if (k) {
    const toAdd = k.searchTerms.filter(t => t.source === "search" && t.conversions >= 2 && t.status === "NONE").sort((a, b) => b.convValue - a.convValue);
    if (toAdd.length) out.push({ phase: "weeks2to4", area: "Google", action: `Add ${toAdd.length} converting search terms as exact keywords`, how: [`${toAdd.slice(0, 6).map(t => `"${t.term}" (${Math.round(t.conversions)} sales)`).join(", ")}.`, "Give each its own ad with the term in headline 1, sending people to the matching product page."], doneWhen: "Your top converting terms are all exact keywords you control." });
    const poorQs = k.keywords.filter(x => x.qs != null && x.qs <= 4 && x.spend > 0).sort((a, b) => b.spend - a.spend);
    if (poorQs.length) out.push({ phase: "weeks2to4", area: "Google", action: `Lift Quality Score on ${poorQs.length} keywords scored 4 or lower`, how: [`${poorQs.slice(0, 5).map(x => `"${x.keyword}" (QS ${x.qs})`).join(", ")}.`, "Put the exact keyword in headline 1 and in the landing page heading; send each to the product page, not the home page.", "Split ad groups so each covers one product type."], doneWhen: "Average Quality Score 7+ on keywords with spend." });
  }

  // ---- Months 2-3 ----
  const capped = o ? c.campaigns.filter(x => x.objective === "SALES" && (x.searchBudgetLost ?? 0) >= 10 && x.roas >= Math.max(be * 1.2, ROAS_TARGET * 0.8) && x.conversions >= 3) : [];
  const share = c.metaSpendDay + c.gadsSpendDay > 0 ? c.gadsSpendDay / (c.metaSpendDay + c.gadsSpendDay) : 1;
  const path = c.goal.path;
  out.push({
    phase: "months2to3", area: "Google",
    action: path.length ? `Scale Google from ${inr(c.gadsSpendDay)}/day to about ${inr(path[path.length - 1].budgetPerDay * share)}/day` : "Scale the campaigns that return the most",
    how: [
      ...(capped.length ? capped.slice(0, 4).map(x => `"${x.name}" is profitable (${x2(x.roas)}) but misses ${Math.round(x.searchBudgetLost ?? 0)}% of searches on budget: raise ${x.dailyBudget ? `${inr(x.dailyBudget)} → ${inr(x.dailyBudget * 1.2)}` : "its budget 20%"} this week.`) : []),
      `Raise budgets 20% a week on campaigns at ${x2(Math.max(be * 1.2, 2))}+ ROAS; hold any campaign whose cost per sale passes ${inr(tcpa)}.`,
      ...path.map(p => `Month ${p.month}: ~${inr(p.budgetPerDay * share)}/day on Google.`),
      "When search impression share on your converting terms passes 80%, growth has to come from Shopping/PMax and new keywords, not more budget on the same ones.",
    ],
    doneWhen: "Searches lost to budget under 10% on profitable campaigns, cost per sale under target.",
  });
  return out;
}

function bothSteps(c: Ctx): PlanStep[] {
  const out: PlanStep[] = [];
  const m = c.inp.meta?.kpis, g = c.inp.gads;
  if (m && g && m.purchases > 0 && g.conversions > 0 && m.spend > 0 && g.spend > 0) {
    const mc = m.spend / m.purchases, gc = g.spend / g.conversions;
    const cheap = mc <= gc ? "Meta" : "Google", dear = cheap === "Meta" ? "Google" : "Meta";
    const gap = Math.max(mc, gc) / Math.min(mc, gc);
    if (gap >= 1.3) {
      const dearSpend = cheap === "Meta" ? c.gadsSpendDay : c.metaSpendDay;
      out.push({ phase: "weeks2to4", area: "Budget", action: `Shift budget from ${dear} to ${cheap} (${cheap} is ${Math.round((gap - 1) * 100)}% cheaper per sale)`, how: [`Meta ${inr(mc)} per reported sale vs Google ${inr(gc)}.`, `Move ${inr(round10(dearSpend * 0.15))}/day from ${dear}'s weakest campaigns to ${cheap}'s best - at most 15-20% a week.`, `Keep ${dear}'s brand / retargeting campaigns running - they're cheap and protect sales you already earned.`, "Check the store's kept orders after each move: platforms both claim the same buyers."], doneWhen: "Ad cost per kept order (all ads) falls week on week." });
    }
  }
  return out;
}

export function buildPlan(c0: { dx: Diagnosis; inp: DiagnosisInput; goal: GoalPlan }, scope: Scope): PlanStep[] {
  const c = ctxOf(c0.dx, c0.inp, c0.goal);
  let steps: PlanStep[] = [];
  if (scope === "meta") steps = [...metaSteps(c), ...offerStoreSteps(c, scope)];
  else if (scope === "google") steps = [...googleSteps(c), ...offerStoreSteps(c, scope)];
  else {
    // Both: each channel's waste and setup steps, the budget split, and one combined scaling step.
    const meta = metaSteps(c), google = googleSteps(c);
    steps = [...meta.filter(s => s.phase !== "months2to3"), ...google.filter(s => s.phase !== "months2to3"), ...bothSteps(c), ...offerStoreSteps(c, scope)];
    const path = c.goal.path;
    const tot = c.metaSpendDay + c.gadsSpendDay;
    if (tot > 0) {
      steps.push({
        phase: "months2to3", area: "Budget",
        action: path.length ? `Grow total ad budget from ${inr(tot)}/day to about ${inr(path[path.length - 1].budgetPerDay)}/day` : "Grow both channels step by step",
        how: [
          ...path.map(p => `Month ${p.month}: ~${inr(p.budgetPerDay)}/day total → ${p.ordersPerDay.toFixed(0)} kept orders/day at ~${inr(p.cpa)} ad cost each.`),
          ...(meta.find(s => s.phase === "months2to3")?.how.slice(0, 2) ?? []),
          ...(google.find(s => s.phase === "months2to3")?.how.filter(h => h.includes("misses")).slice(0, 2) ?? []),
          "Each Monday give the extra budget to whichever channel had the lower cost per kept order last week.",
        ],
        doneWhen: "Kept orders per day on the goal path, ad cost per kept order under target.",
      });
    }
  }
  // Waste first inside each phase, then the rest by ₹ saved.
  const rank: Record<Phase, number> = { week1: 0, weeks2to4: 1, months2to3: 2 };
  return steps.map((s, i) => ({ s, i })).sort((a, b) => rank[a.s.phase] - rank[b.s.phase] || (b.s.saves ?? 0) - (a.s.saves ?? 0) || a.i - b.i).map(x => x.s);
}

/* ═══════════════════════ 05 WEEKLY CHECKS ═══════════════════════ */

export interface WeeklyCheck { metric: string; where: string; now: string; week4: string; scaleWhen: string; ok: boolean | null }

// Week-4 target sits between today and healthy and never asks for worse than today.
const midUp = (now: number, healthy: number) => (now >= healthy ? now : now + (healthy - now) * 0.6);
const midDown = (now: number, healthy: number) => (now <= healthy ? now : now - (now - healthy) * 0.6);

export function buildChecks(c0: { dx: Diagnosis; inp: DiagnosisInput; goal: GoalPlan }, scope: Scope): WeeklyCheck[] {
  const c = ctxOf(c0.dx, c0.inp, c0.goal);
  const out: WeeklyCheck[] = [];
  const m = c.inp.meta?.kpis, g = c.inp.gads, s = c.inp.shop, e = c.dx.economics;
  const tcpa = c.targetCpa;

  if (scope !== "google" && m && m.spend > 0) {
    out.push({ metric: "Click rate (CTR)", where: "Meta Ads Manager", now: pct(m.ctr, 2), week4: pct(midUp(m.ctr, 1.5), 2), scaleWhen: "1.5%+", ok: m.ctr >= 1.5 });
    if ((m.videoViews3s ?? 0) > 0 && m.thumbStopRatio != null) out.push({ metric: "Hook rate (3-sec views / impressions)", where: "Meta", now: pct(m.thumbStopRatio), week4: pct(midUp(m.thumbStopRatio, 25)), scaleWhen: "25%+", ok: m.thumbStopRatio >= 25 });
    out.push({ metric: "Frequency (last 7 days)", where: "Meta", now: m.frequency.toFixed(1), week4: midDown(m.frequency, 2.5).toFixed(1), scaleWhen: "under 3", ok: m.frequency < 3 });
    if (m.outboundClicks >= 50) { const lp = (m.lpv / m.outboundClicks) * 100; out.push({ metric: "Clicks that load the page", where: "Meta (landing page views / link clicks)", now: pct(lp), week4: pct(midUp(lp, 80)), scaleWhen: "75%+", ok: lp >= 75 }); }
    if (m.lpv >= 100) { const atc = (m.atc / m.lpv) * 100; out.push({ metric: "Add to cart rate", where: "Meta (adds to cart / page views)", now: pct(atc, 1), week4: pct(midUp(atc, 8), 1), scaleWhen: "8%+", ok: atc >= 8 }); }
    if (m.purchases > 0 && tcpa) { const cpp = m.spend / m.purchases; out.push({ metric: "Cost per purchase (Meta)", where: "Meta", now: inr(cpp), week4: inr(midDown(cpp, tcpa)), scaleWhen: `under ${inr(tcpa)}`, ok: cpp <= tcpa }); }
  }
  if (scope !== "meta" && g && g.spend > 0) {
    const o = c.inp.gadsInsights?.overview, k = c.inp.gadsInsights?.keywords;
    const search = c.campaigns.filter(x => x.channel === "SEARCH");
    if (search.length) {
      const sm = sumMetrics(search);
      const b = BENCHMARKS.SEARCH;
      if (sm.impressions >= 500) out.push({ metric: "Search click rate (CTR)", where: "Google Ads", now: pct(sm.ctr, 2), week4: pct(midUp(sm.ctr, b.ctr ?? 5), 2), scaleWhen: `${b.ctr}%+`, ok: sm.ctr >= (b.ctr ?? 5) });
      if (sm.clicks >= 30) out.push({ metric: "Search conversion rate", where: "Google Ads", now: pct(sm.cvr, 2), week4: pct(midUp(sm.cvr, 3), 2), scaleWhen: "3%+", ok: sm.cvr >= 3 });
    }
    if (g.conversions > 0 && tcpa) { const cpa = g.spend / g.conversions; out.push({ metric: "Cost per sale (Google)", where: "Google Ads", now: inr(cpa), week4: inr(midDown(cpa, tcpa)), scaleWhen: `under ${inr(tcpa)}`, ok: cpa <= tcpa }); }
    const be = c.goal.breakEvenRoas, need = c.goal.roasNeeded;
    if (g.conversionValue > 0) out.push({ metric: "ROAS (Google)", where: "Google Ads", now: x2(g.roas), week4: x2(midUp(g.roas, need ?? ROAS_TARGET)), scaleWhen: `${x2(need ?? ROAS_TARGET)}+${be ? ` (never under ${x2(be)})` : ""}`, ok: g.roas >= (need ?? ROAS_TARGET) });
    if (o) {
      const winners = c.campaigns.filter(x => x.objective === "SALES" && x.roas >= ROAS_TARGET && x.searchBudgetLost != null);
      if (winners.length) { const lost = Math.max(...winners.map(x => x.searchBudgetLost ?? 0)); out.push({ metric: "Searches lost to budget (profitable campaigns)", where: "Google > Campaigns > Search lost IS (budget)", now: pct(lost), week4: pct(midDown(lost, 10)), scaleWhen: "under 10%", ok: lost < 10 }); }
    }
    if (k && k.searchTerms.length && g.spend > 0) {
      const cpaAvg = g.conversions > 0 ? g.spend / g.conversions : 0;
      const ws = k.searchTerms.filter(t => t.conversions === 0 && t.spend > 0 && t.spend >= Math.max(cpaAvg * 0.5, 100) && t.status !== "EXCLUDED").reduce((a, t) => a + t.spend, 0);
      const share = (ws / g.spend) * 100;
      out.push({ metric: "Spend on search terms with no sale", where: "Google > Search terms", now: pct(share), week4: pct(midDown(share, 8)), scaleWhen: "under 10%", ok: share < 10 });
    }
  }
  // Business numbers - checked in every view, because they decide whether ads make money.
  if (e.costPerKept != null && tcpa) out.push({ metric: "Ad cost per kept order (all ads)", where: "This page", now: inr(e.costPerKept), week4: inr(midDown(e.costPerKept, tcpa)), scaleWhen: `under ${inr(tcpa)}`, ok: e.costPerKept <= tcpa });
  if (s && s.cod.placed >= 10) out.push({ metric: "COD orders that fail", where: "Shopify orders", now: pct(s.cod.failRatePct), week4: pct(midDown(s.cod.failRatePct, 15)), scaleWhen: "under 20%", ok: s.cod.failRatePct < 20 });
  if (scope === "both" && c.inp.ga4 && c.inp.ga4.sessions >= 300 && s) { const cr = (s.orders.placed / c.inp.ga4.sessions) * 100; out.push({ metric: "Store visits that order", where: "Google Analytics + Shopify", now: pct(cr, 2), week4: pct(midUp(cr, 1.5), 2), scaleWhen: "1.5%+", ok: cr >= 1.5 }); }
  if (s && e.aov > 0) out.push({ metric: "Average order value", where: "Shopify", now: inr(e.aov), week4: inr(c.dx.findings.some(f => f.id === "basket" || f.id === "aov_drop") ? e.aov * 1.08 : e.aov), scaleWhen: "not falling", ok: null });
  const pace = c.goal.path[0];
  if (s) out.push({ metric: "Kept orders per day", where: "Shopify (not cancelled or returned)", now: e.keptPerDay.toFixed(1), week4: pace ? pace.ordersPerDay.toFixed(1) : e.keptPerDay.toFixed(1), scaleWhen: c.goal.targetOrdersPerDay > 0 ? `goal ${c.goal.targetOrdersPerDay.toFixed(0)}` : "-", ok: c.goal.targetOrdersPerDay > 0 ? e.keptPerDay >= c.goal.targetOrdersPerDay : null });
  return out;
}
