// Google Ads analytics: shared types, industry benchmarks and the rule engine behind the
// verdicts + recommendations. Pure functions only - safe on both server and client.
// Everything here is advisory: Skylitee only reads Google Ads, it never changes an account.

/* ── Types ─────────────────────────────────────────────────────────────── */

export type Channel = "SEARCH" | "SHOPPING" | "PERFORMANCE_MAX" | "DISPLAY" | "VIDEO" | "DEMAND_GEN" | "APP" | "SMART" | "OTHER";

export const CHANNEL_LABEL: Record<Channel, string> = {
  SEARCH: "Search", SHOPPING: "Shopping", PERFORMANCE_MAX: "Performance Max",
  DISPLAY: "Display", VIDEO: "YouTube / Video", DEMAND_GEN: "Demand Gen", APP: "App", SMART: "Smart", OTHER: "Other",
};

// These types have no keywords or headlines to fix, so low CTR needs a different remedy.
const CTR_FIX: Partial<Record<Channel, string>> = {
  SHOPPING: "improve product titles and images in your feed, and check your prices against competitors",
  VIDEO: "show the product and the offer in the first 5 seconds, add a clear call to action, and narrow the audience",
  DISPLAY: "use a clearer image with the offer visible on it, and narrow the audience",
  DEMAND_GEN: "use a clearer image or video with the offer visible on it, and narrow the audience",
};

// What each campaign type is for, shown beside it so the table reads without Google Ads knowledge.
export const CHANNEL_PURPOSE: Record<Channel, string> = {
  SEARCH: "Reaches people searching on Google",
  PERFORMANCE_MAX: "Seeks conversions across all of Google's placements",
  SHOPPING: "Shows your products through Merchant Center",
  DEMAND_GEN: "Visual, video and product ads",
  DISPLAY: "Image ads on websites and apps",
  VIDEO: "Video ads, mainly on YouTube",
  APP: "App installs and in-app actions",
  SMART: "Simplified campaigns for small businesses",
  OTHER: "Other campaign types, such as hotel or local",
};

// Fixed per channel so a colour always means the same campaign type across charts.
export const CHANNEL_COLOR: Record<Channel, string> = {
  SEARCH: "#F97316", SHOPPING: "#3B82F6", PERFORMANCE_MAX: "#22C55E",
  DISPLAY: "#8B5CF6", VIDEO: "#EC4899", DEMAND_GEN: "#EAB308", APP: "#78716C", SMART: "#A16207", OTHER: "#14B8A6",
};

export function channelOf(raw?: string): Channel {
  if (raw === "SEARCH" || raw === "SHOPPING" || raw === "DISPLAY" || raw === "VIDEO" || raw === "PERFORMANCE_MAX" || raw === "DEMAND_GEN" || raw === "SMART") return raw;
  // Google's API calls App campaigns MULTI_CHANNEL.
  return raw === "MULTI_CHANNEL" ? "APP" : "OTHER";
}

export interface GMetrics {
  impressions: number; clicks: number; spend: number; conversions: number; convValue: number;
  ctr: number; cpc: number; cvr: number; roas: number; cpa: number; cpm: number; aov: number;
}

export function derive(m: { impressions: number; clicks: number; spend: number; conversions: number; convValue: number }): GMetrics {
  return {
    ...m,
    ctr: m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0,
    cpc: m.clicks > 0 ? m.spend / m.clicks : 0,
    cvr: m.clicks > 0 ? (m.conversions / m.clicks) * 100 : 0,
    roas: m.spend > 0 ? m.convValue / m.spend : 0,
    cpa: m.conversions > 0 ? m.spend / m.conversions : 0,
    cpm: m.impressions > 0 ? (m.spend / m.impressions) * 1000 : 0,
    aov: m.conversions > 0 ? m.convValue / m.conversions : 0,
  };
}

export function sumMetrics(rows: GMetrics[]): GMetrics {
  return derive(rows.reduce(
    (t, r) => ({
      impressions: t.impressions + r.impressions, clicks: t.clicks + r.clicks, spend: t.spend + r.spend,
      conversions: t.conversions + r.conversions, convValue: t.convValue + r.convValue,
    }),
    { impressions: 0, clicks: 0, spend: 0, conversions: 0, convValue: 0 },
  ));
}

export interface Campaign extends GMetrics {
  id: string; name: string; status: string; primaryStatus: string; channel: Channel; bidding: string;
  dailyBudget: number; targetRoas: number | null; targetCpa: number | null;
  // Impression shares are percentages; null when Google doesn't report them for this campaign type.
  searchIS: number | null; searchBudgetLost: number | null; searchRankLost: number | null;
  searchTopIS: number | null; searchAbsTopIS: number | null; contentIS: number | null;
  // conversions and convValue hold only the goal matching the objective. Google's own figures sit beside them.
  objective: Objective; objectiveWhy: string; googleConversions: number; googleValue: number;
  notCounted: GoalLine[]; usedSecondary: boolean; allConversions: number; viewThrough: number;
}

export interface DailyRow extends GMetrics { date: string }
export interface ObjectiveDaily extends DailyRow { objective: Objective }
export interface ConversionAction { name: string; category: string; conversions: number; value: number }
export interface GoogleSuggestion { type: string; count: number; extraConversions: number }

export interface OverviewData {
  account: string; currency: string; timeZone: string; optimizationScore: number | null;
  period: { from: string; to: string }; prevPeriod: { from: string; to: string };
  totals: GMetrics & { allConversions: number; viewThrough: number; googleConversions: number; googleValue: number };
  prev: GMetrics | null; prevByObjective: Partial<Record<Objective, GMetrics>>;
  daily: DailyRow[]; dailyByObjective: ObjectiveDaily[]; campaigns: Campaign[]; conversionActions: ConversionAction[];
  // False when Google refused the per-goal split, so every number is Google's own count.
  goalCounting: boolean;
  suggestions: GoogleSuggestion[];
  errors: Record<string, string>;
}

export interface AdCopy { text: string; pinned?: string }
export interface AdRow extends GMetrics {
  id: string; name: string; type: string; channel: Channel; campaign: string; adGroup: string;
  status: string; approval: string; strength: string; finalUrl: string; path: string; business: string;
  headlines: AdCopy[]; longHeadlines: AdCopy[]; descriptions: AdCopy[];
}
export interface AssetRow extends GMetrics {
  text: string; field: string; label: string; pinned: string; adCount: number; campaign: string;
}
export interface AssetGroupRow extends GMetrics {
  id: string; name: string; campaign: string; status: string; strength: string;
  headlines: string[]; longHeadlines: string[]; descriptions: string[];
}
export interface ProductRow extends GMetrics { title: string; itemId: string; brand: string }
export interface LandingRow extends GMetrics { url: string }
export interface DisapprovedAd { id: string; campaign: string; adGroup: string; approval: string; type: string; topics: string[] }

export interface AdsData {
  account: string; currency: string; period: { from: string; to: string };
  ads: AdRow[]; assets: AssetRow[]; assetGroups: AssetGroupRow[]; products: ProductRow[];
  landingPages: LandingRow[]; disapproved: DisapprovedAd[];
  errors: Record<string, string>;
}

export interface KeywordRow extends GMetrics {
  id: string; keyword: string; matchType: string; status: string; campaign: string; adGroup: string;
  qs: number | null; adRelevance: string; landingExp: string; expectedCtr: string;
  searchIS: number | null; rankLost: number | null;
}
export interface SearchTermRow extends GMetrics { term: string; status: string; campaign: string; adGroup: string; source: "search" | "pmax" }

export interface KeywordsData {
  account: string; currency: string; period: { from: string; to: string };
  keywords: KeywordRow[]; searchTerms: SearchTermRow[];
  errors: Record<string, string>;
}

export interface SegmentRow extends GMetrics { key: string; label: string }
export interface HeatRow extends GMetrics { day: string; hour: number }

export interface AudienceData {
  account: string; currency: string; timeZone: string; period: { from: string; to: string };
  devices: SegmentRow[]; networks: SegmentRow[]; ages: SegmentRow[]; genders: SegmentRow[];
  states: SegmentRow[]; heat: HeatRow[];
  errors: Record<string, string>;
}

/* ── Formatting ────────────────────────────────────────────────────────── */

