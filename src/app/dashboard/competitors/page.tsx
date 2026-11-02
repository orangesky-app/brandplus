"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Binoculars, Plus, Trash2, RefreshCw, ExternalLink, Sparkles, Info, Calculator, Megaphone,
  Search, Play, Images, Image as ImageIcon, Layers, Clock, Zap, Globe, TrendingUp, LoaderCircle, X, Target,
  ShoppingBag, MonitorPlay, Type, BadgeCheck, Scale, Trophy, TrendingDown,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KPICard } from "@/components/ui/kpi-card";
import { WarnBanner } from "@/components/ui/warn-banner";
import { Tooltip } from "@/components/ui/tooltip";
import { Donut } from "@/components/ui/charts";
import { cn, formatINR, formatNumber } from "@/lib/utils";
import { formatDateSpan, toLocalYMD } from "@/lib/date-range-context";
import {
  COUNTRIES, getCountry, type Competitor, type AdsPayload, type AdStats, type CompetitorAd,
  type GoogleAd, type GoogleAdsPayload, type GoogleAdStats, type GoogleAdPlatform,
} from "@/lib/competitor-shared";
import {
  defaultAssumptions, estimateAll, estimateGoogleSpend, FX_INR,
  type Assumptions, type AssumptionSource, type OwnMetrics, type Range, type Confidence, type FullEstimate,
} from "@/lib/competitor-estimate";
import type { TrafficPayload } from "@/lib/dataforseo";
import type { StorePayload } from "@/lib/shopify-public";

// ── Types for API responses ───────────────────────────────────────────────────

interface Providers { adsAnyCountry: boolean; adsEu: boolean; euReach: boolean; traffic: boolean; ai: boolean }
type Failed = { status: "setup_needed"; missing: string[]; message: string } | { status: "error"; message: string };
type AdsResp = ({ status: "ok"; data: AdsPayload; cached: boolean; refreshBlocked?: boolean; stats: AdStats }) | Failed;
type TrafficResp = ({ status: "ok"; data: TrafficPayload; cached: boolean; refreshBlocked?: boolean }) | Failed;
type GadsResp = ({ status: "ok"; data: GoogleAdsPayload; cached: boolean; refreshBlocked?: boolean; stats: GoogleAdStats }) | Failed;
type StoreResp = { status: "ok"; data: StorePayload } | { status: "error"; message: string };

interface OwnData {
  metrics: OwnMetrics;
  period: string;                // the 30 days all of these cover, in real dates
  spend: number | null;          // ₹ last 30 days (Meta)
  roas: number | null;
  activeAds: number | null;
  formats: Record<string, number> | null;
  gscClicks: number | null;
  ga4Sessions: number | null;
  inrAccount: boolean;
  revenue: number | null;        // ₹ last 30 days (Shopify)
  googleSpend: number | null;    // ₹ last 30 days (Google Ads, when connected)
  googleConvValue: number | null;
  store: StorePayload | null;    // own catalogue, read the same public way as competitors'
}

type Tab = "ads" | "gads" | "traffic" | "spend" | "compare";

// ── Formatting ────────────────────────────────────────────────────────────────

