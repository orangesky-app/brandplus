"use client";
import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DiagPanel, EmptyNote, GadsGate, GadsHeader, Judged, Pills, PartialNotice, useGadsSection,
} from "@/components/gads/shared";
import {
  diagnoseAudience, judgeRoas, money, rankDiags,
  type AudienceData, type HeatRow, type SegmentRow,
} from "@/lib/gads-analysis";

const QUERY_LABELS: Record<string, string> = { devices: "Devices", networks: "Networks", heat: "Day and hour", ages: "Age", genders: "Gender", states: "Locations" };

function Breakdown({ title, note, rows, cur, limit }: { title: string; note?: string; rows: SegmentRow[]; cur: string; limit?: number }) {
  const [all, setAll] = useState(false);
  const total = rows.reduce((s, r) => s + r.spend, 0);
  const shown = limit && !all ? rows.slice(0, limit) : rows;
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 && <EmptyNote>No data for this date range.</EmptyNote>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/[0.06] text-[14px] text-[#71717A] dark:text-[#A1A1AA]">
                <th className="text-left py-2 px-2 font-semibold">Segment</th>
                <th className="text-left py-2 px-2 font-semibold min-w-[110px]">Share of spend</th>
                <th className="text-right py-2 px-2 font-semibold">Spend</th>
                <th className="text-right py-2 px-2 font-semibold">ROAS</th>
                <th className="text-right py-2 px-2 font-semibold">Conv.</th>
                <th className="text-right py-2 px-2 font-semibold">Conv. rate</th>
                <th className="text-right py-2 px-2 font-semibold">CTR</th>
                <th className="text-right py-2 px-2 font-semibold">Avg CPC</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const pct = total > 0 ? (r.spend / total) * 100 : 0;
                return (
                  <tr key={r.key} className="border-b border-black/[0.04] dark:border-white/[0.04] text-[#18181B] dark:text-[#F4F4F5]">
                    <td className="py-2 px-2 font-medium whitespace-nowrap">{r.label}</td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-[#F4F4F5] dark:bg-white/[0.06] overflow-hidden">
                          <div className="h-full rounded-full bg-[#3B82F6]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[14px] tabular-nums text-[#52525B] dark:text-[#A1A1AA] w-10 text-right">{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{money(cur, r.spend)}</td>
                    <td className="py-2 px-2 text-right">{r.convValue > 0 ? <Judged verdict={judgeRoas(r.roas)}>{r.roas.toFixed(2)}x</Judged> : "-"}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.conversions.toFixed(1)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.cvr.toFixed(2)}%</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.ctr.toFixed(2)}%</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{money(cur, r.cpc, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {limit && !all && rows.length > limit && (
        <button onClick={() => setAll(true)} className="mt-2 text-[15px] font-semibold text-[#EA580C] dark:text-[#FB923C] hover:underline">Show all {rows.length}</button>
      )}
      {note && <p className="mt-2 text-[14px] text-[#71717A] dark:text-[#A1A1AA]">{note}</p>}
    </Card>
  );
}

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const DAY_SHORT: Record<string, string> = { MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun" };
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;

type HeatMetric = "conversions" | "spend" | "clicks";

function Heatmap({ rows, cur, timeZone }: { rows: HeatRow[]; cur: string; timeZone: string }) {
  const [metric, setMetric] = useState<HeatMetric>("conversions");
  const cells = useMemo(() => new Map(rows.map(r => [`${r.day}|${r.hour}`, r])), [rows]);
  const max = Math.max(0, ...rows.map(r => r[metric]));

  return (
    <Card>
      <CardHeader title="Best days and hours" right={timeZone ? `In your ad account's time (${timeZone})` : undefined} />
      <div className="mb-3">
        <Pills value={metric} onChange={setMetric} options={[{ key: "conversions", label: "Conversions" }, { key: "spend", label: "Spend" }, { key: "clicks", label: "Clicks" }]} />
      </div>
      {rows.length === 0 && <EmptyNote>No data for this date range.</EmptyNote>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <div className="inline-block">
            <div className="flex items-end mb-1">
              <div className="w-10 shrink-0" />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="w-[26px] shrink-0 text-center text-[12px] text-[#71717A] dark:text-[#A1A1AA]">{h % 3 === 0 ? hourLabel(h) : ""}</div>
              ))}
            </div>
            {DAYS.map(day => (
              <div key={day} className="flex items-center">
                <div className="w-10 shrink-0 text-[14px] text-[#52525B] dark:text-[#A1A1AA]">{DAY_SHORT[day]}</div>
                {Array.from({ length: 24 }, (_, h) => {
                  const c = cells.get(`${day}|${h}`);
                  const v = c ? c[metric] : 0;
                  const strength = max > 0 ? v / max : 0;
                  const shownValue = metric === "spend" ? money(cur, v) : metric === "conversions" ? v.toFixed(1) : v.toLocaleString("en-IN");
                  return (
                    <Tooltip key={h} side="top" maxWidth={190} content={`${DAY_SHORT[day]} ${hourLabel(h)}: ${shownValue} ${metric === "spend" ? "spend" : metric}${c ? `, ${money(cur, c.spend)} spent` : ""}`}>
                      <div
                        className="w-6 h-6 m-px rounded-[3px] bg-[#F4F4F5] dark:bg-white/[0.06]"
                        style={v > 0 ? { background: `rgba(59, 130, 246, ${0.12 + strength * 0.88})` } : undefined}
                      />
                    </Tooltip>
                  );
                })}
              </div>
            ))}
            <div className="flex items-center gap-2 mt-2 text-[13px] text-[#71717A] dark:text-[#A1A1AA]">
              <span>Less</span>
              <div className="w-24 h-2 rounded-full" style={{ background: "linear-gradient(to right, rgba(59,130,246,0.12), rgba(59,130,246,1))" }} />
              <span>More</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function AudienceView({ d }: { d: AudienceData }) {
  const cur = d.currency;
  const diags = useMemo(() => rankDiags(diagnoseAudience(d)), [d]);
  return (
    <>
      <PartialNotice errors={d.errors} labels={QUERY_LABELS} />
      <DiagPanel diags={diags} currency={cur} limit={4} right="Compared with your account average" />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <Breakdown title="Devices" rows={d.devices} cur={cur} />
        <Breakdown title="Where ads showed" rows={d.networks} cur={cur} />
        <Breakdown title="Age" rows={d.ages} cur={cur} note="Google doesn't report age for Performance Max, so those campaigns aren't included." />
        <Breakdown title="Gender" rows={d.genders} cur={cur} note="Google doesn't report gender for Performance Max, so those campaigns aren't included." />
      </div>
      <Heatmap rows={d.heat} cur={cur} timeZone={d.timeZone} />
      <Breakdown title="States and regions" rows={d.states} cur={cur} limit={15} note="Based on where people physically were. Clicks without a known location aren't included." />
    </>
  );
}

export default function GadsAudiencePage() {
  const state = useGadsSection<AudienceData>("audience");
  return (
    <div className="space-y-4">
      <GadsHeader
        icon={Users}
        title="Audience & Timing"
        subtitle={state.data ? `${state.data.account} · ${state.data.period.from} to ${state.data.period.to}` : "Devices, networks, age, gender, locations and hours"}
      />
      <GadsGate state={state}>{d => <AudienceView d={d} />}</GadsGate>
    </div>
  );
}