export function sym(code: string) {
  return code === "INR" ? "₹" : code === "USD" ? "$" : code === "EUR" ? "€" : code === "GBP" ? "£" : code ? `${code} ` : "";
}
export function money(cur: string, n: number, digits = 0) {
  return `${sym(cur)}${n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}
// Google reports an impression share under 10% as 9.99 - show it the way Google Ads does.
export function shareText(v: number | null) {
  if (v === null) return "-";
  return v <= 9.99 ? "<10%" : `${v.toFixed(1)}%`;
}
export function titleCase(s: string) {
  return s.toLowerCase().split("_").map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}
// "1 ad has" / "3 ads have" - accounts often have exactly one of something.
const nOf = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function names(list: string[], n = 3) {
  const short = list.slice(0, n).map(s => `"${s.length > 40 ? `${s.slice(0, 40)}...` : s}"`).join(", ");
  return list.length > n ? `${short} and ${list.length - n} more` : short;
}

/* ── Objectives and conversion goals ───────────────────────────────────────
   Each objective counts one goal only: Sales = Purchases, Leads = Leads, Traffic = Engagements,
   Video Views = YouTube follow-on views. Google's "Conversions" column adds up every Primary goal,
   so a Sales campaign can count Add to cart with its purchases, which flatters cost per conversion.
   No campaign field naming the objective was found in the API reference, so it's worked out from
   the campaign's goals, name, type and bidding, and shown with the reason. */

export type Objective = "SALES" | "LEADS" | "TRAFFIC" | "VIDEO_VIEWS" | "OTHER";
export type ObjectiveFilter = Objective | "ALL";

export const OBJECTIVES: Objective[] = ["SALES", "LEADS", "TRAFFIC", "VIDEO_VIEWS", "OTHER"];
export const OBJECTIVE_LABEL: Record<Objective, string> = {
  SALES: "Sales", LEADS: "Leads", TRAFFIC: "Traffic", VIDEO_VIEWS: "Video Views", OTHER: "Other",
};
export const OBJECTIVE_GOAL: Record<Objective, string> = {
  SALES: "Purchases", LEADS: "Leads", TRAFFIC: "Engagements", VIDEO_VIEWS: "YouTube follow-on views", OTHER: "Conversions",
};
const GOAL_WORD: Record<Objective, string> = {
  SALES: "purchases", LEADS: "leads", TRAFFIC: "engagements", VIDEO_VIEWS: "YouTube follow-on views", OTHER: "conversions",
};

const LEAD_CATEGORIES = ["SUBMIT_LEAD_FORM", "IMPORTED_LEAD", "QUALIFIED_LEAD", "CONVERTED_LEAD", "PHONE_CALL_LEAD", "MESSAGE_LEAD", "CONTACT", "BOOK_APPOINTMENT", "REQUEST_QUOTE", "SIGNUP"];
const SALE_FAMILY = ["PURCHASE", "ADD_TO_CART", "BEGIN_CHECKOUT", "STORE_SALE", "SUBSCRIBE_PAID"];
const COUNTED: Record<Exclude<Objective, "OTHER">, string[]> = {
  SALES: ["PURCHASE"], LEADS: LEAD_CATEGORIES, TRAFFIC: ["ENGAGEMENT"], VIDEO_VIEWS: ["YOUTUBE_FOLLOW_ON_VIEWS"],
};

export function goalLabel(category: string) {
  if (category === "PURCHASE") return "Purchases";
  if (category === "ENGAGEMENT") return "Engagements";
  if (category === "YOUTUBE_FOLLOW_ON_VIEWS") return "YouTube follow-on views";
  const words = titleCase(category);
  return words.charAt(0) + words.slice(1).toLowerCase();
}

// Which objective a conversion category counts toward, or null when none does.
export function objectiveOfCategory(category: string): Objective | null {
  const list = Object.entries(COUNTED) as [Objective, string[]][];
  return list.find(([, cats]) => cats.includes(category))?.[0] ?? null;
}

export interface GoalResult { category: string; conversions: number; value: number; allConversions: number; allValue: number }
export interface GoalLine { category: string; label: string; conversions: number; value: number }

export function mergeGoalLines(lists: GoalLine[][]): GoalLine[] {
  const merged = new Map<string, GoalLine>();
  for (const line of lists.flat()) {
    const item = merged.get(line.category) ?? { ...line, conversions: 0, value: 0 };
    item.conversions += line.conversions;
    item.value += line.value;
    merged.set(line.category, item);
  }
  return [...merged.values()].sort((a, b) => b.conversions - a.conversions);
}

export function goalLinesText(lines: GoalLine[]) {
  return lines.map(l => `${l.label} ${Math.round(l.conversions).toLocaleString("en-IN")}`).join(", ");
}

const VIEW_BIDDING = ["TARGET_CPV", "MANUAL_CPV", "TARGET_CPM", "MANUAL_CPM"];
const CLICK_BIDDING = ["TARGET_SPEND", "MANUAL_CPC"];
const NAME_HINTS: [Objective, RegExp][] = [
  ["SALES", /\b(sales?|purchases?)\b/i],
  ["LEADS", /\b(leads?|lead[\s-]?gen)\b/i],
  ["TRAFFIC", /\b(website\s+)?traffic\b/i],
  ["VIDEO_VIEWS", /\b(video\s+views?|views?\s+campaign|yt\s+views?|youtube\s+views?)\b/i],
];

export function detectObjective(input: { name: string; channel: Channel; bidding: string; goals: string[]; results: GoalResult[] }): { objective: Objective; why: string } {
  const { name, channel, bidding, goals, results } = input;
  if (channel === "APP") return { objective: "OTHER", why: "App campaigns work toward installs, so Google's own count is used" };

  const has = (list: string[]) => goals.some(g => list.includes(g));
  const hasSale = has(SALE_FAMILY);
  const hasLead = has(LEAD_CATEGORIES);
  const recorded = (list: string[]) => results.filter(r => list.includes(r.category)).reduce((s, r) => s + Math.max(r.conversions, r.allConversions), 0);
  const purchases = recorded(["PURCHASE"]);
  const leads = recorded(LEAD_CATEGORIES);

  // A goal list with only one family can't mean anything else.
  if (hasLead && !hasSale) return { objective: "LEADS", why: "Its conversion goals are lead goals" };
  if (!hasSale && !hasLead) {
    if (goals.includes("YOUTUBE_FOLLOW_ON_VIEWS") && (channel === "VIDEO" || !goals.includes("ENGAGEMENT"))) return { objective: "VIDEO_VIEWS", why: "Its conversion goal is YouTube follow-on views" };
    if (goals.includes("ENGAGEMENT")) return { objective: "TRAFFIC", why: "Its conversion goal is engagements" };
  }

  // Goals can be inherited from the account default, so the campaign name comes next.
  const named = NAME_HINTS.filter(([, re]) => re.test(name));
  if (named.length === 1) return { objective: named[0][0], why: `Its name says "${OBJECTIVE_LABEL[named[0][0]]}"` };

  if (channel === "VIDEO" && VIEW_BIDDING.includes(bidding)) return { objective: "VIDEO_VIEWS", why: "A YouTube campaign bidding for views" };

  if (hasSale && hasLead) {
    if (leads > purchases) return { objective: "LEADS", why: "Has both sale and lead goals, and records more leads" };
    return { objective: "SALES", why: purchases > 0 ? "Has both sale and lead goals, and records more purchases" : "Has both sale and lead goals with no results yet, so this is a best guess" };
  }
  if (hasSale) {
    if (CLICK_BIDDING.includes(bidding) && purchases === 0) return { objective: "TRAFFIC", why: "Bids for clicks and records no purchases" };
    return { objective: "SALES", why: "Its conversion goals are sale goals" };
  }

  // Google gave no goal list for this campaign.
  if (purchases > 0) return { objective: "SALES", why: "It records purchases" };
  if (leads > 0) return { objective: "LEADS", why: "It records leads" };
  if (channel === "VIDEO" && recorded(["YOUTUBE_FOLLOW_ON_VIEWS"]) > 0) return { objective: "VIDEO_VIEWS", why: "It records YouTube follow-on views" };
  if (channel === "SHOPPING" || channel === "PERFORMANCE_MAX") return { objective: "SALES", why: `${CHANNEL_LABEL[channel]} campaigns usually aim for sales` };
  if (CLICK_BIDDING.includes(bidding)) return { objective: "TRAFFIC", why: "It bids for clicks" };
  return { objective: "OTHER", why: "Not enough information to tell, so Google's own count is used" };
}

export interface GoalCount { conversions: number; convValue: number; usedSecondary: boolean; notCounted: GoalLine[] }

// Secondary goals show 0 in Google's main column but still appear in All conversions. A campaign
// whose matching goal is Secondary is read from there instead of showing a false zero.
export function countForObjective(objective: Objective, rows: GoalResult[], google: { conversions: number; convValue: number }, useAll?: boolean): GoalCount {
  if (objective === "OTHER") return { conversions: google.conversions, convValue: google.convValue, usedSecondary: false, notCounted: [] };
  const wanted = COUNTED[objective];
  const matching = rows.filter(r => wanted.includes(r.category));
  const primary = matching.reduce((s, r) => s + r.conversions, 0);
  const all = matching.reduce((s, r) => s + r.allConversions, 0);
  const usedSecondary = useAll ?? (primary === 0 && all > 0);
  const notCounted = mergeGoalLines([rows
    .filter(r => !wanted.includes(r.category) && r.conversions > 0)
    .map(r => ({ category: r.category, label: goalLabel(r.category), conversions: r.conversions, value: r.value }))]);
  return usedSecondary
    ? { conversions: all, convValue: matching.reduce((s, r) => s + r.allValue, 0), usedSecondary, notCounted }
    : { conversions: primary, convValue: matching.reduce((s, r) => s + r.value, 0), usedSecondary, notCounted };
}

export function rollDaily(rows: DailyRow[]): DailyRow[] {
  const days = new Map<string, DailyRow[]>();
  for (const r of rows) days.set(r.date, [...(days.get(r.date) ?? []), r]);
  return [...days.entries()]
    .map(([date, list]) => ({ date, ...sumMetrics(list) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Everything on the Overview for one objective, or the whole account for "ALL".
export function objectiveView(o: OverviewData, filter: ObjectiveFilter) {
  if (filter === "ALL") return { campaigns: o.campaigns, totals: o.totals, prev: o.prev, daily: o.daily };
  const campaigns = o.campaigns.filter(c => c.objective === filter);
  const add = (f: (c: Campaign) => number) => campaigns.reduce((s, c) => s + f(c), 0);
  return {
    campaigns,
    totals: {
      ...sumMetrics(campaigns), allConversions: add(c => c.allConversions), viewThrough: add(c => c.viewThrough),
      googleConversions: add(c => c.googleConversions), googleValue: add(c => c.googleValue),
    },
    prev: o.prevByObjective[filter] ?? null,
    daily: rollDaily(o.dailyByObjective.filter(r => r.objective === filter)),
  };
}

export interface ObjectiveRow { objective: Objective; campaigns: number; metrics: GMetrics; googleConversions: number; notCounted: GoalLine[] }

export function buildObjectiveRows(campaigns: Campaign[]): ObjectiveRow[] {
  return OBJECTIVES
    .map(objective => {
      const list = campaigns.filter(c => c.objective === objective);
      return {
        objective, campaigns: list.length, metrics: sumMetrics(list),
        googleConversions: list.reduce((s, c) => s + c.googleConversions, 0),
        notCounted: mergeGoalLines(list.map(c => c.notCounted)),
      };
    })
    .filter(r => r.campaigns > 0)
    .sort((a, b) => b.metrics.spend - a.metrics.spend);
}

/* ── Industry benchmarks ───────────────────────────────────────────────────
   Published reference points, NOT Google's own numbers and NOT guarantees. No source covers
   every campaign type, so each figure is only set where one was published:
   - Top Growth Marketing DTC panel (28 DTC brands, Sep 2025 - Aug 2026, USD accounts, one agency):
     Search CVR 5.65% / ROAS 4.91, Shopping CTR 1.01% / CVR 2.86% / ROAS 4.13,
     Performance Max CVR 3.06% / ROAS 3.90, blended CTR 1.79% / CVR 3.13% / ROAS 4.28.
   - WordStream / LocaliQ 2026 (13,000+ US campaigns, all industries): Search CTR 6.64%.
   - Display CTR 0.46% from a published roundup; YouTube in-stream CTR 0.51% from AdConversion.
   Performance Max CTR is left out on purpose: it blends many surfaces, so it doesn't compare.
   CPC and cost per conversion have no benchmark on purpose: published figures are in US dollars
   and don't carry across markets, so those are judged against the account's own average. */

export interface ChannelBenchmark { ctr: number | null; cvr: number | null; roas: number | null }

export const BENCHMARKS: Record<Channel, ChannelBenchmark> = {
  SEARCH:          { ctr: 6.64, cvr: 5.65, roas: 4.91 },
  SHOPPING:        { ctr: 1.01, cvr: 2.86, roas: 4.13 },
  PERFORMANCE_MAX: { ctr: null, cvr: 3.06, roas: 3.9 },
  DISPLAY:         { ctr: 0.46, cvr: null, roas: null },
  VIDEO:           { ctr: 0.51, cvr: null, roas: null },
  DEMAND_GEN:      { ctr: null, cvr: null, roas: null },
  APP:             { ctr: null, cvr: null, roas: null },
  SMART:           { ctr: null, cvr: null, roas: null },
  OTHER:          { ctr: 1.79, cvr: 3.13, roas: 4.28 },
};

// Same ROAS bars as the Meta pages, so both ad platforms are held to one standard.
export const ROAS_TARGET = 3;
export const ROAS_MIN = 2;

export const BENCHMARK_NOTE =
  "Benchmarks are published averages for reference: CTR, conversion rate and ROAS from a 28-brand DTC study and WordStream / LocaliQ 2026. They mostly come from US-dollar accounts, so your own margin sets your real target. Quality Score and Ad Strength use Google's own ratings. Impression-share limits are common practice among ad managers, not a published standard.";

export type Verdict = "good" | "watch" | "bad" | "na";

export function judgeAgainst(v: number, bench: number | null): Verdict {
  if (bench === null) return "na";
  if (v >= bench) return "good";
  return v >= bench * 0.7 ? "watch" : "bad";
}
export function judgeRoas(r: number): Verdict {
  return r >= ROAS_TARGET ? "good" : r >= ROAS_MIN ? "watch" : "bad";
}
export function judgeQs(q: number | null): Verdict {
  if (q === null) return "na";
  return q >= 7 ? "good" : q >= 5 ? "watch" : "bad";
}
export function judgeStrength(s: string): Verdict {
  if (s === "EXCELLENT" || s === "GOOD") return "good";
  if (s === "AVERAGE") return "watch";
  return s === "POOR" ? "bad" : "na";
}
export function judgeLost(v: number | null): Verdict {
  if (v === null) return "na";
  return v < 10 ? "good" : v < 20 ? "watch" : "bad";
}
export function judgeShare(v: number | null): Verdict {
  if (v === null) return "na";
  return v >= 70 ? "good" : v >= 40 ? "watch" : "bad";
}

// Too little data makes a verdict noise, so these stop a handful of clicks being called a trend.
const MIN_CTR_IMPRESSIONS = 500;
const MIN_CVR_CLICKS = 30;
// Video and Display mostly build awareness, so sales KPIs aren't held against them.
const isSalesChannel = (c: Channel) => c === "SEARCH" || c === "SHOPPING" || c === "PERFORMANCE_MAX" || c === "DEMAND_GEN" || c === "SMART" || c === "OTHER";

export interface ScoreRow { kpi: string; you: string; standard: string; verdict: Verdict; note: string }
export interface ChannelScore { channel: Channel; spend: number; metrics: GMetrics; rows: ScoreRow[] }

// CTR applies to every campaign. Conversion rate and ROAS are sales measures, so they only use
// Sales campaigns: a Leads campaign shouldn't be judged against a purchase benchmark.
function kpiRows(channel: Channel, all: GMetrics, sales: GMetrics): ScoreRow[] {
  const b = BENCHMARKS[channel];
  const rows: ScoreRow[] = [];
  if (b.ctr !== null) {
    const enough = all.impressions >= MIN_CTR_IMPRESSIONS;
    rows.push({
      kpi: "CTR", you: `${all.ctr.toFixed(2)}%`, standard: `${b.ctr}%`,
      verdict: enough ? judgeAgainst(all.ctr, b.ctr) : "na",
      note: enough ? "How often people click after seeing the ad" : "Not enough impressions yet to judge",
    });
  }
  if (b.cvr !== null && sales.clicks > 0) {
    const enough = sales.clicks >= MIN_CVR_CLICKS;
    rows.push({
      kpi: "Conversion rate", you: `${sales.cvr.toFixed(2)}%`, standard: `${b.cvr}%`,
      verdict: enough ? judgeAgainst(sales.cvr, b.cvr) : "na",
      note: enough ? "How many clicks become purchases" : "Not enough clicks yet to judge",
    });
  }
  if (sales.convValue > 0) {
    rows.push({
      kpi: "ROAS", you: `${sales.roas.toFixed(2)}x`, standard: `${ROAS_TARGET}x target${b.roas ? `, peers ${b.roas}x` : ""}`,
      verdict: judgeRoas(sales.roas), note: "How much sales value each unit of ad spend earns",
    });
  }
  return rows;
}

export function buildScorecard(campaigns: Campaign[]): ChannelScore[] {
  const groups = new Map<Channel, Campaign[]>();
  for (const c of campaigns) groups.set(c.channel, [...(groups.get(c.channel) ?? []), c]);
  return [...groups.entries()]
    .map(([channel, list]) => {
      const metrics = sumMetrics(list);
      return { channel, spend: metrics.spend, metrics, rows: kpiRows(channel, metrics, sumMetrics(list.filter(c => c.objective === "SALES"))) };
    })
    .sort((a, b) => b.spend - a.spend);
}

/* ── Which ads are working ─────────────────────────────────────────────── */

export interface AdTypeRow { channel: Channel; objective: Objective; metrics: GMetrics; verdict: Verdict; label: string; why: string }

const RESULT_LABEL: Record<Exclude<Verdict, "na">, string> = { good: "Good", watch: "Check", bad: "Review" };

function judgeAdType(objective: Objective, channel: Channel, m: GMetrics, peers: GMetrics[], cur: string): Pick<AdTypeRow, "verdict" | "label" | "why"> {
  const result = (verdict: Verdict, why: string) => ({ verdict, label: verdict === "na" ? "No verdict" : RESULT_LABEL[verdict], why });
  const none = (label: string, why: string) => ({ verdict: "na" as const, label, why });
  const roasResult = () => {
    const v = judgeRoas(m.roas);
    return result(v, `Earns ${m.roas.toFixed(2)}x. ${v === "good" ? `At or above the ${ROAS_TARGET}x target` : v === "watch" ? `Between the ${ROAS_MIN}x minimum and the ${ROAS_TARGET}x target` : `Below the ${ROAS_MIN}x minimum`}`);
  };

  if ((objective === "SALES" || objective === "LEADS") && m.conversions === 0) {
    return m.clicks < MIN_CVR_CLICKS
      ? none("Too early", `Only ${m.clicks.toLocaleString("en-IN")} clicks so far`)
      : result("bad", `${m.clicks.toLocaleString("en-IN")} clicks and no ${GOAL_WORD[objective]}`);
  }
  if (objective === "SALES") return m.convValue > 0 ? roasResult() : none("No sale value", "Purchases are recorded, but Google gets no sale amount");
  if (objective === "LEADS") {
    if (peers.length < 2) return none("No comparison", `${money(cur, m.cpa)} per lead. Only one lead campaign type, and lead costs have no reliable benchmark`);
    const avg = sumMetrics(peers).cpa;
    return result(m.cpa <= avg ? "good" : m.cpa <= avg * 1.3 ? "watch" : "bad", `${money(cur, m.cpa)} per lead against your ${money(cur, avg)} average`);
  }
  if (objective === "TRAFFIC") {
    const bench = BENCHMARKS[channel].ctr;
    if (bench === null) return none("No benchmark", `CTR ${m.ctr.toFixed(2)}%. No reliable published figure for this type`);
    if (m.impressions < MIN_CTR_IMPRESSIONS) return none("Too early", `Only ${m.impressions.toLocaleString("en-IN")} impressions so far`);
    return result(judgeAgainst(m.ctr, bench), `CTR ${m.ctr.toFixed(2)}% against the ${bench}% benchmark`);
  }
  if (objective === "VIDEO_VIEWS") {
    if (m.conversions === 0 && m.impressions >= MIN_CTR_IMPRESSIONS) return result("watch", `${m.impressions.toLocaleString("en-IN")} impressions and no YouTube follow-on views`);
    return none("No benchmark", "No reliable published figure for YouTube follow-on views");
  }
  return m.convValue > 0 ? roasResult() : none("No verdict", "No objective detected, so there's nothing fair to judge it against");
}

// One row per campaign type and objective, because a type can run for two objectives at once.
export function buildAdTypeTable(campaigns: Campaign[], cur: string): AdTypeRow[] {
  const groups = new Map<string, Campaign[]>();
  for (const c of campaigns) {
    const key = `${c.channel}|${c.objective}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const rows = [...groups.values()].map(list => ({ channel: list[0].channel, objective: list[0].objective, metrics: sumMetrics(list) }));
  return rows
    .map(r => ({ ...r, ...judgeAdType(r.objective, r.channel, r.metrics, rows.filter(x => x.objective === r.objective).map(x => x.metrics), cur) }))
    .sort((a, b) => b.metrics.spend - a.metrics.spend);
}

