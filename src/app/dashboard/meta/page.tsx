"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { KPICard } from "@/components/ui/kpi-card";
import { Card, CardHeader } from "@/components/ui/card";
import { Share2, ArrowDown, MousePointerClick, MonitorSmartphone, ShoppingCart, CreditCard, PackageCheck, AlertTriangle, CheckCircle2, ChevronRight, ChevronDown, Play, Film, Images, Image as ImageIcon, Layers, X } from "lucide-react";
import Link from "next/link";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF } from "@/lib/export";
import { useDateRange, formatDateSpan } from "@/lib/date-range-context";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { cn } from "@/lib/utils";

interface MetaKPIs {
  spend: number; roas: number; cac: number; purchases: number; purchaseValue: number;
  leads: number; costPerLead: number;
  impressions: number; reach: number; frequency: number; cpm: number;
  clicks: number; ctr: number; cpc: number; outboundClicks: number; outboundCtr: number;
  lpv: number; lpRatio: number;
  atc: number; atcValue: number; atcRatio: number;
  checkout: number; checkoutValue: number; checkoutRatio: number;
  purchaseRatio: number; conversionRatio: number;
  videoViews3s: number; thruplay: number; thumbStopRatio: number; holdRatio: number;
}

interface MetaData {
  adAccountName: string;
  currency: string;
  period: { from: string; to: string };
  kpis: MetaKPIs;
  campaigns: {
    id: string; name: string; status: string; objective: string;
    spend: number; impressions: number; reach: number; frequency: number; clicks: number; ctr: number;
    cpc: number; cpm: number; outboundClicks: number; lpv: number; leads: number;
    purchases: number; purchaseValue: number; roas: number; atc: number;
    atcValue: number; checkout: number; checkoutValue: number;
  }[];
  daily: { date: string; spend: number; impressions: number; clicks: number; purchases: number; purchaseValue: number }[];
}

type Tab = "overview" | "campaigns" | "monthly";

interface MetaMonthRow { ym: string; label: string; spend: number; impressions: number; clicks: number; ctr: number; cpm: number; purchases: number; purchaseValue: number; roas: number; cac: number; leads: number; cpl: number }
type ObjFilter = "ALL" | "SALES" | "TRAFFIC" | "AWARENESS" | "ENGAGEMENT" | "LEADS" | "APP" | "OTHER";

function normalizeObj(raw: string): ObjFilter {
  const r = (raw ?? "").toUpperCase();
  if (r.includes("SALES") || r.includes("CONVERSIONS")) return "SALES";
  if (r.includes("TRAFFIC") || r.includes("LINK_CLICKS")) return "TRAFFIC";
  if (r.includes("AWARENESS") || r.includes("REACH") || r.includes("BRAND")) return "AWARENESS";
  if (r.includes("ENGAGEMENT")) return "ENGAGEMENT";
  if (r.includes("LEAD")) return "LEADS";
  if (r.includes("APP")) return "APP";
  return "OTHER";
}

