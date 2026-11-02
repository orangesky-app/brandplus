"use client";
import { useEffect, useState } from "react";
import { useDateRange, rangeText } from "@/lib/date-range-context";
import { RangeText } from "@/components/ui/period";
import { fetchGoogleAds } from "@/lib/gads-client";
import { Card, CardHeader } from "@/components/ui/card";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF } from "@/lib/export";
import { cn } from "@/lib/utils";
import { Sparkles, CheckCircle2, AlertTriangle, Lightbulb, RefreshCw, Target } from "lucide-react";

interface AIReport {
  executiveSummary: string;
  overallScore: number;
  scoreLabel: string;
  working: { metric: string; value: string; insight: string }[];
  notWorking: { metric: string; value: string; insight: string; severity: "high" | "medium" | "low" }[];
  recommendations: { action: string; why: string; priority: "high" | "medium"; effort: "low" | "medium" | "high" }[];
  priorities: string[];
  channelSummary: { bestChannel: string; bestChannelReason: string; weakestChannel: string; weakestChannelReason: string };
}

const scoreColor = (score: number) =>
  score >= 85 ? "#22C55E" : score >= 70 ? "#F97316" : score >= 50 ? "#EAB308" : "#EF4444";

const effortBadge: Record<string, string> = {
  low: "bg-[#F0FDF4] text-[#16A34A] border-[#86EFAC]",
  medium: "bg-[#FFFBEB] text-[#92400E] border-[#FCD34D]",
  high: "bg-[#FEF2F2] text-[#991B1B] border-[#FCA5A5]",
};

const severityBadge: Record<string, string> = {
  high: "bg-[#FEF2F2] text-[#991B1B] border-[#FCA5A5]",
  medium: "bg-[#FFFBEB] text-[#92400E] border-[#FCD34D]",
  low: "bg-[#F5F5F4] text-[#71717A] border-[#E5E5E5]",
};

