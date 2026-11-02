"use client";
import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { PeriodNote } from "@/components/ui/period";
import { formatDateSpan } from "@/lib/date-range-context";
import { formatINR } from "@/lib/utils";
import { Brain, RefreshCw, TrendingUp } from "lucide-react";
import Link from "next/link";

interface InsightMetrics {
  grossSales: number;
  totalOrders: number;
  aov: number;
  codPct: number;
  repeatRate: number;
  avgLTV: number;
  projectedMonthly: number;
  days: number;
}

export default function InsightsPage() {
  const [insights, setInsights] = useState<string>("");
  const [metrics, setMetrics] = useState<InsightMetrics | null>(null);
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adsConnected, setAdsConnected] = useState(false);

  // Reflect real connection status - don't hard-show a "Connect Meta/Google Ads"
  // prompt when those platforms are already linked.
  useEffect(() => {
    Promise.allSettled([
      fetch("/api/meta/accounts").then(r => r.json()),
      fetch("/api/google/sites").then(r => r.json()),
    ]).then(([m, g]) => {
      const metaOk = m.status === "fulfilled" && !m.value?.error;
      const gadsOk = g.status === "fulfilled" && !!g.value?.gadsConnected;
      setAdsConnected(metaOk || gadsOk);
    });
  }, []);

  const fetchInsights = () => {
    setLoading(true);
    setError("");
    fetch("/api/ai/insights")
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError("Could not load - check Shopify connection"); return; }
        setInsights(d.insights);
        setMetrics(d.metrics);
        setPeriod(d.period ?? null);
      })
      .catch(() => setError("Failed to generate insights"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchInsights(); }, []);

  // Parse Claude's **Title** format into sections
  const parsedInsights = insights.split(/\*\*(.+?)\*\*/).filter(s => s.trim()).reduce<{ title: string; body: string }[]>((acc, part, i) => {
    if (i % 2 === 0) { acc.push({ title: part.trim(), body: "" }); }
    else if (acc.length > 0) { acc[acc.length - 1].body = part.trim(); }
    return acc;
  }, []);

  const insightColors = ["border-[#e0f5ee] bg-[#f7fdf9]", "border-[#e4eef9] bg-[#f5f8fd]", "border-[#faecd7] bg-[#fffaf4]"];
  const titleColors = ["text-[#064d38]", "text-[#0a3d7a]", "text-[#5c3608]"];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Brain size={18} className="text-[#F97316]" /> AI Insights</h2>
          <p className="text-[17px] text-[#686864] mt-0.5">Claude AI · analysing your real Shopify data</p>
          {period && <PeriodNote from={period.from} to={period.to} label="This month so far" />}
        </div>
        <button
          onClick={fetchInsights}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[17px] font-medium border border-[#17a773] text-[#17a773] bg-[#f0faf4] hover:bg-[#e0f5ee] disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          {/* Metrics summary */}
          {metrics && (
            <Card className="mb-3">
              <CardHeader title="Store snapshot" right={period ? formatDateSpan(period.from, period.to) : `${metrics.days} days this month`} />
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Revenue so far", value: formatINR(metrics.grossSales) },
                  { label: "Projected monthly", value: formatINR(metrics.projectedMonthly) },
                  { label: "Total orders", value: metrics.totalOrders.toString() },
                  { label: "AOV", value: formatINR(metrics.aov) },
                  { label: "COD ratio", value: `${metrics.codPct}%` },
                  { label: "Repeat rate", value: `${metrics.repeatRate}%` },
                ].map(m => (
                  <div key={m.label} className="bg-[#f7f7f5] rounded-lg p-2.5">
                    <div className="text-[15px] text-[#686864]">{m.label}</div>
                    <div className="text-[17px] font-bold text-[#181816] mt-0.5">{m.value}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Month forecast */}
          {metrics && (
            <Card>
              <CardHeader title="Month-end forecast" />
              <div className="bg-[#f7f7f5] rounded-xl p-3.5 mb-2">
                <div className="flex items-center gap-1.5 text-[16px] text-[#686864] mb-1">
                  <TrendingUp size={11} /> At current pace
                </div>
                <div className="text-2xl font-bold text-[#0d6b4f]">{formatINR(metrics.projectedMonthly)}</div>
                <div className="text-[17px] text-[#686864] mt-1">
                  Based on {metrics.days} days of real data
                </div>
              </div>
              {adsConnected ? (
                <Link href="/dashboard/attribution" className="block text-[17px] text-[#686864] bg-[#f0faf4] border border-[#bbf7d0] rounded-lg px-3 py-2">
                  <span className="font-medium text-[#15803d]">Meta / Google Ads connected</span> - view ROAS & channel attribution →
                </Link>
              ) : (
                <Link href="/dashboard/connections" className="block text-[17px] text-[#686864] bg-[#fff7ed] border border-[#fed7aa] rounded-lg px-3 py-2">
                  <span className="font-medium text-[#92400e]">Connect Meta/Google Ads</span> to see ROAS and channel attribution →
                </Link>
              )}
            </Card>
          )}
        </div>

        <div>
          <div className="text-[16px] font-semibold text-[#9e9e9a] uppercase tracking-wider pb-1.5 border-b border-black/[0.09] mb-3 flex items-center gap-1.5">
            <Brain size={11} /> Claude AI insights · your actual data
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-[17px] text-[#686864] py-8">
              <RefreshCw size={13} className="animate-spin text-[#17a773]" />
              Analysing your Shopify data with Claude AI...
            </div>
          )}

          {error && (
            <div className="text-[17px] text-[#d94040] py-4">{error}</div>
          )}

          {!loading && !error && parsedInsights.length === 0 && insights && (
            <div className="text-[17px] text-[#686864] leading-relaxed bg-[#f7f7f5] rounded-xl p-4 whitespace-pre-wrap">
              {insights}
            </div>
          )}

          {parsedInsights.map((item, i) => (
            <div key={i} className={`border rounded-xl p-4 mb-2.5 ${insightColors[i % insightColors.length]}`}>
              <div className={`text-[17px] font-semibold mb-1.5 ${titleColors[i % titleColors.length]}`}>
                {item.title}
              </div>
              <div className="text-[17px] text-[#686864] leading-relaxed">{item.body}</div>
            </div>
          ))}

          {!loading && !error && (
            <div className="text-[15px] text-[#9e9e9a] mt-3 flex items-center gap-1">
              <Brain size={10} /> Generated by Claude AI using your live Shopify data
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