const OBJ_META: Record<ObjFilter, { label: string; chip: string; badge: string }> = {
  ALL:         { label: "All",         chip: "bg-[#F5F5F4] text-[#52525B] border-[#E5E5E5]",         badge: "bg-[#F5F5F4] text-[#52525B]" },
  SALES:       { label: "Sales",       chip: "bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]",         badge: "bg-[#FFF7ED] text-[#EA580C]" },
  TRAFFIC:     { label: "Traffic",     chip: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",         badge: "bg-[#EFF6FF] text-[#1D4ED8]" },
  AWARENESS:   { label: "Awareness",   chip: "bg-[#F5F3FF] text-[#7C3AED] border-[#DDD6FE]",         badge: "bg-[#F5F3FF] text-[#7C3AED]" },
  ENGAGEMENT:  { label: "Engagement",  chip: "bg-[#FDF2F8] text-[#BE185D] border-[#FBCFE8]",         badge: "bg-[#FDF2F8] text-[#BE185D]" },
  LEADS:       { label: "Leads",       chip: "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]",         badge: "bg-[#F0FDF4] text-[#15803D]" },
  APP:         { label: "App",         chip: "bg-[#F0FDFA] text-[#0F766E] border-[#99F6E4]",         badge: "bg-[#F0FDFA] text-[#0F766E]" },
  OTHER:       { label: "Other",       chip: "bg-[#F5F5F4] text-[#71717A] border-[#E5E5E5]",         badge: "bg-[#F5F5F4] text-[#71717A]" },
};

const statusBadge = (s: string) => {
  if (s === "ACTIVE") return "bg-[#FFF7ED] text-[#EA580C] dark:bg-[#2A1A0E] dark:text-[#FB923C]";
  if (s === "PAUSED") return "bg-[#FFFBEB] text-[#92400E] dark:bg-[#2D1C00] dark:text-[#FCD34D]";
  return "bg-[#F5F5F4] text-[#71717A] dark:bg-[#262626] dark:text-[#A1A1AA]";
};

function bench(value: number, avg: number, good: number, higherIsBetter = true): { change: number; changeLabel: string } {
  const isGood = higherIsBetter ? value >= good : value <= good;
  const isAvg = higherIsBetter ? value >= avg : value <= avg;
  const avgLabel = `Avg: ${avg}`;
  if (isGood) return { change: 1, changeLabel: `Above avg · ${avgLabel}` };
  if (isAvg) return { change: 1, changeLabel: `At avg · ${avgLabel}` };
  return { change: -1, changeLabel: `Below avg · ${avgLabel}` };
}

// ── Objective-level aggregation ─────────────────────────────────────────────
// Every ad objective is judged on the KPI it's actually optimized for (Meta's
// "cost per result" logic): Awareness→CPM, Traffic→cost per visit, Sales→ROAS,
// Leads→cost per lead. We bucket campaigns by objective and re-derive the rates.
type Campaign = MetaData["campaigns"][number];
interface ObjBucket {
  obj: ObjFilter; count: number;
  spend: number; impressions: number; reach: number; clicks: number;
  lpv: number; leads: number; purchases: number; purchaseValue: number; atc: number; outboundClicks: number;
  cpm: number; ctr: number; cpc: number; frequency: number; cpl: number; cplpv: number; lpRatio: number; roas: number; cac: number;
  // Full funnel (so a single objective can render its own funnel, not the account blend)
  atcValue: number; checkout: number; checkoutValue: number;
  atcRatio: number; checkoutRatio: number; purchaseRatio: number; conversionRatio: number;
}

// Minimal shape the funnel card needs - satisfied by both MetaKPIs (account) and ObjBucket
// (a single objective), so the same funnel renders for either scope.
interface FunnelData {
  clicks: number; lpv: number; atc: number; atcValue: number;
  checkout: number; checkoutValue: number; purchases: number; purchaseValue: number;
  conversionRatio: number; lpRatio: number; atcRatio: number; checkoutRatio: number; purchaseRatio: number;
}

function money(cur: string, n: number) { return `${cur}${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`; }
function compact(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`; }

// Objective's headline outcome as display text - shared by the campaigns table and the
// ad-set / ad drill-down so a row always shows the result it was actually optimized for.
function objectiveResult(obj: ObjFilter, r: { purchases: number; leads: number; reach: number; lpv: number; clicks: number }): string {
  if (obj === "SALES") return r.purchases > 0 ? `${r.purchases} orders` : "-";
  if (obj === "LEADS") return r.leads > 0 ? `${r.leads.toLocaleString("en-IN")} leads` : "-";
  if (obj === "AWARENESS") return r.reach > 0 ? `${compact(r.reach)} reach` : "-";
  if (obj === "TRAFFIC") return r.lpv > 0 ? `${r.lpv.toLocaleString("en-IN")} visits` : `${r.clicks.toLocaleString("en-IN")} clicks`;
  return r.clicks > 0 ? `${r.clicks.toLocaleString("en-IN")} clicks` : "-";
}

// Objective's cost-per-result label, shared by table header + cards.
function costLabelFor(obj: ObjFilter): string {
  if (obj === "LEADS") return "Cost/Lead";
  if (obj === "SALES") return "CAC";
  if (obj === "TRAFFIC") return "Cost/Visit";
  if (obj === "AWARENESS") return "CPM";
  return "CPC";
}
// Objective's cost-per-result value (the headline efficiency metric for that objective).
function objectiveCost(obj: ObjFilter, r: { spend: number; leads: number; purchases: number; cac: number; lpv: number; cpm: number; cpc: number }, cur: string): string {
  if (obj === "LEADS") return r.leads > 0 ? money(cur, +(r.spend / r.leads).toFixed(2)) : "-";
  if (obj === "SALES") return r.purchases > 0 ? money(cur, r.cac) : "-";
  if (obj === "TRAFFIC") return r.lpv > 0 ? money(cur, +(r.spend / r.lpv).toFixed(2)) : "-";
  if (obj === "AWARENESS") return money(cur, r.cpm);
  return money(cur, r.cpc);
}

// CTA enum (SHOP_NOW / WHATSAPP_MESSAGE / …) → human label.
function ctaLabel(cta: string | null): string | null {
  if (!cta) return null;
  const special: Record<string, string> = {
    WHATSAPP_MESSAGE: "WhatsApp", MESSAGE_PAGE: "Send Message", LEARN_MORE: "Learn More",
    SHOP_NOW: "Shop Now", SIGN_UP: "Sign Up", SUBSCRIBE: "Subscribe", BOOK_TRAVEL: "Book Now",
    GET_QUOTE: "Get Quote", CONTACT_US: "Contact Us", CALL_NOW: "Call Now", ORDER_NOW: "Order Now",
    DOWNLOAD: "Download", GET_OFFER: "Get Offer", APPLY_NOW: "Apply Now", BUY_NOW: "Buy Now",
  };
  return special[cta] ?? cta.split("_").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

// Display / scorecard order - the four primary objectives first, then the rest.
const OBJ_ORDER: ObjFilter[] = ["AWARENESS", "TRAFFIC", "SALES", "LEADS", "ENGAGEMENT", "APP", "OTHER"];

function aggregate(camps: Campaign[], obj: ObjFilter): ObjBucket {
  const c = camps.filter(x => normalizeObj(x.objective) === obj);
  const sum = (f: (x: Campaign) => number) => c.reduce((s, x) => s + (f(x) || 0), 0);
  const spend = sum(x => x.spend), impressions = sum(x => x.impressions), reach = sum(x => x.reach);
  const clicks = sum(x => x.clicks), lpv = sum(x => x.lpv), leads = sum(x => x.leads);
  const purchases = sum(x => x.purchases), purchaseValue = sum(x => x.purchaseValue);
  const atc = sum(x => x.atc), outboundClicks = sum(x => x.outboundClicks);
  const atcValue = sum(x => x.atcValue), checkout = sum(x => x.checkout), checkoutValue = sum(x => x.checkoutValue);
  return {
    obj, count: c.length, spend, impressions, reach, clicks, lpv, leads, purchases, purchaseValue, atc, outboundClicks,
    atcValue, checkout, checkoutValue,
    cpm: impressions > 0 ? +(spend / impressions * 1000).toFixed(2) : 0,
    ctr: impressions > 0 ? +(clicks / impressions * 100).toFixed(2) : 0,
    cpc: clicks > 0 ? +(spend / clicks).toFixed(2) : 0,
    frequency: reach > 0 ? +(impressions / reach).toFixed(2) : 0,
    cpl: leads > 0 ? +(spend / leads).toFixed(2) : 0,
    cplpv: lpv > 0 ? +(spend / lpv).toFixed(2) : 0,
    lpRatio: clicks > 0 ? +(lpv / clicks * 100).toFixed(1) : 0,
    atcRatio: lpv > 0 ? +(atc / lpv * 100).toFixed(1) : 0,
    checkoutRatio: atc > 0 ? +(checkout / atc * 100).toFixed(1) : 0,
    purchaseRatio: checkout > 0 ? +(purchases / checkout * 100).toFixed(1) : 0,
    conversionRatio: clicks > 0 ? +(purchases / clicks * 100).toFixed(2) : 0,
    roas: spend > 0 ? +(purchaseValue / spend).toFixed(2) : 0,
    cac: purchases > 0 ? +(spend / purchases).toFixed(2) : 0,
  };
}

// The single hero metric + supporting pair shown on each objective scorecard.
// `good` is null when there's no delivery yet, so the card stays neutral (never red on no data).
function objHero(b: ObjBucket, cur: string): { label: string; value: string; good: boolean | null; why: string; supports: { label: string; value: string }[] } {
  switch (b.obj) {
    case "AWARENESS": {
      const good = b.cpm > 0 ? b.cpm <= 150 : null;
      return { label: "CPM", value: money(cur, b.cpm), good,
        why: good === null ? "No delivery yet." : good ? "Efficient cost per 1,000 people reached." : "Above the ₹150 benchmark - tighten audience or refresh creative.",
        supports: [{ label: "Reach", value: compact(b.reach) }, { label: "Freq", value: `${b.frequency}x` }] };
    }
    case "TRAFFIC": {
      const usingLpv = b.lpv > 0;
      const metric = usingLpv ? b.cplpv : b.cpc;
      const good = metric > 0 ? metric <= (usingLpv ? 8 : 10) : null;
      return { label: usingLpv ? "Cost / Visit" : "CPC", value: metric > 0 ? money(cur, metric) : "-", good,
        why: good === null ? "No clicks yet." : good ? (usingLpv ? "Cheap, real landing-page visits." : "Low cost per click.") : "Costly traffic - lift CTR or tighten targeting.",
        supports: [{ label: usingLpv ? "Visits" : "Clicks", value: compact(usingLpv ? b.lpv : b.clicks) }, { label: "CTR", value: `${b.ctr}%` }] };
    }
    case "SALES": {
      const good = b.spend > 0 ? b.roas >= 2 : null;
      return { label: "ROAS", value: `${b.roas}x`, good,
        why: good === null ? "No spend yet." : good ? "Above the 2x break-even." : "Below 2x - spending more than it returns.",
        supports: [{ label: "Orders", value: `${b.purchases}` }, { label: "CAC", value: money(cur, b.cac) }] };
    }
    case "LEADS": {
      const good = b.leads > 0 ? b.cpl <= 200 : null;
      return { label: "Cost / Lead", value: b.leads > 0 ? money(cur, b.cpl) : "-", good,
        why: good === null ? "No leads tracked yet - check the lead event is firing." : good ? "Within the ₹200/lead target." : "Above the ₹200/lead target - refine form, offer or audience.",
        supports: [{ label: "Leads", value: `${b.leads}` }, { label: "CTR", value: `${b.ctr}%` }] };
    }
    default: {
      const good = b.ctr > 0 ? b.ctr >= 0.9 : null;
      return { label: "CTR", value: `${b.ctr}%`, good,
        why: good === null ? "No delivery yet." : good ? "Healthy engagement." : "Low engagement - test new creative.",
        supports: [{ label: "Clicks", value: compact(b.clicks) }, { label: "CPM", value: money(cur, b.cpm) }] };
    }
  }
}

// Per-objective "what's working / what's not" - each insight is GREEN (why it works) or
// RED/amber (why + how to fix), per the benchmark-flagging rule. Sales reuses buildDiagnosis.
function buildObjDiagnosis(b: ObjBucket, cur: string): DiagInsight[] {
  const out: DiagInsight[] = [];
  const ctrInsight = () => {
    if (b.ctr >= 1.5) out.push({ source: "meta", severity: "strength", title: `CTR ${b.ctr}% - strong engagement`, body: "Above the 1.5% good mark. The hook and creative resonate - reuse this angle for new variations." });
    else if (b.ctr >= 0.9) out.push({ source: "meta", severity: "warning", title: `CTR ${b.ctr}% - around the 0.9% average`, body: "At industry average. Test 2–3 fresh hooks/formats to push past 1.5% and lower cost." });
    else out.push({ source: "meta", severity: "issue", title: `CTR ${b.ctr}% - ad not compelling`, body: "Below the 0.9% avg. Weak hook, unclear offer or wrong audience. Test new angles and a fresh creative format." });
  };
  if (b.obj === "AWARENESS" || b.obj === "ENGAGEMENT" || b.obj === "APP" || b.obj === "OTHER") {
    if (b.cpm > 0) {
      if (b.cpm <= 150) out.push({ source: "meta", severity: "strength", title: `CPM ${money(cur, b.cpm)} - efficient reach`, body: "Below the ₹150 benchmark - you're reaching 1,000 people cheaply. Keep the audience broad and rotate creatives to hold this." });
      else out.push({ source: "meta", severity: "issue", title: `CPM ${money(cur, b.cpm)} - expensive reach`, body: "Above the ₹150 benchmark. The auction is costly - broaden or replace the audience and refresh creative to raise relevance and pull CPM down." });
    }
    if (b.frequency > 0) {
      if (b.frequency <= 3) out.push({ source: "meta", severity: "strength", title: `Frequency ${b.frequency}x - healthy`, body: "Inside the safe 1–3x range, so the audience isn't being over-shown the ad. Watch it as you scale." });
      else if (b.frequency <= 5) out.push({ source: "meta", severity: "warning", title: `Frequency ${b.frequency}x - fatigue building`, body: "Approaching the >5x fatigue zone - refresh creatives or widen the audience soon." });
      else out.push({ source: "meta", severity: "risk", title: `Frequency ${b.frequency}x - severe fatigue`, body: "The audience has seen the ad too often, inflating CPM. Launch fresh creatives and expand targeting now." });
    }
    ctrInsight();
  } else if (b.obj === "TRAFFIC") {
    if (b.cplpv > 0) {
      if (b.cplpv <= 8) out.push({ source: "meta", severity: "strength", title: `Cost per visit ${money(cur, b.cplpv)} - cheap traffic`, body: "Below the ₹8 benchmark per real landing-page visit. Targeting and creative are efficient - scale gradually." });
      else out.push({ source: "meta", severity: "issue", title: `Cost per visit ${money(cur, b.cplpv)} - expensive traffic`, body: "Above the ₹8 benchmark. Lift CTR with a stronger hook or tighten the audience so clicks are cheaper and more relevant." });
    }
    ctrInsight();
    if (b.lpv > 0) {
      if (b.lpRatio >= 65) out.push({ source: "website", severity: "strength", title: `Landing rate ${b.lpRatio}% - clicks reach the page`, body: "Above the 65% avg - the page loads fast and most clicks become visits. Keep mobile load under 3s." });
      else out.push({ source: "website", severity: "issue", title: `Landing rate ${b.lpRatio}% - clicks lost before page loads`, body: "Below the 65% avg. Often slow mobile load or a broken/redirecting link. Fix page speed (<3s) and verify the link works." });
    }
  } else if (b.obj === "LEADS") {
    if (b.leads > 0) {
      if (b.cpl <= 200) out.push({ source: "overall", severity: "strength", title: `Cost per lead ${money(cur, b.cpl)} - within target`, body: "At or below the ₹200 benchmark. The form, offer and audience are working - scale carefully and watch lead quality." });
      else out.push({ source: "overall", severity: "issue", title: `Cost per lead ${money(cur, b.cpl)} - above target`, body: "Above the ₹200 benchmark. Shorten the form, sharpen the offer, or tighten the audience to lower cost per lead." });
    } else {
      out.push({ source: "overall", severity: "warning", title: "No leads recorded yet", body: "Spend is running but no lead events came back. Check the instant form / pixel lead event is firing, then re-check this view." });
    }
    ctrInsight();
  }
  return out;
}

const FUNNEL_COLORS = ["#FB923C", "#F97316", "#EA580C", "#DC2626", "#16A34A"];

function ConversionFunnel({ k, cur }: { k: FunnelData; cur: string }) {
  const stages = [
    { label: "Ad Clicks", desc: "Clicked your ad", count: k.clicks, value: 0, Icon: MousePointerClick },
    { label: "Visited Site", desc: "Landing page loaded", count: k.lpv, value: 0, Icon: MonitorSmartphone },
    { label: "Add to Cart", desc: "Added a product", count: k.atc, value: k.atcValue, Icon: ShoppingCart },
    { label: "Reached Checkout", desc: "Started checkout", count: k.checkout, value: k.checkoutValue, Icon: CreditCard },
    { label: "Purchased", desc: "Completed the order", count: k.purchases, value: k.purchaseValue, Icon: PackageCheck },
  ];
  const top = Math.max(stages[0].count, 1);
  // sqrt scale keeps the tiny end-stages visible while the funnel still narrows clearly
  const barWidth = (c: number) => `${Math.max(Math.sqrt(c / top) * 100, 14)}%`;

  return (
    <div>
      {/* Plain-language summary */}
      <p className="text-[15px] text-[#52525B] dark:text-[#A1A1AA] mb-4 leading-relaxed">
        Of <b className="text-[#18181B] dark:text-[#F4F4F5]">{stages[0].count.toLocaleString("en-IN")}</b> people who clicked your ad,{" "}
        <b className="text-[#16A34A]">{k.purchases.toLocaleString("en-IN")}</b> completed a purchase{" "}
        <b className="text-[#18181B] dark:text-[#F4F4F5]">({k.conversionRatio}%)</b>. Each step shows how many continued and how many dropped off.
      </p>

      <div className="space-y-0">
        {stages.map((s, i) => {
          const pctOfTop = (s.count / top) * 100;
          const prev = i > 0 ? stages[i - 1].count : null;
          const continued = prev !== null ? (s.count / Math.max(prev, 1)) * 100 : null;
          const dropped = prev !== null ? Math.max(prev - s.count, 0) : 0;
          const Icon = s.Icon;
          return (
            <div key={s.label}>
              {/* Drop-off connector */}
              {continued !== null && (
                <div className="flex items-center gap-2 pl-9 py-1.5 text-[13px]">
                  <ArrowDown size={13} className="text-[#A1A1AA] shrink-0" />
                  <span className={cn("font-bold",
                    continued >= 50 ? "text-[#16A34A]" : continued >= 20 ? "text-[#EA580C]" : "text-[#DC2626]"
                  )}>{continued.toFixed(1)}% continued</span>
                  <span className="text-[#D4D4D4] dark:text-[#525252]">·</span>
                  <span className="text-[#A1A1AA]">{dropped.toLocaleString("en-IN")} dropped off</span>
                </div>
              )}
              {/* Stage row */}
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${FUNNEL_COLORS[i]}1A` }}>
                  <Icon size={15} style={{ color: FUNNEL_COLORS[i] }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <div className="min-w-0 truncate">
                      <span className="text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{s.label}</span>
                      <span className="text-[13px] text-[#A1A1AA] ml-2 hidden sm:inline">{s.desc}</span>
                    </div>
                    <div className="flex items-baseline gap-2 shrink-0">
                      {s.value > 0 && (
                        <span className="text-[13px] text-[#EA580C] dark:text-[#FB923C] font-semibold">{cur}{s.value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
                      )}
                      <span className="text-[19px] font-black text-[#18181B] dark:text-[#F4F4F5] tabular-nums">{s.count.toLocaleString("en-IN")}</span>
                      <span className="text-[13px] text-[#A1A1AA] w-11 text-right">{pctOfTop.toFixed(pctOfTop < 1 ? 2 : 0)}%</span>
                    </div>
                  </div>
                  <div className="h-3 rounded-full bg-[#F5F5F4] dark:bg-[#1C1C1C] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: barWidth(s.count), background: `linear-gradient(90deg, ${FUNNEL_COLORS[i]}, ${FUNNEL_COLORS[i]}bb)` }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type DiagSource = "meta" | "website" | "overall";
type DiagSeverity = "issue" | "strength" | "risk" | "warning";
interface DiagInsight { source: DiagSource; severity: DiagSeverity; title: string; body: string }

const sourceLabel: Record<DiagSource, string> = { meta: "Meta Ad", website: "Website / Shopify", overall: "Overall" };
const sourceStyle: Record<DiagSource, string> = {
  meta: "bg-[#EFF6FF] text-[#1877F2] dark:bg-[#0D1E3D] dark:text-[#93C5FD]",
  website: "bg-[#FFF7ED] text-[#EA580C] dark:bg-[#2A1A0E] dark:text-[#FB923C]",
  overall: "bg-[#F5F3FF] text-[#7C3AED] dark:bg-[#1E1240] dark:text-[#C4B5FD]",
};
const severityStyle: Record<DiagSeverity, { border: string; bg: string; label: string; labelText: string }> = {
  issue:    { border: "border-l-[#EF4444]", bg: "bg-[#FEF2F2] dark:bg-[#2D0A0A]", label: "ISSUE",    labelText: "text-[#DC2626] dark:text-[#FCA5A5]" },
  strength: { border: "border-l-[#22C55E]", bg: "bg-[#F0FDF4] dark:bg-[#052E16]", label: "GOOD",     labelText: "text-[#15803D] dark:text-[#86EFAC]" },
  risk:     { border: "border-l-[#EAB308]", bg: "bg-[#FFFBEB] dark:bg-[#2D1C00]", label: "RISK",     labelText: "text-[#92400E] dark:text-[#FCD34D]" },
  warning:  { border: "border-l-[#F97316]", bg: "bg-[#FFF7ED] dark:bg-[#2A1A0E]", label: "WATCH",    labelText: "text-[#EA580C] dark:text-[#FB923C]" },
};

function DiagCard({ insight }: { insight: DiagInsight }) {
  const s = severityStyle[insight.severity];
  return (
    <div className={cn("border-l-[3px] rounded-r-xl p-3", s.border, s.bg)}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={cn("text-[12px] font-black uppercase tracking-wider", s.labelText)}>{s.label}</span>
        <span className={cn("text-[12px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide", sourceStyle[insight.source])}>
          {sourceLabel[insight.source]}
        </span>
      </div>
      <div className="text-[15px] font-semibold text-[#18181B] dark:text-[#F4F4F5] mb-0.5">{insight.title}</div>
      <div className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] leading-relaxed">{insight.body}</div>
    </div>
  );
}

// Every benchmarked metric returns ONE verdict: a "strength" (at/above standard, why it
// works + how to keep it) or an "issue"/"risk"/"warning" (below standard, why it happened
// + how to fix). This guarantees the user always sees what's working AND what's not.
function buildDiagnosis(k: MetaKPIs, roas: number, hasConversion: boolean): DiagInsight[] {
  const out: DiagInsight[] = [];

  // ── OVERALL: ROAS - judged on conversion-campaign spend only (avg 2x, 3x good).
  // Skipped entirely when no conversion campaigns ran, so awareness/traffic/lead
  // spend is never wrongly flagged on a sales metric it was never optimized for.
  if (hasConversion) {
    if (roas >= 3.0) {
      out.push({ source: "overall", severity: "strength", title: `ROAS ${roas}x - profitable, above the 3x target`, body: `Every ₹1 of conversion spend returns ₹${roas}. This works because targeting, creative and offer are aligned. Scale carefully: raise budget 20–30% at a time and duplicate winning ad sets into lookalikes so you don't reset learning.` });
    } else if (roas >= 2.0) {
      out.push({ source: "overall", severity: "warning", title: `ROAS ${roas}x - okay but below the 3x target`, body: "Past the 2x break-even guide on conversion spend but not in strong-profit territory. Why: one funnel stage is leaking value. Fix the weakest stage flagged below and shift budget to your best campaigns to push ROAS toward 3x." });
    } else {
      out.push({ source: "overall", severity: "risk", title: `ROAS ${roas}x - below the 2x minimum`, body: "Conversion spend is returning less than it costs. Why: usually a weak funnel stage (see below) or low-intent traffic. Pause the lowest-ROAS campaigns first, fix the biggest drop-off stage, and don't raise budgets until ROAS clears 2x." });
    }
  }

  // ── META: CTR (avg 0.9%, 1.5% good) ──────────────────────────────────────
  if (k.ctr >= 1.5) {
    out.push({ source: "meta", severity: "strength", title: `CTR ${k.ctr}% - strong ad engagement`, body: "Above the 1.5% good mark (avg 0.9%). Your hook and creative are resonating. Keep this creative running and use it as the template for new variations." });
  } else if (k.ctr >= 0.9) {
    out.push({ source: "meta", severity: "warning", title: `CTR ${k.ctr}% - around the 0.9% average`, body: "At industry average but not standout. Test 2–3 new hooks/headlines and a different format (video vs image) to push CTR past 1.5% - that also lowers your CPC." });
  } else {
    out.push({ source: "meta", severity: "issue", title: `CTR ${k.ctr}% - ad not compelling enough`, body: "Below the 0.9% avg. People see the ad but don't click. Why: weak hook, unclear offer, or wrong audience. Fix: test new angles (problem-led hook, stronger headline, clearer offer like discount/bundle/free shipping) and a fresh creative format." });
  }

  // ── META: Frequency (1–3x healthy, >5x fatigue) ─────────────────────────
  if (k.frequency <= 3) {
    out.push({ source: "meta", severity: "strength", title: `Frequency ${k.frequency}x - healthy`, body: "Inside the safe 1–3x range, so the audience isn't being over-shown the same ad. No action needed - just watch it as you scale budget." });
  } else if (k.frequency <= 5) {
    out.push({ source: "meta", severity: "warning", title: `Frequency ${k.frequency}x - fatigue building`, body: "Approaching the >5x fatigue zone - the same people keep seeing the ad, which slowly raises CPM and drops CTR. Refresh creatives soon (new angle/format) or widen the audience." });
  } else {
    out.push({ source: "meta", severity: "risk", title: `Frequency ${k.frequency}x - severe ad fatigue`, body: "The audience has seen this ad too many times, inflating CPMs and killing CTR. Launch 2–3 fresh creatives now and expand targeting / lookalikes." });
  }

  // ── WEBSITE: Landing page rate (avg 65%) ─────────────────────────────────
  if (k.lpRatio >= 65) {
    out.push({ source: "website", severity: "strength", title: `Landing page rate ${k.lpRatio}% - clicks reach your page`, body: "Above the 65% avg, so the page loads fast and most clicks become real visits. Protect it: keep mobile load under 3s and keep the ad↔page message consistent." });
  } else if (k.lpRatio >= 45) {
    out.push({ source: "website", severity: "warning", title: `Landing page rate ${k.lpRatio}% - some clicks lost`, body: "Below the 65% avg. A chunk of clickers never see the page. Why: slow mobile load or a redirect. Fix: test page speed (target <3s) and remove pop-ups that block content on arrival." });
  } else {
    out.push({ source: "website", severity: "issue", title: `Landing page rate ${k.lpRatio}% - most clicks never load the page`, body: "Well below the 65% avg - often the biggest leak. Why: slow load, broken/redirecting link, or ad↔page mismatch. Fix: page speed first (<3s on mobile), verify the link works, and match the page headline to the ad promise." });
  }

  // ── WEBSITE: Add-to-cart rate (avg 7%, 12% strong) ──────────────────────
  if (k.atcRatio >= 12) {
    out.push({ source: "website", severity: "strength", title: `Add-to-cart rate ${k.atcRatio}% - product page converting well`, body: "Above the 12% strong mark (avg 7%). Your product page - offer clarity, photos, reviews - is doing its job. Reuse this page structure for new products." });
  } else if (k.atcRatio >= 7) {
    out.push({ source: "website", severity: "strength", title: `Add-to-cart rate ${k.atcRatio}% - above average`, body: "Above the 7% avg. The product page is turning visitors into carts. To push higher, add photo reviews and make the price/offer even clearer above the fold." });
  } else {
    out.push({ source: "website", severity: "issue", title: `Add-to-cart rate ${k.atcRatio}% - product page not converting`, body: "Below the 7% avg. Visitors land but don't add to cart - a product-page issue, not an ad issue. Fix: photo reviews, a crystal-clear offer (price, what's included), urgency (low stock), and an Add-to-Cart button visible without scrolling." });
  }

  // ── WEBSITE: Cart → checkout (avg 50%) ──────────────────────────────────
  if (k.checkoutRatio >= 50) {
    out.push({ source: "website", severity: "strength", title: `Cart → checkout ${k.checkoutRatio}% - low cart abandonment`, body: "Above the 50% avg. Shoppers who add to cart are moving to checkout - your shipping and trust signals are clear. Keep showing shipping cost + ETA early." });
  } else {
    out.push({ source: "website", severity: "issue", title: `Cart → checkout ${k.checkoutRatio}% - high cart abandonment`, body: "Below the 50% avg. Carts are abandoned before checkout. Why: surprise shipping fees, weak trust, or no COD. Fix: show shipping cost + ETA upfront, add trust badges, surface COD, and add a 1-hour cart-recovery WhatsApp/email." });
  }

  // ── WEBSITE: Checkout → purchase (avg 40%) ──────────────────────────────
  if (k.purchaseRatio >= 40) {
    out.push({ source: "website", severity: "strength", title: `Checkout → purchase ${k.purchaseRatio}% - payment step converting`, body: "Above the 40% avg. People who reach checkout are paying - your payment options and checkout trust are working. Keep UPI/COD/card all visible." });
  } else {
    out.push({ source: "website", severity: "issue", title: `Checkout → purchase ${k.purchaseRatio}% - drop-off at payment`, body: "Below the 40% avg. Customers reach checkout but don't pay. Why: limited payment options, surprise fees, or low trust. Fix: show UPI/COD/card/EMI clearly, display the delivery date, add payment-security badges, and remove fee surprises." });
  }

  // ── META: Video (only when there are video views) ───────────────────────
  if (k.videoViews3s > 0) {
    if (k.thumbStopRatio >= 25) {
      out.push({ source: "meta", severity: "strength", title: `Thumb-stop ${k.thumbStopRatio}% - strong opening hook`, body: "Above the 25% avg - your first 1–2s stop the scroll. Keep opening with the product/bold hook and replicate it in new videos." });
    } else {
      out.push({ source: "meta", severity: "issue", title: `Thumb-stop ${k.thumbStopRatio}% - weak opening hook`, body: "Below the 25% avg - people scroll past. Why: slow or unclear opening. Fix: make the first 1–2s grab attention - bold text overlay, show the product instantly, or open with a surprising visual/problem." });
    }
    if (k.holdRatio >= 15) {
      out.push({ source: "meta", severity: "strength", title: `Hold ratio ${k.holdRatio}% - viewers staying`, body: "Above the 15% avg - the video keeps attention. Maintain the tight pacing and get to the benefit early." });
    } else {
      out.push({ source: "meta", severity: "issue", title: `Hold ratio ${k.holdRatio}% - losing viewers fast`, body: "Below the 15% avg. You stop the scroll but lose them. Fix: get to the key benefit in under 5s, cut long intros, add subtitles, and show product proof earlier." });
    }
  }

  return out;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-[0.12em]">{children}</div>
      <div className="flex-1 h-px bg-black/[0.06] dark:bg-white/[0.06]" />
    </div>
  );
}

// Site conversion funnel + stage-ratio bar. Reused by the account Overview and the
// Conversion objective view. Funnel data is always account-level (Meta only reports
// the deep stages - ATC/checkout - at account scope).
function FunnelCard({ k, cur, note }: { k: FunnelData; cur: string; note?: string }) {
  return (
    <Card>
      <CardHeader title="Conversion Funnel" right={<span className="text-[#F97316] font-semibold">CVR: {k.conversionRatio}%</span>} />
      {note && <p className="text-[14px] text-[#A1A1AA] -mt-2 mb-3">{note}</p>}
      <div className="mb-4">
        <ConversionFunnel k={k} cur={cur} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
        {[
          { label: "LP Ratio", value: `${k.lpRatio}%`, avg: "Avg: 65%", good: k.lpRatio >= 65 },
          { label: "ATC Ratio", value: `${k.atcRatio}%`, avg: "Avg: 7%", good: k.atcRatio >= 7 },
          { label: "Checkout Ratio", value: `${k.checkoutRatio}%`, avg: "Avg: 50%", good: k.checkoutRatio >= 50 },
          { label: "Purchase Ratio", value: `${k.purchaseRatio}%`, avg: "Avg: 40%", good: k.purchaseRatio >= 40 },
        ].map(r => (
          <div key={r.label} className={cn("rounded-xl p-2.5 text-center border",
            r.good
              ? "bg-[#F0FDF4] border-[#BBF7D0] dark:bg-[#052E16] dark:border-[#14532D]"
              : "bg-[#FEF2F2] border-[#FECACA] dark:bg-[#2D0A0A] dark:border-[#7F1D1D]"
          )}>
            <div className="text-[13px] text-[#A1A1AA] font-medium mb-1">{r.label}</div>
            <div className={cn("text-[18px] font-black", r.good ? "text-[#16A34A]" : "text-[#EF4444]")}>{r.value}</div>
            <div className={cn("text-[12px] font-bold mt-0.5", r.good ? "text-[#16A34A]" : "text-[#EF4444]")}>
              {r.good ? "✓ Good" : "↓ Below avg"}
            </div>
            <div className="text-[13px] text-[#A1A1AA]">{r.avg}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// "What's Working & What's Not" - splits insights into needs-attention vs working.
function DiagnosisPanel({ diag }: { diag: DiagInsight[] }) {
  if (diag.length === 0) return null;
  const attention = diag.filter(d => d.severity !== "strength");
  const working = diag.filter(d => d.severity === "strength");
  return (
    <Card>
      <CardHeader title="What's Working & What's Not" right="vs D2C industry benchmarks" />
      {attention.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle size={14} className="text-[#EF4444]" />
            <span className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5] uppercase tracking-wide">Needs attention</span>
            <span className="text-[13px] font-bold text-[#EF4444] bg-[#FEF2F2] dark:bg-[#2D0A0A] px-1.5 py-0.5 rounded-full">{attention.length}</span>
          </div>
          <div className="space-y-2">{attention.map((ins, i) => <DiagCard key={i} insight={ins} />)}</div>
        </div>
      )}
      {working.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <CheckCircle2 size={14} className="text-[#22C55E]" />
            <span className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5] uppercase tracking-wide">What's working</span>
            <span className="text-[13px] font-bold text-[#15803D] bg-[#F0FDF4] dark:bg-[#052E16] px-1.5 py-0.5 rounded-full">{working.length}</span>
          </div>
          <div className="space-y-2">{working.map((ins, i) => <DiagCard key={i} insight={ins} />)}</div>
        </div>
      )}
    </Card>
  );
}

// One scorecard per objective - spend share + the hero KPI it's optimized for, flagged
// green (working) / red (below standard) / neutral (no delivery). Clicking focuses that view.
function ScoreCard({ b, cur, totalSpend, active, onClick }: { b: ObjBucket; cur: string; totalSpend: number; active: boolean; onClick: () => void }) {
  const hero = objHero(b, cur);
  const m = OBJ_META[b.obj];
  const pct = totalSpend > 0 ? Math.round(b.spend / totalSpend * 100) : 0;
  const tone = hero.good === null ? "neutral" : hero.good ? "good" : "bad";
  const valueColor = tone === "good" ? "text-[#16A34A]" : tone === "bad" ? "text-[#EF4444]" : "text-[#18181B] dark:text-[#F4F4F5]";
  const whyColor = tone === "good" ? "text-[#16A34A]" : tone === "bad" ? "text-[#DC2626]" : "text-[#A1A1AA]";
  return (
    <button onClick={onClick}
      className={cn("text-left rounded-2xl border p-3 transition-all hover:shadow-sm",
        active ? "ring-1 ring-[#F97316] border-[#F97316]" : "border-black/[0.06] dark:border-white/[0.06] hover:border-black/10 dark:hover:border-white/10")}>
      <div className="flex items-center justify-between mb-2">
        <span className={cn("text-[13px] px-2 py-0.5 rounded-full font-bold", m.badge)}>{m.label}</span>
        <span className="text-[13px] text-[#A1A1AA] font-medium">{pct}% of spend</span>
      </div>
      <div className="text-[18px] font-black text-[#18181B] dark:text-[#F4F4F5] mb-2 tabular-nums">{money(cur, b.spend)}</div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[12px] text-[#A1A1AA] font-bold uppercase tracking-wide">{hero.label}</span>
        <span className={cn("text-[18px] font-black tabular-nums", valueColor)}>{hero.value}</span>
      </div>
      <div className={cn("text-[13px] leading-snug mb-2", whyColor)}>
        {tone === "good" ? "✓ " : tone === "bad" ? "↓ " : ""}{hero.why}
      </div>
      <div className="flex gap-3 pt-2 border-t border-black/[0.05] dark:border-white/[0.05]">
        {hero.supports.map(s => (
          <div key={s.label} className="flex-1">
            <div className="text-[12px] text-[#A1A1AA] uppercase tracking-wide">{s.label}</div>
            <div className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5] tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>
    </button>
  );
}

function ObjectiveScorecards({ campaigns, cur, totalSpend, active, onSelect }: { campaigns: Campaign[]; cur: string; totalSpend: number; active: ObjFilter; onSelect: (o: ObjFilter) => void }) {
  const present = OBJ_ORDER.map(o => aggregate(campaigns, o)).filter(b => b.count > 0);
  if (present.length < 1) return null; // nothing to break down only when there are no campaigns
  return (
    <div>
      <SectionLabel>Performance by Objective</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {present.map(b => (
          <ScoreCard key={b.obj} b={b} cur={cur} totalSpend={totalSpend} active={active === b.obj} onClick={() => onSelect(active === b.obj ? "ALL" : b.obj)} />
        ))}
      </div>
    </div>
  );
}

// Focused single-objective view: KPI cards relevant to that objective + its own
// working/not-working diagnosis. Sales additionally shows the site funnel.
function ObjectiveDetail({ b, k, cur, totalSpend }: { b: ObjBucket; k: MetaKPIs; cur: string; totalSpend: number }) {
  const fmt = (n: number) => n.toLocaleString("en-IN");
  const fmtC = (n: number) => money(cur, n);
  const m = OBJ_META[b.obj];
  const pct = totalSpend > 0 ? Math.round(b.spend / totalSpend * 100) : 0;
  const freqLabel = b.frequency <= 3 ? "Healthy range" : b.frequency <= 5 ? "Approaching fatigue" : "Ad fatigue risk";

  let cards: React.ReactNode = null;
  if (b.obj === "AWARENESS") {
    cards = (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        <KPICard label="Spend" value={fmtC(b.spend)} />
        <KPICard label="CPM" value={fmtC(b.cpm)} {...bench(b.cpm, 150, 110, false)} sub="Cost per 1,000 views" />
        <KPICard label="Reach" value={compact(b.reach)} />
        <KPICard label="Frequency" value={`${b.frequency}x`} {...bench(b.frequency, 3, 1, false)} changeLabel={freqLabel} />
        <KPICard label="Impressions" value={compact(b.impressions)} />
        <KPICard label="CTR" value={`${b.ctr}%`} {...bench(b.ctr, 0.9, 1.5)} />
        <KPICard label="Outbound Clicks" value={fmt(b.outboundClicks)} />
      </div>
    );
  } else if (b.obj === "TRAFFIC") {
    cards = (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        <KPICard label="Spend" value={fmtC(b.spend)} />
        <KPICard label="Landing Page Views" value={fmt(b.lpv)} sub="Visited the site" />
        <KPICard label="Cost / Visit" value={b.cplpv > 0 ? fmtC(b.cplpv) : "-"} {...(b.cplpv > 0 ? bench(b.cplpv, 12, 8, false) : {})} sub="Per landing-page view" />
        <KPICard label="CTR" value={`${b.ctr}%`} {...bench(b.ctr, 0.9, 1.5)} />
        <KPICard label="CPC" value={fmtC(b.cpc)} />
        <KPICard label="LP Ratio" value={`${b.lpRatio}%`} {...bench(b.lpRatio, 45, 65)} sub="Clicks that loaded" />
        <KPICard label="Clicks" value={fmt(b.clicks)} />
        <KPICard label="Impressions" value={compact(b.impressions)} />
      </div>
    );
  } else if (b.obj === "SALES") {
    cards = (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <KPICard label="Spend" value={fmtC(b.spend)} />
        <KPICard label="ROAS" value={`${b.roas}x`} {...(b.spend > 0 ? bench(b.roas, 2, 3) : {})} />
        <KPICard label="Orders" value={fmt(b.purchases)} />
        <KPICard label="Revenue" value={fmtC(b.purchaseValue)} />
        <KPICard label="CAC" value={fmtC(b.cac)} sub="Cost per order" />
      </div>
    );
  } else if (b.obj === "LEADS") {
    cards = (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        <KPICard label="Spend" value={fmtC(b.spend)} />
        <KPICard label="Leads" value={fmt(b.leads)} />
        <KPICard label="Cost / Lead" value={b.leads > 0 ? fmtC(b.cpl) : "-"} {...(b.leads > 0 ? bench(b.cpl, 300, 200, false) : {})} />
        <KPICard label="CTR" value={`${b.ctr}%`} {...bench(b.ctr, 0.9, 1.5)} />
        <KPICard label="CPC" value={fmtC(b.cpc)} />
        <KPICard label="Clicks" value={fmt(b.clicks)} />
        <KPICard label="Landing Page Views" value={fmt(b.lpv)} />
      </div>
    );
  } else {
    cards = (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        <KPICard label="Spend" value={fmtC(b.spend)} />
        <KPICard label="Impressions" value={compact(b.impressions)} />
        <KPICard label="Reach" value={compact(b.reach)} />
        <KPICard label="CPM" value={fmtC(b.cpm)} {...bench(b.cpm, 150, 110, false)} />
        <KPICard label="CTR" value={`${b.ctr}%`} {...bench(b.ctr, 0.9, 1.5)} />
        <KPICard label="CPC" value={fmtC(b.cpc)} />
        <KPICard label="Clicks" value={fmt(b.clicks)} />
        <KPICard label="Frequency" value={`${b.frequency}x`} {...bench(b.frequency, 3, 1, false)} changeLabel={freqLabel} />
      </div>
    );
  }

  const diag = b.obj === "SALES" ? buildDiagnosis(k, b.roas, b.spend > 0) : buildObjDiagnosis(b, cur);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("text-[14px] px-2.5 py-1 rounded-full font-bold", m.badge)}>{m.label}</span>
        <span className="text-[15px] text-[#52525B] dark:text-[#A1A1AA]">
          {b.count} campaign{b.count === 1 ? "" : "s"} · {money(cur, b.spend)} ({pct}% of total spend)
        </span>
      </div>
      {cards}
      {b.obj === "SALES" && <FunnelCard k={b} cur={cur} note={`Sales-objective funnel only - clicks → purchase from the ${b.count} Sales campaign${b.count === 1 ? "" : "s"} (not blended with awareness/traffic).`} />}
      <DiagnosisPanel diag={diag} />
    </div>
  );
}

// ── Drill-down (Campaign → Ad Set → Ad → Creative) ──────────────────────────
interface DrillMetrics {
  spend: number; impressions: number; reach: number; frequency: number;
  clicks: number; ctr: number; cpc: number; cpm: number; outboundClicks: number;
  lpv: number; leads: number; purchases: number; purchaseValue: number; roas: number; cac: number;
  atc: number; atcValue: number; checkout: number; checkoutValue: number;
}
interface AdSetRow extends DrillMetrics { id: string; name: string; status: string; optimizationGoal: string | null; budget: number | null; }
interface ParsedCreative {
  type: "image" | "carousel" | "video" | "unknown";
  images: string[]; videoThumb: string | null; videoSrc: string | null; videoId: string | null;
  cta: string | null; primaryText: string | null; headline: string | null;
  productSetId?: string | null; catalogName?: string | null;
}
interface AdRow extends DrillMetrics { id: string; name: string; status: string; createdTime?: string | null; creative: ParsedCreative; videoViews3s: number; thruplay: number; thumbStopRatio: number; }

function CreativeMedia({ c }: { c: ParsedCreative }) {
  const placeholder = (Icon: typeof ImageIcon, label: string) => (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-[#A1A1AA]">
      <Icon size={28} /><span className="text-[13px] font-medium">{label}</span>
    </div>
  );
  if (c.type === "video") {
    if (c.videoSrc) return <video src={c.videoSrc} poster={c.videoThumb ?? undefined} controls playsInline className="w-full h-full object-contain bg-black" />;
    if (c.videoThumb) return (
      <div className="relative w-full h-full">
        <img src={c.videoThumb} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="w-11 h-11 rounded-full bg-black/55 flex items-center justify-center"><Play size={20} className="text-white ml-0.5" fill="white" /></div>
        </div>
      </div>
    );
    return placeholder(Film, "Video");
  }
  if (c.type === "carousel" && c.images.length > 0) {
    return (
      <div className="flex h-full gap-1 overflow-x-auto snap-x">
        {c.images.map((src, i) => (
          <img key={i} src={src} alt="" className="h-full aspect-square object-cover snap-start shrink-0 first:rounded-l-none" />
        ))}
      </div>
    );
  }
  if (c.images.length > 0) return <img src={c.images[0]} alt="" className="w-full h-full object-cover" />;
  return placeholder(ImageIcon, "No preview");
}

// Ad-level fixes - only the creative/delivery levers that live on the ad or its ad set.
// Funnel KPIs (LPV/ATC/Checkout/Conversion) are store-wide and stay in the Overview.
interface AdFix { kpi: string; severity: "issue" | "warning"; advice: string }
function buildAdFixes(ad: AdRow, cur: string): AdFix[] {
  const out: AdFix[] = [];
  if (ad.ctr > 0 && ad.ctr < 0.9)
    out.push({ kpi: `CTR ${ad.ctr}%`, severity: "issue", advice: "Below the 0.9% benchmark. Test new ad creatives, hooks/headlines and a clearer CTA; check the offer and audience relevance." });
  if (ad.cpm > 150)
    out.push({ kpi: `CPM ${money(cur, ad.cpm)}`, severity: ad.cpm > 250 ? "issue" : "warning", advice: "Above the ₹150 benchmark. Refine this ad set's targeting & placement and adjust bidding; refresh the creative to raise relevance and lower cost." });
  if (ad.frequency > 3)
    out.push({ kpi: `Frequency ${ad.frequency}x`, severity: ad.frequency > 5 ? "issue" : "warning", advice: "Above 3x - the same people keep seeing this ad. Refresh the creative or widen this ad set's audience." });
  if (ad.creative.type === "video" && ad.videoViews3s > 0) {
    if (ad.thumbStopRatio > 0 && ad.thumbStopRatio < 25)
      out.push({ kpi: `Thumb-stop ${ad.thumbStopRatio}%`, severity: "issue", advice: "Below 25% - the first 1–2s don't grab attention. Open with the product or a bold hook / text overlay." });
    const hold = ad.videoViews3s > 0 ? +(ad.thruplay / ad.videoViews3s * 100).toFixed(1) : 0;
    if (hold > 0 && hold < 15)
      out.push({ kpi: `Hold ${hold}%`, severity: "issue", advice: "Below 15% - viewers drop off fast. Get to the benefit in under 5s, cut the intro, add subtitles." });
  }
  return out;
}

// Full-size preview - the complete creative + all the ad copy, opened by clicking an ad card.
function AdPreviewModal({ ad, obj, cur, onClose }: { ad: AdRow; obj: ObjFilter; cur: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const c = ad.creative;
  const cta = ctaLabel(c.cta);
  const stats: { label: string; value: string }[] = [
    { label: "Spend", value: money(cur, ad.spend) },
    { label: "Result", value: objectiveResult(obj, ad) },
    ...(obj === "SALES" ? [{ label: "ROAS", value: ad.roas > 0 ? `${ad.roas}x` : "-" }] : []),
    { label: costLabelFor(obj), value: objectiveCost(obj, ad, cur) },
    { label: "Impressions", value: compact(ad.impressions) },
    { label: "Reach", value: compact(ad.reach) },
    { label: "CPM", value: money(cur, ad.cpm) },
    { label: "CTR", value: `${ad.ctr}%` },
    { label: "CPC", value: money(cur, ad.cpc) },
    { label: "Link Clicks", value: compact(ad.outboundClicks || ad.clicks) },
    { label: "Landing Page Views", value: compact(ad.lpv) },
    { label: "LP%", value: ad.clicks > 0 ? `${(ad.lpv / ad.clicks * 100).toFixed(0)}%` : "-" },
    { label: "Add to Cart", value: ad.atc > 0 ? `${ad.atc}${ad.atcValue > 0 ? ` · ${money(cur, ad.atcValue)}` : ""}` : "-" },
    { label: "ATC%", value: ad.lpv > 0 ? `${(ad.atc / ad.lpv * 100).toFixed(0)}%` : "-" },
    { label: "Checkout (CI)", value: ad.checkout > 0 ? `${ad.checkout}${ad.checkoutValue > 0 ? ` · ${money(cur, ad.checkoutValue)}` : ""}` : "-" },
    { label: "CI%", value: ad.atc > 0 ? `${(ad.checkout / ad.atc * 100).toFixed(0)}%` : "-" },
    ...(obj === "SALES" ? [
      { label: "Purchase", value: ad.purchases > 0 ? `${ad.purchases}${ad.purchaseValue > 0 ? ` · ${money(cur, ad.purchaseValue)}` : ""}` : "-" },
      { label: "P%", value: ad.checkout > 0 ? `${(ad.purchases / ad.checkout * 100).toFixed(0)}%` : "-" },
    ] : []),
    ...(ad.creative.type === "video" && ad.thumbStopRatio > 0 ? [{ label: "Thumb-stop", value: `${ad.thumbStopRatio}%` }] : []),
    ...(ad.creative.type === "video" && ad.videoViews3s > 0 ? [{ label: "Hold ratio", value: `${(ad.thruplay / ad.videoViews3s * 100).toFixed(0)}%` }] : []),
  ];

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-[#171717] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-4 border-b border-black/[0.06] dark:border-white/[0.06] sticky top-0 bg-white dark:bg-[#171717] z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn("px-2 py-0.5 rounded-full text-[13px] font-bold", OBJ_META[obj]?.badge ?? OBJ_META.OTHER.badge)}>{OBJ_META[obj]?.label ?? "Ad"}</span>
              <span className="text-[14px] text-[#A1A1AA] capitalize">{c.type === "unknown" ? "ad" : c.type}</span>
              <span className={cn("text-[12px] px-1.5 py-0.5 rounded-full font-bold", statusBadge(ad.status))}>{ad.status}</span>
            </div>
            <h3 className="text-[18px] font-bold text-[#18181B] dark:text-[#F4F4F5] truncate" title={ad.name}>{ad.name}</h3>
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg hover:bg-[#F5F5F4] dark:hover:bg-[#262626] text-[#71717A] dark:text-[#A1A1AA]"><X size={18} /></button>
        </div>

        <div className="grid md:grid-cols-2 gap-0">
          {/* Creative */}
          <div className="bg-[#0C0C0C] flex items-center justify-center min-h-[260px] md:min-h-[420px] p-2">
            {c.type === "carousel" && c.images.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto snap-x w-full h-full items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.images.map((src, i) => <img key={i} src={src} alt="" className="max-h-[400px] rounded-lg object-contain snap-center shrink-0" />)}
              </div>
            ) : c.type === "video" && c.videoThumb ? (
              <a href={c.videoId ? `https://www.facebook.com/watch/?v=${c.videoId}` : undefined} target="_blank" rel="noreferrer" className="relative block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.videoThumb} alt="" className="max-h-[420px] rounded-lg object-contain" />
                <div className="absolute inset-0 flex items-center justify-center"><div className="w-14 h-14 rounded-full bg-black/55 flex items-center justify-center"><Play size={26} className="text-white ml-1" fill="white" /></div></div>
              </a>
            ) : c.images.length > 0 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.images[0]} alt="" className="max-h-[420px] rounded-lg object-contain" />
            ) : (
              <div className="text-[#A1A1AA] text-[15px]">No preview available</div>
            )}
          </div>

          {/* Copy + metrics */}
          <div className="p-4">
            {cta && (
              <span className="inline-flex items-center gap-1 text-[14px] font-bold text-[#1877F2] bg-[#EFF6FF] dark:bg-[#0D1E3D] dark:text-[#93C5FD] px-2.5 py-1 rounded-full mb-3">
                <MousePointerClick size={12} /> {cta}
              </span>
            )}
            <div className="space-y-3 text-[15px]">
              {c.primaryText && (<div><div className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider mb-1">Primary text</div><p className="text-[#18181B] dark:text-[#F4F4F5] leading-relaxed whitespace-pre-line">{c.primaryText}</p></div>)}
              {c.headline && (<div><div className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider mb-1">Headline</div><p className="text-[#18181B] dark:text-[#F4F4F5] font-semibold">{c.headline}</p></div>)}
              {!c.primaryText && !c.headline && (<p className="text-[#A1A1AA]">No ad copy returned for this creative.</p>)}
            </div>

            {/* Catalog set (DPA) + how long it's been running */}
            {(c.catalogName || ad.createdTime) && (
              <div className="flex flex-wrap gap-2 mt-3">
                {c.catalogName && (
                  <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#7C3AED] bg-[#F5F3FF] dark:bg-[#1E1437] px-2.5 py-1 rounded-full">
                    <Layers size={12} /> Catalog: {c.catalogName}
                  </span>
                )}
                {ad.createdTime && (() => {
                  const start = new Date(ad.createdTime);
                  const days = Math.max(0, Math.round((Date.now() - start.getTime()) / 86_400_000));
                  return (
                    <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#52525B] dark:text-[#A1A1AA] bg-[#F5F5F4] dark:bg-[#1C1C1C] px-2.5 py-1 rounded-full">
                      Active {days}d · since {start.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  );
                })()}
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 pt-4 border-t border-black/[0.06] dark:border-white/[0.06]">
              {stats.map(s => (
                <div key={s.label} className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] text-[#A1A1AA] uppercase tracking-wide">{s.label}</span>
                  <span className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5] tabular-nums truncate">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function AdCard({ ad, obj, cur }: { ad: AdRow; obj: ObjFilter; cur: string }) {
  const [showFixes, setShowFixes] = useState(false);
  const [preview, setPreview] = useState(false);
  const fixes = buildAdFixes(ad, cur);
  const cta = ctaLabel(ad.creative.cta);
  const result = objectiveResult(obj, ad);
  const TypeIcon = ad.creative.type === "video" ? Film : ad.creative.type === "carousel" ? Images : ImageIcon;
  const stats: { label: string; value: string }[] = [
    { label: "Spend", value: money(cur, ad.spend) },
    { label: "Result", value: result },
    ...(obj === "SALES" ? [{ label: "ROAS", value: ad.roas > 0 ? `${ad.roas}x` : "-" }] : []),
    { label: costLabelFor(obj), value: objectiveCost(obj, ad, cur) },
    { label: "CTR", value: `${ad.ctr}%` },
    { label: "CPC", value: money(cur, ad.cpc) },
  ];
  if (ad.creative.type === "video" && ad.thumbStopRatio > 0) stats.push({ label: "Thumb-stop", value: `${ad.thumbStopRatio}%` });
  return (
    <div className="rounded-2xl border border-black/[0.06] dark:border-white/[0.06] overflow-hidden bg-white dark:bg-[#171717]">
      {preview && <AdPreviewModal ad={ad} obj={obj} cur={cur} onClose={() => setPreview(false)} />}
      <button onClick={() => setPreview(true)} className="block w-full aspect-square bg-[#F5F5F4] dark:bg-[#0C0C0C] relative cursor-pointer group" title="Click to preview full creative & copy">
        <CreativeMedia c={ad.creative} />
        <span className="absolute top-2 left-2 flex items-center gap-1 text-[12px] font-bold px-1.5 py-0.5 rounded-full bg-black/55 text-white">
          <TypeIcon size={11} /> {ad.creative.type === "unknown" ? "Ad" : ad.creative.type.charAt(0).toUpperCase() + ad.creative.type.slice(1)}
        </span>
        <span className={cn("absolute top-2 right-2 text-[12px] px-1.5 py-0.5 rounded-full font-bold", statusBadge(ad.status))}>{ad.status}</span>
        <span className="absolute bottom-2 right-2 text-[12px] font-bold px-2 py-0.5 rounded-full bg-black/55 text-white opacity-0 group-hover:opacity-100 transition-opacity">Tap to expand</span>
      </button>
      <div className="p-3">
        <div className="font-bold text-[15px] text-[#18181B] dark:text-[#F4F4F5] truncate" title={ad.name}>{ad.name}</div>
        {cta && (
          <span className="inline-flex items-center gap-1 mt-1.5 text-[13px] font-bold text-[#1877F2] bg-[#EFF6FF] dark:bg-[#0D1E3D] dark:text-[#93C5FD] px-2 py-0.5 rounded-full">
            <MousePointerClick size={11} /> {cta}
          </span>
        )}
        {ad.creative.primaryText && (
          <p className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] mt-2 leading-snug line-clamp-2">{ad.creative.primaryText}</p>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 pt-3 border-t border-black/[0.05] dark:border-white/[0.05]">
          {stats.map(s => (
            <div key={s.label} className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] text-[#A1A1AA] uppercase tracking-wide">{s.label}</span>
              <span className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5] tabular-nums truncate">{s.value}</span>
            </div>
          ))}
        </div>

        {/* Below-benchmark fixes for this specific ad (creative + delivery levers) */}
        {fixes.length > 0 ? (
          <div className="mt-3 pt-2 border-t border-black/[0.05] dark:border-white/[0.05]">
            <button onClick={() => setShowFixes(o => !o)}
              className="flex items-center gap-1.5 text-[13px] font-bold text-[#EA580C] dark:text-[#FB923C]">
              <AlertTriangle size={12} /> {fixes.length} fix{fixes.length > 1 ? "es" : ""} to improve
              <ChevronDown size={12} className={cn("transition-transform", showFixes && "rotate-180")} />
            </button>
            {showFixes && (
              <ul className="mt-2 space-y-2">
                {fixes.map((f, i) => (
                  <li key={i} className={cn("border-l-[3px] rounded-r-lg pl-2 py-1",
                    f.severity === "issue" ? "border-l-[#EF4444] bg-[#FEF2F2] dark:bg-[#2D0A0A]" : "border-l-[#F97316] bg-[#FFF7ED] dark:bg-[#2A1A0E]")}>
                    <div className="text-[13px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{f.kpi}</div>
                    <div className="text-[13px] text-[#52525B] dark:text-[#A1A1AA] leading-snug">{f.advice}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="mt-3 pt-2 border-t border-black/[0.05] dark:border-white/[0.05] flex items-center gap-1.5 text-[13px] font-bold text-[#16A34A]">
            <CheckCircle2 size={12} /> Meeting benchmarks
          </div>
        )}
      </div>
    </div>
  );
}

export default function MetaPage() {
  const { range } = useDateRange();
  const [data, setData] = useState<MetaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notConnected, setNotConnected] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [objFilter, setObjFilter] = useState<ObjFilter>("ALL");
  const [objView, setObjView] = useState<ObjFilter>("ALL");
  const [drill, setDrill] = useState<{ campId: string; campName: string; obj: ObjFilter; adsetId?: string; adsetName?: string } | null>(null);
  const [drillRows, setDrillRows] = useState<(AdSetRow | AdRow)[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [months, setMonths] = useState(6);
  const [monthly, setMonthly] = useState<MetaMonthRow[] | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setDrill(null); setDrillRows([]); // a new date range invalidates any open drill-down
    fetch(`/api/meta?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then(d => {
        if (d.error === "not_connected" || d.error === "token_expired") { setNotConnected(true); return; }
        if (!d.error) setData(d);
      })
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  // Month-wise - lazy load on tab open / window change.
  useEffect(() => {
    if (tab !== "monthly") return;
    setMonthlyLoading(true);
    fetch(`/api/meta/monthly?months=${months}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setMonthly(d.months ?? []); })
      .finally(() => setMonthlyLoading(false));
  }, [tab, months]);

  async function loadDrill(level: "adset" | "ad", parentId: string) {
    setDrillLoading(true); setDrillError(null); setDrillRows([]);
    try {
      const r = await fetch(`/api/meta/drilldown?level=${level}&parentId=${parentId}&from=${range.from}&to=${range.to}`);
      const d = await r.json();
      if (d.error) setDrillError(typeof d.error === "string" ? d.error : "Could not load");
      else setDrillRows(d.rows ?? []);
    } catch { setDrillError("Could not load"); }
    finally { setDrillLoading(false); }
  }
  function openCampaign(c: MetaData["campaigns"][number]) {
    setObjFilter("ALL");
    setDrill({ campId: c.id, campName: c.name, obj: normalizeObj(c.objective) });
    loadDrill("adset", c.id);
  }
  function openAdset(a: AdSetRow) {
    setDrill(d => d ? { ...d, adsetId: a.id, adsetName: a.name } : d);
    loadDrill("ad", a.id);
  }
  function drillToCampaigns() { setDrill(null); setDrillRows([]); setDrillError(null); }
  function drillToAdsets() {
    if (!drill) return;
    setDrill({ campId: drill.campId, campName: drill.campName, obj: drill.obj });
    loadDrill("adset", drill.campId);
  }

  if (loading) return <div className="text-[16px] text-[#A1A1AA] py-16 text-center">Loading Meta Ads data…</div>;

  if (notConnected) return (
    <div className="text-center py-20">
      <div className="w-16 h-16 bg-[#EFF6FF] dark:bg-[#0D1E3D] rounded-2xl flex items-center justify-center mx-auto mb-4 border border-[#BFDBFE] dark:border-[#1E40AF]">
        <Share2 size={28} className="text-[#1877F2]" />
      </div>
      <h2 className="text-[18px] font-bold mb-1 text-[#18181B] dark:text-[#F4F4F5]">Meta Ads not connected</h2>
      <p className="text-[15px] text-[#71717A] mb-5">Connect to see campaign spend, impressions, clicks and ROAS.</p>
      <Link href="/dashboard/connections" className="px-5 py-2.5 bg-[#F97316] text-white rounded-xl text-[15px] font-semibold hover:bg-[#EA580C] transition-colors">
        Connect Meta Ads →
      </Link>
    </div>
  );

  if (!data) return <div className="text-[16px] text-[#EF4444] py-8 text-center">Could not load Meta Ads data.</div>;

  const k = data.kpis;
  const cur = data.currency === "INR" ? "₹" : data.currency === "USD" ? "$" : data.currency + " ";
  const fmt = (n: number) => n.toLocaleString("en-IN");
  const fmtC = (n: number) => `${cur}${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const dailyFmt = data.daily.map(d => ({ ...d, label: d.date.slice(5) }));

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "campaigns", label: `Campaigns (${data.campaigns.length})` },
    { key: "monthly", label: "Month-wise" },
  ];

  const META_MONTHLY_KPIS: { key: keyof MetaMonthRow; label: string; fmt: (v: number) => string; higher: boolean }[] = [
    { key: "spend", label: "Spend", fmt: v => money(cur, v), higher: false },
    { key: "purchaseValue", label: "Revenue", fmt: v => money(cur, v), higher: true },
    { key: "roas", label: "ROAS", fmt: v => `${v}×`, higher: true },
    { key: "purchases", label: "Orders", fmt: v => v.toLocaleString("en-IN"), higher: true },
    { key: "cac", label: "CAC", fmt: v => v > 0 ? money(cur, v) : "-", higher: false },
    { key: "leads", label: "Leads", fmt: v => v.toLocaleString("en-IN"), higher: true },
    { key: "cpl", label: "Cost / Lead", fmt: v => v > 0 ? money(cur, v) : "-", higher: false },
    { key: "ctr", label: "CTR", fmt: v => `${v}%`, higher: true },
    { key: "cpm", label: "CPM", fmt: v => money(cur, v), higher: false },
    { key: "clicks", label: "Clicks", fmt: v => v.toLocaleString("en-IN"), higher: true },
    { key: "impressions", label: "Impressions", fmt: v => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : `${v}`, higher: true },
  ];

  const hasVideo = k.videoViews3s > 0 || k.thruplay > 0;

  // Hero row is judged on conversion-campaign spend only - so awareness/traffic/lead
  // spend never drags ROAS into the red on a metric it was never optimized for.
  const salesBucket = aggregate(data.campaigns, "SALES");
  const hasConv = salesBucket.count > 0;
  const convRoas = hasConv ? salesBucket.roas : k.roas;
  const convOrders = hasConv ? salesBucket.purchases : k.purchases;
  const convRevenue = hasConv ? salesBucket.purchaseValue : k.purchaseValue;
  const convCac = hasConv ? salesBucket.cac : k.cac;
  const convSpend = hasConv ? salesBucket.spend : k.spend;
  const hasAnyConv = convOrders > 0 || convRevenue > 0;

  const presentObjs = OBJ_ORDER.filter(o => data.campaigns.some(c => normalizeObj(c.objective) === o));
  // Show the objective breakdown whenever any objective is detected - including
  // single-objective accounts (e.g. a leads-only store), so their Leads / Cost-per-Lead
  // surface the same way a multi-objective account's do.
  const showObjective = presentObjs.length >= 1;
  const objViews: ObjFilter[] = ["ALL", ...presentObjs];
  // Fall back to "All" if the focused objective no longer exists in the current range.
  const effectiveView: ObjFilter = objView !== "ALL" && presentObjs.includes(objView) ? objView : "ALL";
  const viewBucket = effectiveView !== "ALL" ? aggregate(data.campaigns, effectiveView) : null;

  function buildSections() {
    if (!data) return [];
    const objLabel = (raw: string) => OBJ_META[normalizeObj(raw)]?.label ?? raw;
    return [
      {
        title: "Meta Ads KPIs",
        headers: ["Metric", "Value"],
        rows: [
          ["Spend", fmtC(k.spend)],
          ["ROAS", `${k.roas}x`],
          ["CAC (Cost per acquisition)", fmtC(k.cac)],
          ["Purchases", k.purchases],
          ["Purchase Value", fmtC(k.purchaseValue)],
          ["Leads", fmt(k.leads)],
          ["Cost per Lead", k.leads > 0 ? fmtC(k.costPerLead) : "-"],
          ["Impressions", fmt(k.impressions)],
          ["Reach", fmt(k.reach)],
          ["Frequency", k.frequency.toFixed(2)],
          ["CPM", fmtC(k.cpm)],
          ["Clicks", fmt(k.clicks)],
          ["CTR", `${k.ctr}%`],
          ["CPC", fmtC(k.cpc)],
          ["Outbound Clicks", fmt(k.outboundClicks)],
          ["Outbound CTR", `${k.outboundCtr}%`],
          ["Landing Page Views", fmt(k.lpv)],
          ["LP View Ratio", `${k.lpRatio}%`],
          ["Add to Cart", fmt(k.atc)],
          ["ATC Value", fmtC(k.atcValue)],
          ["ATC Ratio", `${k.atcRatio}%`],
          ["Checkout Started", fmt(k.checkout)],
          ["Checkout Value", fmtC(k.checkoutValue)],
          ["Checkout Ratio", `${k.checkoutRatio}%`],
          ["Purchase Ratio", `${k.purchaseRatio}%`],
          ["Conversion Ratio", `${k.conversionRatio}%`],
          ...(hasVideo ? [
            ["Video Views (3s)", fmt(k.videoViews3s)] as [string, string],
            ["Thruplay", fmt(k.thruplay)] as [string, string],
            ["Thumb Stop Ratio", `${k.thumbStopRatio}%`] as [string, string],
            ["Hold Ratio", `${k.holdRatio}%`] as [string, string],
          ] : []),
        ],
      },
      {
        title: "Campaigns",
        headers: ["Campaign", "Status", "Objective", "Spend", "Impressions", "Clicks", "CTR", "CPC", "Orders", "Revenue", "ROAS"],
        rows: data.campaigns.map(c => [
          c.name, c.status, objLabel(c.objective),
          fmtC(c.spend), fmt(c.impressions), fmt(c.clicks),
          `${c.ctr}%`, fmtC(c.cpc), c.purchases, fmtC(c.purchaseValue), `${c.roas}x`,
        ]),
      },
      {
        title: "Daily Trend",
        headers: ["Date", "Spend", "Impressions", "Clicks", "Purchases", "Revenue"],
        rows: data.daily.map(d => [d.date, fmtC(d.spend), fmt(d.impressions), fmt(d.clicks), d.purchases, fmtC(d.purchaseValue)]),
      },
    ];
  }

  function handleExportCSV() { exportToCSV(`skylitee-meta-${range.from}`, buildSections()); }
  async function handleExportPDF() {
    if (!data) return;
    await exportToPDF(
      `skylitee-meta-${range.from}`,
      "Meta Ads Report",
      `${data.adAccountName} · ${formatDateSpan(data.period.from, data.period.to)}`,
      buildSections()
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-[#18181B] dark:text-[#F4F4F5] flex items-center gap-2"><Share2 size={18} className="text-[#1877F2]" /> Meta Ads</h2>
          <p className="text-[15px] text-[#A1A1AA] mt-0.5">
            {data.adAccountName} · {formatDateSpan(data.period.from, data.period.to)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[14px] text-[#EA580C] dark:text-[#FB923C] font-semibold bg-[#FFF7ED] dark:bg-[#2A1A0E] px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" /> Live
          </span>
          <ExportButton onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 overflow-x-auto border-b border-black/[0.06] dark:border-white/[0.06] mb-4">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("px-4 py-2 text-[15px] font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap",
              tab === t.key
                ? "border-[#F97316] text-[#F97316]"
                : "border-transparent text-[#71717A] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#F4F4F5]"
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          {/* Performance by Objective - each objective judged on the KPI it's optimized for */}
          {showObjective && (
            <ObjectiveScorecards campaigns={data.campaigns} cur={cur} totalSpend={k.spend} active={effectiveView} onSelect={setObjView} />
          )}

          {/* Objective toggle */}
          {showObjective && (
            <div className="flex flex-wrap gap-2">
              {objViews.map(o => {
                const isActive = effectiveView === o;
                const m = OBJ_META[o];
                return (
                  <button key={o} onClick={() => setObjView(o)}
                    className={cn("px-3 py-1.5 rounded-xl text-[15px] font-semibold border transition-all",
                      isActive
                        ? cn(m.chip, "shadow-sm ring-1 ring-current ring-offset-1")
                        : "bg-[#F5F5F4] dark:bg-[#1C1C1C] text-[#71717A] dark:text-[#A1A1AA] border-transparent hover:border-black/10 dark:hover:border-white/10")}>
                    {o === "ALL" ? "All objectives" : m.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Focused single-objective view */}
          {effectiveView !== "ALL" && viewBucket ? (
            <ObjectiveDetail b={viewBucket} k={k} cur={cur} totalSpend={k.spend} />
          ) : (
          <>
          {/* Core KPIs - ROAS / orders / revenue / CAC scoped to conversion spend */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            <KPICard label="Total Spend" value={fmtC(k.spend)} sub={hasConv ? `${cur}${convSpend.toLocaleString("en-IN", { maximumFractionDigits: 0 })} on conversion` : undefined} />
            <KPICard label="ROAS" value={hasAnyConv ? `${convRoas}x` : "-"}
              {...(hasAnyConv ? bench(convRoas, 2.0, 3.0) : {})}
              sub={hasConv ? "Conversion campaigns" : "No conversion campaigns"} />
            <KPICard label="CAC" value={hasAnyConv ? fmtC(convCac) : "-"} sub="Cost per order" />
            <KPICard label="Total Orders" value={fmt(convOrders)} />
            <KPICard label="Total Order Value" value={fmtC(convRevenue)} />
          </div>

          {/* Reach & Delivery */}
          <div>
            <SectionLabel>Reach &amp; Delivery</SectionLabel>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <KPICard label="Impressions" value={k.impressions >= 1000 ? `${(k.impressions / 1000).toFixed(1)}K` : fmt(k.impressions)} />
              <KPICard label="Reach" value={k.reach >= 1000 ? `${(k.reach / 1000).toFixed(1)}K` : fmt(k.reach)} />
              <KPICard label="Frequency" value={`${k.frequency}x`}
                {...bench(k.frequency, 3, 1, false)}
                changeLabel={k.frequency <= 3 ? "Healthy range" : k.frequency <= 5 ? "Approaching fatigue" : "Ad fatigue risk"} />
              <KPICard label="CPM" value={fmtC(k.cpm)} sub="Cost per 1,000 views" />
            </div>
          </div>

          {/* Click Performance */}
          <div>
            <SectionLabel>Click Performance</SectionLabel>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <KPICard label="Clicks" value={fmt(k.clicks)} />
              <KPICard label="CTR" value={`${k.ctr}%`} {...bench(k.ctr, 0.9, 1.5)} />
              <KPICard label="CPC" value={fmtC(k.cpc)} />
              <KPICard label="Outbound Clicks" value={fmt(k.outboundClicks)}
                sub={k.outboundCtr > 0 ? `Outbound CTR: ${k.outboundCtr}%` : undefined} />
            </div>
          </div>

          {/* Conversion Funnel - all objectives combined; use the Sales toggle for sales-only */}
          <FunnelCard k={k} cur={cur} note={hasConv ? "All objectives combined (awareness + traffic + sales). Click the Sales toggle above for the sales-only funnel." : undefined} />

          {/* Video metrics */}
          {hasVideo && (
            <div>
              <SectionLabel>Video Performance</SectionLabel>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <KPICard label="Thumb Stop Ratio" value={`${k.thumbStopRatio}%`}
                  {...bench(k.thumbStopRatio, 25, 30)}
                  changeLabel={k.thumbStopRatio >= 30 ? "Strong hook" : k.thumbStopRatio >= 20 ? "Near avg · Avg: 25%" : "Weak hook · Avg: 25%"} />
                <KPICard label="Hold Ratio" value={`${k.holdRatio}%`}
                  {...bench(k.holdRatio, 15, 20)}
                  changeLabel={k.holdRatio >= 20 ? "Strong retention" : k.holdRatio >= 12 ? "Near avg · Avg: 15%" : "Drop-off risk"} />
                <KPICard label="3-Sec Video Views" value={fmt(k.videoViews3s)} sub="Stopped scrolling" />
                <KPICard label="ThruPlay" value={fmt(k.thruplay)} sub="Watched to end / 15s" />
              </div>
            </div>
          )}

          {/* Daily Performance chart */}
          {dailyFmt.length > 0 && (
            <Card>
              <CardHeader title="Daily Performance" right={formatDateSpan(data.period.from, data.period.to)} />
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyFmt} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                    <defs>
                      <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#94A3B8" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#94A3B8" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F97316" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" strokeOpacity={0.5} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#A1A1AA" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, border: "1px solid #E5E5E5", borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
                      formatter={(v, name) => [`${cur}${(v as number) ?? 0}`, name === "spend" ? "Spend" : "Revenue"]} />
                    <Legend formatter={(v) => v === "spend" ? "Spend" : "Revenue"} wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="spend" stroke="#94A3B8" strokeWidth={2} fill="url(#spendGrad)" dot={false} />
                    <Area type="monotone" dataKey="purchaseValue" stroke="#F97316" strokeWidth={2.5} fill="url(#revGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* What's working & what's not - vs industry benchmarks (ROAS scoped to conversion) */}
          <DiagnosisPanel diag={buildDiagnosis(k, convRoas, hasAnyConv)} />
          </>
          )}
        </div>
      )}

      {tab === "campaigns" && (() => {
        // Build objective counts
        const objCounts = new Map<ObjFilter, number>();
        data.campaigns.forEach(c => {
          const o = normalizeObj(c.objective);
          objCounts.set(o, (objCounts.get(o) ?? 0) + 1);
        });
        const activeFilters: ObjFilter[] = ["ALL", ...Array.from(objCounts.keys()).sort()];
        const filtered = objFilter === "ALL" ? data.campaigns : data.campaigns.filter(c => normalizeObj(c.objective) === objFilter);

        // Column definitions per objective
        type CampaignRow = (typeof data.campaigns)[0];
        type Col = { label: string; render: (c: CampaignRow) => React.ReactNode };
        const salesCols: Col[] = [
          { label: "Spend",    render: c => <span className="font-semibold whitespace-nowrap">{cur}{c.spend.toLocaleString("en-IN")}</span> },
          { label: "ROAS",     render: c => <span className={cn("font-bold", c.roas >= 3 ? "text-[#F97316]" : c.roas >= 1 ? "text-[#18181B] dark:text-[#F4F4F5]" : "text-[#EF4444]")}>{c.roas > 0 ? `${c.roas}x` : "-"}</span> },
          { label: "Orders",   render: c => <span>{c.purchases > 0 ? c.purchases : "-"}</span> },
          { label: "Revenue",  render: c => <span className="whitespace-nowrap">{c.purchaseValue > 0 ? `${cur}${c.purchaseValue.toLocaleString("en-IN")}` : "-"}</span> },
          { label: "CAC",      render: c => <span className="whitespace-nowrap font-semibold">{c.purchases > 0 ? `${cur}${(c.spend / c.purchases).toFixed(2)}` : "-"}</span> },
          { label: "ATC",      render: c => <span>{c.atc > 0 ? c.atc : "-"}</span> },
          { label: "CTR",      render: c => <span className="text-[#71717A] dark:text-[#A1A1AA]">{c.ctr}%</span> },
          { label: "CPC",      render: c => <span className="whitespace-nowrap text-[#71717A] dark:text-[#A1A1AA]">{cur}{c.cpc}</span> },
        ];
        const trafficCols: Col[] = [
          { label: "Spend",    render: c => <span className="font-semibold whitespace-nowrap">{cur}{c.spend.toLocaleString("en-IN")}</span> },
          { label: "Clicks",   render: c => <span>{c.clicks.toLocaleString("en-IN")}</span> },
          { label: "Visits",   render: c => <span className="font-bold">{c.lpv > 0 ? c.lpv.toLocaleString("en-IN") : "-"}</span> },
          { label: "Cost/Visit", render: c => <span className="whitespace-nowrap font-semibold">{c.lpv > 0 ? `${cur}${(c.spend / c.lpv).toFixed(2)}` : "-"}</span> },
          { label: "CTR",      render: c => <span className={cn("font-bold", c.ctr >= 1.5 ? "text-[#F97316]" : c.ctr >= 0.9 ? "text-[#18181B] dark:text-[#F4F4F5]" : "text-[#EF4444]")}>{c.ctr}%</span> },
          { label: "CPC",      render: c => <span className="whitespace-nowrap text-[#71717A] dark:text-[#A1A1AA]">{cur}{c.cpc}</span> },
        ];
        const awareCols: Col[] = [
          { label: "Spend",       render: c => <span className="font-semibold whitespace-nowrap">{cur}{c.spend.toLocaleString("en-IN")}</span> },
          { label: "Impressions", render: c => <span className="font-bold">{c.impressions >= 1000 ? `${(c.impressions/1000).toFixed(1)}K` : c.impressions}</span> },
          { label: "Reach",       render: c => <span>{c.reach >= 1000 ? `${(c.reach/1000).toFixed(1)}K` : c.reach}</span> },
          { label: "CPM",         render: c => <span className="whitespace-nowrap font-semibold">{cur}{c.cpm}</span> },
          { label: "Freq",        render: c => <span className={cn(c.frequency > 5 ? "text-[#EF4444]" : c.frequency > 3 ? "text-[#EA580C]" : "text-[#71717A] dark:text-[#A1A1AA]")}>{c.frequency > 0 ? `${c.frequency}x` : "-"}</span> },
          { label: "CTR",         render: c => <span className="text-[#71717A] dark:text-[#A1A1AA]">{c.ctr}%</span> },
        ];
        const leadsCols: Col[] = [
          { label: "Spend",     render: c => <span className="font-semibold whitespace-nowrap">{cur}{c.spend.toLocaleString("en-IN")}</span> },
          { label: "Leads",     render: c => <span className="font-bold">{c.leads > 0 ? c.leads.toLocaleString("en-IN") : "-"}</span> },
          { label: "Cost/Lead", render: c => <span className="whitespace-nowrap font-semibold">{c.leads > 0 ? `${cur}${(c.spend / c.leads).toFixed(2)}` : "-"}</span> },
          { label: "CTR",       render: c => <span className="text-[#71717A] dark:text-[#A1A1AA]">{c.ctr}%</span> },
          { label: "CPC",       render: c => <span className="whitespace-nowrap text-[#71717A] dark:text-[#A1A1AA]">{cur}{c.cpc}</span> },
          { label: "Clicks",    render: c => <span className="text-[#71717A] dark:text-[#A1A1AA]">{c.clicks.toLocaleString("en-IN")}</span> },
        ];
        const defaultCols: Col[] = [
          { label: "Spend",       render: c => <span className="font-semibold whitespace-nowrap">{cur}{c.spend.toLocaleString("en-IN")}</span> },
          { label: "Impressions", render: c => <span>{c.impressions >= 1000 ? `${(c.impressions/1000).toFixed(1)}K` : c.impressions}</span> },
          { label: "Clicks",      render: c => <span>{c.clicks.toLocaleString("en-IN")}</span> },
          { label: "CTR",         render: c => <span>{c.ctr}%</span> },
          { label: "CPC",         render: c => <span className="whitespace-nowrap">{cur}{c.cpc}</span> },
        ];
        // In the mixed "All" view, ROAS/Orders are meaningless for non-sales campaigns.
        // The "Result" column shows each campaign's own primary outcome instead.
        const renderResult = (c: CampaignRow) => objectiveResult(normalizeObj(c.objective), c);
        // Cost-per-result, objective-aware (CAC for sales, Cost/Lead for leads, etc.).
        const costPerResult = (c: CampaignRow) => objectiveCost(normalizeObj(c.objective), { ...c, cac: c.purchases > 0 ? +(c.spend / c.purchases).toFixed(2) : 0 }, cur);
        const allCols: Col[] = [
          { label: "Spend",    render: c => <span className="font-semibold whitespace-nowrap">{cur}{c.spend.toLocaleString("en-IN")}</span> },
          { label: "Result",   render: c => <span className="font-semibold whitespace-nowrap text-[#18181B] dark:text-[#F4F4F5]">{renderResult(c)}</span> },
          { label: "Cost/Result", render: c => <span className="whitespace-nowrap font-semibold text-[#18181B] dark:text-[#F4F4F5]">{costPerResult(c)}</span> },
          { label: "ROAS",     render: c => <span className={cn("font-bold", c.roas >= 3 ? "text-[#F97316]" : c.roas >= 1 ? "text-[#18181B] dark:text-[#F4F4F5]" : c.roas > 0 ? "text-[#EF4444]" : "text-[#A1A1AA]")}>{c.roas > 0 ? `${c.roas}x` : "-"}</span> },
          { label: "Impressions", render: c => <span className="text-[#71717A] dark:text-[#A1A1AA]">{c.impressions >= 1000 ? `${(c.impressions/1000).toFixed(1)}K` : c.impressions}</span> },
          { label: "Clicks",   render: c => <span className="text-[#71717A] dark:text-[#A1A1AA]">{c.clicks.toLocaleString("en-IN")}</span> },
          { label: "CTR",      render: c => <span className="text-[#71717A] dark:text-[#A1A1AA]">{c.ctr}%</span> },
          { label: "CPC",      render: c => <span className="whitespace-nowrap text-[#71717A] dark:text-[#A1A1AA]">{cur}{c.cpc}</span> },
        ];

        const cols =
          objFilter === "SALES"     ? salesCols :
          objFilter === "TRAFFIC"   ? trafficCols :
          objFilter === "AWARENESS" ? awareCols :
          objFilter === "LEADS"     ? leadsCols :
          objFilter === "ALL"       ? allCols :
          defaultCols;

        // Ad-set / ad rows share a compact objective-aware column set.
        const drillResult = (r: DrillMetrics) => objectiveResult(drill?.obj ?? "OTHER", r);

        return (
          <Card>
            <CardHeader title={drill ? "Campaign Breakdown" : `Campaigns (${data.campaigns.length})`} right="From Meta Ads Manager" />

            {drill ? (
              <>
                {/* Breadcrumb */}
                <div className="flex items-center gap-1.5 text-[15px] mb-1.5 flex-wrap">
                  <button onClick={drillToCampaigns} className="font-semibold text-[#F97316] hover:underline">Campaigns</button>
                  <ChevronRight size={14} className="text-[#A1A1AA] shrink-0" />
                  {drill.adsetId ? (
                    <button onClick={drillToAdsets} className="font-semibold text-[#F97316] hover:underline truncate max-w-[180px]">{drill.campName}</button>
                  ) : (
                    <span className="font-bold text-[#18181B] dark:text-[#F4F4F5] truncate max-w-[240px]">{drill.campName}</span>
                  )}
                  {drill.adsetId && (
                    <>
                      <ChevronRight size={14} className="text-[#A1A1AA] shrink-0" />
                      <span className="font-bold text-[#18181B] dark:text-[#F4F4F5] truncate max-w-[240px]">{drill.adsetName}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <span className={cn("text-[13px] px-2 py-0.5 rounded-full font-bold", OBJ_META[drill.obj].badge)}>{OBJ_META[drill.obj].label}</span>
                  <span className="text-[14px] text-[#A1A1AA]">{drill.adsetId ? "Ads & creatives in this ad set" : "Ad sets in this campaign - click one to see its ads"}</span>
                </div>

                {drillLoading ? (
                  <div className="text-[15px] text-[#A1A1AA] py-12 text-center">Loading…</div>
                ) : drillError ? (
                  <div className="text-[15px] text-[#EF4444] py-12 text-center">{drillError}</div>
                ) : drillRows.length === 0 ? (
                  <div className="text-[15px] text-[#A1A1AA] py-12 text-center">Nothing ran here in this period.</div>
                ) : drill.adsetId ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {(drillRows as AdRow[]).map(ad => <AdCard key={ad.id} ad={ad} obj={drill.obj} cur={cur} />)}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[15px] border-collapse">
                      <thead>
                        <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                          {["Ad Set", "Status", "Spend", "Result", ...(drill.obj === "SALES" ? ["ROAS"] : []), costLabelFor(drill.obj), "Impressions", "Clicks", "CTR", "CPC", "CPM", "LP%", "ATC%", "CI%", "P%"].map(h => (
                            <th key={h} className="text-left py-2 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(drillRows as AdSetRow[]).map(a => (
                          <tr key={a.id} onClick={() => openAdset(a)}
                            className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors cursor-pointer">
                            <td className="py-2.5 px-2 max-w-[220px]">
                              <div className="flex items-center gap-1.5">
                                <Layers size={13} className="text-[#A1A1AA] shrink-0" />
                                <div className="min-w-0">
                                  <div className="font-semibold text-[#18181B] dark:text-[#F4F4F5] truncate">{a.name}</div>
                                  {a.optimizationGoal && <div className="text-[12px] text-[#A1A1AA] truncate">{a.optimizationGoal.replace(/_/g, " ")}</div>}
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-2"><span className={cn("text-[13px] px-2 py-0.5 rounded-full font-bold", statusBadge(a.status))}>{a.status}</span></td>
                            <td className="py-2.5 px-2 font-semibold whitespace-nowrap">{cur}{a.spend.toLocaleString("en-IN")}</td>
                            <td className="py-2.5 px-2 font-semibold whitespace-nowrap text-[#18181B] dark:text-[#F4F4F5]">{drillResult(a)}</td>
                            {drill.obj === "SALES" && (
                              <td className="py-2.5 px-2"><span className={cn("font-bold", a.roas >= 3 ? "text-[#F97316]" : a.roas >= 1 ? "text-[#18181B] dark:text-[#F4F4F5]" : a.roas > 0 ? "text-[#EF4444]" : "text-[#A1A1AA]")}>{a.roas > 0 ? `${a.roas}x` : "-"}</span></td>
                            )}
                            <td className="py-2.5 px-2 font-semibold whitespace-nowrap text-[#18181B] dark:text-[#F4F4F5]">{objectiveCost(drill.obj, a, cur)}</td>
                            <td className="py-2.5 px-2 text-[#71717A] dark:text-[#A1A1AA]">{a.impressions >= 1000 ? `${(a.impressions / 1000).toFixed(1)}K` : a.impressions}</td>
                            <td className="py-2.5 px-2 text-[#71717A] dark:text-[#A1A1AA]">{a.clicks.toLocaleString("en-IN")}</td>
                            <td className="py-2.5 px-2 text-[#71717A] dark:text-[#A1A1AA]">{a.ctr}%</td>
                            <td className="py-2.5 px-2 whitespace-nowrap text-[#71717A] dark:text-[#A1A1AA]">{cur}{a.cpc}</td>
                            <td className="py-2.5 px-2 whitespace-nowrap text-[#71717A] dark:text-[#A1A1AA]">{cur}{a.cpm}</td>
                            <td className="py-2.5 px-2 text-[#71717A] dark:text-[#A1A1AA]">{a.clicks > 0 ? `${(a.lpv / a.clicks * 100).toFixed(0)}%` : "-"}</td>
                            <td className="py-2.5 px-2 text-[#71717A] dark:text-[#A1A1AA]">{a.lpv > 0 ? `${(a.atc / a.lpv * 100).toFixed(0)}%` : "-"}</td>
                            <td className="py-2.5 px-2 text-[#71717A] dark:text-[#A1A1AA]">{a.atc > 0 ? `${(a.checkout / a.atc * 100).toFixed(0)}%` : "-"}</td>
                            <td className="py-2.5 px-2 text-[#71717A] dark:text-[#A1A1AA]">{a.checkout > 0 ? `${(a.purchases / a.checkout * 100).toFixed(0)}%` : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Objective filter chips */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {activeFilters.map(f => {
                    const m = OBJ_META[f];
                    const count = f === "ALL" ? data.campaigns.length : (objCounts.get(f) ?? 0);
                    const isActive = objFilter === f;
                    return (
                      <button key={f} onClick={() => setObjFilter(f)}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-[15px] font-semibold border transition-all",
                          isActive
                            ? cn(m.chip, "shadow-sm ring-1 ring-current ring-offset-1")
                            : "bg-[#F5F5F4] dark:bg-[#1C1C1C] text-[#71717A] dark:text-[#A1A1AA] border-transparent hover:border-black/10 dark:hover:border-white/10"
                        )}>
                        {m.label} <span className="font-normal opacity-70">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {/* KPI hint for selected objective */}
                {objFilter !== "ALL" && (
                  <div className="mb-3 text-[14px] text-[#71717A] dark:text-[#A1A1AA] bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-lg px-3 py-2">
                    {objFilter === "SALES"     && "Showing: Spend · ROAS · Orders · Revenue · ATC · CTR · CPC"}
                    {objFilter === "TRAFFIC"   && "Showing: Spend · Clicks · Visits · Cost/Visit · CTR · CPC"}
                    {objFilter === "AWARENESS" && "Showing: Spend · Impressions · Reach · CPM · Frequency · CTR"}
                    {objFilter === "ENGAGEMENT"&& "Showing: Spend · Impressions · Clicks · CTR · CPC"}
                    {objFilter === "LEADS"     && "Showing: Spend · Leads · Cost/Lead · CTR · CPC · Clicks"}
                    {objFilter === "APP"       && "Showing: Spend · Impressions · Clicks · CTR · CPC"}
                  </div>
                )}

                <div className="mb-2 text-[14px] text-[#A1A1AA]">Click a campaign to see its ad sets, ads and creatives.</div>

                {filtered.length === 0 ? (
                  <div className="text-[15px] text-[#A1A1AA] py-6 text-center">No {OBJ_META[objFilter].label.toLowerCase()} campaigns in this period</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[15px] border-collapse">
                      <thead>
                        <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                          <th className="text-left py-2 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">Campaign</th>
                          <th className="text-left py-2 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">Objective</th>
                          <th className="text-left py-2 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider">Status</th>
                          {cols.map(col => (
                            <th key={col.label} className="text-left py-2 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wider whitespace-nowrap">{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((c, i) => {
                          const obj = normalizeObj(c.objective);
                          const objM = OBJ_META[obj];
                          return (
                            <tr key={i} onClick={() => openCampaign(c)}
                              className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors cursor-pointer">
                              <td className="py-2.5 px-2 max-w-[180px]">
                                <div className="flex items-center gap-1.5">
                                  <div className="font-semibold text-[#18181B] dark:text-[#F4F4F5] truncate">{c.name}</div>
                                  <ChevronRight size={14} className="text-[#A1A1AA] shrink-0" />
                                </div>
                              </td>
                              <td className="py-2.5 px-2">
                                <span className={cn("text-[13px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap", objM.badge)}>{objM.label}</span>
                              </td>
                              <td className="py-2.5 px-2">
                                <span className={cn("text-[13px] px-2 py-0.5 rounded-full font-bold", statusBadge(c.status))}>{c.status}</span>
                              </td>
                              {cols.map(col => (
                                <td key={col.label} className="py-2.5 px-2">{col.render(c)}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            <div className="mt-3 text-[14px] text-[#A1A1AA] bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-2.5">
              {data.adAccountName} · Live from Meta Ads Manager
            </div>
          </Card>
        );
      })()}

      {/* ── MONTH-WISE ── */}
      {tab === "monthly" && (
        <Card>
          <CardHeader
            title="Month-wise ad performance"
            right={
              <div className="flex items-center gap-1.5 text-[14px]">
                <span className="text-[#A1A1AA]">Last</span>
                <select value={months} onChange={e => setMonths(parseInt(e.target.value, 10))}
                  className="bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-lg px-2 py-1 text-[14px] dark:text-[#F4F4F5] outline-none focus:border-[#1877F2]">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => <option key={n} value={n}>{n} month{n > 1 ? "s" : ""}</option>)}
                </select>
              </div>
            }
          />
          {monthlyLoading ? (
            <div className="text-[15px] text-[#71717A] py-10 text-center">Loading month-wise data…</div>
          ) : !monthly || monthly.length === 0 ? (
            <div className="text-[15px] text-[#71717A] py-10 text-center">No monthly data for this window.</div>
          ) : (
            <>
              {monthly.length > 1 && (
                <div className="h-56 mb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthly.map(m => ({ label: m.label, Spend: m.spend, Revenue: m.purchaseValue }))} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" strokeOpacity={0.5} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 12, fill: "#A1A1AA" }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ fontSize: 13, borderRadius: 12, border: "1px solid #E5E5E5" }} formatter={(v) => money(cur, Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="Spend" stroke="#94A3B8" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="Revenue" stroke="#1877F2" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-[14px] border-collapse min-w-[640px]">
                  <thead>
                    <tr className="border-b border-black/[0.08] dark:border-white/[0.08]">
                      <th className="text-left py-2 px-2 text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider sticky left-0 bg-white dark:bg-[#171717]">KPI</th>
                      {monthly.map(m => <th key={m.ym} className="text-right py-2 px-3 text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider whitespace-nowrap">{m.label}</th>)}
                      {monthly.length > 1 && <th className="text-right py-2 px-3 text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider">MoM</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {META_MONTHLY_KPIS.map(row => {
                      const last = monthly[monthly.length - 1];
                      const prev = monthly[monthly.length - 2];
                      const cv = last[row.key] as number;
                      const pv = prev ? (prev[row.key] as number) : undefined;
                      const mom = pv && pv !== 0 ? ((cv - pv) / pv) * 100 : null;
                      const good = mom === null ? null : (row.higher ? mom >= 0 : mom <= 0);
                      return (
                        <tr key={row.key} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                          <td className="py-2 px-2 font-semibold text-[#18181B] dark:text-[#F4F4F5] sticky left-0 bg-white dark:bg-[#171717]">{row.label}</td>
                          {monthly.map(m => <td key={m.ym} className="py-2 px-3 text-right tabular-nums dark:text-[#F4F4F5]">{row.fmt(m[row.key] as number)}</td>)}
                          {monthly.length > 1 && (
                            <td className={cn("py-2 px-3 text-right tabular-nums font-bold", mom === null ? "text-[#A1A1AA]" : good ? "text-[#16A34A]" : "text-[#EF4444]")}>
                              {mom === null ? "-" : `${mom >= 0 ? "▲" : "▼"} ${Math.abs(mom).toFixed(0)}%`}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[13px] text-[#A1A1AA] mt-2">MoM = latest month ({monthly[monthly.length - 1]?.label}) vs previous. Green = better (spend, CAC, CPM, cost/lead are lower-is-better). The current month is partial until it ends.</p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