export interface AdCheck { kpi: string; you: string; standard: string; verdict: Verdict; advice: string }

// Per-ad benchmark match shown when an ad row is opened.
export function adChecks(ad: AdRow, cur: string, avgCpa: number): AdCheck[] {
  const b = BENCHMARKS[ad.channel];
  const out: AdCheck[] = [];
  const strength = judgeStrength(ad.strength);
  if (strength !== "na") {
    out.push({
      kpi: "Ad Strength", you: titleCase(ad.strength), standard: "Good or Excellent", verdict: strength,
      advice: strength === "good" ? "Google rates this ad's variety well. Keep it running as the model for new ads."
        : "Add more unique headlines and descriptions, and work your main keywords into them.",
    });
  }
  if (b.ctr !== null && ad.impressions >= MIN_CTR_IMPRESSIONS) {
    const v = judgeAgainst(ad.ctr, b.ctr);
    out.push({
      kpi: "CTR", you: `${ad.ctr.toFixed(2)}%`, standard: `${b.ctr}%`, verdict: v,
      advice: v === "good" ? "The message earns clicks. Reuse its best lines in other ads."
        : "People see it but don't click. Try a sharper offer, the price, or a clearer benefit in the first headline.",
    });
  }
  if (b.cvr !== null && ad.clicks >= MIN_CVR_CLICKS) {
    const v = judgeAgainst(ad.cvr, b.cvr);
    out.push({
      kpi: "Conversion rate", you: `${ad.cvr.toFixed(2)}%`, standard: `${b.cvr}%`, verdict: v,
      advice: v === "good" ? "Clicks are turning into sales, so the ad and page promise match."
        : "Clicks aren't converting. Check that the landing page matches the ad's promise and loads fast on mobile.",
    });
  }
  if (isSalesChannel(ad.channel) && ad.convValue > 0) {
    const v = judgeRoas(ad.roas);
    out.push({
      kpi: "ROAS", you: `${ad.roas.toFixed(2)}x`, standard: `${ROAS_TARGET}x target`, verdict: v,
      advice: v === "good" ? "Profitable at the standard target. Protect its budget."
        : "Below target. Fix copy and page first, then cut its budget if it doesn't recover.",
    });
  }
  if (avgCpa > 0 && ad.cpa > 0) {
    const v: Verdict = ad.cpa <= avgCpa ? "good" : ad.cpa <= avgCpa * 1.3 ? "watch" : "bad";
    out.push({
      kpi: "Cost / conversion", you: money(cur, ad.cpa), standard: `${money(cur, avgCpa)} (your average)`, verdict: v,
      advice: v === "good" ? "Cheaper than your account average." : "More expensive than your account average.",
    });
  }
  return out;
}