export default function InsightsReportPage() {
  const { range } = useDateRange();
  const [report, setReport] = useState<AIReport | null>(null);
  const [platforms, setPlatforms] = useState<{ shopify: boolean; meta: boolean; gads: boolean; gsc: boolean; ga4: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  async function generateReport() {
    setLoading(true);
    setError(null);
    setReport(null);

    const [sR, mR, gR, gaR, adsR] = await Promise.allSettled([
      fetch(`/api/shopify/sales?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/meta?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/gsc?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/ga4?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetchGoogleAds(range.from, range.to),
    ]);

    const shopify = sR.status === "fulfilled" && !sR.value?.error ? sR.value : null;
    const meta    = mR.status === "fulfilled" && !mR.value?.error ? mR.value : null;
    const gsc     = gR.status === "fulfilled" && !gR.value?.error ? gR.value : null;
    const ga4     = gaR.status === "fulfilled" && !gaR.value?.error ? gaR.value : null;
    const gads    = adsR.status === "fulfilled" ? adsR.value.data : null;

    if (!shopify && !meta && !gads && !gsc && !ga4) {
      setError("No platform data available. Connect at least one platform to generate AI insights.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/ai/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopify, meta, gads, gsc, ga4, period: { from: range.from, to: range.to } }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setReport(data.report);
      setPlatforms(data.platforms);
      setGeneratedAt(new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }));
    } catch {
      setError("Failed to generate AI insights. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function buildSections() {
    if (!report) return [];
    return [
      { title: "AI Insights Summary", headers: ["Field", "Value"], rows: [
        ["Overall Score", `${report.overallScore}/100 - ${report.scoreLabel}`],
        ["Executive Summary", report.executiveSummary],
        ["Best Channel", `${report.channelSummary.bestChannel}: ${report.channelSummary.bestChannelReason}`],
        ["Weakest Channel", `${report.channelSummary.weakestChannel}: ${report.channelSummary.weakestChannelReason}`],
      ]},
      { title: "What's Working", headers: ["Metric", "Value", "Insight"], rows:
        report.working.map(w => [w.metric, w.value, w.insight])
      },
      { title: "What's Not Working", headers: ["Metric", "Value", "Severity", "Insight"], rows:
        report.notWorking.map(n => [n.metric, n.value, n.severity, n.insight])
      },
      { title: "Recommendations", headers: ["Action", "Why", "Priority", "Effort"], rows:
        report.recommendations.map(r => [r.action, r.why, r.priority, r.effort])
      },
      { title: "Top Priorities", headers: ["#", "Priority Action"], rows:
        report.priorities.map((p, i) => [i + 1, p])
      },
    ];
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 bg-[#F97316] rounded-lg flex items-center justify-center"><Sparkles size={14} className="text-white" /></div>
            <h1 className="text-xl font-bold text-[#18181B] dark:text-[#F4F4F5]">AI Insights</h1>
            <span className="px-2 py-0.5 bg-[#FFF7ED] text-[#EA580C] border border-[#FED7AA] rounded-full text-[12px] font-bold">Powered by Claude</span>
          </div>
          <p className="text-[14px] text-[#A1A1AA] ml-9"><RangeText />{generatedAt ? ` · Generated ${generatedAt}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {report && (
            <ExportButton
              onExportCSV={() => exportToCSV(`skylitee-ai-insights-${range.from}`, buildSections())}
              onExportPDF={() => exportToPDF(`skylitee-ai-insights-${range.from}`, "AI Insights Report", rangeText(range), buildSections())}
            />
          )}
          <button
            onClick={generateReport}
            disabled={loading}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-[15px] font-semibold transition-all",
              loading
                ? "bg-[#F5F5F4] text-[#A1A1AA] cursor-not-allowed"
                : "bg-[#F97316] text-white hover:bg-[#EA580C]"
            )}
          >
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {loading ? "Analysing…" : report ? "Regenerate" : "Generate Insights"}
          </button>
        </div>
      </div>

      {/* Pre-generate state */}
      {!report && !loading && !error && (
        <Card>
          <div className="py-10 text-center">
            <Sparkles size={36} className="text-[#F97316] mx-auto mb-4" />
            <h2 className="text-[18px] font-bold text-[#18181B] dark:text-[#F4F4F5] mb-2">Get AI-powered business insights</h2>
            <p className="text-[15px] text-[#71717A] max-w-md mx-auto mb-6 leading-relaxed">
              Claude analyses your Shopify, Meta Ads, Google Ads, Google Search Console, and GA4 data together to identify what&apos;s working, what needs fixing, and your highest-impact next steps.
            </p>
            <button
              onClick={generateReport}
              className="px-6 py-2.5 bg-[#F97316] text-white rounded-xl text-[15px] font-semibold hover:bg-[#EA580C]"
            >
              <span className="flex items-center gap-2"><Sparkles size={13} />Generate AI Insights</span>
            </button>
          </div>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <Card>
          <div className="py-10 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-10 h-10 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-[16px] font-semibold text-[#18181B] dark:text-[#F4F4F5] mb-1">Analysing your data…</p>
            <p className="text-[14px] text-[#A1A1AA]">Claude is reviewing all your platform data and generating insights. This takes 10–20 seconds.</p>
          </div>
        </Card>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl p-4 text-[15px] text-[#991B1B]">
          {error}
        </div>
      )}

      {/* Report */}
      {report && !loading && (
        <>
          {/* Score + Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-5 flex flex-col items-center justify-center text-center">
              <div className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide mb-2">Overall Score</div>
              <div className="text-[56px] font-black leading-none" style={{ color: scoreColor(report.overallScore) }}>{report.overallScore}</div>
              <div className="text-[15px] font-bold mt-1" style={{ color: scoreColor(report.overallScore) }}>{report.scoreLabel}</div>
              {platforms && (
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {Object.entries(platforms).map(([k, v]) => v && (
                    <span key={k} className="px-2 py-0.5 bg-[#F5F5F4] dark:bg-[#262626] text-[#71717A] text-[12px] rounded-full font-semibold uppercase">{k}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="md:col-span-2 bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-5">
              <div className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide mb-2">Executive Summary</div>
              <p className="text-[16px] text-[#18181B] dark:text-[#F4F4F5] leading-relaxed">{report.executiveSummary}</p>
              {report.channelSummary && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="bg-[#F0FDF4] dark:bg-[#052E16]/30 rounded-xl p-2.5 border border-[#86EFAC]">
                    <div className="text-[12px] font-bold text-[#16A34A] uppercase mb-0.5">Best Channel</div>
                    <div className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{report.channelSummary.bestChannel}</div>
                    <div className="text-[13px] text-[#52525B] dark:text-[#A1A1AA]">{report.channelSummary.bestChannelReason}</div>
                  </div>
                  <div className="bg-[#FEF2F2] dark:bg-[#2D0A0A]/30 rounded-xl p-2.5 border border-[#FCA5A5]">
                    <div className="text-[12px] font-bold text-[#991B1B] uppercase mb-0.5">Needs Work</div>
                    <div className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{report.channelSummary.weakestChannel}</div>
                    <div className="text-[13px] text-[#52525B] dark:text-[#A1A1AA]">{report.channelSummary.weakestChannelReason}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Working + Not Working */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <CardHeader title="✅ What's Working" right={`${report.working.length} signals`} />
              <div className="space-y-2">
                {report.working.map((w, i) => (
                  <div key={i} className="flex items-start gap-3 bg-[#F0FDF4] dark:bg-[#052E16]/40 border border-[#86EFAC] rounded-xl p-3">
                    <CheckCircle2 size={14} className="text-[#16A34A] shrink-0 mt-0.5" />
                    <div>
                      <div className="text-[14px] font-bold text-[#166534] dark:text-[#4ADE80]">{w.metric}: {w.value}</div>
                      <div className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] mt-0.5 leading-relaxed">{w.insight}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="⚠️ What's Not Working" right={`${report.notWorking.length} issues`} />
              <div className="space-y-2">
                {report.notWorking.map((n, i) => (
                  <div key={i} className={cn("flex items-start gap-3 rounded-xl border p-3", n.severity === "high" ? "bg-[#FEF2F2] dark:bg-[#2D0A0A]/40 border-[#FCA5A5]" : "bg-[#FFFBEB] dark:bg-[#2D1C00]/40 border-[#FCD34D]")}>
                    <AlertTriangle size={14} className={cn("shrink-0 mt-0.5", n.severity === "high" ? "text-[#DC2626]" : "text-[#D97706]")} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={cn("text-[14px] font-bold", n.severity === "high" ? "text-[#991B1B] dark:text-[#FCA5A5]" : "text-[#92400E] dark:text-[#FCD34D]")}>{n.metric}: {n.value}</span>
                        <span className={cn("px-1.5 py-0.5 rounded text-[12px] font-bold border", severityBadge[n.severity])}>{n.severity}</span>
                      </div>
                      <div className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] leading-relaxed">{n.insight}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Recommendations */}
          <Card>
            <CardHeader title="Recommendations" right={`${report.recommendations.length} actions`} />
            <div className="space-y-2">
              {report.recommendations.map((r, i) => (
                <div key={i} className="flex items-start gap-3 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-3">
                  <div className="w-5 h-5 bg-[#F97316] rounded-full flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[12px] font-black text-white">{i + 1}</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{r.action}</span>
                      <span className={cn("px-1.5 py-0.5 rounded text-[12px] font-bold border", r.priority === "high" ? "bg-[#FFF7ED] text-[#EA580C] border-[#FED7AA]" : "bg-[#F5F5F4] text-[#52525B] border-[#E5E5E5]")}>{r.priority} priority</span>
                      <span className={cn("px-1.5 py-0.5 rounded text-[12px] font-bold border", effortBadge[r.effort])}>{r.effort} effort</span>
                    </div>
                    <div className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] leading-relaxed">{r.why}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Top Priorities */}
          <Card>
            <CardHeader title="Top Priorities This Week" />
            <div className="space-y-2">
              {report.priorities.map((p, i) => (
                <div key={i} className="flex items-center gap-3 bg-[#FFF7ED] dark:bg-[#2A1A0E]/50 border border-[#FED7AA] rounded-xl p-3">
                  <Target size={14} className="text-[#F97316] shrink-0" />
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-black text-[#A1A1AA]">#{i + 1}</span>
                    <span className="text-[15px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">{p}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Powered by note */}
          <div className="flex items-center gap-2 text-[13px] text-[#A1A1AA]">
            <Lightbulb size={11} />
            <span>AI analysis generated by Claude (Anthropic). Data reflects the selected date range. Regenerate after updating platform data for fresh insights.</span>
          </div>
        </>
      )}
    </div>
  );
}
