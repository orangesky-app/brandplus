"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  AlertCircle, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown,
  ShoppingCart, Share2, Search, Plug, MessageSquareText, Layout,
  Zap, RefreshCw, Target, Megaphone, Eye, MousePointerClick, Send, ArrowRight, Sparkles, BarChart3,
} from "lucide-react";
import Link from "next/link";
import { useDateRange, getComparisonRange, formatDateSpan, rangeDays, rangeText, toLocalYMD } from "@/lib/date-range-context";
import { cn } from "@/lib/utils";
import { Sparkline, Donut, Gauge } from "@/components/ui/charts";
import { RangeText } from "@/components/ui/period";
import { SimpleView } from "@/components/command-center/simple-view";
import type { GlanceData } from "@/components/command-center/glance";
import { buildPlainReport } from "@/lib/plain-insights";
import { ROAS_MIN, ROAS_TARGET } from "@/lib/gads-analysis";
import { readGadsResponse, gadsIssueText, type GadsCampaignRow, type GadsDailyRow, type GadsIssue, type GadsKpis } from "@/lib/gads-client";

/* ─── Types ─────────────────────────────────────────────────── */
interface ShopKpis {
  grossSales: number; totalOrders: number; aov: number; newCustomers: number; returningCustomers: number;
  codOrders: number; prepaidOrders: number; codRevenue?: number; prepaidRevenue?: number;
  refundedRevenue?: number; totalDiscounts?: number;
}
interface ShopData { shop: string; kpis: ShopKpis; dailyRevenue: { date?: string; day: string; revenue: number; orders?: number }[]; period: { days: number } }
interface AnomalyData {
  critical: { title: string; desc: string }[]; warnings: { title: string; desc: string }[]; positive: { title: string; desc: string }[];
  period?: { from: string; to: string };
  summary: { projectedMonthly: number; grossSales: number; totalOrders: number; codPct: number; repeatRate: number };
}
interface LeadsByType { form: number; messaging: number; calls: number }
interface MetaKPIs {
  spend: number; roas: number; cac: number; purchases: number; purchaseValue: number; leads: number; costPerLead: number;
  leadsByType?: LeadsByType; clicks: number; ctr: number; impressions: number; reach: number; frequency: number;
  lpv: number; atc: number; checkout: number;
}
interface MetaCampaign { name: string; status: string; objective: string; spend: number; purchases: number; purchaseValue: number; leads: number; clicks: number; impressions: number; ctr: number; roas: number; frequency: number }
interface GscKPIs { clicks: number; impressions: number; ctr: number; avgPosition: number }
interface GscKeyword { query: string; clicks: number; impressions: number; ctr: number; position: number }
interface Ga4KPIs { sessions: number; users: number; bounceRate: number; avgSessionMin?: string; newUsers?: number }
interface Ga4Ecom { itemsViewed: number; itemsAddedToCart: number; itemsCheckedOut: number; itemsPurchased: number; purchases: number; revenue: number }
interface CostModel { cogsPerOrder: number; shippingPerOrder: number; rtoRate: number; rtoCostPerOrder: number; gatewayPct: number; codFeePct: number }

const ASSUMED_LEAD_CONV = 0.12; // industry-rough lead→order rate; labelled "est." wherever used

/* ─── Objective helpers ──────────────────────────────────────── */
type Obj = "SALES" | "LEADS" | "TRAFFIC" | "AWARENESS" | "ENGAGEMENT" | "OTHER";
function normObj(raw: string): Obj {
  const r = (raw || "").toUpperCase();
  if (r.includes("SALES") || r.includes("CONVERSION")) return "SALES";
  if (r.includes("LEAD")) return "LEADS";
  if (r.includes("TRAFFIC") || r.includes("LINK_CLICK")) return "TRAFFIC";
  if (r.includes("AWARENESS") || r.includes("REACH") || r.includes("BRAND") || r.includes("VIDEO")) return "AWARENESS";
  if (r.includes("ENGAGEMENT")) return "ENGAGEMENT";
  return "OTHER";
}
const OBJ_META: Record<Obj, { label: string; icon: typeof Target; color: string; chip: string }> = {
  SALES:      { label: "Sales",      icon: ShoppingCart,      color: "#EA580C", chip: "bg-[#FFF7ED] text-[#EA580C]" },
  LEADS:      { label: "Leads",      icon: Target,            color: "#15803D", chip: "bg-[#F0FDF4] text-[#15803D]" },
  TRAFFIC:    { label: "Traffic",    icon: MousePointerClick, color: "#1D4ED8", chip: "bg-[#EFF6FF] text-[#1D4ED8]" },
  AWARENESS:  { label: "Awareness",  icon: Eye,               color: "#7C3AED", chip: "bg-[#F5F3FF] text-[#7C3AED]" },
  ENGAGEMENT: { label: "Engagement", icon: Megaphone,         color: "#BE185D", chip: "bg-[#FDF2F8] text-[#BE185D]" },
  OTHER:      { label: "Other",      icon: Share2,            color: "#71717A", chip: "bg-[#F5F5F4] text-[#71717A]" },
};
interface Bucket { obj: Obj; count: number; spend: number; purchases: number; purchaseValue: number; leads: number; clicks: number; impressions: number; roas: number; cpl: number; cac: number; ctr: number }
function bucketFor(camps: MetaCampaign[], obj: Obj): Bucket {
  const c = camps.filter(x => normObj(x.objective) === obj);
  const sum = (f: (x: MetaCampaign) => number) => c.reduce((s, x) => s + (f(x) || 0), 0);
  const spend = sum(x => x.spend), purchaseValue = sum(x => x.purchaseValue), purchases = sum(x => x.purchases);
  const leads = sum(x => x.leads), clicks = sum(x => x.clicks), impressions = sum(x => x.impressions);
  return {
    obj, count: c.length, spend, purchases, purchaseValue, leads, clicks, impressions,
    roas: spend > 0 ? +(purchaseValue / spend).toFixed(2) : 0,
    cpl: leads > 0 ? +(spend / leads).toFixed(0) : 0,
    cac: purchases > 0 ? +(spend / purchases).toFixed(0) : 0,
    ctr: impressions > 0 ? +(clicks / impressions * 100).toFixed(2) : 0,
  };
}

/* ─── Small stat card with a unique sub-line + optional sparkline ── */
function StatCard({ label, value, sub, tone = "neutral", spark, sparkColor = "#F97316" }: { label: string; value: string; sub?: React.ReactNode; tone?: "good" | "bad" | "warn" | "neutral"; spark?: number[]; sparkColor?: string }) {
  const valColor = tone === "good" ? "text-[#16A34A]" : tone === "bad" ? "text-[#EF4444]" : tone === "warn" ? "text-[#B45309]" : "text-[#18181B] dark:text-[#F4F4F5]";
  return (
    <div className="relative bg-white dark:bg-[#171717] rounded-2xl border border-black/[0.06] dark:border-white/[0.06] p-3 overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[#F97316] via-[#FB923C] to-transparent opacity-80" />
      <div className="text-[13px] font-semibold text-[#A1A1AA] uppercase tracking-wide">{label}</div>
      <div className={cn("text-[22px] font-black mt-0.5 leading-none tabular-nums", valColor)}>{value}</div>
      {sub && <div className="text-[13px] text-[#71717A] dark:text-[#A1A1AA] mt-1.5 leading-snug">{sub}</div>}
      {spark && spark.length > 1 && <div className="mt-2 -mx-1"><Sparkline data={spark} color={sparkColor} height={28} /></div>}
    </div>
  );
}