/* ── Recommendations ───────────────────────────────────────────────────── */

export type DiagArea = "Tracking" | "Account" | "Campaigns" | "Ads" | "Ad copy" | "Landing pages" | "Products" | "Keywords" | "Search terms" | "Audience";
export type DiagSeverity = "issue" | "warning" | "strength";

export interface Diag {
  area: DiagArea; severity: DiagSeverity; title: string; body: string;
  // Money at stake, used for ranking. Different rules can count the same spend (a keyword and its
  // search term), so these amounts must never be added together into one total.
  impact?: number; impactLabel?: string;
}

interface Ctx { cur: string; spend: number; roas: number; cpa: number; cvr: number; wasteBar: number }

function ctxFrom(cur: string, rows: GMetrics[]): Ctx {
  const t = sumMetrics(rows);
  return {
    cur, spend: t.spend, roas: t.roas, cpa: t.cpa, cvr: t.cvr,
    // "Enough spend that it should have converted by now": twice the average cost per conversion.
    wasteBar: t.cpa > 0 ? t.cpa * 2 : t.spend * 0.05,
  };
}

export function diagnoseOverview(o: OverviewData, filter: ObjectiveFilter = "ALL"): Diag[] {
  const out: Diag[] = [];
  const cur = o.currency;
  const campaigns = filter === "ALL" ? o.campaigns : o.campaigns.filter(c => c.objective === filter);
  // Campaign detail can fail on its own. The account totals can still reveal missing tracking.
  if (campaigns.length === 0) {
    if (filter === "ALL" && o.totals.spend > 0 && o.totals.conversions === 0) {
      out.push({ area: "Tracking", severity: "issue", impact: o.totals.spend, impactLabel: "spend with no recorded result", title: `${money(cur, o.totals.spend)} spent with 0 conversions recorded`, body: "Either conversion tracking isn't set up or nothing sold. Check first: in Google Ads go to Goals > Conversions and place a test order. Until tracking works, Google's automated bidding has nothing to learn from." });
    }
    return out;
  }
  if (campaigns.reduce((s, c) => s + c.spend, 0) <= 0) return out;
  const noun = (obj: Objective) => (o.goalCounting ? GOAL_WORD[obj] : "conversions");
  const groups = OBJECTIVES
    .map(objective => ({ objective, list: campaigns.filter(c => c.objective === objective) }))
    .filter(g => g.list.length > 0);

  // Tracking comes first: every verdict below is meaningless if this is broken.
  for (const { objective, list } of groups) {
    const m = sumMetrics(list);
    const label = OBJECTIVE_LABEL[objective];
    const word = noun(objective);
    const recordedElse = mergeGoalLines(list.map(c => c.notCounted));

    if ((objective === "SALES" || objective === "LEADS") && m.conversions === 0 && m.clicks >= MIN_CVR_CLICKS) {
      out.push({
        area: "Tracking", severity: "issue", impact: m.spend, impactLabel: "spend with no recorded result",
        title: `${money(cur, m.spend)} on ${label} campaigns with 0 ${word} recorded`,
        body: `${recordedElse.length > 0 ? `Google did record ${goalLinesText(recordedElse)}, but no ${word}. ` : ""}Either the tracking is missing or nothing ${objective === "SALES" ? "sold" : "came in"}. Check first: in Google Ads go to Goals > Conversions and place a test ${objective === "SALES" ? "order" : "enquiry"}. If the action exists but sits under a category like "Other", change its category, because only the matching category counts here.`,
      });
    }
    if (objective === "SALES" && m.conversions > 0 && m.convValue <= 0) {
      out.push({
        area: "Tracking", severity: "issue",
        title: `${Math.round(m.conversions)} ${word} but no sale value`,
        body: "Google records the purchases but gets no sale amount, so ROAS can't be calculated and value-based bidding can't work. Fix: send the order value with your purchase conversion, for example through the Google & YouTube app on Shopify.",
      });
    }

    const google = list.reduce((s, c) => s + c.googleConversions, 0);
    const extra = recordedElse.reduce((s, l) => s + l.conversions, 0);
    if (objective !== "OTHER" && google > 0 && extra / google >= 0.2) {
      out.push({
        area: "Tracking", severity: "warning",
        title: `${Math.round((extra / google) * 100)}% of Google's "conversions" on ${label} campaigns aren't ${GOAL_WORD[objective]}`,
        body: `Google also counts ${goalLinesText(recordedElse)}. Skylitee leaves them out here, but Google still bids toward them, so budget can chase the easier action. Fix in Google Ads: open each campaign, go to Settings > Goals, and keep only ${OBJECTIVE_GOAL[objective]}. Skylitee only reads your account, so this has to be changed there.`,
      });
    }

    const secondary = list.filter(c => c.usedSecondary);
    if (secondary.length > 0) {
      out.push({
        area: "Tracking", severity: "warning",
        title: `${nOf(secondary.length, "campaign isn't", "campaigns aren't")} optimising for ${GOAL_WORD[objective]}`,
        body: `${names(secondary.map(c => c.name))}. ${OBJECTIVE_GOAL[objective]} are recorded but aren't one of the goals these campaigns use, so Google isn't bidding toward them. Skylitee still counts them here, from All conversions. Fix in Google Ads: in the campaign's Settings > Goals add ${OBJECTIVE_GOAL[objective]}, and check under Goals > Conversions that the action is set to Primary.`,
      });
    }
  }

  // ROAS is judged on Sales campaigns only, so other objectives aren't flagged on a sales metric.
  const sales = sumMetrics(campaigns.filter(c => c.objective === "SALES"));
  if (sales.spend > 0 && sales.convValue > 0) {
    const r = sales.roas;
    const v = judgeRoas(r);
    if (v === "good") out.push({ area: "Account", severity: "strength", title: `Sales ROAS ${r.toFixed(2)}x - above the ${ROAS_TARGET}x target`, body: "Your sales campaigns return well above cost, because intent, offer and targeting line up. To keep it: raise budgets about 20% at a time on the best campaigns so automated bidding doesn't have to relearn." });
    else if (v === "watch") out.push({ area: "Account", severity: "warning", title: `Sales ROAS ${r.toFixed(2)}x - below the ${ROAS_TARGET}x target`, body: `Above the ${ROAS_MIN}x minimum but thin once product and shipping costs are paid. Likely cause: a few weak campaigns pulling down the good ones. Fix: move budget from the lowest-ROAS campaigns below to the best, and clear the wasted search terms on the Keywords page.` });
    else out.push({ area: "Account", severity: "issue", impact: Math.max(0, sales.spend * ROAS_MIN - sales.convValue), impactLabel: `value short of ${ROAS_MIN}x`, title: `Sales ROAS ${r.toFixed(2)}x - below the ${ROAS_MIN}x minimum`, body: "Sales campaigns are earning too little for what they cost. Likely cause: low-intent traffic or a weak landing page. Fix: stop the zero-purchase campaigns and keywords first, and don't raise any budget until ROAS clears the minimum." });
  }

  // One verdict per channel KPI that has a published benchmark and enough data behind it.
  for (const score of buildScorecard(campaigns)) {
    const label = CHANNEL_LABEL[score.channel];
    for (const row of score.rows) {
      if (row.kpi === "ROAS" || row.verdict === "na") continue;
      if (row.verdict === "good") {
        out.push({ area: "Account", severity: "strength", title: `${label} ${row.kpi} ${row.you} - at or above the ${row.standard} benchmark`, body: row.kpi === "CTR" ? "Your ads match what people are looking for. Keep the winning lines and test new ones against them, rather than replacing them." : "Clicks are turning into purchases, which means the ad and the page agree. Reuse this page layout for other products." });
      } else {
        out.push({ area: "Account", severity: row.verdict === "bad" ? "issue" : "warning", title: `${label} ${row.kpi} ${row.you} - below the ${row.standard} benchmark`, body: row.kpi === "CTR" ? `People see these ads but don't click. Likely cause: broad targeting or a generic message. Fix: ${CTR_FIX[score.channel] ?? "put the offer and main keyword in the first headline, and add negative keywords"}.` : "Clicks aren't turning into sales. Likely cause: the page doesn't match the ad, loads slowly on mobile, or the offer is weak. Fix: open your landing pages on a phone, then check the Landing Pages tab for the worst ones." });
      }
    }
  }

  const salesPrev = o.prevByObjective.SALES;
  if (groups.some(g => g.objective === "SALES") && salesPrev && salesPrev.roas > 0 && sales.roas > 0) {
    const change = ((sales.roas - salesPrev.roas) / salesPrev.roas) * 100;
    if (change <= -20) out.push({ area: "Account", severity: "warning", title: `Sales ROAS fell ${Math.abs(change).toFixed(0)}% from the previous period`, body: `It went from ${salesPrev.roas.toFixed(2)}x to ${sales.roas.toFixed(2)}x. Common causes: higher auction costs, tired ads, or budget moved into weaker campaigns. Compare the campaigns below, and check for recent changes in Google Ads > Change history.` });
    else if (change >= 20) out.push({ area: "Account", severity: "strength", title: `Sales ROAS improved ${change.toFixed(0)}% from the previous period`, body: `It went from ${salesPrev.roas.toFixed(2)}x to ${sales.roas.toFixed(2)}x. Whatever changed recently is working, so note it before making more changes, and keep them small so you can tell what caused what.` });
  }
  for (const { objective, list } of groups) {
    const p = o.prevByObjective[objective];
    const m = sumMetrics(list);
    if (objective !== "OTHER" && p && p.spend > 0 && m.spend > p.spend * 1.1 && m.conversions < p.conversions) {
      const word = noun(objective);
      out.push({ area: "Account", severity: "issue", impact: m.spend - p.spend, impactLabel: "extra spend, fewer results", title: `${OBJECTIVE_LABEL[objective]} campaigns: spending more but getting fewer ${word}`, body: `Spend rose ${(((m.spend - p.spend) / p.spend) * 100).toFixed(0)}% while ${word} fell from ${Math.round(p.conversions)} to ${Math.round(m.conversions)}. New budget is reaching weaker traffic. Fix: roll back the most recent budget increase, then review search terms for irrelevant traffic.` });
    }
  }

  if (filter === "ALL" && o.optimizationScore !== null && o.optimizationScore < 70) {
    out.push({ area: "Account", severity: "warning", title: `Google optimization score ${o.optimizationScore.toFixed(0)}%`, body: "Google thinks there are setup gaps. Treat the score as a checklist rather than a profit measure: its suggestions often increase spend. Accept the fixes that add tracking or ad variety, and be careful with ones that only raise budgets." });
  }

  // Waste and "cheaper than average" only mean something among campaigns chasing the same goal.
  for (const { objective, list } of groups) {
    const ctx = ctxFrom(cur, list);
    for (const c of list) out.push(...diagnoseCampaign(c, ctx, noun(objective)));
  }
  return out;
}

