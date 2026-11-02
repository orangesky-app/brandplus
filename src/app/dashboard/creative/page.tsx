"use client";
import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { NotConnected } from "@/components/ui/not-connected";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDateRange, formatDateSpan } from "@/lib/date-range-context";
import { RangeText } from "@/components/ui/period";
import { formatINR, formatNumber } from "@/lib/utils";
import { Image as ImageIcon, Images, Video, Film, Play, MousePointerClick, LayoutGrid, TrendingUp, AlertTriangle, Info, X } from "lucide-react";
import { ExportButton } from "@/components/ui/export-button";
import { Tooltip } from "@/components/ui/tooltip";
import { exportToCSV, exportToPDF } from "@/lib/export";

type Objective = "SALES" | "TRAFFIC" | "AWARENESS" | "ENGAGEMENT" | "LEADS" | "APP" | "OTHER";

interface ParsedCreative {
  type: "image" | "carousel" | "video" | "unknown";
  images: string[];
  videoThumb: string | null;
  videoId: string | null;
  cta: string | null;
  primaryText: string | null;
  headline: string | null;
  description: string | null;
}

interface AdCreative {
  id: string;
  name: string;
  status: string;
  thumbnail: string | null;
  objectType: string | null;
  format: "image" | "video" | "carousel";
  creative: ParsedCreative;
  objective: Objective;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  frequency: number;
  purchases: number;
  purchaseValue: number;
  atc: number;
  leads: number;
  lpv: number;
  roas: number;
  cac: number;
  costPerLead: number;
  costPerVisit: number;
  videoViews3s: number;
  thruplay: number;
  thumbStopRatio: number;
  holdRatio: number;
  score: number;
  signal: "scale" | "keep" | "refresh" | "pause";
}

const OBJ_META: Record<Objective, { label: string; cls: string }> = {
  SALES:      { label: "Sales",      cls: "bg-[#fff3e0] text-[#b45309]" },
  TRAFFIC:    { label: "Traffic",    cls: "bg-[#eff6ff] text-[#1d4ed8]" },
  AWARENESS:  { label: "Awareness",  cls: "bg-[#f5f3ff] text-[#7c3aed]" },
  ENGAGEMENT: { label: "Engagement", cls: "bg-[#fdf2f8] text-[#be185d]" },
  LEADS:      { label: "Leads",      cls: "bg-[#f0fdf4] text-[#15803d]" },
  APP:        { label: "App",        cls: "bg-[#f0fdfa] text-[#0f766e]" },
  OTHER:      { label: "Other",      cls: "bg-[#f5f5f4] text-[#71717a]" },
};

// The three KPI tiles + the footer "result" line a card shows depend on the ad's objective -
// ROAS/orders only make sense for Sales, so Leads→CPL/leads, Awareness→CPM/reach, etc.
// Benchmarks match the rest of the app (ROAS 3x · CPL ₹200 · CPM ₹150 · Cost/Visit ₹8).
function objectiveView(ad: AdCreative, fmt: (n: number) => string) {
  const freq = { label: "Freq", value: ad.frequency > 0 ? ad.frequency.toFixed(1) : "-" };
  const ctr = { label: "CTR", value: `${ad.ctr.toFixed(1)}%` };
  switch (ad.objective) {
    case "LEADS":
      return {
        tiles: [{ label: "Cost/Lead", value: ad.costPerLead > 0 ? fmt(ad.costPerLead) : "-" }, ctr, freq],
        footer: `${ad.leads.toLocaleString("en-IN")} ${ad.leads === 1 ? "lead" : "leads"}`,
      };
    case "AWARENESS":
      return {
        tiles: [{ label: "CPM", value: ad.cpm > 0 ? fmt(ad.cpm) : "-" }, ctr, freq],
        footer: ad.reach > 0 ? `${ad.reach >= 1000 ? `${(ad.reach / 1000).toFixed(1)}K` : ad.reach} reach` : "-",
      };
    case "TRAFFIC":
      return {
        tiles: [{ label: ad.lpv > 0 ? "Cost/Visit" : "CPC", value: (ad.lpv > 0 ? ad.costPerVisit : ad.cpc) > 0 ? fmt(ad.lpv > 0 ? ad.costPerVisit : ad.cpc) : "-" }, ctr, freq],
        footer: ad.lpv > 0 ? `${ad.lpv.toLocaleString("en-IN")} visits` : `${ad.clicks.toLocaleString("en-IN")} clicks`,
      };
    case "SALES":
      return {
        tiles: [{ label: "ROAS", value: ad.roas > 0 ? `${ad.roas}×` : "-" }, ctr, freq],
        footer: `${ad.purchases} ${ad.purchases === 1 ? "order" : "orders"}`,
      };
    default: // engagement / app / other
      return {
        tiles: [ctr, { label: "CPC", value: ad.cpc > 0 ? fmt(ad.cpc) : "-" }, freq],
        footer: `${ad.clicks.toLocaleString("en-IN")} clicks`,
      };
  }
}

