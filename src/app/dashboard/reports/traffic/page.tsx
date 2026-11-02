"use client";
import { useEffect, useState } from "react";
import { useDateRange, rangeText, formatDateSpan } from "@/lib/date-range-context";
import { Card, CardHeader } from "@/components/ui/card";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF } from "@/lib/export";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, Globe, Users, MonitorSmartphone, MapPin } from "lucide-react";
import Link from "next/link";

interface GA4Data {
  property: string;
  period: { startDate: string; endDate: string };
  kpis: { sessions: number; users: number; pageviews: number; bounceRate: number; avgSessionMin: string; newUsers: number };
  channels: { channel: string; sessions: number; users: number; purchases: number; revenue: number }[];
  pages: { page: string; views: number; sessions: number; bounceRate: number }[];
  devices: { device: string; sessions: number; users: number }[];
  countries: { country: string; sessions: number; users: number }[];
  landingPages: { page: string; sessions: number; bounceRate: number; newUsers: number }[];
  ecommerce: { itemsViewed: number; itemsAddedToCart: number; itemsCheckedOut: number; itemsPurchased: number; purchases: number; revenue: number; atcRate: number; checkoutRate: number; purchaseRate: number } | null;
  newVsReturning: { type: string; sessions: number; users: number; purchases: number; revenue: number }[];
  cities: { city: string; sessions: number; users: number }[];
}

function Signal({ type, metric, value, detail }: { type: "good" | "warn" | "bad"; metric: string; value: string; detail: string }) {
  const s = {
    good: { bg: "bg-[#F0FDF4] dark:bg-[#052E16]/40 border-[#86EFAC]", icon: <CheckCircle2 size={14} className="text-[#16A34A] shrink-0 mt-0.5" />, label: "text-[#166534] dark:text-[#4ADE80]" },
    warn: { bg: "bg-[#FFFBEB] dark:bg-[#2D1C00]/40 border-[#FCD34D]", icon: <AlertTriangle size={14} className="text-[#D97706] shrink-0 mt-0.5" />, label: "text-[#92400E] dark:text-[#FCD34D]" },
    bad:  { bg: "bg-[#FEF2F2] dark:bg-[#2D0A0A]/40 border-[#FCA5A5]", icon: <XCircle size={14} className="text-[#DC2626] shrink-0 mt-0.5" />, label: "text-[#991B1B] dark:text-[#FCA5A5]" },
  }[type];
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-3", s.bg)}>
      {s.icon}
      <div>
        <div className={cn("text-[14px] font-bold", s.label)}>{metric}: {value}</div>
        <div className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] mt-0.5 leading-relaxed">{detail}</div>
      </div>
    </div>
  );
}