function diagnoseCampaign(c: Campaign, ctx: Ctx, word: string): Diag[] {
  const out: Diag[] = [];
  if (c.status === "REMOVED") return out;
  const { cur } = ctx;
  const sales = c.objective === "SALES";
  const leads = c.objective === "LEADS";

  if ((sales || leads) && c.spend >= ctx.wasteBar && c.conversions === 0 && ctx.spend > 0) {
    out.push({ area: "Campaigns", severity: "issue", impact: c.spend, impactLabel: `spent, 0 ${word}`, title: `"${c.name}" spent ${money(cur, c.spend)} with 0 ${word}`, body: "It has spent enough that it should have delivered by now. Likely cause: the wrong audience or a landing page mismatch. Fix: check its search terms, and pause it if they aren't relevant." });
  } else if (sales && c.convValue > 0 && c.roas < 1 && c.spend >= ctx.wasteBar) {
    out.push({ area: "Campaigns", severity: "issue", impact: c.spend - c.convValue, impactLabel: "spent more than it earned", title: `"${c.name}" earns less than it spends (ROAS ${c.roas.toFixed(2)}x)`, body: `Every ${sym(cur)}1 spent returns less than ${sym(cur)}1 in sales, before product costs. Fix: cut its budget by half, remove poor keywords and products, and move that money to your best campaign.` });
  } else if (sales && c.convValue > 0 && c.roas >= ROAS_TARGET && c.conversions >= 3) {
    out.push({ area: "Campaigns", severity: "strength", title: `"${c.name}" is working - ROAS ${c.roas.toFixed(2)}x`, body: `${Math.round(c.conversions)} ${word} at ${money(cur, c.cpa)} each. Keep it funded, and raise its budget about 20% at a time while ROAS holds.` });
  } else if (leads && c.conversions >= 3 && c.cpa <= ctx.cpa) {
    out.push({ area: "Campaigns", severity: "strength", title: `"${c.name}" brings ${word} at or below your average cost`, body: `${Math.round(c.conversions)} ${word} at ${money(cur, c.cpa)} each, against your ${money(cur, ctx.cpa)} average. Check the lead quality with your sales team, then raise its budget about 20% at a time.` });
  }

  if (sales && c.searchBudgetLost !== null && c.searchBudgetLost >= 10) {
    if (c.convValue > 0 && c.roas >= ROAS_TARGET) {
      // Rough estimate: value grows in step with extra eligible impressions. Capped at today's value.
      const share = c.searchIS && c.searchIS > 9.99 ? c.searchIS : null;
      const missed = share ? Math.min(c.convValue, c.convValue * (c.searchBudgetLost / share)) : undefined;
      out.push({ area: "Campaigns", severity: "warning", impact: missed, impactLabel: "estimated missed sales value", title: `"${c.name}" is profitable but running out of budget`, body: `It missed ${c.searchBudgetLost.toFixed(0)}% of the searches it could have shown on because the budget ran out, at a healthy ROAS of ${c.roas.toFixed(2)}x. Fix: raise its daily budget${c.dailyBudget > 0 ? ` from ${money(cur, c.dailyBudget)}` : ""} by about 20%, then check ROAS after a week. The estimate assumes extra searches convert like today's, so it may be optimistic.` });
    } else if (c.convValue > 0 && c.roas < ROAS_MIN) {
      out.push({ area: "Campaigns", severity: "warning", title: `"${c.name}" is budget-limited, but don't add more yet`, body: `It missed ${c.searchBudgetLost.toFixed(0)}% of searches on budget, but ROAS is only ${c.roas.toFixed(2)}x, so more budget would mostly buy more loss. Fix the targeting and ads first.` });
    }
  }

  if (c.searchRankLost !== null && c.searchRankLost >= 30 && c.spend >= ctx.wasteBar) {
    out.push({ area: "Campaigns", severity: "warning", title: `"${c.name}" loses ${c.searchRankLost.toFixed(0)}% of searches on ad rank`, body: `Competitors outrank it even when budget is available. More budget won't fix this. Fix: raise Quality Score with closer keyword-to-ad matching and better landing pages${sales ? ", or raise the bid or lower the target ROAS if the margin allows" : ", or raise the bid if the margin allows"}.` });
  }

  if (sales && c.targetRoas && c.convValue > 0 && c.roas < c.targetRoas * 0.8 && c.spend >= ctx.wasteBar) {
    out.push({ area: "Campaigns", severity: "warning", title: `"${c.name}" misses its target ROAS`, body: `The target is ${c.targetRoas.toFixed(2)}x and it's delivering ${c.roas.toFixed(2)}x. If it's new, give it about 2 weeks to learn. Otherwise check whether the target is realistic, and whether conversion values are being reported correctly.` });
  }
  return out;
}

