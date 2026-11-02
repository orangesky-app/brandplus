"use client";
import Link from "next/link";
import { ShoppingCart, Wallet, CreditCard, Globe, Share2, Search, Megaphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Donut } from "@/components/ui/charts";
import { formatINR, cn } from "@/lib/utils";

// "At a glance" - the Simple view's chart section. One small card per question a store owner
// asks ("how much did I sell?", "what did ads cost?", "how did people pay?"…), each with a
// simple bar/donut chart and plain labels. Pure presentation: the page passes plain numbers.

export interface GlanceData {
  periodLabel: string;                 // "Today", "This month"…
  periodText: string;                  // "This month (1 - 2 Nov 2026)"
  periodDates: string;                 // "1 - 2 Nov 2026"
  compLabel: string;                   // "Yesterday, full day (1 Nov 2026)"…
  shop: { sales: number; orders: number; aov: number; prepaidRevenue: number; codRevenue: number; prepaidOrders: number; codOrders: number } | null;
  compShop: { sales: number; orders: number } | null;
  meta: { spend: number; clicks: number; purchases: number; purchaseValue: number; leads: number } | null;
  gads: { spend: number; clicks: number; conversions: number; conversionValue: number } | null;
  ga4: { users: number; sessions: number; bounceRate: number; channels: { channel: string; sessions: number }[] } | null;
  gsc: { clicks: number; impressions: number; avgPosition: number; note?: string } | null;
}

const n = (v: number) => Math.round(v).toLocaleString("en-IN");

/** Horizontal bar rows - the bar length is the value relative to the biggest row. */
function Bars({ rows, money = false }: { rows: { label: string; value: number; color: string; hint?: string }[]; money?: boolean }) {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="text-[#52525B] dark:text-[#A1A1AA] truncate">{r.label}{r.hint && <span className="text-[#A1A1AA]"> · {r.hint}</span>}</span>
            <span className="font-bold text-[#18181B] dark:text-[#F4F4F5] tabular-nums shrink-0">{money ? formatINR(r.value) : n(r.value)}</span>
          </div>
          <div className="h-2.5 mt-1 rounded-full bg-[#F5F5F4] dark:bg-[#262626] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.max(r.value > 0 ? 3 : 0, (r.value / max) * 100)}%`, background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-[#A1A1AA] truncate">{label}</div>
      <div className="text-[17px] font-black text-[#18181B] dark:text-[#F4F4F5] tabular-nums leading-tight">{value}</div>
    </div>
  );
}