interface AdsData {
  adAccountName: string;
  currency: string;
  period: { from: string; to: string };
  ads: AdCreative[];
}

const SIGNAL_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  scale: { bg: "bg-[#e0f5ee]", text: "text-[#0d6b4f]", label: "Scale" },
  keep: { bg: "bg-[#e8f0fd]", text: "text-[#1877F2]", label: "Keep" },
  refresh: { bg: "bg-[#fff3e0]", text: "text-[#e89820]", label: "Refresh" },
  pause: { bg: "bg-[#fce8e8]", text: "text-[#d94040]", label: "Pause" },
};

function scoreColor(score: number) {
  if (score >= 75) return "bg-[#17a773]";
  if (score >= 55) return "bg-[#1877F2]";
  if (score >= 35) return "bg-[#e89820]";
  return "bg-[#d94040]";
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

// Render the actual creative - full-res image, all carousel frames, or video thumb with a
// play overlay - instead of the low-res square thumbnail. Mirrors the Meta drill-down.
function CreativeMedia({ c }: { c: ParsedCreative }) {
  const placeholder = (Icon: typeof ImageIcon, label: string) => (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-[#1877F2] opacity-50">
      <Icon size={28} /><span className="text-[14px] font-medium">{label}</span>
    </div>
  );
  if (c.type === "video") {
    if (c.videoThumb) return (
      <div className="relative w-full h-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
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
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={src} alt="" className="h-full aspect-square object-cover snap-start shrink-0" />
        ))}
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  if (c.images.length > 0) return <img src={c.images[0]} alt="" className="w-full h-full object-cover" />;
  return placeholder(ImageIcon, "No preview");
}

function CreativeCard({ ad, currency, onOpen }: { ad: AdCreative; currency: string; onOpen: () => void }) {
  const sig = SIGNAL_STYLES[ad.signal];
  const fmt = (n: number) => currency === "INR" ? formatINR(n) : `$${n.toFixed(0)}`;
  const obj = OBJ_META[ad.objective] ?? OBJ_META.OTHER;
  const view = objectiveView(ad, fmt);
  const FmtIcon = ad.format === "video" ? Video : ad.format === "carousel" ? Images : ImageIcon;
  const fmtLabel = ad.format === "video" ? "Video" : ad.format === "carousel" ? "Carousel" : "Image";
  const cta = ctaLabel(ad.creative.cta);

  return (
    <div onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="bg-white border border-black/[0.09] rounded-xl overflow-hidden hover:shadow-md hover:border-black/[0.15] transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#1877F2]/40">
      {/* Creative preview - real image / carousel / video */}
      <div className="relative h-44 bg-[#f0f5ff]">
        <CreativeMedia c={ad.creative} />
        {/* Signal badge */}
        <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[14px] font-semibold ${sig.bg} ${sig.text}`}>
          {sig.label}
        </div>
        {/* Objective + status badges */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <div className={`px-2 py-0.5 rounded-full text-[14px] font-semibold ${obj.cls}`}>{obj.label}</div>
          {ad.status === "PAUSED" && (
            <div className="px-2 py-0.5 rounded-full text-[14px] font-medium bg-black/40 text-white">Paused</div>
          )}
        </div>
        {/* Creative format badge */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[14px] font-medium bg-black/55 text-white backdrop-blur-sm">
          <FmtIcon size={11} /> {fmtLabel}
        </div>
      </div>

      <div className="p-3">
        {/* Ad name */}
        <div className="text-[16px] font-semibold text-[#181816] truncate" title={ad.name}>
          {ad.name}
        </div>

        {/* Ad copy - what the ad actually says */}
        {cta && (
          <span className="inline-flex items-center gap-1 mt-1.5 text-[13px] font-bold text-[#1877F2] bg-[#eff6ff] px-2 py-0.5 rounded-full">
            <MousePointerClick size={11} /> {cta}
          </span>
        )}
        {ad.creative.headline && (
          <div className="text-[15px] font-semibold text-[#181816] mt-1.5 line-clamp-1" title={ad.creative.headline}>{ad.creative.headline}</div>
        )}
        {ad.creative.primaryText ? (
          <p className="text-[14px] text-[#686864] mt-1 mb-2 leading-snug line-clamp-2" title={ad.creative.primaryText}>{ad.creative.primaryText}</p>
        ) : <div className="mb-2" />}

        {/* Score bar */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <Tooltip content={`Creative Score (0–100): 40% efficiency on this ad's objective (${obj.label}), 30% CTR engagement, 30% freshness (low frequency).`} side="top" maxWidth={240}>
              <span className="text-[15px] text-[#686864] inline-flex items-center gap-1 cursor-help">
                Creative Score <Info size={11} className="text-[#9e9e9a]" />
              </span>
            </Tooltip>
            <span className="text-[16px] font-semibold text-[#181816]">{ad.score}/100</span>
          </div>
          <div className="h-1.5 bg-[#f0f0ee] rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${scoreColor(ad.score)}`} style={{ width: `${ad.score}%` }} />
          </div>
        </div>

        {/* Stats grid - objective-aware */}
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {view.tiles.map(s => (
            <div key={s.label} className="text-center bg-[#f7f7f5] rounded-lg py-1.5">
              <div className="text-[16px] font-semibold text-[#181816]">{s.value}</div>
              <div className="text-[14px] text-[#9e9e9a]">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between text-[15px] text-[#686864] border-t border-black/[0.06] pt-2">
          <span>Spend: <span className="font-medium text-[#181816]">{fmt(ad.spend)}</span></span>
          <span>{view.footer}</span>
        </div>

        {/* Video metrics if applicable */}
        {ad.format === "video" && (ad.thumbStopRatio > 0 || ad.holdRatio > 0) && (
          <div className="flex gap-3 mt-2 text-[14px] text-[#9e9e9a]">
            <span>Thumb stop: <span className="text-[#181816] font-medium">{ad.thumbStopRatio}%</span></span>
            <span>Hold: <span className="text-[#181816] font-medium">{ad.holdRatio}%</span></span>
          </div>
        )}

        {/* Fatigue warning */}
        {ad.frequency >= 2.5 && (
          <div className="mt-2 flex items-center gap-1.5 text-[14px] text-[#d94040] bg-[#fce8e8] rounded-lg px-2 py-1">
            <AlertTriangle size={11} />
            Frequency {ad.frequency.toFixed(1)} - creative fatigue risk
          </div>
        )}
      </div>
    </div>
  );
}

// Full-size preview - the complete creative + all the ad copy, opened by clicking a card.
function CreativeModal({ ad, currency, onClose }: { ad: AdCreative; currency: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const c = ad.creative;
  const obj = OBJ_META[ad.objective] ?? OBJ_META.OTHER;
  const cta = ctaLabel(c.cta);
  const fmt = (n: number) => currency === "INR" ? formatINR(n) : `$${n.toFixed(0)}`;
  const fmtC = (n: number) => `${currency === "INR" ? "₹" : "$"}${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const stats: { label: string; value: string }[] = [
    { label: "Spend", value: fmtC(ad.spend) },
    ...objectiveView(ad, fmt).tiles,
    { label: "Impressions", value: ad.impressions.toLocaleString("en-IN") },
    { label: "Clicks", value: ad.clicks.toLocaleString("en-IN") },
    { label: "CPC", value: fmtC(ad.cpc) },
    { label: "CPM", value: fmtC(ad.cpm) },
    ...(ad.format === "video" && ad.thumbStopRatio > 0 ? [{ label: "Thumb-stop", value: `${ad.thumbStopRatio}%` }] : []),
    ...(ad.format === "video" && ad.holdRatio > 0 ? [{ label: "Hold", value: `${ad.holdRatio}%` }] : []),
  ];

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-4 border-b border-black/[0.06] sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded-full text-[14px] font-semibold ${obj.cls}`}>{obj.label}</span>
              <span className="text-[14px] text-[#9e9e9a] capitalize">{ad.format}</span>
            </div>
            <h3 className="text-[18px] font-semibold text-[#181816] truncate" title={ad.name}>{ad.name}</h3>
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg hover:bg-[#f0f0ee] text-[#686864]"><X size={18} /></button>
        </div>

        <div className="grid md:grid-cols-2 gap-0">
          {/* Creative */}
          <div className="bg-[#0c0c0c] flex items-center justify-center min-h-[260px] md:min-h-[420px] p-2">
            {c.type === "carousel" && c.images.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto snap-x w-full h-full items-center">
                {c.images.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt="" className="max-h-[400px] rounded-lg object-contain snap-center shrink-0" />
                ))}
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
              <div className="text-[#686864] text-[15px]">No preview available</div>
            )}
          </div>

          {/* Copy + metrics */}
          <div className="p-4">
            {cta && (
              <span className="inline-flex items-center gap-1 text-[14px] font-bold text-[#1877F2] bg-[#eff6ff] px-2.5 py-1 rounded-full mb-3">
                <MousePointerClick size={12} /> {cta}
              </span>
            )}
            <div className="space-y-3 text-[15px]">
              {c.primaryText && (<div><div className="text-[13px] font-bold text-[#9e9e9a] uppercase tracking-wider mb-1">Primary text</div><p className="text-[#181816] leading-relaxed whitespace-pre-line">{c.primaryText}</p></div>)}
              {c.headline && (<div><div className="text-[13px] font-bold text-[#9e9e9a] uppercase tracking-wider mb-1">Headline</div><p className="text-[#181816] font-semibold">{c.headline}</p></div>)}
              {c.description && (<div><div className="text-[13px] font-bold text-[#9e9e9a] uppercase tracking-wider mb-1">Description</div><p className="text-[#686864]">{c.description}</p></div>)}
              {!c.primaryText && !c.headline && !c.description && (<p className="text-[#9e9e9a]">No ad copy returned for this creative.</p>)}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 pt-4 border-t border-black/[0.06]">
              {stats.map(s => (
                <div key={s.label} className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] text-[#9e9e9a] uppercase tracking-wide">{s.label}</span>
                  <span className="text-[15px] font-semibold text-[#181816] tabular-nums truncate">{s.value}</span>
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

export default function CreativePage() {
  const { range } = useDateRange();
  const [checking, setChecking] = useState(true);
  const [connected, setConnected] = useState(false);
  const [data, setData] = useState<AdsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "scale" | "keep" | "refresh" | "pause">("all");
  const [selected, setSelected] = useState<AdCreative | null>(null);

  useEffect(() => {
    fetch("/api/meta/accounts")
      .then(r => r.json())
      .then(d => setConnected(!d.error))
      .catch(() => setConnected(false))
      .finally(() => setChecking(false));
  }, []);

  const load = useCallback(() => {
    if (!connected) return;
    setLoading(true);
    setError(null);
    fetch(`/api/meta/ads?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Failed to load creative data"))
      .finally(() => setLoading(false));
  }, [connected, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const ads = data?.ads ?? [];
  const filtered = filter === "all" ? ads : ads.filter(a => a.signal === filter);

  const topRoas = ads.length ? Math.max(...ads.map(a => a.roas)) : 0;
  const avgScore = ads.length ? Math.round(ads.reduce((s, a) => s + a.score, 0) / ads.length) : 0;
  const fatigueCount = ads.filter(a => a.frequency >= 2.5).length;
  const currency = data?.currency ?? "INR";
  const fmtC = (n: number) => `${currency === "INR" ? "₹" : "$"}${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const fmtN = (n: number) => n.toLocaleString("en-IN");

  // Headline KPI #2 adapts to the account's dominant objective (by spend) - Top ROAS is
  // meaningless on a leads/awareness account, so show the best result for what they run.
  const dominantObj: Objective = (() => {
    const spendByObj = new Map<Objective, number>();
    for (const a of ads) spendByObj.set(a.objective, (spendByObj.get(a.objective) ?? 0) + a.spend);
    let top: Objective = "SALES", max = -1;
    for (const [o, s] of spendByObj) if (s > max) { max = s; top = o; }
    return top;
  })();
  const headlineKpi = (() => {
    if (dominantObj === "LEADS") {
      const v = ads.filter(a => a.costPerLead > 0).map(a => a.costPerLead);
      return { label: "Best Cost/Lead", value: v.length ? fmtC(Math.min(...v)) : "-" };
    }
    if (dominantObj === "AWARENESS") {
      const v = ads.filter(a => a.cpm > 0).map(a => a.cpm);
      return { label: "Best CPM", value: v.length ? fmtC(Math.min(...v)) : "-" };
    }
    if (dominantObj === "TRAFFIC") {
      const v = ads.filter(a => a.costPerVisit > 0).map(a => a.costPerVisit);
      if (v.length) return { label: "Best Cost/Visit", value: fmtC(Math.min(...v)) };
      const c = ads.filter(a => a.cpc > 0).map(a => a.cpc);
      return { label: "Best CPC", value: c.length ? fmtC(Math.min(...c)) : "-" };
    }
    return { label: "Top ROAS", value: topRoas > 0 ? `${topRoas}×` : "-" };
  })();

  function buildSections() {
    if (!ads.length) return [];
    return [
      {
        title: "Creative Summary",
        headers: ["Metric", "Value"],
        rows: [
          ["Total Creatives", ads.length],
          [headlineKpi.label, headlineKpi.value],
          ["Avg Creative Score", `${avgScore}/100`],
          ["Fatigue Risk (Freq ≥ 2.5)", fatigueCount],
          ["Scale Signals", ads.filter(a => a.signal === "scale").length],
          ["Pause Signals", ads.filter(a => a.signal === "pause").length],
        ],
      },
      {
        title: "All Ad Creatives",
        headers: ["Ad Name", "Objective", "Status", "Type", "Score", "Signal", "Spend", "Impressions", "Clicks", "CTR", "CPC", "CPM", "Freq", "Leads", "Cost/Lead", "Purchases", "Revenue", "ROAS", "CAC", "ATC", "LP Views", "3s Views", "Thruplay", "Thumb Stop%", "Hold%"],
        rows: ads.map(a => [
          a.name, OBJ_META[a.objective]?.label ?? a.objective, a.status,
          a.format === "video" ? "Video" : a.format === "carousel" ? "Carousel" : "Image",
          `${a.score}/100`, SIGNAL_STYLES[a.signal]?.label ?? a.signal,
          fmtC(a.spend), fmtN(a.impressions), fmtN(a.clicks),
          `${a.ctr}%`, fmtC(a.cpc), fmtC(a.cpm),
          a.frequency.toFixed(2), a.leads, a.costPerLead > 0 ? fmtC(a.costPerLead) : "-",
          a.purchases, fmtC(a.purchaseValue),
          a.roas > 0 ? `${a.roas}x` : "-", a.cac > 0 ? fmtC(a.cac) : "-",
          a.atc, fmtN(a.lpv), fmtN(a.videoViews3s), fmtN(a.thruplay),
          a.thumbStopRatio > 0 ? `${a.thumbStopRatio}%` : "-",
          a.holdRatio > 0 ? `${a.holdRatio}%` : "-",
        ]),
      },
    ];
  }

  function handleExportCSV() { exportToCSV(`skylitee-creatives-${range.from}`, buildSections()); }
  async function handleExportPDF() {
    await exportToPDF(
      `skylitee-creatives-${range.from}`,
      "Meta Ad Creatives Report",
      `${data?.adAccountName ?? "Meta Ads"} · ${formatDateSpan(range.from, range.to)}`,
      buildSections()
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><LayoutGrid size={18} className="text-[#F97316]" /> Creative Studio</h2>
          <p className="text-[17px] text-[#686864] mt-0.5">AI creative scoring · fatigue detection · performance ranking · <RangeText /></p>
        </div>
        {ads.length > 0 && <ExportButton onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} />}
      </div>

      {checking ? (
        <div className="text-[17px] text-[#686864] py-16 text-center">Loading…</div>
      ) : !connected ? (
        <NotConnected
          platform="meta"
          label="Meta Business Suite"
          description="Connect Meta to analyse creative fatigue, score your ad creatives 0–100, and get AI-powered recommendations on what to refresh or scale."
        />
      ) : loading ? (
        <div className="text-[17px] text-[#686864] py-16 text-center">Loading creative data…</div>
      ) : error ? (
        <div className="text-[17px] text-[#d94040] py-16 text-center">{error}</div>
      ) : !ads.length ? (
        <Card>
          <div className="py-12 text-center text-[17px] text-[#686864]">
            No ads with spend found in this date range.
          </div>
        </Card>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { label: "Total Creatives", value: String(ads.length), icon: <LayoutGrid size={14} /> },
              { label: headlineKpi.label, value: headlineKpi.value, icon: <TrendingUp size={14} /> },
              { label: "Avg Creative Score", value: `${avgScore}/100`, icon: null },
              {
                label: "Fatigue Risk",
                value: String(fatigueCount),
                icon: <AlertTriangle size={14} />,
                warn: fatigueCount > 0,
              },
            ].map(k => (
              <div key={k.label} className={`bg-white border rounded-xl p-3.5 ${k.warn ? "border-[#d94040]/30" : "border-black/[0.09]"}`}>
                <div className="text-[17px] text-[#686864] mb-1.5 flex items-center gap-1 font-medium">
                  {k.icon} {k.label}
                </div>
                <div className={`text-2xl font-semibold ${k.warn && fatigueCount > 0 ? "text-[#d94040]" : "text-[#181816]"}`}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1.5 mb-3">
            {(["all", "scale", "keep", "refresh", "pause"] as const).map(f => {
              const count = f === "all" ? ads.length : ads.filter(a => a.signal === f).length;
              const sig = f === "all" ? null : SIGNAL_STYLES[f];
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-[16px] font-medium transition-colors ${
                    filter === f
                      ? (sig ? `${sig.bg} ${sig.text}` : "bg-[#181816] text-white")
                      : "bg-[#f7f7f5] text-[#686864] hover:bg-[#eeeeec]"
                  }`}
                >
                  {f === "all" ? "All" : SIGNAL_STYLES[f].label} ({count})
                </button>
              );
            })}
          </div>

          {/* Creative grid */}
          <div className="grid grid-cols-3 gap-2">
            {filtered.map(ad => (
              <CreativeCard key={ad.id} ad={ad} currency={currency} onOpen={() => setSelected(ad)} />
            ))}
          </div>

          {selected && <CreativeModal ad={selected} currency={currency} onClose={() => setSelected(null)} />}

          {filtered.length === 0 && (
            <Card>
              <div className="py-10 text-center text-[17px] text-[#686864]">
                No creatives in this category.
              </div>
            </Card>
          )}

          {/* Legend */}
          <div className="mt-3 flex items-center gap-4 text-[15px] text-[#9e9e9a]">
            <span className="font-medium text-[#686864]">Score guide:</span>
            {[
              { color: "bg-[#17a773]", label: "75–100 Scale" },
              { color: "bg-[#1877F2]", label: "55–74 Keep" },
              { color: "bg-[#e89820]", label: "35–54 Refresh" },
              { color: "bg-[#d94040]", label: "0–34 Pause" },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1">
                <div className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
                {l.label}
              </div>
            ))}
          </div>

          {/* How Creative Score is calculated */}
          <div className="mt-3 bg-[#f7f7f5] rounded-xl p-3.5 text-[15px] text-[#686864] leading-relaxed">
            <div className="font-semibold text-[#181816] mb-1.5 flex items-center gap-1.5">
              <Info size={13} className="text-[#9e9e9a]" /> How the Creative Score works
            </div>
            Each creative is scored 0–100 from three parts:
            <span className="font-medium text-[#181816]"> 40% Efficiency</span> (judged on the KPI the ad is optimized for, not always ROAS),
            <span className="font-medium text-[#181816]"> 30% Engagement</span> (CTR) and
            <span className="font-medium text-[#181816]"> 30% Freshness</span> (lower ad frequency = less fatigue).
            The efficiency benchmark depends on the objective:
            <span className="whitespace-nowrap"> Sales → ROAS 3×</span>,
            <span className="whitespace-nowrap"> Leads → Cost/Lead ₹200</span>,
            <span className="whitespace-nowrap"> Awareness → CPM ₹150</span>,
            <span className="whitespace-nowrap"> Traffic → Cost/Visit ₹8</span>.
            So a Leads or Awareness creative is no longer penalised for having no sales - it's measured on its own goal.
          </div>
        </>
      )}
    </div>
  );
}