function isHomepage(url: string) {
  try {
    const p = new URL(url).pathname;
    return p === "/" || p === "";
  } catch {
    return false;
  }
}

export function diagnoseAds(a: AdsData): Diag[] {
  const out: Diag[] = [];
  const cur = a.currency;
  const ctx = ctxFrom(cur, a.ads.length > 0 ? a.ads : a.assetGroups);

  if (a.disapproved.length > 0) {
    out.push({ area: "Ads", severity: "issue", title: `${nOf(a.disapproved.length, "ad", "ads")} disapproved or limited by Google`, body: `In ${names([...new Set(a.disapproved.map(d => d.campaign))])}. These ads can't run fully. Fix: open Ads in Google Ads, read the policy reason shown, then edit or appeal them.` });
  }

  const weak = a.ads.filter(x => judgeStrength(x.strength) === "bad" || judgeStrength(x.strength) === "watch");
  if (weak.length > 0) {
    const spend = weak.reduce((s, x) => s + x.spend, 0);
    out.push({ area: "Ad copy", severity: weak.some(x => x.strength === "POOR") ? "issue" : "warning", impact: spend, impactLabel: "spend on weak-strength ads", title: `${nOf(weak.length, "ad has", "ads have")} Poor or Average Ad Strength`, body: "Google has too little variety to match these ads to searches, which limits where they show. Fix: reach 12 or more distinct headlines and 4 descriptions, with keywords, offers, prices and proof points all covered. Open each ad below to see its exact copy." });
  }
  const strong = a.ads.filter(x => judgeStrength(x.strength) === "good");
  if (strong.length > 0 && weak.length === 0) {
    out.push({ area: "Ad copy", severity: "strength", title: "All your ads rate Good or Excellent for Ad Strength", body: "Google has enough variety to match searches. Keep replacing the lowest-rated lines in the Ad Copy tab, so ads stay fresh." });
  }

  const thin = a.ads.filter(x => x.type === "RESPONSIVE_SEARCH_AD" && (x.headlines.length < 8 || x.descriptions.length < 3));
  if (thin.length > 0) {
    out.push({ area: "Ad copy", severity: "warning", title: `${nOf(thin.length, "search ad has", "search ads have")} too few headlines or descriptions`, body: `For example ${names(thin.map(x => x.adGroup))}. Google allows 15 headlines and 4 descriptions, and these use fewer than 8 and 3. Fix: add lines covering benefits, price, shipping or COD, reviews, and the product name.` });
  }

  const dud = a.ads.filter(x => x.conversions === 0 && x.spend >= ctx.wasteBar && isSalesChannel(x.channel));
  if (dud.length > 0) {
    out.push({ area: "Ads", severity: "issue", impact: dud.reduce((s, x) => s + x.spend, 0), impactLabel: "spent, 0 conversions", title: `${nOf(dud.length, "ad", "ads")} spent money with 0 conversions`, body: `In ad groups ${names(dud.map(x => x.adGroup))}. Each spent more than twice your average cost per conversion. Fix: if another ad in the same group converts, pause these. If not, rewrite the copy and check the landing page.` });
  }

  const best = [...a.ads].filter(x => x.conversions >= 3 && x.convValue > 0 && x.roas >= ROAS_TARGET).sort((x, y) => y.convValue - x.convValue)[0];
  if (best) {
    out.push({ area: "Ads", severity: "strength", title: `Top ad earns ${best.roas.toFixed(2)}x in "${best.adGroup}"`, body: `${money(cur, best.convValue)} in value from ${Math.round(best.conversions)} conversions. Its copy clearly works, so open it below and reuse its best lines in your weaker ad groups.` });
  }

  const home = a.ads.filter(x => x.channel === "SEARCH" && isHomepage(x.finalUrl));
  const homeSpend = home.reduce((s, x) => s + x.spend, 0);
  if (ctx.spend > 0 && homeSpend / ctx.spend >= 0.2) {
    out.push({ area: "Landing pages", severity: "warning", impact: homeSpend, impactLabel: "spend sent to the homepage", title: `${Math.round((homeSpend / ctx.spend) * 100)}% of ad spend sends people to your homepage`, body: "Someone searching for a specific product has to hunt for it, which lowers both conversion rate and Quality Score. Fix: link each ad group to its matching product or collection page." });
  }

  const poorPages = a.landingPages.filter(l => l.clicks >= 100 && ctx.cvr > 0 && l.cvr < ctx.cvr * 0.5);
  if (poorPages.length > 0) {
    out.push({ area: "Landing pages", severity: "warning", impact: poorPages.reduce((s, l) => s + l.spend, 0), impactLabel: "spend on weak pages", title: `${nOf(poorPages.length, "landing page converts", "landing pages convert")} at under half your average`, body: `For example ${names(poorPages.map(l => l.url.replace(/^https?:\/\/[^/]+/, "") || "/"))}. Your account average is ${ctx.cvr.toFixed(2)}%. Fix: test on a phone for speed, make sure price and the Buy button show without scrolling, and match the page headline to the ad.` });
  }

  const low = a.assets.filter(x => x.label === "LOW");
  if (low.length > 0) {
    out.push({ area: "Ad copy", severity: "warning", title: `${nOf(low.length, "ad line", "ad lines")} rated Low by Google`, body: `For example ${names(low.map(x => x.text))}. Fix: replace these lines. Filter by Low in the Ad Copy tab to see them all.` });
  }
  const topAssets = a.assets.filter(x => x.label === "BEST");
  if (topAssets.length > 0) {
    out.push({ area: "Ad copy", severity: "strength", title: `${nOf(topAssets.length, "ad line", "ad lines")} rated Best by Google`, body: `For example ${names(topAssets.map(x => x.text))}. These messages resonate, so reuse the same angle in other ad groups and in your Meta ads.` });
  }

  const weakGroups = a.assetGroups.filter(g => judgeStrength(g.strength) === "bad" || judgeStrength(g.strength) === "watch");
  if (weakGroups.length > 0) {
    out.push({ area: "Ad copy", severity: "warning", impact: weakGroups.reduce((s, g) => s + g.spend, 0), impactLabel: "spend on weak asset groups", title: `${nOf(weakGroups.length, "Performance Max asset group has", "Performance Max asset groups have")} low Ad Strength`, body: `${names(weakGroups.map(g => g.name))}. Missing assets limit where Google can show them. Fix: fill every slot with 5 long headlines, 5 descriptions, and images and video in all sizes.` });
  }

  const dudProducts = a.products.filter(p => p.conversions === 0 && p.spend >= ctx.wasteBar);
  if (dudProducts.length > 0) {
    out.push({ area: "Products", severity: "issue", impact: dudProducts.reduce((s, p) => s + p.spend, 0), impactLabel: "spent, 0 conversions", title: `${nOf(dudProducts.length, "product", "products")} got ad spend but no sales`, body: `For example ${names(dudProducts.map(p => p.title))}. Fix: check price, stock and reviews on those pages. If they still don't sell, exclude them from Shopping or Performance Max.` });
  }
  const winners = a.products.filter(p => p.conversions >= 2 && ctx.roas > 0 && p.roas >= ctx.roas * 1.5);
  if (winners.length > 0) {
    out.push({ area: "Products", severity: "strength", title: `${nOf(winners.length, "product earns", "products earn")} 1.5x your average ROAS`, body: `For example ${names(winners.map(p => p.title))}. Move them into their own campaign or asset group with a higher budget, so they get more of your spend.` });
  }
  return out;
}