function inrShort(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return formatINR(Math.round(n));
}
function numShort(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return formatNumber(Math.round(n));
}
const rangeInr = (r: Range) => `${inrShort(r.lo)} - ${inrShort(r.hi)}`;
const rangeX = (r: Range) => `${r.lo}x - ${r.hi}x`;
function ago(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
function last30(): { from: string; to: string } {
  const to = new Date(Date.now() - 3 * 86_400_000); // GSC finalises with a ~3-day lag
  const from = new Date(to.getTime() - 29 * 86_400_000);
  return { from: toLocalYMD(from), to: toLocalYMD(to) };
}

const SUB = "text-[15px] text-[#71717A] dark:text-[#A1A1AA]";
const confVariant: Record<Confidence, "green" | "amber" | "red"> = { High: "green", Medium: "amber", Low: "red" };
const srcLabel: Record<AssumptionSource, { text: string; variant: "green" | "blue" | "gray" }> = {
  yours: { text: "Your real data", variant: "green" },
  competitor: { text: "Their store", variant: "blue" },
  benchmark: { text: "Benchmark", variant: "gray" },
};

function EstimateTag() {
  return <Badge variant="purple" className="uppercase tracking-wide">Estimate</Badge>;
}

function SetupNeeded({ what, missing, message }: { what: string; missing: string[]; message: string }) {
  return (
    <Card className="text-center py-10">
      <Info size={22} className="mx-auto text-[#3B82F6] mb-2" />
      <div className="text-[17px] font-semibold mb-1">{what} - setup needed</div>
      <p className={cn(SUB, "max-w-md mx-auto")}>{message}</p>
      {missing.length > 0 && (
        <p className="text-[13px] text-[#A1A1AA] mt-3">Admin: add {missing.join(", ")} in Vercel environment variables.</p>
      )}
    </Card>
  );
}

function Empty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card className="text-center py-10">
      <div className="mx-auto text-[#A1A1AA] mb-2 flex justify-center">{icon}</div>
      <div className="text-[17px] font-semibold mb-1">{title}</div>
      <p className={cn(SUB, "max-w-md mx-auto")}>{body}</p>
    </Card>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className={cn(SUB, "py-12 text-center flex items-center justify-center gap-2")}>
      <LoaderCircle size={16} className="animate-spin" /> {label}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CompetitorIntelPage() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [limit, setLimit] = useState(5);
  const [providers, setProviders] = useState<Providers | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [country, setCountry] = useState("IN");
  const [tab, setTab] = useState<Tab>("ads");
  const [showAdd, setShowAdd] = useState(false);

  const [ads, setAds] = useState<AdsResp | null>(null);
  const [traffic, setTraffic] = useState<TrafficResp | null>(null);
  const [store, setStore] = useState<StoreResp | null>(null);
  const [adsLoading, setAdsLoading] = useState(false);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [gads, setGads] = useState<GadsResp | null>(null);
  const [gadsLoading, setGadsLoading] = useState(false);
  const [own, setOwn] = useState<OwnData | null>(null);

  const selected = competitors.find(c => c.id === selectedId) ?? null;
  const countryInfo = getCountry(country);

  const loadList = useCallback(() => {
    return fetch("/api/competitors").then(r => r.json()).then(d => {
      if (d.error) return;
      setCompetitors(d.competitors ?? []);
      setLimit(d.limit ?? 5);
      setProviders(d.providers ?? null);
      setSelectedId(prev => prev && d.competitors?.some((c: Competitor) => c.id === prev) ? prev : d.competitors?.[0]?.id ?? null);
    }).finally(() => setListLoading(false));
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // The user's own real numbers (last 30 days) - used for "vs you" and to calibrate estimates
  useEffect(() => {
    const { from, to } = last30();
    Promise.allSettled([
      fetch(`/api/meta?from=${from}&to=${to}`).then(r => r.json()),
      fetch(`/api/shopify/dashboard?from=${from}&to=${to}`).then(r => r.json()),
      fetch(`/api/ga4?from=${from}&to=${to}`).then(r => r.json()),
      fetch(`/api/gsc?from=${from}&to=${to}`).then(r => r.json()),
      fetch(`/api/meta/ads?from=${from}&to=${to}`).then(r => r.json()),
      fetch(`/api/google/ads?from=${from}&to=${to}`).then(r => r.json()),
      fetch(`/api/competitors/store?own=1`).then(r => r.json()),
    ]).then(([metaR, shopR, ga4R, gscR, adsR, gadsR, storeR]) => {
      const ok = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" && r.value && !(r.value as { error?: unknown }).error ? r.value : null);
      const meta = ok(metaR) as { currency?: string; kpis?: { cpm: number; ctr: number; outboundCtr?: number; spend: number; roas: number } } | null;
      const shop = ok(shopR) as { kpis?: { aov: number; totalOrders: number; grossSales: number } } | null;
      const myGads = ok(gadsR) as { currency?: string; kpis?: { spend: number; conversionValue: number } } | null;
      const myStore = ok(storeR) as StoreResp | null;
      const gInr = myGads?.kpis && (myGads.currency ?? "INR") === "INR" ? myGads.kpis : null;
      const ga4 = ok(ga4R) as { kpis?: { sessions: number } } | null;
      const gsc = ok(gscR) as { kpis?: { clicks: number } } | null;
      const myAds = ok(adsR) as { ads?: { status: string; format: string }[] } | null;
      const inr = (meta?.currency ?? "INR") === "INR";
      const sessions = ga4?.kpis?.sessions ?? 0;
      const orders = shop?.kpis?.totalOrders ?? 0;
      const active = myAds?.ads?.filter(a => a.status === "ACTIVE") ?? null;
      const formats: Record<string, number> | null = active ? {} : null;
      if (active && formats) for (const a of active) formats[a.format] = (formats[a.format] ?? 0) + 1;
      const k = meta?.kpis;
      setOwn({
        period: formatDateSpan(from, to),
        metrics: {
          cpm: inr && k?.cpm ? k.cpm : null,
          ctr: k ? (k.outboundCtr && k.outboundCtr > 0 ? k.outboundCtr : k.ctr || null) : null,
          cvr: sessions > 100 && orders > 0 ? Math.round((orders / sessions) * 10000) / 100 : null,
          aov: shop?.kpis?.aov || null,
        },
        spend: inr && k ? k.spend : null,
        roas: k && k.spend > 0 ? k.roas : null,
        activeAds: active ? active.length : null,
        formats,
        gscClicks: gsc?.kpis?.clicks ?? null,
        ga4Sessions: ga4?.kpis ? sessions : null,
        inrAccount: inr,
        revenue: shop?.kpis ? shop.kpis.grossSales : null,
        googleSpend: gInr ? gInr.spend : null,
        googleConvValue: gInr ? gInr.conversionValue : null,
        store: myStore?.status === "ok" && myStore.data.isShopify ? myStore.data : null,
      });
    });
  }, []);

  const loadAds = useCallback((refresh = false) => {
    if (!selected?.pageUrl && !selected?.pageId) { setAds(null); return; }
    setAdsLoading(true);
    fetch(`/api/competitors/ads?id=${selected.id}&country=${country}${refresh ? "&refresh=1" : ""}`)
      .then(r => r.json())
      .then(d => setAds(d.status ? d : { status: "error", message: d.error ?? "Couldn't load ads" }))
      .catch(() => setAds({ status: "error", message: "Couldn't load ads" }))
      .finally(() => setAdsLoading(false));
  }, [selected?.id, selected?.pageUrl, selected?.pageId, country]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTraffic = useCallback((refresh = false) => {
    if (!selected?.website) { setTraffic(null); return; }
    setTrafficLoading(true);
    fetch(`/api/competitors/traffic?id=${selected.id}&country=${country}${refresh ? "&refresh=1" : ""}`)
      .then(r => r.json())
      .then(d => setTraffic(d.status ? d : { status: "error", message: d.error ?? "Couldn't load traffic" }))
      .catch(() => setTraffic({ status: "error", message: "Couldn't load traffic" }))
      .finally(() => setTrafficLoading(false));
  }, [selected?.id, selected?.website, country]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadGads = useCallback((refresh = false) => {
    if (!selected?.website) { setGads(null); return; }
    setGadsLoading(true);
    fetch(`/api/competitors/google-ads?id=${selected.id}&country=${country}${refresh ? "&refresh=1" : ""}`)
      .then(r => r.json())
      .then(d => setGads(d.status ? d : { status: "error", message: d.error ?? "Couldn't load Google ads" }))
      .catch(() => setGads({ status: "error", message: "Couldn't load Google ads" }))
      .finally(() => setGadsLoading(false));
  }, [selected?.id, selected?.website, country]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAds(null); setTraffic(null); setGads(null);
    if (!selected) return;
    loadAds();
    loadTraffic();
    loadGads();
  }, [loadAds, loadTraffic, loadGads, selected]);

  useEffect(() => {
    setStore(null);
    if (!selected?.website) return;
    fetch(`/api/competitors/store?id=${selected.id}`).then(r => r.json()).then(setStore).catch(() => {});
  }, [selected?.id, selected?.website]);

  async function removeCompetitor(c: Competitor) {
    const res = await fetch(`/api/competitors?id=${c.id}`, { method: "DELETE" });
    if (res.ok) loadList();
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Binoculars size={18} className="text-[#F97316]" /> Competitor Intel</h2>
          <p className="text-[17px] text-[#686864] mt-0.5">
            See competitors&apos; live Meta &amp; Google ads, Google traffic and an{" "}
            <span className="font-medium text-[#181816] dark:text-[#F4F4F5]">estimated</span>{" "}
            spend &amp; ROAS - country by country
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-[#A1A1AA]" />
          <select
            value={country}
            onChange={e => setCountry(e.target.value)}
            className="text-[15px] border border-black/10 dark:border-white/10 rounded-lg px-2.5 py-1.5 bg-white dark:bg-[#171717]"
          >
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {providers && !providers.adsAnyCountry && !providers.traffic && (
        <WarnBanner type="blue">
          Competitor Intel is built and ready - the data providers just need to be switched on. Until then, sections show &ldquo;setup needed&rdquo; instead of guessing.
        </WarnBanner>
      )}

      {/* Competitor chips */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {competitors.map(c => (
          <div
            key={c.id}
            className={cn(
              "group flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full border text-[15px] cursor-pointer transition-colors",
              c.id === selectedId
                ? "bg-[#FFF7ED] border-[#F97316] text-[#C2410C] dark:bg-[#2A1A0E] dark:text-[#FB923C]"
                : "bg-white dark:bg-[#171717] border-black/10 dark:border-white/10 hover:border-[#F97316]/50",
            )}
            onClick={() => setSelectedId(c.id)}
          >
            <span className="font-medium">{c.name}</span>
            <button
              title="Remove"
              onClick={e => { e.stopPropagation(); removeCompetitor(c); }}
              className="p-0.5 rounded-full opacity-50 hover:opacity-100 hover:bg-black/5"
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {competitors.length < limit && (
          <button
            onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-dashed border-[#F97316] text-[#F97316] text-[15px] font-medium hover:bg-[#FFF7ED] dark:hover:bg-[#2A1A0E]"
          >
            <Plus size={14} /> Add competitor
          </button>
        )}
        <span className="text-[13px] text-[#A1A1AA]">{competitors.length}/{limit}</span>
      </div>

      {showAdd && <AddCompetitor onDone={() => { setShowAdd(false); loadList(); }} onCancel={() => setShowAdd(false)} />}

      {listLoading ? (
        <Loading label="Loading competitors…" />
      ) : !selected ? (
        <Empty
          icon={<Binoculars size={26} />}
          title="Add your first competitor"
          body="Add a competitor's Facebook page link and website. We'll pull their live Meta ads, Google traffic and estimate how much they spend."
        />
      ) : (
        <>
          <div className="flex gap-1 mb-3 border-b border-black/[0.06] dark:border-white/[0.06] overflow-x-auto">
            {([
              ["ads", "Meta Ad Spy", <Megaphone key="a" size={15} />],
              ["gads", "Google Ad Spy", <Target key="g" size={15} />],
              ["traffic", "Traffic Intel", <Search key="t" size={15} />],
              ["spend", "Est. Spend & ROAS", <Calculator key="s" size={15} />],
              ["compare", "You vs Competitors", <Scale key="c" size={15} />],
            ] as [Tab, string, React.ReactNode][]).map(([key, label, icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-[15px] font-medium border-b-2 -mb-px whitespace-nowrap outline-none focus:outline-none",
                  tab === key ? "border-[#F97316] text-[#F97316]" : "border-transparent text-[#71717A] hover:text-[#18181B] dark:hover:text-[#F4F4F5]",
                )}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {tab === "ads" && (
            <AdSpyTab competitor={selected} resp={ads} loading={adsLoading} own={own} countryName={countryInfo.name} onRefresh={() => loadAds(true)} />
          )}
          {tab === "gads" && (
            <GoogleAdSpyTab competitor={selected} resp={gads} loading={gadsLoading} countryName={countryInfo.name} onRefresh={() => loadGads(true)} />
          )}
          {tab === "traffic" && (
            <TrafficTab competitor={selected} resp={traffic} loading={trafficLoading} own={own} countryCode={country}
              gads={gads?.status === "ok" ? gads : null} onRefresh={() => loadTraffic(true)} />
          )}
          {tab === "spend" && (
            <SpendTab
              key={`${selected.id}-${country}`}
              competitor={selected}
              ads={ads} traffic={traffic} gads={gads} store={store} own={own}
              country={countryInfo}
              loading={adsLoading || trafficLoading}
            />
          )}
          {tab === "compare" && <CompareTab competitors={competitors} own={own} country={countryInfo} />}
        </>
      )}
    </div>
  );
}

// ── Add competitor form ───────────────────────────────────────────────────────

function AddCompetitor({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = "w-full text-[15px] border border-black/10 dark:border-white/10 rounded-lg px-3 py-2 bg-white dark:bg-[#0F0F0F]";

  async function save() {
    setSaving(true); setError(null);
    const res = await fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, pageUrl: pageUrl || undefined, website: website || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setError(d.error ?? "Couldn't add competitor"); return; }
    onDone();
  }

  return (
    <Card className="mb-3">
      <CardHeader title="Add a competitor" right={<button onClick={onCancel}><X size={16} /></button>} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[13px] font-semibold text-[#71717A]">Brand name *</label>
          <input className={input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Brand X" />
        </div>
        <div>
          <label className="text-[13px] font-semibold text-[#71717A]">Facebook page link (for ads)</label>
          <input className={input} value={pageUrl} onChange={e => setPageUrl(e.target.value)} placeholder="facebook.com/brandx" />
        </div>
        <div>
          <label className="text-[13px] font-semibold text-[#71717A]">Website (for traffic &amp; prices)</label>
          <input className={input} value={website} onChange={e => setWebsite(e.target.value)} placeholder="brandx.com" />
        </div>
      </div>
      <p className="text-[13px] text-[#A1A1AA] mt-2">
        Tip: open their Facebook page → &ldquo;Page transparency&rdquo; → &ldquo;Go to Ad Library&rdquo; and paste that link - it&apos;s the most reliable.
      </p>
      {error && <div className="text-[14px] text-[#DC2626] mt-2">{error}</div>}
      <div className="flex justify-end mt-3">
        <button
          onClick={save}
          disabled={saving || !name.trim() || (!pageUrl.trim() && !website.trim())}
          className="px-4 py-2 rounded-lg bg-[#F97316] text-white text-[15px] font-semibold disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add competitor"}
        </button>
      </div>
    </Card>
  );
}

// ── Refresh bar ───────────────────────────────────────────────────────────────

function RefreshBar({ fetchedAt, refreshBlocked, onRefresh, loading, cadence }: {
  fetchedAt: string; refreshBlocked?: boolean; onRefresh: () => void; loading: boolean; cadence: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div className="text-[14px] text-[#A1A1AA] flex items-center gap-1.5">
        <Clock size={13} /> Updated {ago(fetchedAt)} · refreshes {cadence}
        {refreshBlocked && <span className="text-[#B45309]"> · already refreshed recently, showing latest copy</span>}
      </div>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="flex items-center gap-1.5 text-[14px] px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 hover:border-[#F97316] disabled:opacity-40"
      >
        <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh now
      </button>
    </div>
  );
}

// ── Tab 1: Meta Ad Spy ────────────────────────────────────────────────────────

const FORMAT_ICON: Record<string, React.ReactNode> = {
  video: <Play size={12} />, image: <ImageIcon size={12} />, carousel: <Images size={12} />, text: <Layers size={12} />,
};

function AdSpyTab({ competitor, resp, loading, own, countryName, onRefresh }: {
  competitor: Competitor; resp: AdsResp | null; loading: boolean; own: OwnData | null; countryName: string; onRefresh: () => void;
}) {
  const [sort, setSort] = useState<"days" | "new">("days");
  const [format, setFormat] = useState<string>("all");

  if (!competitor.pageUrl && !competitor.pageId) {
    return <Empty icon={<Megaphone size={26} />} title="No Facebook page added" body={`Remove and re-add ${competitor.name} with their Facebook page link to see their ads.`} />;
  }
  if (loading && !resp) return <Loading label={`Fetching ${competitor.name}'s live ads in ${countryName}… first fetch can take 1–2 minutes`} />;
  if (!resp) return null;
  if (resp.status === "setup_needed") return <SetupNeeded what="Meta Ad Spy" missing={resp.missing} message={resp.message} />;
  if (resp.status === "error") return <Empty icon={<Info size={26} />} title="Couldn't load ads" body={resp.message} />;

  const { data, stats } = resp;
  if (data.ads.length === 0) {
    return (
      <>
        <RefreshBar fetchedAt={data.fetchedAt} refreshBlocked={resp.refreshBlocked} onRefresh={onRefresh} loading={loading} cadence="weekly" />
        <Empty icon={<Megaphone size={26} />} title={`No active ads in ${countryName}`} body={`${competitor.name} isn't running any Meta ads that reach ${countryName} right now. Try another country.`} />
      </>
    );
  }

  const shown = data.ads
    .filter(a => format === "all" || a.format === format)
    .sort((a, b) => sort === "days"
      ? (b.daysRunning ?? 0) - (a.daysRunning ?? 0)
      : new Date(b.startDate ?? 0).getTime() - new Date(a.startDate ?? 0).getTime());
  const pct = (n: number) => (stats.active ? Math.round((n / stats.active) * 100) : 0);
  const ownTotal = own?.formats ? Object.values(own.formats).reduce((s, v) => s + v, 0) : 0;
  const ownPct = (k: string) => (own?.formats && ownTotal ? Math.round(((own.formats[k] ?? 0) / ownTotal) * 100) : null);

  return (
    <div>
      <RefreshBar fetchedAt={data.fetchedAt} refreshBlocked={resp.refreshBlocked} onRefresh={onRefresh} loading={loading} cadence="weekly" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2 mb-3">
        <KPICard label="Active ads" value={formatNumber(stats.active)} sub={`${stats.uniqueCreatives} unique creatives`} icon={<Megaphone size={12} />} />
        <KPICard label="Launched (7 days)" value={formatNumber(stats.launched7d)} sub={`${stats.launched30d} in last 30 days`} icon={<Zap size={12} />} />
        <KPICard label="Running 30+ days" value={formatNumber(stats.over30d)} sub={`${stats.over60d} running 60+ days`} icon={<TrendingUp size={12} />} />
        <KPICard label="Median ad age" value={stats.medianDays !== null ? `${stats.medianDays}d` : "-"} sub="days live" icon={<Clock size={12} />} />
        <KPICard label="Variations" value={formatNumber(stats.variations)} sub="incl. near-duplicate versions" icon={<Layers size={12} />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mb-3">
        <Card className="lg:col-span-2">
          <CardHeader title={<span className="flex items-center gap-1.5"><Sparkles size={16} className="text-[#F97316]" /> What their ads are saying</span>} right="AI read of ad copy" />
          {data.hooks ? (
            <div className="space-y-3">
              {data.hooks.summary && <p className="text-[16px] leading-relaxed">{data.hooks.summary}</p>}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <HookList title="Offers" items={data.hooks.offers} empty="No explicit offers in their copy" />
                <HookList title="Hooks / headlines" items={data.hooks.hooks} empty="-" />
                <HookList title="Selling angles" items={data.hooks.angles} empty="-" />
              </div>
            </div>
          ) : (
            <p className={SUB}>AI summary isn&apos;t available for these ads (no ad text found, or AI isn&apos;t switched on).</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Them vs you" right="Active ads" />
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-[13px] text-[#A1A1AA] text-left">
                <th className="font-semibold pb-1.5"></th>
                <th className="font-semibold pb-1.5 text-right">{competitor.name}</th>
                <th className="font-semibold pb-1.5 text-right">You</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
              <tr><td className="py-1.5">Active ads</td><td className="text-right font-semibold">{stats.active}</td><td className="text-right">{own?.activeAds ?? "-"}</td></tr>
              <tr><td className="py-1.5">Video share</td><td className="text-right font-semibold">{pct(stats.formats.video)}%</td><td className="text-right">{ownPct("video") !== null ? `${ownPct("video")}%` : "-"}</td></tr>
              <tr><td className="py-1.5">Image share</td><td className="text-right font-semibold">{pct(stats.formats.image)}%</td><td className="text-right">{ownPct("image") !== null ? `${ownPct("image")}%` : "-"}</td></tr>
              <tr><td className="py-1.5">Carousel share</td><td className="text-right font-semibold">{pct(stats.formats.carousel)}%</td><td className="text-right">{ownPct("carousel") !== null ? `${ownPct("carousel")}%` : "-"}</td></tr>
              <tr><td className="py-1.5">New ads / 30 days</td><td className="text-right font-semibold">{stats.launched30d}</td><td className="text-right text-[#A1A1AA]">-</td></tr>
            </tbody>
          </table>
          <p className="text-[13px] text-[#A1A1AA] mt-2">
            Ads running 30+ days are usually profitable - brands switch off losers within 1–2 weeks.
          </p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[15px] font-semibold">{shown.length} ads</span>
        <div className="flex gap-1 ml-auto">
          {["all", "video", "image", "carousel"].map(f => (
            <button key={f} onClick={() => setFormat(f)}
              className={cn("px-2.5 py-1 rounded-lg text-[13px] capitalize border", format === f ? "border-[#F97316] text-[#F97316]" : "border-black/10 dark:border-white/10 text-[#71717A]")}>
              {f}
            </button>
          ))}
        </div>
        <select value={sort} onChange={e => setSort(e.target.value as "days" | "new")}
          className="text-[13px] border border-black/10 dark:border-white/10 rounded-lg px-2 py-1 bg-white dark:bg-[#171717]">
          <option value="days">Longest running</option>
          <option value="new">Newest first</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {shown.map(ad => <AdCard key={ad.id} ad={ad} />)}
      </div>
    </div>
  );
}

function HookList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <div className="text-[13px] font-bold uppercase tracking-wide text-[#A1A1AA] mb-1.5">{title}</div>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((t, i) => <li key={i} className="text-[15px] flex gap-1.5"><span className="text-[#F97316]">•</span>{t}</li>)}
        </ul>
      ) : <div className="text-[14px] text-[#A1A1AA]">{empty}</div>}
    </div>
  );
}

function AdCard({ ad }: { ad: CompetitorAd }) {
  const [imgOk, setImgOk] = useState(true);
  const days = ad.daysRunning ?? 0;
  return (
    <Card className="p-0 overflow-hidden flex flex-col">
      <div className="relative aspect-square bg-[#F4F4F5] dark:bg-[#0F0F0F] flex items-center justify-center">
        {ad.videoUrl ? (
          <video src={ad.videoUrl} poster={ad.imageUrl ?? undefined} controls preload="none" className="w-full h-full object-cover" />
        ) : ad.imageUrl && imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setImgOk(false)} className="w-full h-full object-cover" />
        ) : (
          <a href={ad.libraryUrl} target="_blank" rel="noreferrer" className="text-[14px] text-[#71717A] flex items-center gap-1">
            <ExternalLink size={14} /> View creative in Ad Library
          </a>
        )}
        <div className="absolute top-2 left-2 flex gap-1">
          <Badge variant="gray" className="bg-white/90 dark:bg-black/70 flex items-center gap-1 capitalize">{FORMAT_ICON[ad.format]} {ad.format}</Badge>
        </div>
        <div className="absolute top-2 right-2">
          <Tooltip content={days > 60 ? "Running 60+ days - very likely a profitable, scaled ad" : days > 30 ? "Running 30+ days - likely profitable" : days <= 7 ? "New - probably still being tested" : "Running 1–4 weeks"} side="left">
            <Badge variant={days > 30 ? "green" : days <= 7 ? "blue" : "gray"}>{days}d live</Badge>
          </Tooltip>
        </div>
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1.5">
        {ad.title && <div className="text-[15px] font-semibold line-clamp-2">{ad.title}</div>}
        {ad.body && <div className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] line-clamp-4 whitespace-pre-line">{ad.body}</div>}
        <div className="mt-auto pt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[#A1A1AA]">
          {ad.cta && <Badge variant="orange">{ad.cta}</Badge>}
          {ad.collationCount > 1 && <Badge variant="purple">{ad.collationCount} versions</Badge>}
          {ad.euReach && <Badge variant="teal">{numShort(ad.euReach)} reach</Badge>}
          {ad.startDate && <span>since {new Date(ad.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}</span>}
          <a href={ad.libraryUrl} target="_blank" rel="noreferrer" className="ml-auto text-[#F97316] flex items-center gap-0.5 hover:underline">
            Ad Library <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </Card>
  );
}

// ── Tab 2: Google Ad Spy ──────────────────────────────────────────────────────

const GPLATFORM: Record<GoogleAdPlatform, { label: string; icon: React.ReactNode; color: string; what: string }> = {
  search: { label: "Google Search", icon: <Search size={13} />, color: "#3B82F6", what: "text ads on Google results - they bid on keywords" },
  shopping: { label: "Shopping / PMax", icon: <ShoppingBag size={13} />, color: "#F97316", what: "product listings with price & image - Shopping or Performance Max campaigns" },
  youtube: { label: "YouTube", icon: <MonitorPlay size={13} />, color: "#EF4444", what: "video ads before / inside YouTube videos" },
};
const GFORMAT_ICON: Record<string, React.ReactNode> = { text: <Type size={12} />, image: <ImageIcon size={12} />, video: <Play size={12} /> };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });

function GoogleAdSpyTab({ competitor, resp, loading, countryName, onRefresh }: {
  competitor: Competitor; resp: GadsResp | null; loading: boolean; countryName: string; onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [sort, setSort] = useState<"days" | "new">("days");

  if (!competitor.website) {
    return <Empty icon={<Target size={26} />} title="No website added" body={`Remove and re-add ${competitor.name} with their website to see their Google ads.`} />;
  }
  if (loading && !resp) return <Loading label={`Fetching ${competitor.name}'s Google ads in ${countryName}…`} />;
  if (!resp) return null;
  if (resp.status === "setup_needed") return <SetupNeeded what="Google Ad Spy" missing={resp.missing} message={resp.message} />;
  if (resp.status === "error") return <Empty icon={<Info size={26} />} title="Couldn't load Google ads" body={resp.message} />;

  const { data, stats } = resp;
  if (data.ads.length === 0) {
    return (
      <>
        <RefreshBar fetchedAt={data.fetchedAt} refreshBlocked={resp.refreshBlocked} onRefresh={onRefresh} loading={loading} cadence="weekly" />
        <Empty icon={<Target size={26} />} title={`No Google ads in ${countryName}`}
          body={`Google hasn't shown any ads for ${data.domain} in ${countryName} in the last 90 days. If they sell through a distributor, the ads may run under that company's website.`} />
      </>
    );
  }

  // Google's own totals where available (the fetched list stops at 120 ads)
  const platformN = (p: GoogleAdPlatform) => Math.max(data.totals?.[p] ?? 0, stats.platforms[p]);
  const seen90d = Math.max(data.totals?.seen90d ?? 0, stats.seen90d);
  const liveN = data.totals?.live ?? stats.active;
  const tagged = platformN("search") + platformN("shopping") + platformN("youtube");
  const used = (Object.keys(GPLATFORM) as GoogleAdPlatform[]).filter(p => platformN(p) > 0);
  const shown = data.ads
    .filter(a => filter === "all" ? true
      : filter === "live" ? a.isActive
      : filter in GPLATFORM ? a.platforms.includes(filter as GoogleAdPlatform)
      : a.format === filter)
    .sort((a, b) => sort === "days"
      ? (b.daysRunning ?? 0) - (a.daysRunning ?? 0)
      : new Date(b.firstShown ?? 0).getTime() - new Date(a.firstShown ?? 0).getTime());

  return (
    <div>
      <RefreshBar fetchedAt={data.fetchedAt} refreshBlocked={resp.refreshBlocked} onRefresh={onRefresh} loading={loading} cadence="weekly" />
      <WarnBanner type="blue">
        Real ads from Google&apos;s Ads Transparency Center for {data.domain} - what ran, where and for how long.
        Google doesn&apos;t publish spend or clicks for brand ads, so spend stays an estimate.
      </WarnBanner>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2 mb-3">
        <KPICard label="Live now" value={formatNumber(liveN)} sub={`${formatNumber(seen90d)} shown in last 90 days`} icon={<Target size={12} />} />
        <KPICard label="Launched (30 days)" value={formatNumber(stats.launched30d)} sub="new ads started" icon={<Zap size={12} />} />
        <KPICard label="Running 30+ days" value={formatNumber(stats.over30d)} sub={`${stats.over60d} running 60+ days`} icon={<TrendingUp size={12} />} />
        <KPICard label="Median ad age" value={stats.medianDays !== null ? `${stats.medianDays}d` : "-"} sub="first to last shown" icon={<Clock size={12} />} />
        <KPICard label="Advertiser accounts" value={formatNumber(data.advertisers.length)} sub={data.advertisers.some(x => x.verified) ? "Google-verified" : "not verified"} icon={<BadgeCheck size={12} />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mb-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Where they advertise on Google" right={`${stats.formats.text} text · ${stats.formats.image} image · ${stats.formats.video} video`} />
          {tagged === 0 ? (
            <p className={SUB}>Google didn&apos;t say which network these ads ran on (often Display / partner sites).</p>
          ) : (
            <div className="space-y-2.5">
              {(Object.keys(GPLATFORM) as GoogleAdPlatform[]).map(p => {
                const n = platformN(p);
                const pctOf = Math.round((n / Math.max(1, seen90d)) * 100);
                return (
                  <div key={p}>
                    <div className="flex items-center justify-between text-[15px] mb-1">
                      <span className="flex items-center gap-1.5 font-medium" style={{ color: GPLATFORM[p].color }}>{GPLATFORM[p].icon} {GPLATFORM[p].label}</span>
                      <span className={n ? "font-semibold" : "text-[#A1A1AA]"}>{n ? `${n} ads` : "none seen"}</span>
                    </div>
                    <div className="h-2 rounded-full bg-black/[0.05] dark:bg-white/[0.06] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pctOf)}%`, background: GPLATFORM[p].color }} />
                    </div>
                    <div className="text-[13px] text-[#A1A1AA] mt-0.5">{GPLATFORM[p].what}</div>
                  </div>
                );
              })}
            </div>
          )}
          {used.length > 0 && (
            <p className="text-[15px] mt-3 pt-3 border-t border-black/[0.05] dark:border-white/[0.05]">
              <b>{competitor.name}</b> runs Google ads on {used.map(p => GPLATFORM[p].label).join(", ").replace(/, ([^,]*)$/, " and $1")}
              {platformN("shopping") > 0 && platformN("search") === 0 ?" - Shopping/PMax only, so their Google spend never shows in keyword tools." : "."}
              {stats.over30d > 0 && ` ${stats.over30d} ad${stats.over30d > 1 ? "s have" : " has"} run 30+ days - likely working for them.`}
            </p>
          )}
        </Card>

        <Card>
          <CardHeader title="Advertiser accounts" right="who pays for the ads" />
          <ul className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
            {data.advertisers.slice(0, 6).map(x => (
              <li key={x.id} className="py-1.5 flex items-center gap-2 text-[15px]">
                <span className="truncate">{x.name || x.id}</span>
                {x.verified && <BadgeCheck size={14} className="text-[#3B82F6] shrink-0" />}
                <span className="ml-auto text-[#71717A] shrink-0">{x.ads} ads</span>
                <a href={`https://adstransparency.google.com/advertiser/${x.id}?region=${data.country}`} target="_blank" rel="noreferrer" className="text-[#F97316] shrink-0"><ExternalLink size={12} /></a>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-[#A1A1AA] mt-2">More than one account usually means a distributor or agency also runs ads for the brand.</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[15px] font-semibold">{shown.length} ads</span>
        <div className="flex flex-wrap gap-1 ml-auto">
          {[["all", "All"], ["live", "Live now"], ...used.map(p => [p, GPLATFORM[p].label]), ["text", "Text"], ["image", "Image"], ["video", "Video"]].map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={cn("px-2.5 py-1 rounded-lg text-[13px] border", filter === k ? "border-[#F97316] text-[#F97316]" : "border-black/10 dark:border-white/10 text-[#71717A]")}>
              {label}
            </button>
          ))}
        </div>
        <select value={sort} onChange={e => setSort(e.target.value as "days" | "new")}
          className="text-[13px] border border-black/10 dark:border-white/10 rounded-lg px-2 py-1 bg-white dark:bg-[#171717]">
          <option value="days">Longest running</option>
          <option value="new">Newest first</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {shown.map(ad => <GoogleAdCard key={ad.id} ad={ad} />)}
      </div>
      {data.capped && <p className="text-[13px] text-[#A1A1AA] mt-2">Showing {data.ads.length} of their {formatNumber(seen90d)} ads (every live one included) - Google returns at most 120 per lookup.</p>}
    </div>
  );
}

function GoogleAdCard({ ad }: { ad: GoogleAd }) {
  const [imgOk, setImgOk] = useState(true);
  const days = ad.daysRunning ?? 0;
  return (
    <Card className="p-0 overflow-hidden flex flex-col">
      <div className="relative aspect-[4/3] bg-white dark:bg-[#0F0F0F] border-b border-black/[0.05] dark:border-white/[0.05] flex items-center justify-center p-2">
        {ad.imageUrl && imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setImgOk(false)} className="max-w-full max-h-full object-contain" />
        ) : (
          <a href={ad.transparencyUrl} target="_blank" rel="noreferrer" className="text-[14px] text-[#71717A] flex items-center gap-1">
            <ExternalLink size={14} /> View ad on Google
          </a>
        )}
        {ad.youtubeId && imgOk && (
          <a href={`https://www.youtube.com/watch?v=${ad.youtubeId}`} target="_blank" rel="noreferrer" aria-label="Watch on YouTube"
            className="absolute inset-0 flex items-center justify-center group">
            <span className="w-12 h-12 rounded-full bg-black/60 group-hover:bg-[#EF4444] flex items-center justify-center transition-colors">
              <Play size={20} className="text-white ml-0.5" fill="white" />
            </span>
          </a>
        )}
        <div className="absolute top-2 left-2 flex gap-1">
          <Badge variant="gray" className="bg-white/90 dark:bg-black/70 flex items-center gap-1 capitalize">{GFORMAT_ICON[ad.format]} {ad.format}</Badge>
        </div>
        <div className="absolute top-2 right-2">
          <Tooltip content={days > 60 ? "Ran 60+ days - very likely a profitable ad" : days > 30 ? "Ran 30+ days - likely profitable" : days <= 7 ? "New - probably still being tested" : "Ran 1–4 weeks"} side="left">
            <Badge variant={days > 30 ? "green" : days <= 7 ? "blue" : "gray"}>{days}d</Badge>
          </Tooltip>
        </div>
      </div>
      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={ad.isActive ? "green" : "gray"}>{ad.isActive ? "Live" : "Ended"}</Badge>
          {ad.platforms.map(p => (
            <Badge key={p} variant="gray" className="flex items-center gap-1">{GPLATFORM[p].icon} {GPLATFORM[p].label}</Badge>
          ))}
        </div>
        <div className="mt-auto pt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[#A1A1AA]">
          {ad.firstShown && <span>{shortDate(ad.firstShown)} → {ad.isActive ? "now" : ad.lastShown ? shortDate(ad.lastShown) : "?"}</span>}
          <a href={ad.transparencyUrl} target="_blank" rel="noreferrer" className="ml-auto text-[#F97316] flex items-center gap-0.5 hover:underline">
            Google <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </Card>
  );
}

// ── Tab 3: Traffic Intel ──────────────────────────────────────────────────────

function TrafficTab({ competitor, resp, loading, own, countryCode, gads, onRefresh }: {
  competitor: Competitor; resp: TrafficResp | null; loading: boolean; own: OwnData | null; countryCode: string;
  gads: Extract<GadsResp, { status: "ok" }> | null; // live Google ads from Ad Spy - keyword tools miss most of them
  onRefresh: () => void;
}) {
  const googleLive = gads ? gads.data.totals?.live ?? gads.stats.active : 0;
  if (!competitor.website) {
    return <Empty icon={<Globe size={26} />} title="No website added" body={`Remove and re-add ${competitor.name} with their website to see their Google traffic.`} />;
  }
  if (loading && !resp) return <Loading label={`Fetching ${competitor.website} traffic estimates…`} />;
  if (!resp) return null;
  if (resp.status === "setup_needed") return <SetupNeeded what="Traffic Intel" missing={resp.missing} message={resp.message} />;
  if (resp.status === "error") return <Empty icon={<Info size={26} />} title="Couldn't load traffic" body={resp.message} />;

  const { data } = resp;
  const ov = data.overview;
  if (!ov || (ov.organicTraffic === 0 && ov.paidTraffic === 0 && data.topKeywords.length === 0)) {
    return (
      <>
        <RefreshBar fetchedAt={data.fetchedAt} refreshBlocked={resp.refreshBlocked} onRefresh={onRefresh} loading={loading} cadence="monthly" />
        <Empty icon={<Search size={26} />} title="Not enough data" body={`${data.domain} is too small (or too new) in this country for Google traffic estimates. That's normal for many D2C brands that grow mostly through Meta.`} />
      </>
    );
  }
  const history = data.history.map(h => ({ ...h, label: new Date(`${h.month}-01`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) }));
  const ownComparable = countryCode === "IN"; // own GSC/GA4 are mostly home-market traffic

  // Keyword data often sees none of a brand's ads (it samples searches) - fall back to the
  // live-ad estimate the Est. Spend tab uses, so these cards match it.
  const country = getCountry(countryCode);
  const gEst = ov.paidCostInr > 0 ? null : estimateGoogleSpend(gads?.data.ads ?? null, googleLive || null, 0, country);
  const gCpc = defaultAssumptions(country, null, null).a.gCpc;
  const gVisits = gEst ? { lo: Math.round(gEst.range.lo / gCpc), hi: Math.round(gEst.range.hi / gCpc) } : null;

  return (
    <div>
      <RefreshBar fetchedAt={data.fetchedAt} refreshBlocked={resp.refreshBlocked} onRefresh={onRefresh} loading={loading} cadence="monthly" />
      <WarnBanner type="blue">
        These are DataForSEO{" "}<b>estimates</b>{" "}of Google traffic (from rankings × search volume).
        {gEst
          ? <> Its keyword sample caught none of {competitor.name}&apos;s Google ads, so the ad cards are estimated from their {gEst.liveAds} live ads instead (same as the Est. Spend tab).</>
          : <> &ldquo;Search-ad&rdquo; means keyword ads only - Shopping, YouTube and Meta clicks aren&apos;t in this data; the Est. Spend tab adds them.</>}
      </WarnBanner>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 mb-3">
        <KPICard label="Organic visits / mo" value={numShort(ov.organicTraffic)} sub={`${formatNumber(ov.organicKeywords)} keywords · estimate`} icon={<Search size={12} />} />
        {gEst && gVisits ? (
          <>
            <KPICard label="Google-ad visits / mo" value={`${numShort(gVisits.lo)} - ${numShort(gVisits.hi)}`}
              sub={`spend ÷ ₹${gCpc}/click · ${gEst.confidence} confidence`} icon={<Megaphone size={12} />} />
            <KPICard label="Google-ad spend / mo" value={rangeInr(gEst.range)}
              sub={`from ${gEst.liveAds} live Google ads · ${gEst.confidence} confidence`} icon={<Target size={12} />} />
          </>
        ) : (
          <>
            <KPICard label="Search-ad visits / mo" value={ov.paidTraffic > 0 ? numShort(ov.paidTraffic) : "0"}
              sub={ov.paidTraffic > 0 ? `${formatNumber(ov.paidKeywords)} paid keywords · estimate` : "no Google ads found"}
              icon={<Megaphone size={12} />} />
            <KPICard label="Search-ad spend / mo" value={ov.paidCostInr > 0 ? inrShort(ov.paidCostInr) : "₹0"}
              sub={ov.paidCostInr > 0 ? "keyword ads only · estimate" : "no Google ads found"}
              icon={<Target size={12} />} />
          </>
        )}
        <KPICard label="Organic traffic value" value={inrShort(ov.organicValueInr)} sub="what it'd cost as ads" icon={<TrendingUp size={12} />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mb-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Google traffic trend" right={<EstimateTag />} />
          {history.length >= 2 ? (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 5, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={v => numShort(Number(v))} />
                  <RTooltip formatter={(v) => numShort(Number(v))} />
                  <Line type="monotone" dataKey="organic" name="Organic" stroke="#22C55E" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="paid" name="Google ads" stroke="#F97316" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <p className={SUB}>Not enough history yet.</p>}
        </Card>
        <Card>
          <CardHeader title="Them vs you" right="per month" />
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-[13px] text-[#A1A1AA] text-left">
                <th className="font-semibold pb-1.5"></th>
                <th className="font-semibold pb-1.5 text-right">{competitor.name}<div className="font-normal">estimate</div></th>
                <th className="font-semibold pb-1.5 text-right">You<div className="font-normal">real</div></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
              <tr>
                <td className="py-1.5">Google organic clicks</td>
                <td className="text-right font-semibold">{numShort(ov.organicTraffic)}</td>
                <td className="text-right">{ownComparable && own?.gscClicks != null ? numShort(own.gscClicks) : "-"}</td>
              </tr>
              <tr>
                <td className="py-1.5">Ranking keywords</td>
                <td className="text-right font-semibold">{numShort(ov.organicKeywords)}</td>
                <td className="text-right text-[#A1A1AA]">-</td>
              </tr>
              <tr>
                <td className="py-1.5">All website sessions</td>
                <td className="text-right text-[#A1A1AA]">not visible</td>
                <td className="text-right">{ownComparable && own?.ga4Sessions != null ? numShort(own.ga4Sessions) : "-"}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-[13px] text-[#A1A1AA] mt-2">
            Your numbers are {own?.period ?? "the last 30 days"} from Search Console &amp; GA4{!ownComparable && " (shown for India only)"}.
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-3">
        <KeywordTable title="Top organic keywords" rows={data.topKeywords.slice(0, 15)} />
        <Card>
          <CardHeader title="Top pages" right="by organic visits" />
          {data.topPages.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead><tr className="text-[13px] text-[#A1A1AA] text-left"><th className="font-semibold pb-1.5">Page</th><th className="font-semibold pb-1.5 text-right">Visits</th><th className="font-semibold pb-1.5 text-right">Keywords</th></tr></thead>
                <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                  {data.topPages.map(p => (
                    <tr key={p.url}>
                      <td className="py-1.5 max-w-[260px] truncate"><a href={p.url} target="_blank" rel="noreferrer" className="hover:text-[#F97316]">{p.url.replace(/^https?:\/\/(www\.)?/, "")}</a></td>
                      <td className="text-right font-semibold">{numShort(p.traffic)}</td>
                      <td className="text-right">{p.keywords}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className={SUB}>No page data.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <Card>
          <CardHeader title="Keyword gap - they rank, you don't" right={data.gapAgainst ? `vs ${data.gapAgainst}` : undefined} />
          {data.gap === null ? (
            <p className={SUB}>Connect Google Search Console in Connections so we know your website - then we&apos;ll list keywords where {competitor.name} ranks and you don&apos;t.</p>
          ) : data.gap.length === 0 ? (
            <p className={SUB}>No gap found - you rank for the same keywords they do. 👏</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead><tr className="text-[13px] text-[#A1A1AA] text-left"><th className="font-semibold pb-1.5">Keyword</th><th className="font-semibold pb-1.5 text-right">Searches/mo</th><th className="font-semibold pb-1.5 text-right">Their rank</th><th className="font-semibold pb-1.5 text-right">CPC</th></tr></thead>
                <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                  {data.gap.slice(0, 15).map(k => (
                    <tr key={k.keyword}>
                      <td className="py-1.5">{k.keyword}</td>
                      <td className="text-right font-semibold">{numShort(k.volume)}</td>
                      <td className="text-right">#{k.theirPosition}</td>
                      <td className="text-right">{k.cpcInr != null ? formatINR(k.cpcInr) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {data.paidKeywords.length > 0
          ? <KeywordTable title="Keywords they buy on Google" rows={data.paidKeywords.slice(0, 15)} />
          : <Card><CardHeader title="Keywords they buy on Google" /><p className={SUB}>No Google search ads found for {data.domain} in this country.</p></Card>}
      </div>
    </div>
  );
}

function KeywordTable({ title, rows }: { title: string; rows: TrafficPayload["topKeywords"] }) {
  return (
    <Card>
      <CardHeader title={title} right={<EstimateTag />} />
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead><tr className="text-[13px] text-[#A1A1AA] text-left"><th className="font-semibold pb-1.5">Keyword</th><th className="font-semibold pb-1.5 text-right">Rank</th><th className="font-semibold pb-1.5 text-right">Searches/mo</th><th className="font-semibold pb-1.5 text-right">Visits</th></tr></thead>
            <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
              {rows.map(k => (
                <tr key={k.keyword + k.position}>
                  <td className="py-1.5">{k.keyword}</td>
                  <td className="text-right">#{k.position}</td>
                  <td className="text-right">{numShort(k.volume)}</td>
                  <td className="text-right font-semibold">{numShort(k.traffic)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className={SUB}>No keywords found.</p>}
    </Card>
  );
}

// ── Tab 5: You vs Competitors ─────────────────────────────────────────────────

type Slot<T> = T | "loading" | null;  // null = not applicable (no page/website added)
interface CompData { ads: Slot<AdsResp>; gads: Slot<GadsResp>; traffic: Slot<TrafficResp>; store: Slot<StoreResp> }
interface Cell { v: number | null; text: string; est?: boolean }
type CellOrLoading = Cell | "loading";
interface RowDef {
  key: string; group: string; label: string; hint?: string;
  better: "higher" | "neutral";
  you: Cell;
  them: (d: CompData, e: FullEstimate | null) => CellOrLoading;
  fix?: { behind: string; ahead: string };
}

const DASH: Cell = { v: null, text: "-" };
function okOf<T extends { status: string }>(s: Slot<T>): Extract<T, { status: "ok" }> | null {
  return s && s !== "loading" && s.status === "ok" ? (s as Extract<T, { status: "ok" }>) : null;
}
function fromSlot<T extends { status: string }>(s: Slot<T>, f: (ok: Extract<T, { status: "ok" }>) => Cell): CellOrLoading {
  if (s === "loading") return "loading";
  const ok = okOf(s);
  return ok ? f(ok) : DASH;
}
const estCell = (r: Range | null | undefined, fmt: (r: Range) => string): Cell => (r ? { v: r.mid, text: fmt(r), est: true } : DASH);

function CompareTab({ competitors, own, country }: {
  competitors: Competitor[]; own: OwnData | null; country: ReturnType<typeof getCountry>;
}) {
  const [data, setData] = useState<Record<string, CompData>>({});
  const depKey = competitors.map(c => `${c.id}|${c.website ?? ""}|${c.pageUrl ?? ""}|${c.pageId ?? ""}`).join(",") + `@${country.code}`;

  // Everything comes from the same cached endpoints the other tabs use - no extra provider cost once cached
  useEffect(() => {
    let alive = true;
    const init: Record<string, CompData> = {};
    for (const c of competitors) {
      const hasPage = !!(c.pageUrl || c.pageId);
      init[c.id] = { ads: hasPage ? "loading" : null, gads: c.website ? "loading" : null, traffic: c.website ? "loading" : null, store: c.website ? "loading" : null };
    }
    setData(init);
    const put = (id: string, key: keyof CompData, v: CompData[keyof CompData]) => {
      if (alive) setData(prev => ({ ...prev, [id]: { ...prev[id], [key]: v } }));
    };
    const get = (url: string, fallback: string) => fetch(url).then(r => r.json())
      .then(d => (d.status ? d : { status: "error", message: d.error ?? fallback }))
      .catch(() => ({ status: "error", message: fallback }));
    for (const c of competitors) {
      if (c.pageUrl || c.pageId) get(`/api/competitors/ads?id=${c.id}&country=${country.code}`, "Couldn't load ads").then(d => put(c.id, "ads", d));
      if (c.website) {
        get(`/api/competitors/google-ads?id=${c.id}&country=${country.code}`, "Couldn't load Google ads").then(d => put(c.id, "gads", d));
        get(`/api/competitors/traffic?id=${c.id}&country=${country.code}`, "Couldn't load traffic").then(d => put(c.id, "traffic", d));
        get(`/api/competitors/store?id=${c.id}`, "Couldn't load store").then(d => put(c.id, "store", d));
      }
    }
    return () => { alive = false; };
  }, [depKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-competitor spend / revenue / ROAS estimate - same model as the Est. Spend tab (default assumptions)
  const estimates = useMemo(() => {
    const out: Record<string, FullEstimate | null> = {};
    for (const c of competitors) {
      const d = data[c.id];
      if (!d || d.ads === "loading" || d.gads === "loading" || d.traffic === "loading") { out[c.id] = null; continue; }
      const adsOk = okOf(d.ads), gOk = okOf(d.gads), tOk = okOf(d.traffic), sOk = okOf(d.store);
      const p = sOk?.data.bestsellerMedian ?? sOk?.data.priceMedian ?? null;
      const fx = FX_INR[(sOk?.data.currency ?? "INR").toUpperCase()];
      const aov = p && fx ? Math.round(p * fx) : null;
      const a = defaultAssumptions(country, own?.metrics ?? null, aov).a;
      const ov = tOk?.data.overview ?? null;
      out[c.id] = estimateAll({
        ads: adsOk?.data.ads ?? null,
        googleAds: gOk?.data.ads ?? null,
        googleLive: gOk?.data.totals?.live ?? null,
        traffic: ov ? { organicTraffic: ov.organicTraffic, paidTraffic: ov.paidTraffic, paidCostInr: ov.paidCostInr } : null,
        country, a,
      });
    }
    return out;
  }, [competitors, data, country, own]);

  const spendRowLoading = (d: CompData) => d.ads === "loading" || d.gads === "loading" || d.traffic === "loading";
  const homeMarket = country.code === "IN"; // own GSC is mostly home-market traffic
  const ownTotalSpend = own?.spend != null || own?.googleSpend != null ? (own?.spend ?? 0) + (own?.googleSpend ?? 0) : null;
  const ownRoas = (() => {
    if (!own) return null;
    const metaSales = own.spend != null && own.roas != null ? own.spend * own.roas : 0;
    const gSales = own.googleConvValue ?? 0;
    return ownTotalSpend && ownTotalSpend > 0 && (metaSales + gSales) > 0 ? Math.round(((metaSales + gSales) / ownTotalSpend) * 10) / 10 : null;
  })();
  const ownFormats = own?.formats ? Object.values(own.formats).reduce((s, n) => s + n, 0) : 0;
  const pctOf = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : null);
  const inrCell = (n: number | null | undefined): Cell => (n != null ? { v: n, text: inrShort(n) } : DASH);
  const numCell = (n: number | null | undefined): Cell => (n != null ? { v: n, text: numShort(n) } : DASH);
  const pctCell = (n: number | null): Cell => (n != null ? { v: n, text: `${n}%` } : DASH);
  const storeInr = (s: StorePayload, n: number | null): Cell => {
    const fx = FX_INR[(s.currency ?? "INR").toUpperCase()];
    return n != null && fx ? inrCell(Math.round(n * fx)) : DASH;
  };

  const rows: RowDef[] = [
    // Ads activity
    {
      key: "metaLive", group: "Ads activity", label: "Live Meta ads", better: "higher",
      you: numCell(own?.activeAds),
      them: d => fromSlot(d.ads, ok => numCell(ok.stats.active)),
      fix: { behind: "Test more creatives - leaders keep many ads live and add new ones every week.", ahead: "You're testing more creatives than them - keep the winners running 30+ days." },
    },
    {
      key: "metaNew", group: "Ads activity", label: "New Meta ads (30 days)", hint: "How fast they test new creatives", better: "neutral",
      you: DASH,
      them: d => fromSlot(d.ads, ok => numCell(ok.stats.launched30d)),
    },
    {
      key: "metaWinners", group: "Ads activity", label: "Meta ads running 30+ days", hint: "Long-running ads are usually their profitable ones", better: "neutral",
      you: DASH,
      them: d => fromSlot(d.ads, ok => numCell(ok.stats.over30d)),
    },
    {
      key: "metaVideo", group: "Ads activity", label: "Video share of Meta ads", better: "neutral",
      you: pctCell(own?.formats ? pctOf(own.formats.video ?? 0, ownFormats) : null),
      them: d => fromSlot(d.ads, ok => {
        const total = Object.values(ok.stats.formats).reduce((s, n) => s + n, 0);
        return pctCell(pctOf(ok.stats.formats.video, total));
      }),
    },
    {
      key: "gLive", group: "Ads activity", label: "Live Google ads", better: "neutral",
      you: DASH,
      them: d => fromSlot(d.gads, ok => numCell(ok.data.totals?.live ?? ok.stats.active)),
    },
    // Spend & returns
    {
      key: "metaSpend", group: "Ad spend & returns / month", label: "Meta ad spend", better: "neutral",
      you: inrCell(own?.spend),
      them: (d, e) => (spendRowLoading(d) ? "loading" : estCell(e?.meta?.range, rangeInr)),
    },
    {
      key: "gSpend", group: "Ad spend & returns / month", label: "Google ad spend", better: "neutral",
      you: inrCell(own?.googleSpend),
      them: (d, e) => (spendRowLoading(d) ? "loading" : estCell(e?.google?.range, rangeInr)),
    },
    {
      key: "totalSpend", group: "Ad spend & returns / month", label: "Total ad spend", better: "neutral",
      you: inrCell(ownTotalSpend),
      them: (d, e) => (spendRowLoading(d) ? "loading" : estCell(e?.totalSpend, rangeInr)),
    },
    {
      key: "roas", group: "Ad spend & returns / month", label: "ROAS (ad sales ÷ ad spend)", hint: "Yours is platform-reported; theirs is a Low-confidence estimate", better: "higher",
      you: ownRoas != null ? { v: ownRoas, text: `${ownRoas}x` } : DASH,
      them: (d, e) => (spendRowLoading(d) ? "loading" : estCell(e?.paidRoas, rangeX)),
      fix: { behind: "Pause ads below break-even ROAS and move that budget to your ads that have run 30+ days.", ahead: "Each ₹ of your ads returns more than theirs - you have room to scale budget." },
    },
    // Google search
    {
      key: "organic", group: "Google search", label: "Google organic visits / month", hint: "Yours: Search Console clicks · theirs: DataForSEO estimate", better: "higher",
      you: homeMarket ? numCell(own?.gscClicks) : DASH,
      them: d => fromSlot(d.traffic, ok => (ok.data.overview ? { ...numCell(ok.data.overview.organicTraffic), est: true } : DASH)),
      fix: { behind: "SEO gap - create pages for the keywords they rank for (Traffic Intel → keyword gap). This is free traffic they don't pay ads for.", ahead: "You win more free Google traffic than them - protect those rankings." },
    },
    {
      key: "keywords", group: "Google search", label: "Ranking keywords", better: "neutral",
      you: DASH,
      them: d => fromSlot(d.traffic, ok => (ok.data.overview ? { ...numCell(ok.data.overview.organicKeywords), est: true } : DASH)),
    },
    {
      key: "orgValue", group: "Google search", label: "Free-traffic value / month", hint: "What their organic traffic would cost as ads", better: "neutral",
      you: DASH,
      them: d => fromSlot(d.traffic, ok => (ok.data.overview ? { ...inrCell(ok.data.overview.organicValueInr), est: true } : DASH)),
    },
    // Store & sales
    {
      key: "revenue", group: "Store & sales", label: "Revenue / month", hint: `Yours: Shopify ${own?.period ?? "last 30 days"} · theirs: estimate`, better: "higher",
      you: inrCell(own?.revenue),
      them: (d, e) => (spendRowLoading(d) ? "loading" : estCell(e?.revenue, rangeInr)),
      fix: { behind: "They sell more - study their long-running ads (proven angles) and their bestseller prices below.", ahead: "You're out-selling them on these estimates." },
    },
    {
      key: "aov", group: "Store & sales", label: "Order value", hint: "Yours: real AOV · theirs: median bestseller price", better: "neutral",
      you: inrCell(own?.metrics.aov),
      them: d => fromSlot(d.store, ok => (ok.data.isShopify ? { ...storeInr(ok.data, ok.data.bestsellerMedian ?? ok.data.priceMedian), est: true } : DASH)),
    },
    {
      key: "products", group: "Store & sales", label: "Products in store", better: "neutral",
      you: numCell(own?.store?.productCount),
      them: d => fromSlot(d.store, ok => (ok.data.isShopify ? numCell(ok.data.productCount) : DASH)),
    },
    {
      key: "price", group: "Store & sales", label: "Typical product price", hint: "Median price across the catalogue", better: "neutral",
      you: own?.store ? storeInr(own.store, own.store.priceMedian) : DASH,
      them: d => fromSlot(d.store, ok => (ok.data.isShopify ? storeInr(ok.data, ok.data.priceMedian) : DASH)),
    },
    {
      key: "sale", group: "Store & sales", label: "Products on discount", better: "neutral",
      you: pctCell(own?.store?.onSalePct ?? null),
      them: d => fromSlot(d.store, ok => (ok.data.isShopify ? pctCell(ok.data.onSalePct) : DASH)),
    },
  ];

  // Resolve every cell once, then score "higher is better" rows: you vs the competitor average
  const table = rows.map(r => {
    const cells = competitors.map(c => (data[c.id] ? r.them(data[c.id], estimates[c.id]) : "loading" as const));
    const vals = cells.map((x, i) => ({ v: x === "loading" ? null : x.v, name: competitors[i].name })).filter(x => x.v != null) as { v: number; name: string }[];
    let verdict: "ahead" | "behind" | null = null;
    let leader: { v: number; name: string } | null = null;
    if (r.better === "higher" && r.you.v != null && vals.length > 0) {
      const avg = vals.reduce((s, x) => s + x.v, 0) / vals.length;
      verdict = r.you.v >= avg ? "ahead" : "behind";
      leader = vals.reduce((a, b) => (b.v > a.v ? b : a));
    }
    return { r, cells, verdict, leader };
  });
  const scored = table.filter(t => t.verdict);
  const aheadN = scored.filter(t => t.verdict === "ahead").length;
  const anyLoading = table.some(t => t.cells.includes("loading"));
  const groups = [...new Set(rows.map(r => r.group))];

  if (competitors.length === 0) return null;

  const cellText = (x: CellOrLoading) =>
    x === "loading" ? <LoaderCircle size={14} className="animate-spin inline text-[#A1A1AA]" />
      : <span className={x.v == null ? "text-[#A1A1AA]" : ""}>{x.est && x.v != null ? "~" : ""}{x.text}</span>;

  return (
    <div>
      <WarnBanner type="blue">
        <b>You</b> = your real numbers ({own?.period ?? "last 30 days"} from Shopify, Meta, Google Ads &amp; Search Console). <b>Competitors</b> = estimates from their live ads, Google traffic and public store (marked ~).
        Green = you&apos;re ahead of the competitor average, red = behind. Ad spend is never colour-coded - spending more isn&apos;t better by itself.
      </WarnBanner>

      {scored.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
          <KPICard label="Ahead on" value={`${aheadN} of ${scored.length}`} sub="key measures vs competitor average" icon={<Trophy size={12} />} />
          <KPICard label="Behind on" value={`${scored.length - aheadN} of ${scored.length}`} sub="see fixes below" icon={<TrendingDown size={12} />} />
          <KPICard label="Compared with" value={`${competitors.length} competitor${competitors.length > 1 ? "s" : ""}`} sub={country.name} icon={<Scale size={12} />} />
        </div>
      )}

      <Card className="mb-3 !p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[15px] min-w-[560px]">
            <thead>
              <tr className="text-[13px] text-[#71717A] text-left border-b border-black/[0.06] dark:border-white/[0.06]">
                <th className="font-semibold px-3 py-2 sticky left-0 bg-white dark:bg-[#171717] min-w-[180px]">Measure</th>
                <th className="font-semibold px-3 py-2 text-right bg-[#FFF7ED] dark:bg-[#2A1A0E] text-[#C2410C] dark:text-[#FB923C]">You<div className="font-normal text-[12px]">real</div></th>
                {competitors.map(c => (
                  <th key={c.id} className="font-semibold px-3 py-2 text-right whitespace-nowrap">{c.name}<div className="font-normal text-[12px] text-[#A1A1AA]">estimate</div></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <Fragment key={g}>
                  <tr><td colSpan={competitors.length + 2} className="px-3 pt-3 pb-1 text-[12px] font-semibold uppercase tracking-wide text-[#A1A1AA] sticky left-0">{g}</td></tr>
                  {table.filter(t => t.r.group === g).map(({ r, cells, verdict, leader }) => (
                    <tr key={r.key} className="border-t border-black/[0.04] dark:border-white/[0.04]">
                      <td className="px-3 py-2 sticky left-0 bg-white dark:bg-[#171717]">
                        {r.label}
                        {r.hint && <div className="text-[12px] text-[#A1A1AA]">{r.hint}</div>}
                      </td>
                      <td className={cn(
                        "px-3 py-2 text-right font-semibold whitespace-nowrap",
                        verdict === "ahead" ? "bg-[#F0FDF4] text-[#16A34A] dark:bg-[#052e16]" : verdict === "behind" ? "bg-[#FEF2F2] text-[#DC2626] dark:bg-[#450a0a]" : "bg-[#FFF7ED]/60 dark:bg-[#2A1A0E]/60",
                      )}>
                        {cellText(r.you)}
                      </td>
                      {cells.map((x, i) => (
                        <td key={competitors[i].id} className={cn("px-3 py-2 text-right whitespace-nowrap", leader && x !== "loading" && x.v === leader.v && leader.name === competitors[i].name && "font-semibold")}>
                          {cellText(x)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] text-[#A1A1AA] px-3 py-2 border-t border-black/[0.04] dark:border-white/[0.04]">
          {anyLoading ? "Still loading some competitor data… " : ""}
          &ldquo;-&rdquo; = not visible for that brand (no Facebook page / website added, not a Shopify store, or not measurable for you).
          {!homeMarket && " Your Search Console clicks are compared in India only."}
        </p>
      </Card>

      {scored.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {(["behind", "ahead"] as const).map(kind => {
            const list = scored.filter(t => t.verdict === kind);
            if (list.length === 0) return null;
            return (
              <Card key={kind}>
                <CardHeader title={kind === "behind" ? "Where you're behind - and the fix" : "Where you're ahead"} />
                <div className="space-y-2.5">
                  {list.map(({ r, leader }) => (
                    <div key={r.key} className={cn("rounded-lg p-2.5 border", kind === "behind" ? "border-[#FECACA] bg-[#FEF2F2] dark:bg-[#450a0a]/40 dark:border-[#7f1d1d]" : "border-[#BBF7D0] bg-[#F0FDF4] dark:bg-[#052e16]/40 dark:border-[#14532d]")}>
                      <div className="text-[15px] font-semibold">{r.label}</div>
                      <div className={SUB}>
                        You: <b>{r.you.text}</b>{leader ? <> · best competitor: <b>{leader.name}</b> (~{r.key === "roas" ? `${leader.v}x` : r.key === "revenue" ? inrShort(leader.v) : numShort(leader.v)})</> : null}
                      </div>
                      {r.fix && <div className="text-[14px] mt-1">{kind === "behind" ? r.fix.behind : r.fix.ahead}</div>}
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tab 4: Estimated Spend & ROAS ─────────────────────────────────────────────

function SpendTab({ competitor, ads, traffic, gads, store, own, country, loading }: {
  competitor: Competitor; ads: AdsResp | null; traffic: TrafficResp | null; gads: GadsResp | null; store: StoreResp | null;
  own: OwnData | null; country: ReturnType<typeof getCountry>; loading: boolean;
}) {
  const storeData = store?.status === "ok" ? store.data : null;
  const competitorAov = useMemo(() => {
    const p = storeData?.bestsellerMedian ?? storeData?.priceMedian ?? null;
    if (!p) return null;
    const fx = FX_INR[(storeData?.currency ?? "INR").toUpperCase()];
    return fx ? Math.round(p * fx) : null;
  }, [storeData]);

  const defaults = useMemo(() => defaultAssumptions(country, own?.metrics ?? null, competitorAov), [country, own, competitorAov]);
  const [edited, setEdited] = useState<Partial<Assumptions>>({});
  const a: Assumptions = { ...defaults.a, ...edited };

  const adsList = ads?.status === "ok" ? ads.data.ads : null;
  const gadsData = gads?.status === "ok" ? gads.data : null;
  const ov = traffic?.status === "ok" ? traffic.data.overview : null;
  const est = estimateAll({
    ads: adsList,
    googleAds: gadsData?.ads ?? null,
    googleLive: gadsData?.totals?.live ?? null,
    traffic: ov ? { organicTraffic: ov.organicTraffic, paidTraffic: ov.paidTraffic, paidCostInr: ov.paidCostInr } : null,
    country, a,
  });

  if (loading && !adsList && !ov) return <Loading label="Gathering signals for the estimate…" />;
  const adsSetup = ads?.status === "setup_needed";
  const trafficSetup = traffic?.status === "setup_needed";
  if (!adsList && !ov && (adsSetup || trafficSetup || (!competitor.pageUrl && !competitor.pageId && !competitor.website))) {
    return (
      <SetupNeeded
        what="Spend & ROAS estimate"
        missing={[...(ads?.status === "setup_needed" ? ads.missing : []), ...(traffic?.status === "setup_needed" ? traffic.missing : [])]}
        message="The estimate is built from their live ads and Google traffic. Once those data sources are switched on, it appears here automatically."
      />
    );
  }

  const visitsTotal = est.visits ? est.visits.organic + est.visits.googlePaid + est.visits.meta : 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <EstimateTag />
        <Badge variant={confVariant[est.confidence]}>Confidence: {est.confidence}</Badge>
        <span className="text-[14px] text-[#A1A1AA]">
          {country.eu && est.meta?.method !== "ad_activity"
            ? "EU: Meta spend uses real ad reach from Meta's Ad Library."
            : "Ad spend is inferred from how many ads run and for how long - real figures may be 2–3× off."}
        </span>
      </div>

      {est.missing.length > 0 && (
        <WarnBanner type="amber">{est.missing.join(" ")}</WarnBanner>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 mb-3">
        <RangeCard label="Meta ad spend / mo" value={est.meta ? rangeInr(est.meta.range) : "-"}
          sub={est.meta ? `${est.meta.creatives} live creatives · ${est.meta.confidence} confidence` : "no ad data"} />
        <RangeCard label="Google ad spend / mo" value={est.google ? rangeInr(est.google.range) : gadsData ? "₹0" : ov ? "Not seen" : "-"}
          sub={est.google
            ? est.google.method === "ad_activity"
              ? `${est.google.liveAds} live Google ads · ${est.google.confidence} confidence`
              : "search-ad clicks · Shopping/YouTube not visible"
            : gadsData ? "no live Google ads right now" : "no Google ad data"} />
        <RangeCard label="Est. revenue / mo (all)" value={est.revenue ? rangeInr(est.revenue) : "-"}
          sub={est.revenue
            ? est.paidRevenue
              ? `only ${rangeInr(est.paidRevenue)} from ads - rest is free Google traffic`
              : `${numShort(visitsTotal)} visits · ${a.cvr}% conv. · ${formatINR(a.aov)} AOV`
            : "needs traffic + price"} />
        <RangeCard label="ROAS from ads" value={est.paidRoas ? rangeX(est.paidRoas) : "-"}
          sub={[
            est.paidRoas && est.paidRevenue && est.totalSpend
              ? `≈ ${inrShort(est.paidRevenue.mid)} ad sales ÷ ${inrShort(est.totalSpend.mid)} ad spend (middle)`
              : est.paidRoas ? "ad-driven revenue ÷ ad spend" : "needs ads + price",
            est.blendedRoas && est.blendedMeaningful ? `blended ${rangeX(est.blendedRoas)}` : null,
            own?.roas ? `yours ${own.roas}x (real)` : null,
          ].filter(Boolean).join(" · ")} />
      </div>

      {est.blendedRoas && !est.blendedMeaningful && (
        <WarnBanner type="blue">
          About {Math.round(est.organicShare * 100)}% of their visible visits are free Google traffic. Those sales cost them no ad money, so ROAS counts only sales from ad visits
          {est.paidRevenue && est.revenue ? <> (≈ {inrShort(est.paidRevenue.mid)} of ≈ {inrShort(est.revenue.mid)} total revenue)</> : null}.
          Ranges don&apos;t multiply end-to-end - high spend doesn&apos;t come with high ROAS; compare the middle values.
        </WarnBanner>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 mb-3">
        <Card>
          <CardHeader title={<span className="flex items-center gap-1.5"><Calculator size={16} className="text-[#F97316]" /> Assumptions</span>}
            right={Object.keys(edited).length > 0 ? <button className="text-[#F97316] text-[13px]" onClick={() => setEdited({})}>Reset</button> : "editable"} />
          <div className="space-y-2.5">
            <NumField label={`CPM (₹ / 1,000 views) - low`} value={a.cpm[0]} src={defaults.src.cpm} onChange={v => setEdited(e => ({ ...e, cpm: [v, (e.cpm ?? a.cpm)[1]] }))} />
            <NumField label={`CPM - high`} value={a.cpm[1]} src={defaults.src.cpm} onChange={v => setEdited(e => ({ ...e, cpm: [(e.cpm ?? a.cpm)[0], v] }))} />
            <NumField label="Click-through rate (%)" value={a.ctr} step={0.1} src={defaults.src.ctr} onChange={v => setEdited(e => ({ ...e, ctr: v }))} />
            <NumField label="Google cost per click (₹)" value={a.gCpc} src={defaults.src.gCpc} onChange={v => setEdited(e => ({ ...e, gCpc: v }))} />
            <NumField label="Conversion rate (%)" value={a.cvr} step={0.1} src={defaults.src.cvr} onChange={v => setEdited(e => ({ ...e, cvr: v }))} />
            <NumField label="Average order value (₹)" value={a.aov} src={defaults.src.aov} onChange={v => setEdited(e => ({ ...e, aov: v }))} />
          </div>
          <p className="text-[13px] text-[#A1A1AA] mt-3">
            &ldquo;Your real data&rdquo; = your own last-30-day Meta/Shopify numbers - assumes they perform like you.
          </p>
        </Card>

        <Card>
          <CardHeader title="Where their visits come from" right={<EstimateTag />} />
          {est.visits && visitsTotal > 0 ? (
            <Donut
              size={130}
              centerValue={numShort(visitsTotal)}
              centerLabel="visits / mo"
              segments={[
                { label: "Google organic", value: est.visits.organic, color: "#22C55E" },
                { label: "Google ads", value: est.visits.googlePaid, color: "#3B82F6" },
                { label: "Meta ads", value: est.visits.meta, color: "#F97316" },
              ]}
            />
          ) : <p className={SUB}>Not enough data.</p>}
          <p className="text-[13px] text-[#A1A1AA] mt-3">Excludes direct, email, WhatsApp, influencer and marketplace traffic - none of it is visible publicly.</p>
        </Card>

        <Card>
          <CardHeader title="Their prices" right={storeData?.isShopify ? "live from their store" : undefined} />
          {!competitor.website ? (
            <p className={SUB}>Add their website to read real prices.</p>
          ) : !store ? (
            <Loading label="Reading their store…" />
          ) : !storeData?.isShopify ? (
            <p className={SUB}>Couldn&apos;t read prices - their site isn&apos;t a public Shopify store. Set the AOV manually in Assumptions.</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2 text-center">
                <MiniStat label="Products" value={formatNumber(storeData.productCount)} />
                <MiniStat label="Median price" value={storeData.priceMedian ? `${storeData.currency ?? "₹"} ${formatNumber(storeData.priceMedian)}` : "-"} />
                <MiniStat label="On sale" value={storeData.onSalePct != null ? `${storeData.onSalePct}%` : "-"} />
              </div>
              {storeData.bestsellers.length > 0 && (
                <div>
                  <div className="text-[13px] font-bold uppercase tracking-wide text-[#A1A1AA] mb-1">Their bestsellers</div>
                  <ul className="space-y-1">
                    {storeData.bestsellers.slice(0, 6).map(p => (
                      <li key={p.handle} className="flex items-center justify-between gap-2 text-[14px]">
                        <a href={p.url} target="_blank" rel="noreferrer" className="truncate hover:text-[#F97316]">{p.title}</a>
                        <span className="font-semibold whitespace-nowrap">
                          {formatNumber(p.price)}
                          {p.compareAt && <span className="text-[#A1A1AA] line-through ml-1 font-normal">{formatNumber(p.compareAt)}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title={<span className="flex items-center gap-1.5"><Info size={16} className="text-[#3B82F6]" /> How this is calculated &amp; why real ROAS is probably lower</span>} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[15px] text-[#52525B] dark:text-[#A1A1AA]">
          <ul className="space-y-1.5 list-disc pl-5">
            <li><b>Meta spend</b>: {country.eu ? "real EU reach × 1.3–2.5 views per person × CPM, last 30 days." : "each live creative gets a daily-budget range based on how long it has run (testing < 7 days, proving < 30, scaled 30+) × 30 days, adjusted for this country's ad costs."}</li>
            <li><b>Google spend</b>: each live Google ad (Search, Shopping/PMax, YouTube) gets a smaller daily-budget range than Meta - several Google ads share one campaign budget - by how long it has run, × 30 days. Never below DataForSEO&apos;s search-click cost. Google visits = spend ÷ cost per click.</li>
            <li><b>Conversion rate</b>: your own rate only if they sell at a similar price; otherwise a benchmark for their price level (e.g. 0.35% for ₹30,000+ products). Ad visits convert at 70% of that.</li>
            <li><b>Revenue</b>: (Google organic + Google-ads + Meta-ad visits) × conversion rate × average order value.</li>
            <li><b>ROAS from ads</b>: revenue from ad visits ÷ ad spend. Blended (all revenue ÷ spend) is shown only when most traffic isn&apos;t free.</li>
          </ul>
          <ul className="space-y-1.5 list-disc pl-5">
            <li>We can&apos;t see their <b>discounts</b>, <b>COD returns (RTO)</b> or <b>repeat customers</b> - real ROAS is usually lower than shown.</li>
            <li>Marketplace sales (Amazon, Myntra, Nykaa) and influencer spend are invisible.</li>
            <li>Small or new brands often have too little Google data for a reliable estimate.</li>
            <li>Use this to compare direction and scale - not as their exact numbers.</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}

function RangeCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="relative bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-4 shadow-sm">
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[#8B5CF6] via-[#A78BFA] to-transparent rounded-t-2xl" />
      <div className="text-[13px] font-bold text-[#A1A1AA] mb-2 uppercase tracking-[0.12em] flex items-center justify-between">
        {label} <span className="text-[11px] text-[#8B5CF6]">EST.</span>
      </div>
      <div className="text-[24px] font-black leading-tight tracking-tight">{value}</div>
      <div className="text-[13px] text-[#A1A1AA] mt-1.5">{sub}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#FAFAFA] dark:bg-[#0F0F0F] p-2">
      <div className="text-[16px] font-bold">{value}</div>
      <div className="text-[12px] text-[#A1A1AA]">{label}</div>
    </div>
  );
}

function NumField({ label, value, onChange, src, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void; src: AssumptionSource; step?: number;
}) {
  const s = srcLabel[src];
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-[13px] font-semibold text-[#71717A]">{label}</label>
        <Badge variant={s.variant}>{s.text}</Badge>
      </div>
      <input
        type="number" min={0} step={step} value={Number.isFinite(value) ? value : 0}
        onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-full text-[15px] border border-black/10 dark:border-white/10 rounded-lg px-3 py-1.5 bg-white dark:bg-[#0F0F0F]"
      />
    </div>
  );
}
