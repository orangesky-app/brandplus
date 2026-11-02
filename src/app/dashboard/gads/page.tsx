"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip as RTooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  Megaphone, TrendingUp, MousePointer, Eye, Target,
  DollarSign, Zap, BarChart2, Search, AlertCircle,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";

interface GadsKpis {
  spend: number; clicks: number; impressions: number;
  conversions: number; conversionValue: number;
  roas: number; avgCpc: number; ctr: number; costPerConversion: number;
}
interface Campaign {
  id: string; name: string; status: string;
  impressions: number; clicks: number; spend: number;
  conversions: number; conversionValue: number;
  ctr: number; avgCpc: number; roas: number;
}
interface DailyRow {
  date: string; impressions: number; clicks: number;
  spend: number; conversions: number; convValue: number;
}
interface Keyword {
  keyword: string; impressions: number; clicks: number;
  spend: number; conversions: number; ctr: number; avgCpc: number;
}
interface GadsData {
  account: string; currency: string;
  period: { startDate: string; endDate: string };
  kpis: GadsKpis;
  campaigns: Campaign[];
  daily: DailyRow[];
  keywords: Keyword[];
}

function sym(code: string) {
  return code === "INR" ? "₹" : code === "USD" ? "$" : code === "EUR" ? "€" : `${code} `;
}
function fmtMoney(n: number, cur: string) {
  return `${sym(cur)}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function GadsContent() {
  const searchParams = useSearchParams();
  const [data, setData]       = useState<GadsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState("");

  const today     = new Date();
  const defTo      = today.toISOString().split("T")[0];
  const defFrom    = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [from, setFrom] = useState(searchParams.get("from") ?? defFrom);
  const [to,   setTo]   = useState(searchParams.get("to")   ?? defTo);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/google/ads?from=${from}&to=${to}`)
      .then(r => r.json())
      .then((d: GadsData & { error?: string; detail?: string }) => {
        if (d.error === "not_connected")                { setError("not_connected"); return; }
        if (d.error === "no_customer_selected")         { setError("no_customer");   return; }
        if (d.error === "google_ads_dev_token_missing") { setError("dev_token");     return; }
        if (d.error === "test_token")                   { setError("test_token");    return; }
        if (d.error === "api_disabled")                 { setError("api_disabled");  return; }
        if (d.error === "no_account_access")            { setError("no_access");     return; }
        if (d.error)                                    { setError("failed"); setErrorDetail(d.detail ?? ""); return; }
        setData(d);
      })
      .catch(() => setError("failed"))
      .finally(() => setLoading(false));
  }, [from, to]);

  const c = data?.currency ?? "USD";

  /* ── Loading ──────────────────────────────────────────────────────── */
  if (loading) return (
    <div className="flex items-center justify-center py-24 text-[17px] text-[#686864]">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-[#34A853] border-t-transparent rounded-full animate-spin" />
        Loading Google Ads data…
      </div>
    </div>
  );

  /* ── Error states ─────────────────────────────────────────────────── */
  if (error === "not_connected") return (
    <div className="max-w-md mx-auto mt-12">
      <Card>
        <div className="p-6 text-center">
          <Megaphone size={32} className="text-[#34A853] mx-auto mb-3" />
          <div className="text-[19px] font-semibold text-[#181816] mb-1">Google Ads not connected</div>
          <div className="text-[16px] text-[#686864] mb-4">
            Connect your Google Ads account to track campaign spend, ROAS, and keyword performance.
          </div>
          <a href="/api/auth/google?service=gads"
            className="inline-block px-5 py-2.5 bg-[#34A853] text-white rounded-xl text-[16px] font-semibold hover:bg-[#2d9248] transition-colors">
            Connect Google Ads
          </a>
        </div>
      </Card>
    </div>
  );

  if (error === "no_customer") return (
    <div className="max-w-md mx-auto mt-12">
      <Card>
        <div className="p-6 text-center">
          <AlertCircle size={32} className="text-amber-500 mx-auto mb-3" />
          <div className="text-[19px] font-semibold text-[#181816] mb-1">Select your Google Ads account</div>
          <div className="text-[16px] text-[#686864] mb-4">
            Connected - but no account selected. Pick one in Connections.
          </div>
          <a href="/dashboard/connections"
            className="inline-block px-5 py-2.5 bg-[#34A853] text-white rounded-xl text-[16px] font-semibold hover:bg-[#2d9248] transition-colors">
            Go to Connections
          </a>
        </div>
      </Card>
    </div>
  );

  if (error === "dev_token") return (
    <div className="max-w-md mx-auto mt-12">
      <Card>
        <div className="p-6 text-center">
          <AlertCircle size={32} className="text-red-500 mx-auto mb-3" />
          <div className="text-[19px] font-semibold text-[#181816] mb-2">Google Ads API not configured</div>
          <div className="text-[16px] text-[#686864]">
            Add <code className="bg-[#f5f5f4] px-1 rounded text-[15px]">GOOGLE_ADS_DEVELOPER_TOKEN</code> in Vercel environment variables.
          </div>
        </div>
      </Card>
    </div>
  );

  if (error === "test_token") return (
    <div className="max-w-lg mx-auto mt-12 space-y-3">
      <Card>
        <div className="p-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#fffbe6] border border-[#ffe58f] flex items-center justify-center shrink-0">
              <AlertCircle size={20} className="text-amber-500" />
            </div>
            <div>
              <div className="text-[18px] font-semibold text-[#181816] mb-1">
                Google Ads data isn&apos;t available yet
              </div>
              <div className="text-[16px] text-[#686864] space-y-2">
                <p>Your account is connected. Skylitee doesn&apos;t have Google&apos;s full Google Ads API access yet, and Google blocks reading live ad data until it does.</p>
                <p className="font-medium text-[#181816]">What&apos;s happening:</p>
                <ul className="space-y-1 list-disc list-inside text-[15px]">
                  <li>Google account ✓ Connected</li>
                  <li>Customer ID ✓ Saved</li>
                  <li>Ad data ✗ Blocked until Google grants Skylitee access</li>
                </ul>
                <p className="text-[15px] bg-[#e8f5e9] border border-[#a5d6a7] rounded-lg px-3 py-2 text-[#1b5e20]">
                  ✓ No action needed on your account. This is on Skylitee&apos;s side, and your Google Ads data will load here automatically once Google grants access.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );

  if (error === "api_disabled") return (
    <div className="max-w-md mx-auto mt-12">
      <Card>
        <div className="p-6 text-center">
          <AlertCircle size={32} className="text-amber-500 mx-auto mb-3" />
          <div className="text-[19px] font-semibold mb-1">Google Ads API is switched off</div>
          <div className="text-[16px] text-[#686864]">The Google Ads API is disabled in Skylitee&apos;s Google Cloud project. This is on Skylitee&apos;s side, not your account.</div>
        </div>
      </Card>
    </div>
  );

  if (error === "no_access") return (
    <div className="max-w-md mx-auto mt-12">
      <Card>
        <div className="p-6 text-center">
          <AlertCircle size={32} className="text-amber-500 mx-auto mb-3" />
          <div className="text-[19px] font-semibold mb-1">This Google login can&apos;t read that ad account</div>
          <div className="text-[16px] text-[#686864] mb-4">Reconnect Google Ads with a login that has access to this account, or choose a different account.</div>
          <a href="/dashboard/connections"
            className="inline-block px-5 py-2.5 bg-[#34A853] text-white rounded-xl text-[16px] font-semibold hover:bg-[#2d9248] transition-colors">
            Go to Connections
          </a>
        </div>
      </Card>
    </div>
  );

  if (error) return (
    <div className="max-w-md mx-auto mt-12">
      <Card>
        <div className="p-6 text-center">
          <AlertCircle size={32} className="text-red-500 mx-auto mb-3" />
          <div className="text-[19px] font-semibold mb-1">Could not load Google Ads data</div>
          <div className="text-[16px] text-[#686864]">{errorDetail ? `Google said: ${errorDetail}` : "Check your connection in Settings → Connections."}</div>
        </div>
      </Card>
    </div>
  );

  if (!data) return null;

  const k = data.kpis;

  const kpiRow1 = [
    { label: "Ad Spend",     value: fmtMoney(k.spend, c),                  icon: DollarSign,   color: "text-[#34A853]", bg: "bg-[#e8f5e9]" },
    { label: "ROAS",         value: `${k.roas.toFixed(2)}x`,               icon: TrendingUp,   color: "text-[#4285F4]", bg: "bg-[#e3f0ff]" },
    { label: "Conversions",  value: k.conversions.toLocaleString(),         icon: Target,       color: "text-[#E37400]", bg: "bg-[#fff3e0]" },
    { label: "Conv. Value",  value: fmtMoney(k.conversionValue, c),        icon: Zap,          color: "text-[#9333ea]", bg: "bg-[#f3e8ff]" },
    { label: "Clicks",       value: k.clicks.toLocaleString(),              icon: MousePointer, color: "text-[#34A853]", bg: "bg-[#e8f5e9]" },
  ];
  const kpiRow2 = [
    { label: "Impressions",    value: k.impressions.toLocaleString(),       icon: Eye,       color: "text-[#4285F4]", bg: "bg-[#e3f0ff]" },
    { label: "CTR",            value: `${k.ctr.toFixed(2)}%`,              icon: BarChart2, color: "text-[#E37400]", bg: "bg-[#fff3e0]" },
    { label: "Avg CPC",        value: fmtMoney(k.avgCpc, c),               icon: DollarSign,color: "text-[#34A853]", bg: "bg-[#e8f5e9]" },
    { label: "Cost / Conv.",   value: fmtMoney(k.costPerConversion, c),    icon: Target,    color: "text-[#ef4444]", bg: "bg-[#fce8e8]" },
  ];

  return (
    <div className="space-y-4">

      {/* Header + date picker */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Megaphone size={18} className="text-[#F97316]" /> Google Ads</h2>
          <p className="text-[17px] text-[#686864] mt-0.5">{data.account} · {sym(c)} currency</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className="text-[16px] border border-black/[0.12] rounded-lg px-2.5 py-1.5 bg-white" />
          <span className="text-[16px] text-[#686864]">→</span>
          <input type="date" value={to} min={from} max={defTo} onChange={e => setTo(e.target.value)}
            className="text-[16px] border border-black/[0.12] rounded-lg px-2.5 py-1.5 bg-white" />
        </div>
      </div>

      {/* KPI row 1 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {kpiRow1.map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} className="bg-white border border-black/[0.06] rounded-xl p-3">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 ${card.bg}`}>
                <Icon size={13} className={card.color} />
              </div>
              <div className="text-[18px] font-bold text-[#181816]">{card.value}</div>
              <div className="text-[14px] text-[#686864] mt-0.5">{card.label}</div>
            </div>
          );
        })}
      </div>

      {/* KPI row 2 */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {kpiRow2.map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} className="bg-white border border-black/[0.06] rounded-xl p-3">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 ${card.bg}`}>
                <Icon size={13} className={card.color} />
              </div>
              <div className="text-[18px] font-bold text-[#181816]">{card.value}</div>
              <div className="text-[14px] text-[#686864] mt-0.5">{card.label}</div>
            </div>
          );
        })}
      </div>

      {/* Daily Spend + Conversions Chart */}
      {data.daily.length > 0 && (
        <Card>
          <CardHeader title="Daily Spend & Conversions" />
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data.daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis yAxisId="left"  tick={{ fontSize: 11 }} tickFormatter={v => `${sym(c)}${v}`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <RTooltip
                formatter={(value, name) => {
                  const v = Number(value ?? 0);
                  if (name === "spend")       return [`${sym(c)}${v.toFixed(2)}`, "Spend"];
                  if (name === "conversions") return [v.toFixed(1), "Conversions"];
                  return [value, String(name)];
                }}
                labelFormatter={l => `Date: ${l}`}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar  yAxisId="left"  dataKey="spend"       fill="#34A853" opacity={0.8} name="spend" />
              <Line yAxisId="right" dataKey="conversions" stroke="#E37400" dot={false} strokeWidth={2} name="conversions" />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Campaigns + Keywords */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

        {data.campaigns.length > 0 && (
          <Card>
            <CardHeader title="Campaigns" />
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="border-b border-black/[0.06]">
                    {["Campaign", "Spend", "ROAS", "Clicks", "CTR", "Conv."].map(h => (
                      <th key={h} className="text-left py-2 px-2 text-[14px] text-[#686864] font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((camp, i) => (
                    <tr key={camp.id || i} className="border-b border-black/[0.04] hover:bg-[#f9f9f7]">
                      <td className="py-2 px-2 font-medium text-[#181816] max-w-[140px] truncate" title={camp.name}>{camp.name}</td>
                      <td className="py-2 px-2 text-[#181816] whitespace-nowrap">{sym(c)}{camp.spend.toFixed(0)}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <span className={`font-semibold ${camp.roas >= 3 ? "text-[#0d6b4f]" : camp.roas >= 1.5 ? "text-amber-600" : "text-red-500"}`}>
                          {camp.roas > 0 ? `${camp.roas.toFixed(1)}x` : "-"}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-[#181816]">{camp.clicks.toLocaleString()}</td>
                      <td className="py-2 px-2 text-[#181816]">{camp.ctr.toFixed(1)}%</td>
                      <td className="py-2 px-2 text-[#181816]">{camp.conversions.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {data.keywords.length > 0 && (
          <Card>
            <CardHeader title={
              <div className="flex items-center gap-1.5">
                <Search size={12} className="text-[#34A853]" /> Top Keywords
              </div>
            } />
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="border-b border-black/[0.06]">
                    {["Keyword", "Clicks", "CTR", "CPC", "Conv."].map(h => (
                      <th key={h} className="text-left py-2 px-2 text-[14px] text-[#686864] font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.keywords.map((kw, i) => (
                    <tr key={i} className="border-b border-black/[0.04] hover:bg-[#f9f9f7]">
                      <td className="py-2 px-2 font-medium text-[#181816] max-w-[130px] truncate" title={kw.keyword}>{kw.keyword || "-"}</td>
                      <td className="py-2 px-2 text-[#181816]">{kw.clicks.toLocaleString()}</td>
                      <td className="py-2 px-2 text-[#181816]">{kw.ctr.toFixed(1)}%</td>
                      <td className="py-2 px-2 text-[#181816] whitespace-nowrap">{sym(c)}{kw.avgCpc.toFixed(2)}</td>
                      <td className="py-2 px-2 text-[#181816]">{kw.conversions.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {data.campaigns.length === 0 && data.keywords.length === 0 && (
        <Card>
          <div className="py-10 text-center text-[16px] text-[#686864]">
            No campaign data found for this date range. Try a wider date range.
          </div>
        </Card>
      )}
    </div>
  );
}

export default function GadsPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-[17px] text-[#686864]">Loading…</div>}>
      <GadsContent />
    </Suspense>
  );
}