export function diagnoseKeywords(k: KeywordsData): Diag[] {
  const out: Diag[] = [];
  const cur = k.currency;
  const ctx = ctxFrom(cur, k.keywords.length > 0 ? k.keywords : k.searchTerms);

  const scored = k.keywords.filter(x => x.qs !== null && x.impressions > 0);
  if (scored.length > 0) {
    const imp = scored.reduce((s, x) => s + x.impressions, 0);
    const avg = scored.reduce((s, x) => s + (x.qs ?? 0) * x.impressions, 0) / imp;
    const v = judgeQs(avg);
    if (v === "good") out.push({ area: "Keywords", severity: "strength", title: `Average Quality Score ${avg.toFixed(1)} of 10`, body: "Google sees your keywords, ads and pages as relevant, and that means cheaper clicks and better positions. To keep it: when you add keywords, give them their own closely matching ads." });
    else out.push({ area: "Keywords", severity: v === "bad" ? "issue" : "warning", title: `Average Quality Score ${avg.toFixed(1)} of 10 - aim for 7+`, body: "Low scores mean you pay more per click for worse positions. Likely cause: ad groups covering too many topics. Fix: split them so each keyword group has its own matching ad and page." });

    const poor = scored.filter(x => (x.qs ?? 0) <= 4 && x.spend > 0);
    if (poor.length > 0) {
      const count = (f: (x: KeywordRow) => string) => poor.filter(x => f(x) === "BELOW_AVERAGE").length;
      const parts = [
        [count(x => x.expectedCtr), "expected CTR (write ads that include the keyword)"],
        [count(x => x.adRelevance), "ad relevance (the ad doesn't match the keyword)"],
        [count(x => x.landingExp), "landing page (slow or off-topic page)"],
      ] as const;
      const main = [...parts].sort((a, b) => b[0] - a[0])[0];
      out.push({ area: "Keywords", severity: "issue", impact: poor.reduce((s, x) => s + x.spend, 0), impactLabel: "spend on Quality Score 4 or lower", title: `${nOf(poor.length, "keyword has", "keywords have")} Quality Score 4 or lower`, body: `For example ${names(poor.map(x => x.keyword))}.${main[0] > 0 ? ` The most common weak spot is ${main[1]}, on ${main[0]} of them.` : ""} Fix those, or pause the keywords that aren't core to your products.` });
    }
  }

  const dud = k.keywords.filter(x => x.conversions === 0 && x.spend >= ctx.wasteBar);
  if (dud.length > 0) {
    out.push({ area: "Keywords", severity: "issue", impact: dud.reduce((s, x) => s + x.spend, 0), impactLabel: "spent, 0 conversions", title: `${nOf(dud.length, "keyword", "keywords")} spent money with 0 conversions`, body: `For example ${names(dud.map(x => x.keyword))}. Each spent more than twice your average cost per conversion. Fix: pause them or switch to a tighter match type.` });
  }
  const winners = k.keywords.filter(x => x.conversions >= 2 && x.convValue > 0 && x.roas >= ROAS_TARGET && (x.rankLost ?? 0) >= 20);
  if (winners.length > 0) {
    out.push({ area: "Keywords", severity: "warning", title: `${nOf(winners.length, "profitable keyword is", "profitable keywords are")} being outranked`, body: `For example ${names(winners.map(x => x.keyword))}. They earn ${ROAS_TARGET}x or more but lose at least 20% of searches on ad rank, so you're leaving profitable sales behind. Fix: raise their bids or give them dedicated ads.` });
  }
  const top = k.keywords.filter(x => x.conversions >= 3 && x.convValue > 0 && x.roas >= ROAS_TARGET).sort((a, b) => b.convValue - a.convValue);
  if (top.length > 0) {
    out.push({ area: "Keywords", severity: "strength", title: `${nOf(top.length, "keyword delivers", "keywords deliver")} ${ROAS_TARGET}x ROAS or more`, body: `Led by ${names(top.map(x => x.keyword))}. People searching these want what you sell. Protect their budget, and look for similar terms to add.` });
  }

  const byMatch = new Map<string, GMetrics[]>();
  for (const x of k.keywords) byMatch.set(x.matchType, [...(byMatch.get(x.matchType) ?? []), x]);
  const broad = byMatch.get("BROAD");
  const exact = byMatch.get("EXACT");
  if (broad && exact && ctx.spend > 0) {
    const b = sumMetrics(broad);
    const e = sumMetrics(exact);
    if (b.spend / ctx.spend >= 0.4 && e.roas > 0 && b.roas < e.roas * 0.7) {
      out.push({ area: "Keywords", severity: "warning", title: `Broad match takes ${Math.round((b.spend / ctx.spend) * 100)}% of keyword spend at a lower ROAS`, body: `Broad earns ${b.roas.toFixed(2)}x against ${e.roas.toFixed(2)}x for Exact. Fix: add the winning search terms as Exact, add negatives for the poor ones, and shift budget toward what converts.` });
    }
  }

  const wasted = k.searchTerms.filter(t => t.conversions === 0 && t.spend >= Math.max(ctx.cpa, ctx.wasteBar / 2) && t.status !== "EXCLUDED" && t.spend > 0);
  if (wasted.length > 0) {
    const pmaxOnly = wasted.every(t => t.source === "pmax");
    out.push({ area: "Search terms", severity: "issue", impact: wasted.reduce((s, t) => s + t.spend, 0), impactLabel: "wasted on search terms", title: `${nOf(wasted.length, "search term costs", "search terms cost")} money with no conversions`, body: `For example ${names(wasted.map(t => t.term))}. These are the actual words people typed. Fix: add the irrelevant ones as negative keywords${pmaxOnly ? " at account level, since these came from Performance Max" : ""}, so you stop paying for them.` });
  }
  const toAdd = k.searchTerms.filter(t => t.source === "search" && t.conversions >= 2 && t.status === "NONE");
  if (toAdd.length > 0) {
    out.push({ area: "Search terms", severity: "warning", impact: toAdd.reduce((s, t) => s + t.convValue, 0), impactLabel: "value not protected by a keyword", title: `${nOf(toAdd.length, "converting search term isn't a keyword", "converting search terms aren't keywords")} yet`, body: `For example ${names(toAdd.map(t => t.term))}. They already sell, but you have no direct control over their bids. Fix: add them as Exact match keywords with their own ad.` });
  }
  return out;
}