export default function TrafficReportPage() {
  const { range } = useDateRange();
  const [data, setData] = useState<GA4Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [notConnected, setNotConnected] = useState(false);
  const generatedAt = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    setLoading(true);
    fetch(`/api/ga4?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then(d => {
        if (d.error === "not_connected") { setNotConnected(true); return; }
        if (!d.error) setData(d);
      })
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  function buildSections() {
    if (!data) return [];
    const k = data.kpis;
    return [
      { title: "Traffic KPIs", headers: ["Metric", "Value"], rows: [
        ["Sessions", k.sessions], ["Users", k.users], ["Pageviews", k.pageviews],
        ["New Users", k.newUsers], ["Bounce Rate", `${k.bounceRate}%`], ["Avg Session Duration", k.avgSessionMin],
        ["Period", formatDateSpan(data.period.startDate, data.period.endDate)],
      ]},
      { title: "Traffic Channels", headers: ["Channel", "Sessions", "Users", "Purchases", "Revenue"], rows:
        data.channels.map(c => [c.channel, c.sessions, c.users, c.purchases, `Rs.${c.revenue.toFixed(0)}`])
      },
      { title: "Top Pages", headers: ["Page", "Views", "Sessions", "Bounce Rate"], rows:
        data.pages.map(p => [p.page, p.views, p.sessions, `${p.bounceRate}%`])
      },
      { title: "Devices", headers: ["Device", "Sessions", "Users"], rows:
        data.devices.map(d => [d.device, d.sessions, d.users])
      },
      { title: "Top Countries", headers: ["Country", "Sessions", "Users"], rows:
        data.countries.map(c => [c.country, c.sessions, c.users])
      },
      { title: "Top Cities", headers: ["City", "Sessions", "Users"], rows:
        data.cities.map(c => [c.city, c.sessions, c.users])
      },
      { title: "Landing Pages", headers: ["Page", "Sessions", "Bounce Rate", "New Users"], rows:
        data.landingPages.map(p => [p.page, p.sessions, `${p.bounceRate}%`, p.newUsers])
      },
      ...(data.ecommerce ? [{ title: "Ecommerce Funnel", headers: ["Stage", "Count", "Rate"], rows: [
        ["Items Viewed", data.ecommerce.itemsViewed, "-"],
        ["Add to Cart", data.ecommerce.itemsAddedToCart, `${data.ecommerce.atcRate}%`],
        ["Checkout", data.ecommerce.itemsCheckedOut, `${data.ecommerce.checkoutRate}%`],
        ["Purchased", data.ecommerce.itemsPurchased, `${data.ecommerce.purchaseRate}%`],
      ]}] : []),
    ];
  }

  if (loading) return <div className="text-[16px] text-[#A1A1AA] py-20 text-center">Loading traffic data…</div>;
  if (notConnected) return (
    <div className="text-center py-20">
      <Globe size={32} className="text-[#A1A1AA] mx-auto mb-3" />
      <h2 className="text-[18px] font-bold mb-2 dark:text-[#F4F4F5]">Google Analytics 4 not connected</h2>
      <Link href="/api/auth/google?service=ga4" className="px-5 py-2.5 bg-[#22C55E] text-white rounded-xl text-[15px] font-semibold">Connect GA4 →</Link>
    </div>
  );
  if (!data) return <div className="text-[16px] text-[#EF4444] py-8 text-center">Could not load traffic data.</div>;

  const k = data.kpis;
  const newUserPct = k.users > 0 ? Math.round((k.newUsers / k.users) * 100) : 0;
  const returningPct = 100 - newUserPct;
  const topChannel = data.channels[0];
  const topChannelPct = k.sessions > 0 ? Math.round((topChannel?.sessions / k.sessions) * 100) : 0;

  const working: { metric: string; value: string; detail: string }[] = [];
  const attention: { type: "warn" | "bad"; metric: string; value: string; detail: string }[] = [];

  if (k.bounceRate < 50) working.push({ metric: "Bounce Rate", value: `${k.bounceRate}%`, detail: "Below 50% - visitors are engaging with your site after landing. Content and UX are resonating well." });
  if (k.sessions > 0) working.push({ metric: "Sessions", value: k.sessions.toLocaleString("en-IN"), detail: `${k.sessions.toLocaleString("en-IN")} sessions in the period - steady traffic base. Grow this with consistent content and ads.` });
  if (data.channels.length >= 3) working.push({ metric: "Channel Diversity", value: `${data.channels.length} channels`, detail: "Traffic is coming from multiple channels - reduces dependency on a single source and lowers risk." });
  if (returningPct >= 20) working.push({ metric: "Returning Users", value: `${returningPct}%`, detail: `${returningPct}% of users are returning - good retention signal. Build on this with email and WhatsApp re-engagement.` });

  if (k.bounceRate >= 70) attention.push({ type: "bad", metric: "Bounce Rate", value: `${k.bounceRate}%`, detail: "Very high bounce rate - most visitors leave without engaging. Review landing page speed, mobile UX, and ad-to-page relevance." });
  else if (k.bounceRate >= 50) attention.push({ type: "warn", metric: "Bounce Rate", value: `${k.bounceRate}%`, detail: "Above 50% - more than half of visitors are bouncing. Check page load speed and ensure ad copy matches landing page content." });
  if (topChannelPct > 70) attention.push({ type: "warn", metric: "Channel Concentration", value: `${topChannel?.channel} ${topChannelPct}%`, detail: `Over 70% of traffic from one channel - high dependency risk. Invest in SEO and organic content to diversify.` });
  if (data.ecommerce && data.ecommerce.atcRate < 10) attention.push({ type: "warn", metric: "ATC Rate (GA4)", value: `${data.ecommerce.atcRate}%`, detail: "Very few visitors add items to cart. Review product page UX - ensure price, images, and reviews are all visible above the fold." });

  const channelColors: Record<string, string> = {
    "Organic Search": "#4285F4", "Paid Search": "#FBBC04", "Direct": "#34A853", "Social": "#1877F2",
    "Email": "#EA580C", "Referral": "#8B5CF6", "Organic Social": "#EC4899",
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 bg-[#22C55E] rounded-lg flex items-center justify-center"><Globe size={14} className="text-white" /></div>
            <h1 className="text-xl font-bold text-[#18181B] dark:text-[#F4F4F5]">Traffic Report</h1>
          </div>
          <p className="text-[14px] text-[#A1A1AA] ml-9">{data.property} · {rangeText(range)} · Generated {generatedAt}</p>
        </div>
        <ExportButton
          onExportCSV={() => exportToCSV(`skylitee-traffic-report-${range.from}`, buildSections())}
          onExportPDF={() => exportToPDF(`skylitee-traffic-report-${range.from}`, "Traffic Report", `${data.property} · ${rangeText(range)}`, buildSections())}
        />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Sessions", value: k.sessions.toLocaleString("en-IN"), icon: <Globe size={13} className="text-[#22C55E]" /> },
          { label: "Users", value: k.users.toLocaleString("en-IN"), icon: <Users size={13} className="text-[#22C55E]" /> },
          { label: "Bounce Rate", value: `${k.bounceRate}%`, icon: <MonitorSmartphone size={13} className={k.bounceRate < 50 ? "text-[#22C55E]" : "text-[#EF4444]"} /> },
          { label: "Avg Session", value: k.avgSessionMin, icon: <Globe size={13} className="text-[#A1A1AA]" /> },
        ].map(item => (
          <div key={item.label} className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-4">
            <div className="flex items-center gap-1.5 mb-2">{item.icon}<span className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide">{item.label}</span></div>
            <div className="text-[22px] font-black text-[#18181B] dark:text-[#F4F4F5]">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Signals */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader title="✅ What's Working" />
          <div className="space-y-2">
            {working.length === 0
              ? <p className="text-[15px] text-[#A1A1AA]">Connect GA4 and build traffic first.</p>
              : working.map((s, i) => <Signal key={i} type="good" {...s} />)}
          </div>
        </Card>
        <Card>
          <CardHeader title="⚠️ Needs Attention" />
          <div className="space-y-2">
            {attention.length === 0
              ? <p className="text-[15px] text-[#A1A1AA]">No major issues detected.</p>
              : attention.map((s, i) => <Signal key={i} {...s} />)}
          </div>
        </Card>
      </div>

      {/* Traffic Channels */}
      <Card>
        <CardHeader title="Traffic Channels" right={`${data.channels.length} channels`} />
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                {["Channel", "Sessions", "Share", "Users", "Purchases"].map(h => (
                  <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.channels.map((ch, i) => {
                const pct = k.sessions > 0 ? Math.round((ch.sessions / k.sessions) * 100) : 0;
                const color = channelColors[ch.channel] ?? "#A1A1AA";
                return (
                  <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]">
                    <td className="py-2 px-2 font-semibold dark:text-[#F4F4F5]">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        {ch.channel}
                      </span>
                    </td>
                    <td className="py-2 px-2 font-bold">{ch.sessions.toLocaleString("en-IN")}</td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden max-w-[60px]">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                        <span className="text-[#71717A]">{pct}%</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-[#A1A1AA]">{ch.users.toLocaleString("en-IN")}</td>
                    <td className="py-2 px-2">{ch.purchases || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* New vs Returning + Ecommerce */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader title="New vs Returning" />
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-[#F0FDF4] dark:bg-[#052E16]/30 rounded-xl p-3 text-center border border-[#86EFAC]">
              <div className="text-[28px] font-black text-[#22C55E]">{k.newUsers.toLocaleString("en-IN")}</div>
              <div className="text-[13px] text-[#A1A1AA]">New Users</div>
              <div className="text-[15px] font-bold text-[#16A34A]">{newUserPct}%</div>
            </div>
            <div className="bg-[#EFF6FF] dark:bg-[#1E3A5F]/30 rounded-xl p-3 text-center border border-[#BFDBFE]">
              <div className="text-[28px] font-black text-[#3B82F6]">{(k.users - k.newUsers).toLocaleString("en-IN")}</div>
              <div className="text-[13px] text-[#A1A1AA]">Returning</div>
              <div className="text-[15px] font-bold text-[#1D4ED8]">{returningPct}%</div>
            </div>
          </div>
          <div className="h-2 flex rounded-full overflow-hidden">
            <div className="bg-[#22C55E]" style={{ width: `${newUserPct}%` }} />
            <div className="bg-[#3B82F6]" style={{ width: `${returningPct}%` }} />
          </div>
        </Card>

        {data.ecommerce && (
          <Card>
            <CardHeader title="Ecommerce Funnel (GA4)" />
            <div className="space-y-1.5">
              {[
                { label: "Items Viewed", count: data.ecommerce.itemsViewed, color: "#6366F1", pct: 100 },
                { label: "Add to Cart", count: data.ecommerce.itemsAddedToCart, color: "#EAB308", pct: data.ecommerce.atcRate },
                { label: "Checkout", count: data.ecommerce.itemsCheckedOut, color: "#F97316", pct: data.ecommerce.checkoutRate },
                { label: "Purchased", count: data.ecommerce.itemsPurchased, color: "#22C55E", pct: data.ecommerce.purchaseRate },
              ].map(step => (
                <div key={step.label} className="bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[14px] font-semibold dark:text-[#F4F4F5]">{step.label}</span>
                    <span className="text-[16px] font-black" style={{ color: step.color }}>{step.count.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="h-1.5 bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(step.pct, 100)}%`, backgroundColor: step.color, opacity: 0.75 }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Top Pages + Devices */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader title="Top Pages" right={`${data.pages.length} pages`} />
          <table className="w-full text-[14px]">
            <thead><tr className="border-b border-black/[0.06] dark:border-white/[0.06]">{["Page", "Views", "Bounce"].map(h => <th key={h} className="text-left py-1.5 px-2 text-[13px] font-bold text-[#A1A1AA] uppercase">{h}</th>)}</tr></thead>
            <tbody>
              {data.pages.slice(0, 8).map((p, i) => (
                <tr key={i} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                  <td className="py-2 px-2 font-medium dark:text-[#F4F4F5] max-w-[160px]"><div className="truncate">{p.page}</div></td>
                  <td className="py-2 px-2 font-bold text-[#22C55E]">{p.views}</td>
                  <td className="py-2 px-2"><span className={cn("font-semibold", p.bounceRate >= 70 ? "text-[#EF4444]" : p.bounceRate >= 50 ? "text-[#EAB308]" : "text-[#22C55E]")}>{p.bounceRate}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader title="Devices & Locations" />
          <div className="mb-3">
            <div className="text-[13px] font-bold text-[#A1A1AA] uppercase mb-2 flex items-center gap-1"><MonitorSmartphone size={10} /> Devices</div>
            <div className="space-y-1.5">
              {data.devices.map((d, i) => {
                const pct = k.sessions > 0 ? Math.round((d.sessions / k.sessions) * 100) : 0;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[14px] capitalize w-16 shrink-0 dark:text-[#F4F4F5]">{d.device}</span>
                    <div className="flex-1 h-1.5 bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                      <div className="h-full bg-[#22C55E] rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[13px] text-[#A1A1AA] w-8 text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-[13px] font-bold text-[#A1A1AA] uppercase mb-2 flex items-center gap-1"><MapPin size={10} /> Top Countries</div>
            <div className="space-y-1">
              {data.countries.slice(0, 5).map((c, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-[14px] dark:text-[#F4F4F5]">{c.country}</span>
                  <span className="text-[14px] font-bold text-[#22C55E]">{c.sessions.toLocaleString("en-IN")}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