// "2 Nov": a bare 11/2 reads as 11 February in India.
const shortDay = (ymd: string) => new Date(ymd + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// Search Console's newest final data is about 3 days old: the latest full week it can vouch for.
function gscFinalWeek() {
  const end = new Date(); end.setDate(end.getDate() - 3);
  const start = new Date(end); start.setDate(start.getDate() - 6);
  return { from: toLocalYMD(start), to: toLocalYMD(end) };
}

const quickActions = [
  { label: "Sales Report", href: "/dashboard/sales", icon: ShoppingCart, color: "bg-[#FFF7ED] text-[#F97316]" },
  { label: "Meta Campaigns", href: "/dashboard/meta", icon: Share2, color: "bg-[#EFF6FF] text-[#1877F2]" },
  { label: "Google Ads", href: "/dashboard/gads", icon: Megaphone, color: "bg-[#FEFCE8] text-[#A16207]" },
  { label: "Creative Studio", href: "/dashboard/creative", icon: Layout, color: "bg-[#F5F3FF] text-[#7C3AED]" },
  { label: "Search Console", href: "/dashboard/gsc", icon: Search, color: "bg-[#F0FDF4] text-[#16A34A]" },
  { label: "Analytics GA4", href: "/dashboard/ga4", icon: BarChart3, color: "bg-[#EEF2FF] text-[#6366F1]" },
  { label: "Financial P&L", href: "/dashboard/financial", icon: TrendingUp, color: "bg-[#FEF2F2] text-[#DC2626]" },
  { label: "Connections", href: "/dashboard/connections", icon: Plug, color: "bg-[#F5F5F4] text-[#71717A]" },
];

/* ─── Component ─────────────────────────────────────────────── */
export default function CommandCenterPage() {
  const { range, compareWith, setPreset } = useDateRange();
  const router = useRouter();

  // Command Center opens on TODAY (once per browser session - if the user then picks another
  // range it sticks). Fetching waits for this so we don't load "This month" first and throw it away.
  const [rangeReady, setRangeReady] = useState(false);
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("skylitee-cc-today")) {
        sessionStorage.setItem("skylitee-cc-today", "1");
        if (range.preset !== "today") setPreset("today");
      }
    } catch { /* storage blocked → keep the current range */ }
    setRangeReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [shop, setShop] = useState<ShopData | null>(null);
  const [compShop, setCompShop] = useState<ShopData | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyData | null>(null);
  const [meta, setMeta] = useState<MetaKPIs | null>(null);
  const [compMeta, setCompMeta] = useState<MetaKPIs | null>(null);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [metaDaily, setMetaDaily] = useState<{ date: string; spend: number; purchaseValue: number }[]>([]);
  const [gads, setGads] = useState<GadsKpis | null>(null);
  const [compGads, setCompGads] = useState<GadsKpis | null>(null);
  const [gadsDaily, setGadsDaily] = useState<GadsDailyRow[]>([]);
  const [gadsCampaigns, setGadsCampaigns] = useState<GadsCampaignRow[]>([]);
  const [gadsIssue, setGadsIssue] = useState<GadsIssue | null>(null);
  const [gsc, setGsc] = useState<GscKPIs | null>(null);
  const [gscKeywords, setGscKeywords] = useState<GscKeyword[]>([]);
  const [ga4, setGa4] = useState<Ga4KPIs | null>(null);
  const [ga4Ecom, setGa4Ecom] = useState<Ga4Ecom | null>(null);
  const [ga4Channels, setGa4Channels] = useState<{ channel: string; sessions: number }[]>([]);
  const [funnelSrc, setFunnelSrc] = useState<"meta" | "google" | "ga4" | "shopify">("meta");
  const [connections, setConnections] = useState({ shopify: false, meta: false, gads: false, gsc: false, ga4: false });
  const [savedCost, setCost] = useState<CostModel | null>(null);
  // Product cost per order from Shopify's "Cost per item" (null = not set in Shopify).
  const [shopCogsPerOrder, setShopCogsPerOrder] = useState<number | null>(null);
  const [salesTarget, setSalesTarget] = useState(0);
  const [chatQ, setChatQ] = useState("");
  const [loading, setLoading] = useState(true);
  // Simple (plain-language, default for everyone) vs Expert (all charts). Remembered per browser.
  const [view, setView] = useState<"simple" | "expert">("simple");
  useEffect(() => {
    try { if (localStorage.getItem("skylitee-cc-view") === "expert") setView("expert"); } catch { /* ignore */ }
  }, []);
  function switchView(v: "simple" | "expert") {
    setView(v);
    try { localStorage.setItem("skylitee-cc-view", v); } catch { /* ignore */ }
  }

  // Cost model + goal from the same localStorage the Financial/Goals pages use.
  useEffect(() => {
    try {
      const c = localStorage.getItem("skylitee-pl-inputs");
      if (c) setCost(JSON.parse(c));
      // The Goals page saves one record per month.
      const g = localStorage.getItem("skylitee-goals");
      const records: { month: string; salesTarget: number }[] = g ? JSON.parse(g) : [];
      const thisMonth = toLocalYMD(new Date()).slice(0, 7);
      setSalesTarget(records.find(r => r.month === thisMonth)?.salesTarget ?? 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!rangeReady) return;
    // Old numbers must never sit under new dates, and a slow answer for the previous
    // range must not overwrite the current one.
    let stale = false;
    setLoading(true);
    setShop(null); setCompShop(null);
    setMeta(null); setCompMeta(null); setMetaDaily([]); setCampaigns([]);
    setGsc(null); setGscKeywords([]);
    setGa4(null); setGa4Ecom(null); setGa4Channels([]);
    setGads(null); setCompGads(null); setGadsDaily([]); setGadsCampaigns([]); setGadsIssue(null);
    setShopCogsPerOrder(null);
    // Separate from the main batch so a slow cost lookup never holds up the page.
    fetch(`/api/shopify/cogs?from=${range.from}&to=${range.to}`).then(r => r.json())
      .then(d => { if (!stale && d && !d.error && d.status !== "none") setShopCogsPerOrder(d.cogs.perOrder); })
      .catch(() => {});
    const compRange = getComparisonRange(range, compareWith);
    Promise.allSettled([
      fetch(`/api/shopify/dashboard?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch("/api/shopify/anomalies").then(r => r.json()),
      compRange ? fetch(`/api/shopify/dashboard?from=${compRange.from}&to=${compRange.to}`).then(r => r.json()) : Promise.resolve(null),
      fetch(`/api/meta?from=${range.from}&to=${range.to}`).then(r => r.json()),
      compRange ? fetch(`/api/meta?from=${compRange.from}&to=${compRange.to}`).then(r => r.json()) : Promise.resolve(null),
      fetch(`/api/gsc?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/ga4?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/google/ads?from=${range.from}&to=${range.to}`).then(r => r.json()),
      compRange ? fetch(`/api/google/ads?from=${compRange.from}&to=${compRange.to}`).then(r => r.json()) : Promise.resolve(null),
    ]).then(results => {
      if (stale) return;
      const [shopRes, anomRes, compRes, metaRes, compMetaRes, gscRes, ga4Res, gadsRes, compGadsRes] = results;
      const ok = (r: PromiseSettledResult<any>) => (r.status === "fulfilled" && r.value && !r.value.error ? r.value : null); // eslint-disable-line @typescript-eslint/no-explicit-any
      const s = ok(shopRes), m = ok(metaRes), sc = ok(gscRes), an = ok(ga4Res);
      const g = readGadsResponse(gadsRes.status === "fulfilled" ? gadsRes.value : null);
      if (s) setShop(s);
      if (ok(anomRes)) setAnomalies(anomRes.status === "fulfilled" ? anomRes.value : null);
      if (ok(compRes)) setCompShop(ok(compRes));
      if (m) { setMeta(m.kpis ?? null); setMetaDaily(m.daily ?? []); setCampaigns(m.campaigns ?? []); }
      if (ok(compMetaRes)) setCompMeta(ok(compMetaRes).kpis ?? null);
      if (sc) { setGsc(sc.kpis ?? null); setGscKeywords(sc.keywords ?? []); }
      if (an) { setGa4(an.kpis ?? null); setGa4Ecom(an.ecommerce ?? null); setGa4Channels(an.channels ?? []); }
      if (g.data) { setGads(g.data.kpis); setGadsDaily(g.data.daily); setGadsCampaigns(g.data.campaigns); }
      setGadsIssue(g.issue);
      if (compGadsRes.status === "fulfilled" && compGadsRes.value) setCompGads(readGadsResponse(compGadsRes.value).data?.kpis ?? null);
      setConnections({ shopify: !!s, meta: !!m, gads: !!g.data, gsc: !!sc, ga4: !!an });
    }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [range.from, range.to, compareWith, rangeReady]);

  // Google Search Console finalises data 2-3 days late, so "today" is always empty there.
  // For a recent range, the glance card shows the latest 7 FINAL days instead (labelled).
  const [gscRecent, setGscRecent] = useState<(GscKPIs & { from: string; to: string }) | null>(null);
  useEffect(() => {
    if (!rangeReady) return;
    const week = gscFinalWeek();
    if (range.to <= week.to) { setGscRecent(null); return; }
    let stale = false;
    fetch(`/api/gsc?from=${week.from}&to=${week.to}`).then(r => r.json())
      .then(d => { if (!stale) setGscRecent(!d?.error && d.kpis ? { ...d.kpis, ...week } : null); })
      .catch(() => { if (!stale) setGscRecent(null); });
    return () => { stale = true; };
  }, [range.to, rangeReady]);

  /* ── Derived ── */
  const shopName = shop?.shop?.replace(".myshopify.com", "") ?? "";
  const days = shop?.period.days ?? 1;
  const k = shop?.kpis;
  const codPct = k ? Math.round((k.codOrders / Math.max(k.totalOrders, 1)) * 100) : 0;
  const totalSpend = (meta?.spend ?? 0) + (gads?.spend ?? 0);
  const liveCount = [connections.shopify, connections.meta, connections.gsc, connections.ga4, connections.gads].filter(Boolean).length;
  const compLabel = getComparisonRange(range, compareWith)?.label ?? "prev";

  // GSC reports finalise ~2-3 days late, so a recent window legitimately reads 0
  // even when GA4 shows traffic. Flag it so a bare "0" doesn't look broken.
  const gscRecentLag = useMemo(() => range.to > gscFinalWeek().to, [range.to]);
  const gscPending = !!gsc && gsc.clicks === 0 && gscRecentLag;

  const pct = (curr: number, prev?: number) => (!prev ? undefined : +((curr - prev) / prev * 100).toFixed(0));
  const salesChange = pct(k?.grossSales ?? 0, compShop?.kpis.grossSales);
  const ordersChange = pct(k?.totalOrders ?? 0, compShop?.kpis.totalOrders);
  // Only compare spend when both periods cover the same platforms, or a failed load reads as a swing.
  const spendComparable = (!meta || !!compMeta) && (!gads || !!compGads);
  const spendChange = spendComparable ? pct(totalSpend, (compMeta?.spend ?? 0) + (compGads?.spend ?? 0)) : undefined;

  // Objective buckets (judge each by its own KPI)
  const sales = useMemo(() => bucketFor(campaigns, "SALES"), [campaigns]);
  const leadsB = useMemo(() => bucketFor(campaigns, "LEADS"), [campaigns]);
  const awareness = useMemo(() => bucketFor(campaigns, "AWARENESS"), [campaigns]);
  const traffic = useMemo(() => bucketFor(campaigns, "TRAFFIC"), [campaigns]);
  const activeObjs = useMemo(() => (["SALES", "LEADS", "TRAFFIC", "AWARENESS", "ENGAGEMENT", "OTHER"] as Obj[])
    .map(o => bucketFor(campaigns, o)).filter(b => b.count > 0 && b.spend > 0), [campaigns]);

  // COD-adjusted cash
  const prepaidRev = k?.prepaidRevenue ?? (k ? Math.round(k.aov * k.prepaidOrders) : 0);
  const codRev = k?.codRevenue ?? (k ? Math.round(k.aov * k.codOrders) : 0);

  // Sparkline series for KPI cards
  const revSpark = shop?.dailyRevenue.map(d => d.revenue) ?? [];
  const ordersSpark = shop?.dailyRevenue.map(d => d.orders ?? 0) ?? [];
  const spendSpark = useMemo(() => {
    const byDate = new Map<string, number>();
    [...metaDaily, ...gadsDaily].forEach(d => byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.spend));
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [metaDaily, gadsDaily]);

  // Donut / gauge data
  const metaSalesV = meta?.purchaseValue ?? 0;
  const gSalesV = gads?.conversionValue ?? 0;
  const organicSalesV = Math.max(0, (k?.grossSales ?? 0) - metaSalesV - gSalesV);
  const channelSegments = [
    { label: "Organic / Direct", value: organicSalesV, color: "#22C55E" },
    { label: "Meta Ads", value: metaSalesV, color: "#3B82F6" },
    ...(gSalesV > 0 ? [{ label: "Google Ads", value: gSalesV, color: "#EAB308" }] : []),
  ];
  const paySegments = [
    { label: "Prepaid (cash now)", value: prepaidRev, color: "#F97316" },
    { label: "COD (pending)", value: codRev, color: "#94A3B8" },
  ];
  // The goal is monthly, so it's measured against month-to-date sales, whatever range is picked above.
  const monthSales = anomalies?.summary.grossSales ?? null;
  const goalPct = salesTarget > 0 && monthSales !== null ? Math.round((monthSales / salesTarget) * 100) : null;
  const monthDates = anomalies?.period ? formatDateSpan(anomalies.period.from, anomalies.period.to) : "this month";

  // Sales ads across Meta and Google. Google's value comes from its own conversion tracking.
  const gSpend = gads?.spend ?? 0;
  const adSpendForSales = sales.spend + gSpend;
  const adSalesValue = sales.purchaseValue + gSalesV;
  const salesRoasAll = adSpendForSales > 0 ? +(adSalesValue / adSpendForSales).toFixed(2) : 0;

  // Cost model: Shopify's product cost wins over the typed-in one; other costs from Financial P&L
  // (same defaults that page uses when nothing is saved).
  const cost = useMemo<CostModel | null>(() => {
    if (shopCogsPerOrder === null) return savedCost;
    const base = savedCost ?? { cogsPerOrder: 0, shippingPerOrder: 0, rtoRate: 25, rtoCostPerOrder: 80, gatewayPct: 2, codFeePct: 1.5 };
    return { ...base, cogsPerOrder: shopCogsPerOrder };
  }, [savedCost, shopCogsPerOrder]);

  // Break-even ROAS + unit economics from the cost model
  const econ = useMemo(() => {
    if (!k || !cost || k.aov <= 0) return null;
    const feePct = (codPct / 100) * (cost.codFeePct / 100) + (1 - codPct / 100) * (cost.gatewayPct / 100);
    const rtoPerOrder = (codPct / 100) * (cost.rtoRate / 100) * cost.rtoCostPerOrder;
    const contribution = k.aov - cost.cogsPerOrder - cost.shippingPerOrder - (k.aov * feePct) - rtoPerOrder;
    const margin = contribution / k.aov;
    const breakEvenRoas = margin > 0 ? +(1 / margin).toFixed(2) : null;
    return { contribution: Math.round(contribution), margin, breakEvenRoas };
  }, [k, cost, codPct]);
  const configured = !!cost && (cost.cogsPerOrder > 0 || cost.shippingPerOrder > 0);

  const blendedCAC = (k?.newCustomers ?? 0) > 0 ? Math.round(totalSpend / k!.newCustomers) : 0;
  const ltvEst = k ? Math.round(k.aov * 2) : 0; // est. (AOV × 2), consistent with Financial page

  // GSC near-page-1 opportunity
  const gscOpp = useMemo(() => {
    const near = gscKeywords.filter(q => q.position > 10 && q.position <= 15 && q.impressions >= 20);
    const extraClicks = Math.round(near.reduce((s, q) => s + q.impressions * Math.max(0, 0.03 - q.ctr / 100), 0));
    return { count: near.length, extraClicks };
  }, [gscKeywords]);

  // Lead mix + pipeline estimate
  const lt = meta?.leadsByType;
  const totalLeads = meta?.leads ?? 0;
  const waLeads = lt?.messaging ?? 0;
  const formLeads = lt?.form ?? 0;
  const waPct = totalLeads > 0 ? Math.round((waLeads / totalLeads) * 100) : 0;
  const pipelineEst = k ? Math.round(totalLeads * ASSUMED_LEAD_CONV * k.aov) : 0;

  // Run-rate / pace
  const dailyRunRate = k ? Math.round(k.grossSales / Math.max(days, 1)) : 0;
  const today = new Date();
  const daysLeftInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate();
  const neededPerDay = salesTarget > 0 && monthSales !== null ? Math.max(0, Math.round((salesTarget - monthSales) / Math.max(daysLeftInMonth, 1))) : 0;

  // Google campaigns worth acting on. Paused ones can't be paused again, so they're left out.
  const gLive = useMemo(() => gadsCampaigns.filter(c => c.status !== "PAUSED" && c.spend > 0), [gadsCampaigns]);
  const gHasConversions = (gads?.conversions ?? 0) > 0;
  const gDead = useMemo(() => (gHasConversions ? gLive.filter(c => c.conversions === 0 && c.spend >= 300) : []), [gLive, gHasConversions]);
  const gLosing = useMemo(() => gLive.filter(c => c.conversionValue > 0 && c.roas < 1), [gLive]);
  const gWinners = useMemo(() => {
    const bar = Math.max((econ?.breakEvenRoas ?? ROAS_TARGET) * 1.3, ROAS_TARGET);
    return gLive.filter(c => c.roas >= bar && c.spend >= 1000).sort((a, b) => b.roas - a.roas);
  }, [gLive, econ]);

  /* ── Combined chart ── */
  const chartData = useMemo(() => {
    if (!shop) return [];
    return shop.dailyRevenue.map(d => {
      // Join on the canonical YYYY-MM-DD `date` (all three sources share it).
      // The old "M/D" match silently failed on leading zeros ("06/12" ≠ "6/12"),
      // so ad spend always rendered as a flat 0 line.
      const md = metaDaily.find(m => m.date === d.date);
      const gd = gadsDaily.find(g => g.date === d.date);
      return { day: d.date ? shortDay(d.date) : d.day, revenue: d.revenue, spend: (md?.spend ?? 0) + (gd?.spend ?? 0) };
    });
  }, [shop, metaDaily, gadsDaily]);

  /* ── Single-source conversion funnels ── one platform at a time, no stitching.
        Each funnel is built ONLY from its own platform's tracked numbers so a
        store owner always knows exactly which source they're reading. ── */
  const funnels = useMemo(() => {
    const inr = (n: number) => formatINR(n);
    const cnt = (n: number) => n.toLocaleString("en-IN");

    // Meta - the ad funnel, all Meta-tracked
    const metaSteps = meta ? [
      { label: "Impressions", value: meta.impressions, display: cnt(meta.impressions) },
      { label: "Link Clicks", value: meta.clicks, display: cnt(meta.clicks) },
      { label: "Landing Page Views", value: meta.lpv, display: cnt(meta.lpv) },
      { label: "Add to Cart", value: meta.atc, display: cnt(meta.atc) },
      { label: "Checkout", value: meta.checkout, display: cnt(meta.checkout) },
      { label: "Purchases", value: meta.purchases, display: cnt(meta.purchases) },
    ].filter(s => s.value > 0) : [];

    // Google Ads - Google's own numbers. "Conversions" is whatever goals the account counts.
    const googleSteps = gads ? [
      { label: "Impressions", value: gads.impressions, display: cnt(gads.impressions) },
      { label: "Clicks", value: gads.clicks, display: cnt(gads.clicks) },
      { label: "Conversions", value: gads.conversions, display: cnt(gads.conversions) },
    ].filter(s => s.value > 0) : [];

    // GA4 - the on-site ecommerce funnel (needs ecommerce events configured)
    const ga4Steps = ga4 && ga4Ecom ? [
      { label: "Sessions", value: ga4.sessions, display: cnt(ga4.sessions) },
      { label: "Product Views", value: ga4Ecom.itemsViewed, display: cnt(ga4Ecom.itemsViewed) },
      { label: "Add to Cart", value: ga4Ecom.itemsAddedToCart, display: cnt(ga4Ecom.itemsAddedToCart) },
      { label: "Reached Checkout", value: ga4Ecom.itemsCheckedOut, display: cnt(ga4Ecom.itemsCheckedOut) },
      { label: "Purchased", value: ga4Ecom.itemsPurchased, display: cnt(ga4Ecom.itemsPurchased) },
    ].filter(s => s.value > 0) : [];

    // Shopify - the revenue / cash funnel (gross → net → real cash now)
    const discounts = k?.totalDiscounts ?? 0;
    const returns = k?.refundedRevenue ?? 0;
    const afterDisc = Math.max(0, (k?.grossSales ?? 0) - discounts);
    const net = Math.max(0, (k?.grossSales ?? 0) - returns);
    const shopSteps = k ? [
      { label: "Gross Sales", value: k.grossSales, display: inr(k.grossSales) },
      ...(discounts > 0 ? [{ label: "After Discounts", value: afterDisc, display: inr(afterDisc) }] : []),
      ...(returns > 0 ? [{ label: "Net of Returns", value: net, display: inr(net) }] : []),
      { label: "Prepaid Cash Now", value: prepaidRev, display: inr(prepaidRev) },
    ].filter(s => s.value > 0) : [];

    const diag: Record<string, string> = {
      // Meta
      "Link Clicks→Landing Page Views": "Clicks aren't loading the page - a site-speed / broken-link problem, not targeting.",
      "Landing Page Views→Add to Cart": "People land but don't add to cart - the landing page / offer isn't convincing. Fix the page, not the ads.",
      "Add to Cart→Checkout": "Cart abandons before checkout - likely shipping-cost shock or a clunky cart. Show shipping early.",
      "Checkout→Purchases": "Checkout started but not completed - payment / COD friction. Offer prepaid incentives.",
      // GA4
      "Product Views→Add to Cart": "Visitors view products but don't add to cart - price, photos or trust signals on the product page need work.",
      "Add to Cart→Reached Checkout": "Carts abandon before checkout - surface shipping cost and a clear CTA earlier.",
      "Reached Checkout→Purchased": "Checkout drop-off - simplify the form and reduce payment friction.",
      // Shopify
      "Gross Sales→Prepaid Cash Now": "A large share of sales is COD - cash is pending and carries RTO risk. A prepaid discount shifts the mix.",
      "Net of Returns→Prepaid Cash Now": "Most collected revenue is still COD (pending). Nudge prepaid to protect cash flow.",
    };

    const build = (steps: { label: string; value: number; display: string }[], unit: "count" | "inr") => {
      let worst = { from: "", to: "", dropPct: 0 };
      for (let i = 1; i < steps.length; i++) {
        const prev = steps[i - 1].value, cur = steps[i].value;
        if (prev > 0 && cur <= prev) {
          const drop = Math.round((1 - cur / prev) * 100);
          if (drop > worst.dropPct) worst = { from: steps[i - 1].label, to: steps[i].label, dropPct: drop };
        }
      }
      return { steps, worst, diagnosis: diag[`${worst.from}→${worst.to}`] ?? "", available: steps.length >= 2, unit };
    };

    // Almost nobody clicks an ad, so impressions to clicks is always the biggest drop and says
    // nothing. What the owner can act on is what clicks turn into.
    const google = build(googleSteps, "count");
    if (gads && gads.clicks > 0 && gads.conversions > 0) {
      const rate = (gads.conversions / gads.clicks) * 100;
      google.worst = { from: "Clicks", to: "Conversions", dropPct: Math.round(100 - rate) };
      google.diagnosis = rate < 1
        ? `Only ${rate.toFixed(1)} in 100 clicks convert. Check the landing page and the search terms in Google Ads before spending more.`
        : "";
    }

    return {
      meta: build(metaSteps, "count"),
      google,
      ga4: build(ga4Steps, "count"),
      shopify: build(shopSteps, "inr"),
    };
  }, [meta, gads, ga4, ga4Ecom, k, prepaidRev]);

  // Keep the selected source on something that actually has data.
  useEffect(() => {
    const order = ["meta", "google", "ga4", "shopify"] as const;
    if (!funnels[funnelSrc].available) {
      const first = order.find(s => funnels[s].available);
      if (first && first !== funnelSrc) setFunnelSrc(first);
    }
  }, [funnels, funnelSrc]);

  const funnel = funnels[funnelSrc];
  const anyFunnel = funnels.meta.available || funnels.google.available || funnels.ga4.available || funnels.shopify.available;
  const FUNNEL_SRC_META: Record<"meta" | "google" | "ga4" | "shopify", { label: string; sub: string }> = {
    meta: { label: "Meta", sub: "Meta-tracked ad funnel - impressions to purchase" },
    google: { label: "Google", sub: "Google Ads funnel - impressions to the conversions your account counts" },
    ga4: { label: "GA4", sub: "On-site behaviour - sessions to purchase" },
    shopify: { label: "Shopify", sub: "Revenue funnel - gross sales to real cash collected" },
  };

  /* ── Cross-platform alerts ── */
  const alerts = useMemo(() => {
    const out: { sev: "danger" | "warning" | "positive"; title: string; body: string }[] = [];
    if (totalSpend > 0 && spendChange !== undefined && spendChange >= 25 && (ordersChange ?? 0) <= 5) {
      out.push({ sev: "danger", title: `Ad spend up ${spendChange}% but orders flat`, body: "Spend rose sharply without more orders - likely a tracking break or a landing-page issue. Check the Meta pixel, your Google conversion tag and your top campaign's landing page." });
    }
    if (meta && sales.count > 0 && meta.spend > 0 && meta.purchaseValue === 0) {
      out.push({ sev: "danger", title: `₹${meta.spend.toLocaleString("en-IN")} spent on Meta, ₹0 tracked revenue`, body: "A sales campaign is spending but recording no revenue - almost always a broken/ missing purchase pixel. Verify the Meta pixel fires on order confirmation." });
    }
    if (gads && gads.spend >= 500 && gads.conversions === 0) {
      // Google can credit a conversion to the click's day hours later, so a day or two isn't proof yet.
      const short = rangeDays(range) < 3;
      out.push({ sev: short ? "warning" : "danger", title: `${formatINR(gads.spend)} on Google Ads, 0 conversions`, body: short
        ? "Google can report conversions a few hours late, so check again tomorrow. If it's still 0, test your conversion tag in Google Ads."
        : "Either these ads aren't bringing buyers or your conversion tag isn't firing. Check Goals > Conversions in Google Ads first." });
    }
    if (gads && gads.conversionValue > 0) {
      const floor = econ?.breakEvenRoas ?? ROAS_MIN;
      if (gads.roas < floor) out.push({ sev: "warning", title: `Google Ads ROAS ${gads.roas}x - below ${floor}x`, body: econ?.breakEvenRoas ? "At your margins these ads lose money. Open Recommendations under Google Ads to see which campaigns to fix first." : "Under 2x usually loses money once product costs are paid. Open Recommendations under Google Ads to see which campaigns to fix first." });
    }
    if (codPct > 60 && k) out.push({ sev: "warning", title: `COD at ${codPct}% - cash & RTO risk`, body: `Only ${formatINR(prepaidRev)} is collected up front; ${formatINR(codRev)} is COD (pending + return risk). Offer a ₹75–100 prepaid discount to shift the mix.` });
    if (meta && meta.frequency >= 3) out.push({ sev: "warning", title: `Ad frequency at ${meta.frequency}x - fatigue incoming`, body: "Audience is seeing the same ads too often; CPM/CPL will rise in 2–3 days. Refresh creative or widen the audience now." });
    if (anomalies && anomalies.summary.repeatRate < 20 && anomalies.summary.repeatRate > 0) {
      out.push({ sev: "warning", title: `Repeat rate ${anomalies.summary.repeatRate}% vs 20% benchmark`, body: "Most customers don't come back. Set up a win-back email/WhatsApp flow for past buyers - cheapest revenue you have." });
    }
    (anomalies?.critical ?? []).forEach(a => out.push({ sev: "danger", title: a.title, body: a.desc }));
    return out.sort((a, b) => ({ danger: 0, warning: 1, positive: 2 }[a.sev] - { danger: 0, warning: 1, positive: 2 }[b.sev]));
  }, [meta, gads, econ, range, totalSpend, spendChange, ordersChange, sales.count, codPct, k, prepaidRev, codRev, anomalies]);

  /* ── AI insights (computed, sharp) ── */
  const insights = useMemo(() => {
    const list: { type: "positive" | "warning" | "danger"; title: string; body: string }[] = [];
    if (sales.count > 0 && sales.spend > 0) {
      const be = econ?.breakEvenRoas;
      if (be && sales.roas >= be) list.push({ type: "positive", title: `Sales ROAS ${sales.roas}x - above your ${be}x break-even`, body: `Every ₹1 on sales ads returns ₹${sales.roas}. You have room to scale - push budget 20–30% on the best campaigns.` });
      else if (be) list.push({ type: "danger", title: `Sales ROAS ${sales.roas}x - below your ${be}x break-even`, body: `At your margins you need ${be}x just to break even. Pause the lowest-ROAS sales campaigns and fix the biggest funnel drop before scaling.` });
      else list.push({ type: sales.roas >= 3 ? "positive" : "warning", title: `Sales ROAS ${sales.roas}x`, body: configured ? "" : "Set your costs in Financial P&L to see your real break-even ROAS." });
    }
    if (gads && gads.spend > 0 && gads.conversionValue > 0) {
      const be = econ?.breakEvenRoas;
      const good = gads.roas >= (be ?? ROAS_TARGET);
      list.push({ type: good ? "positive" : be ? "danger" : "warning", title: `Google Ads ROAS ${gads.roas}x${be ? ` vs your ${be}x break-even` : ""}`, body: gWinners.length ? `"${gWinners[0].name}" leads at ${gWinners[0].roas}x. It has room for more budget.` : good ? "Google Ads is paying back. Check Recommendations under Google Ads before you raise budgets." : `Every ₹1 returns ₹${gads.roas}. Fix the weakest campaigns before raising budgets.` });
    } else if (gads && gads.conversions > 0 && gads.conversionValue === 0) {
      list.push({ type: "warning", title: `${gads.conversions} Google conversions, ₹0 value recorded`, body: "Google counts these but has no sale value for them, so ROAS can't be judged. Add a value to your purchase conversion, or this is lead tracking only." });
    }
    if (leadsB.count > 0 && totalLeads > 0 && waPct > 0 && waPct < 50) {
      list.push({ type: "warning", title: `${100 - waPct}% of leads are forms, ${waPct}% WhatsApp`, body: "WhatsApp/chat leads usually convert higher and drop off less. Shift creative CTAs to click-to-WhatsApp to lift lead quality." });
    }
    if (gscOpp.count >= 2) list.push({ type: "positive", title: `${gscOpp.count} keywords on the cusp of page 1`, body: `Sitting at position 11–15 with demand. One content/link push ≈ +${gscOpp.extraClicks} clicks/period at 3% CTR - the cheapest acquisition you have right now.` });
    if (k && codPct > 55) list.push({ type: "warning", title: `COD ${codPct}% - real cash is ${formatINR(prepaidRev)}, not ${formatINR(k.grossSales)}`, body: "COD ties up cash and carries RTO risk. A small prepaid incentive shifts behaviour and protects margin." });
    const order = { danger: 0, warning: 1, positive: 2 } as const;
    return list.filter(x => x.body).sort((a, b) => order[a.type] - order[b.type]).slice(0, 5);
  }, [sales, gads, gWinners, leadsB.count, totalLeads, waPct, gscOpp, k, codPct, prepaidRev, econ, configured]);

  /* ── Priority actions (₹-ranked) ── */
  const actions = useMemo(() => {
    const out: { impact: number; text: string; source: string }[] = [];
    // Fatigued / losing sales campaigns
    const losing = campaigns.filter(c => normObj(c.objective) === "SALES" && c.spend > 0 && c.roas > 0 && c.roas < 1);
    if (losing.length) {
      const waste = Math.round(losing.reduce((s, c) => s + c.spend, 0));
      out.push({ impact: waste, text: `Pause ${losing.length} sales campaign${losing.length > 1 ? "s" : ""} running below 1x ROAS (e.g. "${losing[0].name}")`, source: "Meta" });
    }
    if (gDead.length) {
      const waste = Math.round(gDead.reduce((s, c) => s + c.spend, 0));
      out.push({ impact: waste, text: `Review ${gDead.length} Google campaign${gDead.length > 1 ? "s" : ""} with spend but no conversions (biggest: "${[...gDead].sort((a, b) => b.spend - a.spend)[0].name}")`, source: "Google Ads" });
    }
    if (gLosing.length) {
      const loss = Math.round(gLosing.reduce((s, c) => s + (c.spend - c.conversionValue), 0));
      out.push({ impact: loss, text: `Fix or pause ${gLosing.length} Google campaign${gLosing.length > 1 ? "s" : ""} running below 1x ROAS (e.g. "${gLosing[0].name}")`, source: "Google Ads" });
    }
    if (gWinners.length) {
      const w = gWinners[0];
      out.push({ impact: Math.round(w.spend * 0.2 * w.roas), text: `Raise "${w.name}" budget by 20% - it returns ${w.roas}x on Google`, source: "Google Ads" });
    }
    const fatigued = campaigns.filter(c => c.frequency >= 3.5 && c.spend > 0);
    if (fatigued.length) out.push({ impact: Math.round(fatigued.reduce((s, c) => s + c.spend, 0) * 0.2), text: `Refresh creative on ${fatigued.length} fatigued campaign${fatigued.length > 1 ? "s" : ""} (freq ≥ 3.5) before CPL rises`, source: "Meta" });
    // Prepaid shift
    if (k && codPct > 50 && cost) {
      const rtoSave = Math.round(k.codOrders * (cost.rtoRate / 100) * cost.rtoCostPerOrder);
      if (rtoSave > 0) out.push({ impact: rtoSave, text: `Add a ₹75 prepaid discount - at ${codPct}% COD this could save ~${formatINR(rtoSave)} in RTO losses`, source: "Shopify + costs" });
    }
    // GSC content
    if (gscOpp.count >= 2 && k) {
      const val = Math.round(gscOpp.extraClicks * 0.02 * k.aov);
      out.push({ impact: val, text: `Improve content/links on ${gscOpp.count} keywords at position 11–15 → est. ${formatINR(val)} from +${gscOpp.extraClicks} organic clicks`, source: "GSC" });
    }
    // Lead pipeline / WhatsApp
    if (leadsB.count > 0 && pipelineEst > 0) out.push({ impact: Math.round(pipelineEst * 0.25), text: `Follow up ${totalLeads} leads fast - est. ${formatINR(pipelineEst)} pipeline (${totalLeads}×${Math.round(ASSUMED_LEAD_CONV * 100)}%×AOV); shift CTAs to WhatsApp to lift conversion`, source: "Meta + Shopify (est.)" });
    return out.sort((a, b) => b.impact - a.impact).slice(0, 5);
  }, [campaigns, gDead, gLosing, gWinners, k, codPct, cost, gscOpp, leadsB.count, pipelineEst, totalLeads]);

  const platforms = [
    { label: "Shopify", connected: connections.shopify },
    { label: "Meta Ads", connected: connections.meta },
    { label: "GSC", connected: connections.gsc },
    { label: "GA4", connected: connections.ga4 },
    { label: "Google Ads", connected: connections.gads },
  ];

  function askAI(q = chatQ) {
    if (q.trim()) { try { sessionStorage.setItem("skylitee-chat-prefill", q.trim()); } catch { /* ignore */ } }
    router.push("/dashboard/chat");
  }

  /* ── Plain-language report for the Simple view ── */
  const plain = useMemo(() => buildPlainReport({
    periodLabel: (() => {
      if (range.preset === "custom") return `the period ${range.label}`;
      const l = (range.label ?? "").toLowerCase();
      if (["today", "yesterday", "this month", "last month"].includes(l)) return l;
      return l.startsWith("last ") ? `the ${l}` : "this period";
    })(),
    storeHandle: shopName || undefined,
    shop: k ? {
      sales: k.grossSales, orders: k.totalOrders, aov: k.aov, codOrders: k.codOrders,
      prepaidRevenue: prepaidRev, codRevenue: codRev, newCustomers: k.newCustomers,
    } : null,
    salesChangePct: salesChange,
    repeatRate: anomalies && anomalies.summary.repeatRate > 0 ? anomalies.summary.repeatRate : null,
    meta: meta ? { spend: meta.spend, purchaseValue: meta.purchaseValue, leads: meta.leads, clicks: meta.clicks, impressions: meta.impressions, frequency: meta.frequency } : null,
    campaigns: campaigns.map(c => ({ name: c.name, objective: c.objective, spend: c.spend, purchases: c.purchases, purchaseValue: c.purchaseValue, leads: c.leads, clicks: c.clicks, impressions: c.impressions, frequency: c.frequency })),
    gads: gads ? { spend: gads.spend, conversionValue: gads.conversionValue, conversions: gads.conversions, clicks: gads.clicks, impressions: gads.impressions } : null,
    gadsCampaigns: gLive.map(c => ({ name: c.name, spend: c.spend, conversions: c.conversions, conversionValue: c.conversionValue })),
    gsc: gsc ? { avgPosition: gsc.avgPosition, nearPage1: gscOpp.count, extraClicks: gscOpp.extraClicks, pending: gscPending } : null,
    connected: { meta: connections.meta, google: connections.gsc || connections.ga4 || connections.gads || !!gadsIssue },
    breakEvenRoas: econ?.breakEvenRoas ?? null,
    costsSet: configured,
    rto: cost ? { rate: cost.rtoRate, costPerOrder: cost.rtoCostPerOrder } : null,
  }), [range.label, range.preset, shopName, k, prepaidRev, codRev, salesChange, anomalies, meta, campaigns, gads, gLive, gadsIssue, gsc, gscOpp, gscPending, connections, econ, configured, cost]);

  /* ── "At a glance" chart data for the Simple view ── */
  const glance = useMemo<GlanceData>(() => {
    // Today vs a FULL yesterday isn't like-for-like - say so in the label.
    const compDates = getComparisonRange(range, compareWith);
    const cmpWord = range.preset === "today" && compareWith === "prev_period" ? "Yesterday, full day" : `vs ${compLabel}`;
    const cmp = compDates ? `${cmpWord} (${formatDateSpan(compDates.from, compDates.to)})` : cmpWord;
    // GSC: use the period's own numbers when they exist, else the latest 7 final days.
    const gscUse = gsc && !gscPending ? { ...gsc, note: undefined as string | undefined }
      : gscRecent ? { ...gscRecent, note: `Search: ${formatDateSpan(gscRecent.from, gscRecent.to)} (Google is 2-3 days late)` } : null;
    return {
      periodLabel: range.label,
      periodText: rangeText(range),
      periodDates: formatDateSpan(range.from, range.to),
      compLabel: cmp,
      shop: k ? { sales: k.grossSales, orders: k.totalOrders, aov: k.aov, prepaidRevenue: prepaidRev, codRevenue: codRev, prepaidOrders: k.prepaidOrders, codOrders: k.codOrders } : null,
      compShop: compShop ? { sales: compShop.kpis.grossSales, orders: compShop.kpis.totalOrders } : null,
      meta: meta ? { spend: meta.spend, clicks: meta.clicks, purchases: meta.purchases, purchaseValue: meta.purchaseValue, leads: meta.leads } : null,
      gads: gads ? { spend: gads.spend, clicks: gads.clicks ?? 0, conversions: gads.conversions, conversionValue: gads.conversionValue ?? 0 } : null,
      ga4: ga4 ? { users: ga4.users, sessions: ga4.sessions, bounceRate: ga4.bounceRate, channels: ga4Channels } : null,
      gsc: connections.gsc ? gscUse : null,
    };
  }, [range, compareWith, compLabel, gsc, gscPending, gscRecent, k, prepaidRev, codRev, compShop, meta, gads, ga4, ga4Channels, connections.gsc]);

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-bold text-[#18181B] dark:text-[#F4F4F5]">Command Center</h2>
            {loading ? (
              <span className="text-[14px] text-[#A1A1AA] flex items-center gap-1"><RefreshCw size={10} className="animate-spin" /> Loading…</span>
            ) : connections.shopify ? (
              <span className="flex items-center gap-1 text-[14px] text-[#EA580C] dark:text-[#FB923C] bg-[#FFF7ED] dark:bg-[#2A1A0E] px-2.5 py-0.5 rounded-full font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse" /> Live · {shopName}
              </span>
            ) : null}
          </div>
          <p className="text-[14px] text-[#A1A1AA] mt-0.5"><span className="font-semibold text-[#71717A] dark:text-[#A1A1AA]"><RangeText /></span> · {liveCount} of 5 platforms active</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-lg p-0.5 mr-1" role="group" aria-label="View">
            {(["simple", "expert"] as const).map(v => (
              <button key={v} onClick={() => switchView(v)}
                className={cn("px-3 py-1 rounded-md text-[13px] font-bold transition-colors",
                  view === v ? "bg-white dark:bg-[#2A2A2A] text-[#EA580C] shadow-sm" : "text-[#71717A] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#F4F4F5]")}>
                {v === "simple" ? "Simple" : "Expert"}
              </button>
            ))}
          </div>
          {view === "expert" && platforms.map(p => (
            <div key={p.label} className={cn("hidden sm:flex items-center gap-1 px-2 py-1 rounded-full text-[13px] font-semibold border",
              p.connected ? "bg-[#F5F5F4] dark:bg-[#1C1C1C] border-black/[0.06] dark:border-white/[0.06] text-[#52525B] dark:text-[#A1A1AA]" : "bg-white dark:bg-[#171717] border-black/[0.04] dark:border-white/[0.04] text-[#A1A1AA]")}>
              <span className={cn("w-1.5 h-1.5 rounded-full", p.connected ? "bg-[#22C55E]" : "bg-[#D4D4D4] dark:bg-[#525252]")} />
              {p.label}
            </div>
          ))}
        </div>
      </div>

      {view === "simple" ? (
        <SimpleView report={plain} glance={glance} loading={loading} onAsk={askAI} storeName={shopName} periodTitle={rangeText(range)} />
      ) : (<>
      {/* ── SECTION 1: Active Objectives Strip ── */}
      {(activeObjs.length > 0 || gSpend > 0) && (
        <div className="flex items-center gap-2 flex-wrap bg-white dark:bg-[#171717] rounded-2xl border border-black/[0.06] dark:border-white/[0.06] px-3 py-2.5">
          <span className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5]">You&apos;re running:</span>
          {activeObjs.map(b => {
            const m = OBJ_META[b.obj];
            const result = b.obj === "SALES" ? `${b.roas}x ROAS` : b.obj === "LEADS" ? `${b.leads} leads · ${formatINR(b.cpl)}/lead` : b.obj === "AWARENESS" ? `${(b.impressions / 1000).toFixed(0)}K impressions` : b.obj === "TRAFFIC" ? `${b.clicks.toLocaleString("en-IN")} clicks` : `${formatINR(b.spend)}`;
            return (
              <span key={b.obj} className={cn("inline-flex items-center gap-1.5 text-[14px] font-semibold px-2.5 py-1 rounded-full", m.chip)}>
                <m.icon size={12} /> {m.label} <span className="opacity-70">· {result}</span>
              </span>
            );
          })}
          {gads && gSpend > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold px-2.5 py-1 rounded-full bg-[#FEFCE8] text-[#A16207]">
              <Megaphone size={12} /> Google Ads <span className="opacity-70">· {gads.conversionValue > 0 ? `${gads.roas}x ROAS` : `${gads.conversions.toLocaleString("en-IN")} conversions`}</span>
            </span>
          )}
          <span className="text-[13px] text-[#A1A1AA] ml-auto hidden md:block">Each objective judged by its own KPI - not one blended number</span>
        </div>
      )}

      {/* ── SECTION 2: Objective-aware KPI cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <StatCard label="Gross Sales" value={k ? formatINR(k.grossSales) : "-"} spark={revSpark} sparkColor="#F97316"
          sub={k ? <>Avg <b>{formatINR(dailyRunRate)}</b>/day{salesTarget > 0 && monthSales !== null && <> · need <b className="text-[#EA580C]">{formatINR(neededPerDay)}</b>/day to hit this month&apos;s {formatINR(salesTarget)}</>}{salesChange !== undefined && <> · <span className={salesChange >= 0 ? "text-[#16A34A]" : "text-[#EF4444]"}>{salesChange >= 0 ? "+" : ""}{salesChange}% vs {compLabel}</span></>}</> : undefined} />

        {sales.count > 0 || gSpend > 0 || !leadsB.count ? (
          <StatCard label="Sales ROAS" value={adSpendForSales > 0 ? `${salesRoasAll}x` : "-"}
            tone={adSpendForSales === 0 ? "neutral" : econ?.breakEvenRoas ? (salesRoasAll >= econ.breakEvenRoas ? "good" : "bad") : (salesRoasAll >= 3 ? "good" : salesRoasAll >= 2 ? "warn" : "bad")}
            sub={adSpendForSales > 0 ? <>{sales.spend > 0 && gads && gSpend > 0 ? <>Meta {sales.roas}x · Google {gads.roas}x · </> : gSpend > 0 ? "Google Ads · " : ""}{econ?.breakEvenRoas ? <>break-even <b>{econ.breakEvenRoas}x</b> · </> : ""}{formatINR(adSpendForSales)} spend → {formatINR(adSalesValue)}</> : "No sales campaigns"} />
        ) : (
          <StatCard label="Cost / Lead" value={leadsB.leads > 0 ? formatINR(leadsB.cpl) : "-"} tone={leadsB.cpl > 0 && leadsB.cpl <= 200 ? "good" : "warn"}
            sub={<>{leadsB.leads} leads · {formatINR(leadsB.spend)} spend</>} />
        )}

        <StatCard label="Orders" value={k ? k.totalOrders.toString() : "-"} tone={codPct > 60 ? "warn" : "neutral"} spark={ordersSpark} sparkColor="#22C55E"
          sub={k ? <>{codPct}% COD · real cash <b>{formatINR(prepaidRev)}</b> not {formatINR(k.grossSales)}{ordersChange !== undefined && <> · <span className={ordersChange >= 0 ? "text-[#16A34A]" : "text-[#EF4444]"}>{ordersChange >= 0 ? "+" : ""}{ordersChange}%</span></>}</> : undefined} />

        <StatCard label="Total Ad Spend" value={totalSpend > 0 ? formatINR(totalSpend) : "-"} spark={spendSpark} sparkColor="#3B82F6"
          tone={meta && meta.spend > 0 && meta.purchaseValue === 0 && sales.count > 0 ? "bad" : "neutral"}
          sub={meta && meta.spend > 0 && meta.purchaseValue === 0 && sales.count > 0 ? <span className="text-[#EF4444] font-semibold">₹0 tracked on Meta - likely pixel issue</span>
            : meta || gads ? <>{meta && gads ? <>Meta {formatINR(meta.spend)} · Google {formatINR(gads.spend)}</> : meta ? "Meta" : "Google Ads"}{spendChange !== undefined && <> · <span className={spendChange > 25 ? "text-[#EF4444]" : "text-[#A1A1AA]"}>{spendChange >= 0 ? "+" : ""}{spendChange}% vs {compLabel}</span></>}</>
            : loading ? undefined : "Connect Meta or Google Ads"} />

        {leadsB.count > 0 ? (
          <StatCard label="Total Leads" value={totalLeads.toString()}
            sub={<>{waPct}% WhatsApp · {100 - waPct}% form · est. lead→order {Math.round(ASSUMED_LEAD_CONV * 100)}%</>} />
        ) : (
          <StatCard label="AOV" value={k ? formatINR(k.aov) : "-"} sub={k ? <>{k.newCustomers} new · {k.returningCustomers} returning</> : undefined} />
        )}

        <StatCard label={gsc ? "Search Clicks" : "New Customers"} value={gsc ? gsc.clicks.toLocaleString("en-IN") : (k?.newCustomers.toString() ?? "-")}
          sub={gsc ? (gscPending ? <span className="text-[#B45309] font-semibold">Search Console finalises ~2-3 days late - this window is too recent to report yet</span> : gscOpp.count > 0 ? <span className="text-[#16A34A] font-semibold">{gscOpp.count} keywords at pos 11–15 → ~+{gscOpp.extraClicks} clicks one push from page 1</span> : <>{gsc.ctr.toFixed(1)}% CTR · pos {gsc.avgPosition.toFixed(1)}</>) : (k ? "Connect GSC for search data" : undefined)} />
      </div>

      {/* ── Visual snapshot: channel mix · cash split · pace ── */}
      {k && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardHeader title="Revenue by channel" right={<span className="text-[13px] text-[#A1A1AA]">where sales come from</span>} />
            <Donut segments={channelSegments} centerValue={formatINR(k.grossSales)} centerLabel="total" />
          </Card>
          <Card>
            <CardHeader title="Cash collected" right={<span className="text-[13px] text-[#A1A1AA]">prepaid vs COD</span>} />
            <Donut segments={paySegments} centerValue={`${100 - codPct}%`} centerLabel="prepaid now" />
          </Card>
          <Card>
            <CardHeader title={salesTarget > 0 ? "Monthly goal pace" : "Month progress"} right={<span className="text-[13px] text-[#A1A1AA]">{salesTarget > 0 ? formatINR(salesTarget) : "this month"}</span>} />
            <div className="pt-2">
              <Gauge
                value={goalPct !== null ? Math.min(goalPct, 100) : Math.round(today.getDate() / new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() * 100)}
                color={goalPct !== null && goalPct >= 100 ? "#22C55E" : "#F97316"}
                centerValue={goalPct !== null ? `${goalPct}%` : undefined}
                centerLabel={salesTarget > 0 ? "of target" : "of month elapsed"}
              />
              {salesTarget > 0 && monthSales !== null && (
                <div className="text-center text-[13px] text-[#A1A1AA] mt-1">{formatINR(monthSales)} of {formatINR(salesTarget)} ({monthDates}){neededPerDay > 0 && <> · need {formatINR(neededPerDay)}/day</>}</div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ── SECTION 5: Objective Performance Panels ── */}
      {(sales.count > 0 || leadsB.count > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {sales.count > 0 && (
            <Card>
              <CardHeader title={<span className="flex items-center gap-1.5"><ShoppingCart size={14} className="text-[#EA580C]" /> Sales objective</span>} right={<span className="text-[13px] text-[#A1A1AA]">{sales.count} campaign{sales.count > 1 ? "s" : ""} · {formatINR(sales.spend)}</span>} />
              <div className="flex items-center gap-4">
                <div className="shrink-0">
                  <Gauge
                    value={Math.min(100, (sales.roas / (econ?.breakEvenRoas ? econ.breakEvenRoas * 2 : 4)) * 100)}
                    color={econ?.breakEvenRoas ? (sales.roas >= econ.breakEvenRoas ? "#22C55E" : "#EF4444") : "#F97316"}
                    centerValue={`${sales.roas}x`} centerLabel={econ?.breakEvenRoas ? `break-even ${econ.breakEvenRoas}x` : "ROAS"} size={120} />
                </div>
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <div><div className="text-[13px] text-[#A1A1AA]">CAC vs LTV</div><div className="text-[18px] font-black text-[#18181B] dark:text-[#F4F4F5]">{blendedCAC ? formatINR(blendedCAC) : "-"}</div><div className="text-[12px] text-[#A1A1AA]">LTV ~{formatINR(ltvEst)} (est.)</div></div>
                  <div><div className="text-[13px] text-[#A1A1AA]">Orders (Shopify)</div><div className="text-[18px] font-black text-[#18181B] dark:text-[#F4F4F5]">{sales.purchases}</div><div className="text-[12px] text-[#A1A1AA]">{formatINR(sales.purchaseValue)}</div></div>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-black/[0.05] dark:border-white/[0.05] text-[13px] text-[#71717A] dark:text-[#A1A1AA]">
                {econ?.breakEvenRoas && sales.roas >= econ.breakEvenRoas ? `Profitable - acquiring at ${formatINR(blendedCAC)} vs ~${formatINR(ltvEst)} LTV. Room to scale.` : econ?.breakEvenRoas ? `Below break-even (${econ.breakEvenRoas}x) - fix funnel/creative before scaling.` : "Add your costs (Financial P&L) to see real break-even ROAS & profit."}
              </div>
            </Card>
          )}
          {leadsB.count > 0 && (
            <Card>
              <CardHeader title={<span className="flex items-center gap-1.5"><Target size={14} className="text-[#15803D]" /> Leads objective</span>} right={<span className="text-[13px] text-[#A1A1AA]">{leadsB.count} campaign{leadsB.count > 1 ? "s" : ""} · {formatINR(leadsB.spend)}</span>} />
              <Donut
                segments={[{ label: "WhatsApp / chat", value: waLeads, color: "#22C55E" }, { label: "Form leads", value: formLeads, color: "#3B82F6" }]}
                centerValue={String(totalLeads)} centerLabel="leads" size={120} />
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div><div className="text-[13px] text-[#A1A1AA]">Cost / Lead</div><div className="text-[18px] font-black text-[#18181B] dark:text-[#F4F4F5]">{leadsB.leads > 0 ? formatINR(leadsB.cpl) : "-"}</div><div className="text-[12px] text-[#A1A1AA]">{leadsB.leads} leads</div></div>
                <div><div className="text-[13px] text-[#A1A1AA]">Pipeline (est.)</div><div className="text-[18px] font-black text-[#15803D]">{formatINR(pipelineEst)}</div><div className="text-[12px] text-[#A1A1AA]">{totalLeads}×{Math.round(ASSUMED_LEAD_CONV * 100)}%×AOV</div></div>
              </div>
              <div className="mt-2 pt-2 border-t border-black/[0.05] dark:border-white/[0.05] text-[13px] text-[#71717A] dark:text-[#A1A1AA]">
                {waPct < 50 ? "WhatsApp leads convert higher than forms - shift creative CTAs to click-to-WhatsApp." : "Strong WhatsApp lead share - keep nurturing chat leads fast (intent fades in hours)."}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── SECTION 3 + 4: Revenue chart + Platform snapshot ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="col-span-1 lg:col-span-2">
          <Card className="h-full">
            <CardHeader title="Revenue vs Ad Spend" right={<span className="flex items-center gap-3 text-[13px]">
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-[#F97316] inline-block" /> Revenue</span>
              {(connections.meta || connections.gads) && <span className="flex items-center gap-1"><span className="w-3 h-px rounded bg-[#94A3B8] inline-block border-b border-dashed border-[#94A3B8]" /> Ad Spend</span>}
            </span>} />
            {loading ? <div className="h-44 flex items-center justify-center text-[15px] text-[#A1A1AA]">Loading chart…</div>
              : chartData.length === 0 ? <div className="h-44 flex items-center justify-center text-[15px] text-[#A1A1AA]">No revenue data for this period</div>
              : (
                <ResponsiveContainer width="100%" height={176}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" strokeOpacity={0.4} vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#A1A1AA" }} tickLine={false} axisLine={false} interval={Math.floor(chartData.length / 6)} />
                    <YAxis hide />
                    <Tooltip contentStyle={{ fontSize: 12, border: "1px solid #E5E5E5", borderRadius: 12 }} formatter={(v, name) => [formatINR(Number(v)), name === "revenue" ? "Revenue" : "Ad Spend"]} />
                    <Bar dataKey="revenue" fill="#F97316" radius={[3, 3, 0, 0]} barSize={10} opacity={0.9} />
                    {(connections.meta || connections.gads) && <Line type="monotone" dataKey="spend" stroke="#94A3B8" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            <div className="mt-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 text-[14px] text-[#A1A1AA]"><TrendingUp size={12} className="text-[#F97316]" /> Month so far ({monthDates}) at this pace</div>
              <div className="flex items-center gap-3">
                {(k?.refundedRevenue ?? 0) > 0 && <span className="text-[14px] text-[#A1A1AA]">Returns: <b className="text-[#EF4444]">−{formatINR(k!.refundedRevenue!)}</b></span>}
                {anomalies && anomalies.summary.projectedMonthly > 0 && <span className="text-[15px] font-bold text-[#EA580C] dark:text-[#FB923C]">{formatINR(anomalies.summary.projectedMonthly)} projected for the month</span>}
              </div>
            </div>
          </Card>
        </div>

        {/* Platform snapshot - unique data per platform */}
        <Card>
          <CardHeader title="Platform Snapshot" />
          <div className="space-y-0">
            <PlatformRow name="Shopify" connected={connections.shopify}
              main={k ? formatINR(k.grossSales) : "-"} mainSub={k ? `${k.totalOrders} orders · AOV ${formatINR(k.aov)}` : ""}
              right={k ? `${codPct}% COD` : ""} rightSub={anomalies ? `repeat ${anomalies.summary.repeatRate}%${anomalies.summary.repeatRate < 20 ? " ⚠" : ""}` : ""} rightTone={codPct > 55 ? "warn" : "neutral"} />
            <PlatformRow name="Meta Ads" connected={connections.meta} connectHref="/dashboard/connections"
              main={meta ? formatINR(meta.spend) : "-"} mainSub={activeObjs.length ? activeObjs.map(b => `${OBJ_META[b.obj].label}`).join(" + ") : "spend"}
              right={sales.count > 0 ? `${sales.roas}x ROAS` : leadsB.count > 0 ? `${formatINR(leadsB.cpl)}/lead` : ""} rightSub={meta ? `freq ${meta.frequency}x${meta.frequency >= 3 ? " ⚠" : ""}` : ""} rightTone={meta && meta.frequency >= 3 ? "warn" : "neutral"} />
            {gads ? (
              <PlatformRow name="Google Ads" connected
                main={formatINR(gads.spend)} mainSub={`${gads.conversions.toLocaleString("en-IN")} conversions · ${gads.clicks.toLocaleString("en-IN")} clicks`}
                right={gads.conversionValue > 0 ? `${gads.roas}x ROAS` : ""} rightSub={gads.clicks > 0 ? `${formatINR(gads.avgCpc)} per click` : ""}
                rightTone={gads.conversionValue === 0 ? "neutral" : gads.roas >= (econ?.breakEvenRoas ?? ROAS_TARGET) ? "good" : "bad"} />
            ) : (
              <div className="py-3 border-b border-black/[0.06] dark:border-white/[0.06]">
                <div className="flex items-center gap-1.5 mb-1.5"><span className={cn("w-1.5 h-1.5 rounded-full", gadsIssue ? "bg-[#EAB308]" : "bg-[#D4D4D4]")} /><span className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5]">Google Ads</span></div>
                {gadsIssue ? (
                  <>
                    <div className="text-[13px] text-[#71717A] dark:text-[#A1A1AA] leading-snug">{gadsIssueText(gadsIssue)}</div>
                    {["no_customer_selected", "no_account_access"].includes(gadsIssue.kind) && <Link href="/dashboard/connections" className="text-[14px] text-[#F97316] font-semibold">Go to Connections →</Link>}
                  </>
                ) : !loading && <Link href="/dashboard/connections" className="text-[14px] text-[#F97316] font-semibold">Connect - you may be flying blind on spend here →</Link>}
              </div>
            )}
            <PlatformRow name="Search Console" connected={connections.gsc} connectHref="/dashboard/connections"
              main={gsc ? gsc.clicks.toLocaleString("en-IN") : "-"} mainSub={gscPending ? "lags 2-3 days - too recent" : gsc ? `${gsc.impressions.toLocaleString("en-IN")} impressions` : ""}
              right={gsc ? `pos ${gsc.avgPosition.toFixed(1)}` : ""} rightSub={gscOpp.count > 0 ? `${gscOpp.count} near page 1` : `${gsc?.ctr.toFixed(1) ?? "-"}% CTR`} rightTone={gscOpp.count > 0 ? "good" : "neutral"} />
            <PlatformRow name="Analytics GA4" connected={connections.ga4} connectHref="/dashboard/connections"
              main={ga4 ? ga4.sessions.toLocaleString("en-IN") : "-"} mainSub={ga4 ? `${ga4.users.toLocaleString("en-IN")} users` : ""}
              right={ga4 ? `${ga4.bounceRate.toFixed(0)}% bounce` : ""} rightSub={ga4?.avgSessionMin ?? ""} />
          </div>
        </Card>
      </div>

      {/* ── SECTION 6: Single-source conversion funnel (pick one platform) ── */}
      {anyFunnel && (
        <Card>
          <CardHeader
            title="Conversion Funnel"
            right={
              <div className="flex items-center gap-1 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-lg p-0.5">
                {(["meta", "google", "ga4", "shopify"] as const).map(src => {
                  const ok = funnels[src].available;
                  return (
                    <button
                      key={src}
                      onClick={() => ok && setFunnelSrc(src)}
                      disabled={!ok}
                      title={ok ? "" : `No ${FUNNEL_SRC_META[src].label} funnel data for this period`}
                      className={cn("px-2.5 py-1 rounded-md text-[13px] font-bold transition-colors",
                        funnelSrc === src ? "bg-white dark:bg-[#2A2A2A] text-[#EA580C] shadow-sm"
                          : ok ? "text-[#71717A] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#F4F4F5]"
                          : "text-[#D4D4D4] dark:text-[#3F3F46] cursor-not-allowed")}
                    >
                      {FUNNEL_SRC_META[src].label}
                    </button>
                  );
                })}
              </div>
            }
          />
          <p className="text-[13px] text-[#A1A1AA] -mt-1 mb-2">{FUNNEL_SRC_META[funnelSrc].sub}</p>
          <div className="space-y-1.5">
            {funnel.steps.map((s, i) => {
              const top = funnel.steps[0].value || 1;
              const widthPct = Math.max(4, Math.round((s.value / top) * 100));
              const prev = i > 0 ? funnel.steps[i - 1].value : null;
              const drop = prev && prev > 0 ? Math.round((1 - s.value / prev) * 100) : null;
              const isWorst = funnel.worst.to === s.label && funnel.worst.dropPct > 0;
              return (
                <div key={s.label} className="flex items-center gap-3">
                  <div className="w-36 text-[14px] text-[#52525B] dark:text-[#A1A1AA] shrink-0">{s.label}</div>
                  <div className="flex-1 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-lg h-6 relative overflow-hidden">
                    <div className={cn("h-full rounded-lg", isWorst ? "bg-[#EF4444]" : "bg-[#F97316]")} style={{ width: `${widthPct}%` }} />
                    <span className="absolute left-2 top-0 h-full flex items-center text-[13px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{s.display}</span>
                  </div>
                  <div className="w-16 text-right text-[13px] shrink-0">{drop !== null && <span className={drop >= 70 ? "text-[#EF4444] font-bold" : "text-[#A1A1AA]"}>−{drop}%</span>}</div>
                </div>
              );
            })}
          </div>
          {funnel.steps.length < 2 && (
            <div className="text-[14px] text-[#A1A1AA] py-3 text-center">No {FUNNEL_SRC_META[funnelSrc].label} funnel data for this period.{funnelSrc === "ga4" ? " (GA4 needs ecommerce events configured.)" : ""}</div>
          )}
          {funnel.diagnosis && (
            <div className="mt-3 rounded-xl bg-[#FEF2F2] dark:bg-[#2D0A0A] border-l-[3px] border-l-[#EF4444] p-3">
              <div className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5]">Biggest drop: {funnel.worst.dropPct}% between {funnel.worst.from} → {funnel.worst.to}</div>
              <div className="text-[13px] text-[#71717A] dark:text-[#A1A1AA] mt-0.5">{funnel.diagnosis}</div>
            </div>
          )}
        </Card>
      )}

      {/* ── SECTION 7 + 8 + 9: Alerts · AI Insights · Priority Actions ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Alerts */}
        <Card>
          <CardHeader title="Cross-Platform Alerts" right={alerts.length > 0 ? <span className="text-[13px] text-[#EF4444] font-bold bg-[#FEF2F2] px-2 py-0.5 rounded-full">{alerts.length}</span> : <span className="text-[13px] text-[#22C55E] font-bold bg-[#F0FDF4] px-2 py-0.5 rounded-full">All clear</span>} />
          {loading ? <div className="text-[14px] text-[#A1A1AA] py-4 text-center">Checking…</div>
            : alerts.length === 0 ? <div className="text-[14px] text-[#A1A1AA] py-4 text-center">No cross-platform issues detected</div>
            : <div className="space-y-2">{alerts.slice(0, 5).map((a, i) => (
                <div key={i} className="flex items-start gap-2.5 py-1">
                  <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", a.sev === "danger" ? "bg-[#FEF2F2] dark:bg-[#2D0A0A]" : "bg-[#FFFBEB] dark:bg-[#2D1C00]")}>
                    {a.sev === "danger" ? <AlertCircle size={12} className="text-[#EF4444]" /> : <AlertTriangle size={12} className="text-[#EAB308]" />}
                  </div>
                  <div><div className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{a.title}</div><div className="text-[13px] text-[#71717A] dark:text-[#A1A1AA] mt-0.5 leading-relaxed">{a.body}</div></div>
                </div>
              ))}</div>}
          <Link href="/dashboard/anomaly" className="block mt-3 text-[14px] font-bold text-[#F97316]">View all alerts →</Link>
        </Card>

        {/* AI Insights */}
        <Card>
          <CardHeader title="AI Insights" right={<span className="flex items-center gap-1 text-[#A1A1AA]"><Zap size={11} /> Live</span>} />
          {loading ? <div className="text-[14px] text-[#A1A1AA] py-4 text-center">Computing…</div>
            : insights.length === 0 ? <div className="text-[14px] text-[#A1A1AA] py-4 text-center">Connect more platforms / set costs for insights</div>
            : <div className="space-y-2">{insights.map((ins, i) => (
                <div key={i} className={cn("rounded-xl p-3 border-l-[3px]", ins.type === "positive" ? "bg-[#F0FDF4] dark:bg-[#052E16] border-l-[#22C55E]" : ins.type === "warning" ? "bg-[#FFFBEB] dark:bg-[#2D1C00] border-l-[#EAB308]" : "bg-[#FEF2F2] dark:bg-[#2D0A0A] border-l-[#EF4444]")}>
                  <div className="flex items-center gap-1.5">{ins.type === "positive" ? <CheckCircle2 size={13} className="text-[#22C55E] shrink-0" /> : <AlertTriangle size={13} className={cn("shrink-0", ins.type === "warning" ? "text-[#EAB308]" : "text-[#EF4444]")} />}<div className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{ins.title}</div></div>
                  <div className="text-[13px] text-[#71717A] dark:text-[#A1A1AA] mt-0.5 leading-relaxed">{ins.body}</div>
                </div>
              ))}</div>}
        </Card>

        {/* Priority Actions */}
        <Card>
          <CardHeader title="Priority Actions" right={<span className="text-[13px] text-[#A1A1AA]">by ₹ impact</span>} />
          {loading ? <div className="text-[14px] text-[#A1A1AA] py-4 text-center">Computing…</div>
            : actions.length === 0 ? <div className="text-[14px] text-[#A1A1AA] py-4 text-center">No high-impact actions right now - you&apos;re in good shape.</div>
            : <div className="space-y-2">{actions.map((a, i) => (
                <div key={i} className="flex items-start gap-2.5 py-1">
                  <span className="w-5 h-5 rounded-full bg-[#FFF7ED] dark:bg-[#2A1A0E] text-[#EA580C] text-[13px] font-black flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  <div>
                    <div className="text-[14px] font-semibold text-[#18181B] dark:text-[#F4F4F5] leading-snug">{a.text}</div>
                    <div className="text-[12px] text-[#A1A1AA] mt-0.5">{a.impact > 0 ? <span className="text-[#16A34A] font-bold">≈ {formatINR(a.impact)} impact</span> : null} · {a.source}</div>
                  </div>
                </div>
              ))}</div>}
        </Card>
      </div>

      {/* ── SECTION 10: Quick nav + AI chat ── */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-[#F97316]" />
          <input value={chatQ} onChange={e => setChatQ(e.target.value)} onKeyDown={e => e.key === "Enter" && askAI()}
            placeholder="Ask anything - &quot;which city has the worst RTO?&quot;, &quot;which creative should I kill?&quot;"
            className="flex-1 bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-2 text-[15px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]" />
          <button onClick={() => askAI()} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[15px] font-bold bg-[#F97316] hover:bg-[#EA580C] text-white transition-colors"><Send size={13} /> Ask AI</button>
        </div>
        <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
          {quickActions.map(a => (
            <Link key={a.href} href={a.href} className="group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border border-black/[0.05] dark:border-white/[0.05] bg-[#FAFAF9] dark:bg-[#1C1C1C] hover:border-[#F97316] hover:bg-[#FFF7ED] dark:hover:bg-[#2A1A0E] transition-all text-center">
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", a.color)}><a.icon size={14} /></div>
              <div className="text-[13px] font-bold text-[#18181B] dark:text-[#F4F4F5] group-hover:text-[#EA580C] leading-tight">{a.label}</div>
            </Link>
          ))}
        </div>
      </Card>
      </>)}
    </div>
  );
}

/* ─── Platform snapshot row ─────────────────────────────────── */
function PlatformRow({ name, connected, connectHref, main, mainSub, right, rightSub, rightTone = "neutral" }: {
  name: string; connected: boolean; connectHref?: string; main: string; mainSub: string; right?: string; rightSub?: string; rightTone?: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <div className={cn("py-3 border-b border-black/[0.06] dark:border-white/[0.06] last:border-0", !connected && "opacity-60")}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5"><span className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-[#22C55E]" : "bg-[#D4D4D4]")} /><span className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{name}</span></div>
      </div>
      {connected ? (
        <div className="flex items-center justify-between">
          <div><div className="text-[18px] font-black text-[#18181B] dark:text-[#F4F4F5]">{main}</div><div className="text-[13px] text-[#A1A1AA]">{mainSub}</div></div>
          {right && <div className="text-right"><div className={cn("text-[14px] font-semibold", rightTone === "good" ? "text-[#16A34A]" : rightTone === "warn" ? "text-[#B45309]" : rightTone === "bad" ? "text-[#EF4444]" : "text-[#52525B] dark:text-[#A1A1AA]")}>{right}</div><div className="text-[13px] text-[#A1A1AA]">{rightSub}</div></div>}
        </div>
      ) : (
        <Link href={connectHref ?? "/dashboard/connections"} className="text-[14px] text-[#F97316] font-semibold">Connect {name} →</Link>
      )}
    </div>
  );
}