function GlanceCard({ icon: Icon, iconColor, title, sub, children }: {
  icon: typeof ShoppingCart; iconColor: string; title: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="flex items-center gap-1.5 text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5]"><Icon size={15} className={iconColor} /> {title}</span>
        {sub && <span className="text-[12px] text-[#A1A1AA] text-right">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

function NotConnected({ what }: { what: string }) {
  return (
    <div className="text-[14px] text-[#A1A1AA] py-6 text-center">
      {what} not connected. <Link href="/dashboard/connections" className="text-[#F97316] font-semibold">Connect →</Link>
    </div>
  );
}

export function Glance({ d, loading }: { d: GlanceData; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {Array.from({ length: 6 }, (_, i) => <Card key={i}><div className="h-[150px] flex items-center justify-center text-[14px] text-[#A1A1AA]">Loading…</div></Card>)}
      </div>
    );
  }

  const s = d.shop;
  const adSpend = (d.meta?.spend ?? 0) + (d.gads?.spend ?? 0);
  const backPer100 = adSpend > 0 && s ? Math.round((s.sales / adSpend) * 100) : null;
  const metaResult = d.meta ? (d.meta.purchases > 0 || d.meta.leads === 0
    ? { label: "Orders from ads", value: n(d.meta.purchases) }
    : { label: "Leads", value: n(d.meta.leads) }) : null;
  const topChannels = (d.ga4?.channels ?? []).filter(c => c.sessions > 0).sort((a, b) => b.sessions - a.sessions).slice(0, 4);
  const CHANNEL_COLORS = ["#6366F1", "#8B5CF6", "#A78BFA", "#C4B5FD"];

  return (
    <div className="space-y-2">
    <div className="text-[13px] text-[#71717A] dark:text-[#A1A1AA]">These numbers cover <b className="font-semibold">{d.periodText}</b></div>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
      {/* 1 · Sales */}
      <GlanceCard icon={ShoppingCart} iconColor="text-[#F97316]" title="Sales" sub={d.periodDates}>
        {!s ? <NotConnected what="Shopify" /> : (<>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="Sales" value={formatINR(s.sales)} />
            <Stat label="Orders" value={n(s.orders)} />
            <Stat label="Avg order" value={formatINR(s.aov)} />
          </div>
          <Bars money rows={[
            { label: d.periodDates, value: s.sales, color: "#F97316", hint: `${n(s.orders)} orders` },
            ...(d.compShop ? [{ label: d.compLabel, value: d.compShop.sales, color: "#FDBA74", hint: `${n(d.compShop.orders)} orders` }] : []),
          ]} />
        </>)}
      </GlanceCard>

      {/* 2 · Money in vs ad money out */}
      <GlanceCard icon={Wallet} iconColor="text-[#16A34A]" title="Sales vs ad spend" sub={backPer100 !== null ? `₹${n(backPer100)} back per ₹100` : undefined}>
        {!s ? <NotConnected what="Shopify" /> : (
          <Bars money rows={[
            { label: "Sales", value: s.sales, color: "#22C55E" },
            ...(d.meta ? [{ label: "Meta ads spend", value: d.meta.spend, color: "#3B82F6" }] : []),
            ...(d.gads ? [{ label: "Google ads spend", value: d.gads.spend, color: "#EAB308" }] : []),
          ]} />
        )}
        {s && !d.meta && !d.gads && <div className="text-[13px] text-[#A1A1AA] mt-2">Connect Meta or Google Ads to see what ads cost.</div>}
      </GlanceCard>

      {/* 3 · How customers paid */}
      <GlanceCard icon={CreditCard} iconColor="text-[#F97316]" title="How customers paid">
        {!s ? <NotConnected what="Shopify" /> : (<>
          <Donut size={120} centerValue={n(s.orders)} centerLabel="orders" segments={[
            { label: `Prepaid · ${n(s.prepaidOrders)} orders`, value: s.prepaidRevenue, color: "#F97316" },
            { label: `COD · ${n(s.codOrders)} orders`, value: s.codRevenue, color: "#94A3B8" },
          ]} />
          <div className="text-[13px] text-[#52525B] dark:text-[#A1A1AA] mt-2">
            <b className="text-[#18181B] dark:text-[#F4F4F5]">{formatINR(s.prepaidRevenue)}</b> already paid · <b className="text-[#18181B] dark:text-[#F4F4F5]">{formatINR(s.codRevenue)}</b> to collect on delivery
          </div>
        </>)}
      </GlanceCard>

      {/* 4 · Website (GA4) */}
      <GlanceCard icon={Globe} iconColor="text-[#6366F1]" title="Website visitors" sub="Google Analytics">
        {!d.ga4 ? <NotConnected what="Google Analytics" /> : (<>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="Visitors" value={n(d.ga4.users)} />
            <Stat label="Visits" value={n(d.ga4.sessions)} />
            <Stat label="Left quickly" value={`${Math.round(d.ga4.bounceRate)}%`} />
          </div>
          {topChannels.length > 0
            ? <><div className="text-[12px] text-[#A1A1AA] mb-1.5">Where visits came from</div>
                <Bars rows={topChannels.map((c, i) => ({ label: c.channel, value: c.sessions, color: CHANNEL_COLORS[i] }))} /></>
            : <div className="text-[13px] text-[#A1A1AA]">No visits recorded yet for {d.periodLabel.toLowerCase()}.</div>}
        </>)}
      </GlanceCard>

      {/* 5 · Meta ads */}
      <GlanceCard icon={Share2} iconColor="text-[#1877F2]" title="Meta ads" sub="Facebook & Instagram">
        {!d.meta ? <NotConnected what="Meta Ads" /> : (<>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="Spent" value={formatINR(d.meta.spend)} />
            <Stat label="Clicks" value={n(d.meta.clicks)} />
            {metaResult && <Stat label={metaResult.label} value={metaResult.value} />}
          </div>
          <Bars money rows={[
            { label: "Spent on ads", value: d.meta.spend, color: "#3B82F6" },
            { label: "Sales Meta tracked", value: d.meta.purchaseValue, color: "#22C55E" },
          ]} />
        </>)}
      </GlanceCard>

      {/* 6 · Google (Ads + Search) */}
      <GlanceCard icon={Search} iconColor="text-[#16A34A]" title="Google" sub={d.gsc?.note}>
        {!d.gads && !d.gsc ? <NotConnected what="Google" /> : (
          <div className="space-y-3">
            {d.gads && (
              <div>
                <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#A1A1AA] mb-1"><Megaphone size={12} /> Google Ads</div>
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Spent" value={formatINR(d.gads.spend)} />
                  <Stat label="Clicks" value={n(d.gads.clicks)} />
                  <Stat label="Conversions" value={n(d.gads.conversions)} />
                </div>
                <div className="mt-2.5">
                  <Bars money rows={[
                    { label: "Spent on ads", value: d.gads.spend, color: "#EAB308" },
                    { label: "Sales Google tracked", value: d.gads.conversionValue, color: "#22C55E" },
                  ]} />
                </div>
              </div>
            )}
            {d.gsc && (
              <div className={cn(d.gads && "pt-3 border-t border-black/[0.05] dark:border-white/[0.05]")}>
                <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#A1A1AA] mb-1.5"><Search size={12} /> Free Google search</div>
                <Bars rows={[
                  { label: "Times you showed up", value: d.gsc.impressions, color: "#86EFAC" },
                  { label: "Clicks to your site", value: d.gsc.clicks, color: "#16A34A" },
                ]} />
                {d.gsc.avgPosition > 0 && (
                  <div className="text-[13px] text-[#52525B] dark:text-[#A1A1AA] mt-2">
                    Average Google rank: <b className="text-[#18181B] dark:text-[#F4F4F5]">#{Math.round(d.gsc.avgPosition)}</b>
                    {d.gsc.avgPosition <= 10 ? " - page 1" : ` - page ${Math.ceil(d.gsc.avgPosition / 10)}`}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </GlanceCard>
    </div>
    </div>
  );
}
