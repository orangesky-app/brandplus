"use client";
import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { PeriodNote } from "@/components/ui/period";
import { formatDateSpan } from "@/lib/date-range-context";
import { AlertCircle, AlertTriangle, CheckCircle2, RefreshCw, TrendingUp } from "lucide-react";
import Link from "next/link";

interface Alert { title: string; desc: string; }
interface AnomalyData {
  critical: Alert[];
  warnings: Alert[];
  positive: Alert[];
  summary: { totalOrders: number; codPct: number; repeatRate: number; projectedMonthly: number; days: number; grossSales: number };
  period: { from: string; to: string };
}

export default function AnomalyPage() {
  const [data, setData] = useState<AnomalyData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    setLoading(true);
    fetch("/api/shopify/anomalies")
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const totalAlerts = (data?.critical.length ?? 0) + (data?.warnings.length ?? 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-[#18181B] dark:text-[#F4F4F5] flex items-center gap-2"><AlertCircle size={18} className="text-[#F97316]" /> Anomaly Feed</h2>
          <p className="text-[15px] text-[#A1A1AA] mt-0.5">Real-time signals from your Shopify store</p>
          {data?.period && <PeriodNote from={data.period.from} to={data.period.to} label="This month so far" />}
        </div>
        <div className="flex items-center gap-2.5">
          {/* Stat pills */}
          <div className="flex gap-2">
            {[
              { label: "Critical", value: data?.critical.length ?? 0, bg: "bg-[#FEF2F2] dark:bg-[#2D0A0A]", text: "text-[#DC2626] dark:text-[#FCA5A5]", border: "border-[#FCA5A5] dark:border-[#991B1B]" },
              { label: "Warnings", value: data?.warnings.length ?? 0, bg: "bg-[#FFFBEB] dark:bg-[#2D1C00]", text: "text-[#92400E] dark:text-[#FCD34D]", border: "border-[#FCD34D] dark:border-[#92400E]" },
              { label: "Positive", value: data?.positive.length ?? 0, bg: "bg-[#FFF7ED] dark:bg-[#2A1A0E]", text: "text-[#EA580C] dark:text-[#FB923C]", border: "border-[#FED7AA] dark:border-[#7C2D12]" },
            ].map(s => (
              <div key={s.label} className={`text-center px-4 py-2 rounded-xl border ${s.bg} ${s.border}`}>
                <div className={`text-xl font-black ${s.text}`}>{loading ? "-" : s.value}</div>
                <div className="text-[13px] text-[#A1A1AA] mt-0.5 font-medium">{s.label}</div>
              </div>
            ))}
          </div>
          <button onClick={fetchData} disabled={loading}
            className="w-9 h-9 rounded-xl border border-black/[0.06] dark:border-white/[0.06] flex items-center justify-center text-[#71717A] dark:text-[#A1A1AA] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors disabled:opacity-40">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-[16px] text-[#A1A1AA] py-16 text-center">Analysing your store data...</div>
      ) : !data ? (
        <div className="text-center py-16">
          <p className="text-[16px] text-[#71717A] mb-3">Could not load - check Shopify connection</p>
          <Link href="/dashboard/connections" className="text-[15px] text-[#F97316] font-semibold underline">Go to Connections →</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Critical + Warnings */}
          <div>
            {data.critical.length > 0 && (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="text-[13px] font-bold text-[#DC2626] dark:text-[#FCA5A5] uppercase tracking-[0.1em]">Critical - action needed now</div>
                  <div className="flex-1 h-px bg-[#FCA5A5] dark:bg-[#991B1B] opacity-40" />
                </div>
                {data.critical.map((a, i) => (
                  <div key={i} className="border border-[#FCA5A5] dark:border-[#991B1B] rounded-2xl p-4 mb-3 flex items-start gap-3 bg-[#FEF2F2] dark:bg-[#2D0A0A]">
                    <div className="w-9 h-9 rounded-xl bg-white dark:bg-[#3D0F0F] border border-[#FCA5A5] dark:border-[#991B1B] flex items-center justify-center shrink-0">
                      <AlertCircle size={14} className="text-[#DC2626] dark:text-[#FCA5A5]" />
                    </div>
                    <div>
                      <div className="text-[16px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{a.title}</div>
                      <div className="text-[15px] text-[#71717A] dark:text-[#A1A1AA] mt-1 leading-relaxed">{a.desc}</div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {data.warnings.length > 0 && (
              <>
                <div className="flex items-center gap-2 mb-3 mt-4">
                  <div className="text-[13px] font-bold text-[#92400E] dark:text-[#FCD34D] uppercase tracking-[0.1em]">Warnings - monitor closely</div>
                  <div className="flex-1 h-px bg-[#FCD34D] dark:bg-[#92400E] opacity-40" />
                </div>
                {data.warnings.map((a, i) => (
                  <div key={i} className="border border-[#FCD34D] dark:border-[#92400E] rounded-2xl p-4 mb-3 flex items-start gap-3 bg-[#FFFBEB] dark:bg-[#2D1C00]">
                    <div className="w-9 h-9 rounded-xl bg-white dark:bg-[#3D2400] border border-[#FCD34D] dark:border-[#92400E] flex items-center justify-center shrink-0">
                      <AlertTriangle size={14} className="text-[#EAB308] dark:text-[#FCD34D]" />
                    </div>
                    <div>
                      <div className="text-[16px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{a.title}</div>
                      <div className="text-[15px] text-[#71717A] dark:text-[#A1A1AA] mt-1 leading-relaxed">{a.desc}</div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {totalAlerts === 0 && (
              <div className="border border-[#FED7AA] dark:border-[#7C2D12] rounded-2xl p-6 text-center bg-[#FFF7ED] dark:bg-[#2A1A0E]">
                <div className="w-12 h-12 bg-white dark:bg-[#3D2810] rounded-2xl flex items-center justify-center mx-auto mb-3 border border-[#FED7AA] dark:border-[#7C2D12]">
                  <CheckCircle2 size={22} className="text-[#F97316]" />
                </div>
                <div className="text-[17px] font-bold text-[#EA580C] dark:text-[#FB923C]">All clear!</div>
                <div className="text-[15px] text-[#71717A] dark:text-[#A1A1AA] mt-1">No critical issues or warnings detected.</div>
              </div>
            )}
          </div>

          {/* Right: Positive + Summary */}
          <div>
            {data.positive.length > 0 && (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="text-[13px] font-bold text-[#A1A1AA] uppercase tracking-[0.1em]">Positive signals</div>
                  <div className="flex-1 h-px bg-black/[0.06] dark:bg-white/[0.06]" />
                </div>
                {data.positive.map((a, i) => (
                  <div key={i} className="border border-black/[0.06] dark:border-white/[0.06] rounded-2xl p-4 mb-3 flex items-start gap-3 bg-white dark:bg-[#171717] shadow-sm">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${i === 0 ? "bg-[#FFF7ED] dark:bg-[#2A1A0E] border-[#FED7AA] dark:border-[#7C2D12]" : "bg-[#F5F5F4] dark:bg-[#1C1C1C] border-black/[0.06] dark:border-white/[0.06]"}`}>
                      {i === 0
                        ? <TrendingUp size={14} className="text-[#F97316]" />
                        : <CheckCircle2 size={14} className="text-[#22C55E]" />
                      }
                    </div>
                    <div>
                      <div className={`text-[16px] font-bold ${i === 0 ? "text-[#EA580C] dark:text-[#FB923C]" : "text-[#18181B] dark:text-[#F4F4F5]"}`}>{a.title}</div>
                      <div className="text-[15px] text-[#71717A] dark:text-[#A1A1AA] mt-1 leading-relaxed">{a.desc}</div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Store summary card */}
            <Card className="mt-2">
              <CardHeader title="Store summary" right={data.period ? formatDateSpan(data.period.from, data.period.to) : "This month"} />
              <div className="space-y-3">
                {[
                  { label: "Total orders", value: data.summary.totalOrders.toString(), warn: false },
                  { label: "COD ratio", value: `${data.summary.codPct}%`, warn: data.summary.codPct > 50 },
                  { label: "Repeat rate (all customers)", value: `${data.summary.repeatRate}%`, warn: data.summary.repeatRate < 20 },
                  { label: "Projected monthly", value: `₹${data.summary.projectedMonthly.toLocaleString("en-IN")}`, warn: false },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between">
                    <span className="text-[15px] text-[#71717A] dark:text-[#A1A1AA]">{row.label}</span>
                    <span className={`text-[15px] font-bold ${row.warn ? "text-[#EF4444]" : "text-[#18181B] dark:text-[#F4F4F5]"}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            </Card>

            <div className="mt-3 text-[14px] text-[#A1A1AA] leading-relaxed bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-3 border border-black/[0.04] dark:border-white/[0.04]">
              <strong className="text-[#71717A] dark:text-[#A1A1AA]">About anomaly detection:</strong> Signals are computed from live Shopify data - stock levels, order patterns, COD ratio, and repeat behaviour. Connect Meta Ads and GA4 to unlock ROAS and traffic anomaly alerts.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