function diagnoseSegments(area: DiagArea, what: string, rows: SegmentRow[], ctx: Ctx, advice: { low: string; high: string }): Diag[] {
  const out: Diag[] = [];
  if (ctx.spend <= 0 || rows.length < 2) return out;
  const usable = rows.filter(r => r.spend >= ctx.spend * 0.1 && r.clicks >= MIN_CVR_CLICKS);
  const compare = ctx.roas > 0 ? (r: SegmentRow) => r.roas / ctx.roas : ctx.cvr > 0 ? (r: SegmentRow) => r.cvr / ctx.cvr : null;
  if (!compare) return out;
  const unit = (r: SegmentRow) => (ctx.roas > 0 ? `${r.roas.toFixed(2)}x ROAS against ${ctx.roas.toFixed(2)}x overall` : `${r.cvr.toFixed(2)}% conversion rate against ${ctx.cvr.toFixed(2)}% overall`);

  for (const r of usable) {
    const ratio = compare(r);
    if (ratio < 0.6) {
      const gap = ctx.roas > 0 ? r.spend * ctx.roas - r.convValue : undefined;
      out.push({ area, severity: "warning", impact: gap, impactLabel: "value below your account average", title: `${what} "${r.label}" underperforms`, body: `${money(ctx.cur, r.spend)} spent at ${unit(r)}. ${advice.low}` });
    } else if (ratio >= 1.3 && r.conversions >= 3) {
      out.push({ area, severity: "strength", title: `${what} "${r.label}" outperforms`, body: `${money(ctx.cur, r.spend)} spent at ${unit(r)}. ${advice.high}` });
    }
  }
  return out;
}

const DAY_LABEL: Record<string, string> = { MONDAY: "Monday", TUESDAY: "Tuesday", WEDNESDAY: "Wednesday", THURSDAY: "Thursday", FRIDAY: "Friday", SATURDAY: "Saturday", SUNDAY: "Sunday" };

export function diagnoseAudience(a: AudienceData): Diag[] {
  const out: Diag[] = [];
  const base = a.devices.length > 0 ? a.devices : a.networks.length > 0 ? a.networks : a.heat;
  const ctx = ctxFrom(a.currency, base);

  out.push(...diagnoseSegments("Audience", "Device", a.devices, ctx, {
    low: "Likely cause: a slow or awkward page on this device. Fix the page first. On manual bidding you can also lower the bid here. Automated bidding usually handles bids itself.",
    high: "Make sure this device's page experience stays fast, and put new tests here first.",
  }));
  out.push(...diagnoseSegments("Audience", "Network", a.networks, ctx, {
    low: "If this is Search Partners or Display inside a Search campaign, switch it off in campaign settings and compare results after 2 weeks.",
    high: "This is where your budget works hardest. Keep it enabled, and consider a dedicated campaign.",
  }));
  out.push(...diagnoseSegments("Audience", "Age", a.ages, ctx, {
    low: "Check whether your product really suits this group. If not, lower bids or exclude it, keeping in mind this skips Performance Max.",
    high: "Shape your ad message and images around this group.",
  }));
  out.push(...diagnoseSegments("Audience", "Gender", a.genders, ctx, {
    low: "Check whether your product and creative suit this group, and adjust the message before excluding anyone.",
    high: "Shape your ad message and images around this group.",
  }));
  out.push(...diagnoseSegments("Audience", "State", a.states, ctx, {
    low: "Check delivery times and COD availability here. If they aren't the cause, lower spend in this location.",
    high: "Raise budget here, or run a location-specific campaign that mentions fast delivery.",
  }));

  const mobile = a.devices.find(d => d.key === "MOBILE");
  const desktop = a.devices.find(d => d.key === "DESKTOP");
  if (mobile && desktop && mobile.clicks >= MIN_CVR_CLICKS && desktop.clicks >= MIN_CVR_CLICKS && desktop.cvr > 0 && mobile.cvr < desktop.cvr * 0.5) {
    out.push({ area: "Landing pages", severity: "warning", impact: mobile.spend, impactLabel: "mobile spend affected", title: `Mobile converts at under half of desktop (${mobile.cvr.toFixed(2)}% vs ${desktop.cvr.toFixed(2)}%)`, body: "Some gap is normal, but this size usually points to the mobile page. Fix: test speed on a real phone, keep the Buy button visible, and offer UPI and COD at checkout." });
  }

  if (a.heat.length > 0 && ctx.spend > 0) {
    const roll = <K extends string | number>(key: (r: HeatRow) => K) => {
      const groups = new Map<K, HeatRow[]>();
      for (const r of a.heat) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
      return [...groups.entries()].map(([k, list]) => ({ key: k, m: sumMetrics(list) }));
    };
    const days = roll(r => r.day);
    const hours = roll(r => r.hour);
    const hourText = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;

    const bestDay = days.filter(d => d.m.conversions >= 3).sort((x, y) => y.m.cvr - x.m.cvr)[0];
    if (bestDay) out.push({ area: "Audience", severity: "strength", title: `${DAY_LABEL[bestDay.key] ?? bestDay.key} is your best day`, body: `${bestDay.m.cvr.toFixed(2)}% conversion rate, against ${ctx.cvr.toFixed(2)}% overall. Time offers and new launches for this day.` });

    const deadHours = hours.filter(h => h.m.conversions === 0 && h.m.spend >= ctx.wasteBar / 2 && h.m.spend > 0);
    if (deadHours.length > 0) {
      out.push({ area: "Audience", severity: "warning", impact: deadHours.reduce((s, h) => s + h.m.spend, 0), impactLabel: "spent in zero-conversion hours", title: `${nOf(deadHours.length, "hour of the day spends", "hours of the day spend")} money with no conversions`, body: `${deadHours.sort((x, y) => Number(x.key) - Number(y.key)).slice(0, 6).map(h => hourText(Number(h.key))).join(", ")}${deadHours.length > 6 ? " and others" : ""}. If you use manual bidding, try an ad schedule that skips these hours. On automated bidding, leave it unless the pattern holds for a month.` });
    }
  }
  return out;
}

const SEVERITY_ORDER: Record<DiagSeverity, number> = { issue: 0, warning: 1, strength: 2 };

// Biggest money at stake first. Findings with no amount follow by severity, wins last.
export function rankDiags(list: Diag[]): Diag[] {
  return [...list].sort((a, b) => {
    const wa = a.severity === "strength" ? 1 : 0;
    const wb = b.severity === "strength" ? 1 : 0;
    if (wa !== wb) return wa - wb;
    const ia = a.impact ?? -1;
    const ib = b.impact ?? -1;
    if (ia !== ib) return ib - ia;
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });
}
