"use client";
import { useMemo } from "react";
import Link from "next/link";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip as RTooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { ArrowRight, Megaphone } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Donut } from "@/components/ui/charts";
import {
  BenchmarkNote, DataTable, DiagPanel, EmptyNote, GadsGate, GadsHeader, Judged, KpiTile,
  PartialNotice, VerdictBadge, pctChange, useGadsSection, type Column,
} from "@/components/gads/shared";
import {
  buildScorecard, CHANNEL_COLOR, CHANNEL_LABEL, diagnoseOverview, judgeAgainst, judgeLost, judgeRoas,
  judgeShare, BENCHMARKS, money, rankDiags, shareText, sym, titleCase,
  type Campaign, type ConversionAction, type OverviewData,
} from "@/lib/gads-analysis";

const QUERY_LABELS: Record<string, string> = {
  totals: "Account totals", previous: "Previous period comparison", daily: "Daily trend", campaigns: "Campaigns",
  conversionActions: "Conversion actions", suggestions: "Google's own suggestions",
};

const CHART_TOOLTIP = {
  contentStyle: { background: "#18181B", border: "none", borderRadius: 8, fontSize: 13 },
  labelStyle: { color: "#fff" },
  itemStyle: { color: "#fff" },
};

// Google gives each campaign's share separately. To estimate an account figure, each is weighted
// by the searches it was eligible for (impressions / share).
function accountShares(campaigns: Campaign[]) {
  const search = campaigns.filter(c => c.searchIS !== null && c.searchIS > 0);
  if (search.length === 0) return null;
  let eligible = 0, shown = 0, budget = 0, rank = 0;
  for (const c of search) {
    const e = c.impressions / ((c.searchIS as number) / 100);
    eligible += e;
    shown += c.impressions;
    budget += e * (c.searchBudgetLost ?? 0);
    rank += e * (c.searchRankLost ?? 0);
  }
  if (eligible <= 0) return null;
  return { share: (shown / eligible) * 100, budgetLost: budget / eligible, rankLost: rank / eligible };
}

function campaignColumns(cur: string): Column<Campaign>[] {
  return [
    {
      key: "name", label: "Campaign", sort: c => c.name,
      render: c => (
        <div className="min-w-[180px] max-w-[280px]">
          <div className="font-medium truncate" title={c.name}>{c.name}</div>
          <div className="flex items-center gap-1.5 text-[14px] text-[#71717A] dark:text-[#A1A1AA]">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: CHANNEL_COLOR[c.channel] }} />
            {CHANNEL_LABEL[c.channel]}{c.status !== "ENABLED" && ` · ${titleCase(c.status)}`}
          </div>
        </div>
      ),
    },
    { key: "spend", label: "Spend", align: "right", sort: c => c.spend, render: c => money(cur, c.spend) },
    { key: "value", label: "Conv. value", align: "right", sort: c => c.convValue, render: c => money(cur, c.convValue) },
    {
      key: "roas", label: "ROAS", align: "right", hint: "Conversion value divided by spend. 3x or more is good, under 2x is a concern.", sort: c => c.roas,
      render: c => (c.convValue > 0 ? <Judged verdict={judgeRoas(c.roas)}>{c.roas.toFixed(2)}x</Judged> : "-"),
    },
    { key: "conv", label: "Conv.", align: "right", sort: c => c.conversions, render: c => c.conversions.toFixed(1) },
    { key: "cpa", label: "Cost / conv.", align: "right", sort: c => c.cpa, render: c => (c.cpa > 0 ? money(cur, c.cpa) : "-") },
    {
      key: "ctr", label: "CTR", align: "right", hint: "Clicks divided by impressions, compared with the benchmark for this campaign type.", sort: c => c.ctr,
      render: c => <Judged verdict={c.impressions >= 500 ? judgeAgainst(c.ctr, BENCHMARKS[c.channel].ctr) : "na"}>{c.ctr.toFixed(2)}%</Judged>,
    },
    {
      key: "cvr", label: "Conv. rate", align: "right", hint: "Conversions divided by clicks, compared with the benchmark for this campaign type.", sort: c => c.cvr,
      render: c => <Judged verdict={c.clicks >= 30 ? judgeAgainst(c.cvr, BENCHMARKS[c.channel].cvr) : "na"}>{c.cvr.toFixed(2)}%</Judged>,
    },
    { key: "cpc", label: "Avg CPC", align: "right", sort: c => c.cpc, render: c => money(cur, c.cpc, 2) },
    {
      key: "is", label: "Search share", align: "right", hint: "Share of eligible searches where your ad showed. Reported for Search campaigns.", sort: c => c.searchIS ?? -1,
      render: c => <Judged verdict={judgeShare(c.searchIS)}>{shareText(c.searchIS)}</Judged>,
    },
    {
      key: "lostB", label: "Lost: budget", align: "right", hint: "Searches missed because the daily budget ran out.", sort: c => c.searchBudgetLost ?? -1,
      render: c => (c.searchBudgetLost === null ? "-" : <Judged verdict={judgeLost(c.searchBudgetLost)}>{c.searchBudgetLost.toFixed(1)}%</Judged>),
    },
    {
      key: "lostR", label: "Lost: rank", align: "right", hint: "Searches missed because competitors outranked your ad, from bid and quality.", sort: c => c.searchRankLost ?? -1,
      render: c => (c.searchRankLost === null ? "-" : <Judged verdict={judgeLost(c.searchRankLost)}>{c.searchRankLost.toFixed(1)}%</Judged>),
    },
    { key: "budget", label: "Daily budget", align: "right", sort: c => c.dailyBudget, render: c => (c.dailyBudget > 0 ? money(cur, c.dailyBudget) : "-") },
    {
      key: "bid", label: "Bidding", sort: c => c.bidding,
      render: c => (
        <span className="whitespace-nowrap text-[14px] text-[#52525B] dark:text-[#A1A1AA]">
          {c.bidding ? titleCase(c.bidding) : "-"}
          {c.targetRoas ? ` (${c.targetRoas.toFixed(2)}x)` : c.targetCpa ? ` (${money(cur, c.targetCpa)})` : ""}
        </span>
      ),
    },
  ];
}

function conversionColumns(cur: string): Column<ConversionAction>[] {
  return [
    { key: "name", label: "Conversion action", sort: a => a.name, render: a => <span className="font-medium">{a.name}</span> },
    { key: "cat", label: "Type", sort: a => a.category, render: a => titleCase(a.category) },
    { key: "conv", label: "Conversions", align: "right", sort: a => a.conversions, render: a => a.conversions.toFixed(1) },
    { key: "value", label: "Value", align: "right", sort: a => a.value, render: a => money(cur, a.value) },
  ];
}

function Overview({ d }: { d: OverviewData }) {
  const cur = d.currency;
  const t = d.totals;
  const p = d.prev;
  const shares = useMemo(() => accountShares(d.campaigns), [d.campaigns]);
  const scorecard = useMemo(() => buildScorecard(d.campaigns), [d.campaigns]);
  const diags = useMemo(() => rankDiags(diagnoseOverview(d)), [d]);
  const columns = useMemo(() => campaignColumns(cur), [cur]);
  const convColumns = useMemo(() => conversionColumns(cur), [cur]);

  if (t.impressions === 0 && d.campaigns.length === 0) {
    return (
      <>
        <PartialNotice errors={d.errors} labels={QUERY_LABELS} />
        <Card><EmptyNote>No Google Ads activity in this date range. Try a wider range from the date picker at the top.</EmptyNote></Card>
      </>
    );
  }

  const chartData = d.daily.map(r => ({ date: r.date.slice(5), Spend: Math.round(r.spend), "Conv. value": Math.round(r.convValue), Conversions: r.conversions }));
  const mix = scorecard.map(s => ({ label: CHANNEL_LABEL[s.channel], value: s.spend, color: CHANNEL_COLOR[s.channel] }));

  return (
    <>
      <PartialNotice errors={d.errors} labels={QUERY_LABELS} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiTile label="Ad spend" value={money(cur, t.spend)} delta={pctChange(t.spend, p?.spend)} />
        <KpiTile label="Conv. value" value={money(cur, t.convValue)} delta={pctChange(t.convValue, p?.convValue)} hint="Sale value Google attributes to your ads, by its own conversion tracking." />
        <KpiTile label="ROAS" value={t.convValue > 0 ? `${t.roas.toFixed(2)}x` : "-"} delta={pctChange(t.roas, p?.roas)} verdict={t.convValue > 0 ? judgeRoas(t.roas) : "na"} hint="Conversion value divided by spend, across all campaign types. 3x or more is good, under 2x is a concern." />
        <KpiTile label="Conversions" value={t.conversions.toFixed(1)} delta={pctChange(t.conversions, p?.conversions)} />
        <KpiTile label="Cost / conv." value={t.cpa > 0 ? money(cur, t.cpa) : "-"} delta={pctChange(t.cpa, p?.cpa)} lowerIsBetter hint="Spend divided by conversions. Compared with your own previous period, because published benchmarks are in US dollars." />
        <KpiTile label="Conv. rate" value={`${t.cvr.toFixed(2)}%`} delta={pctChange(t.cvr, p?.cvr)} hint="Conversions divided by clicks." />
        <KpiTile label="Clicks" value={t.clicks.toLocaleString("en-IN")} delta={pctChange(t.clicks, p?.clicks)} />
        <KpiTile label="Impressions" value={t.impressions.toLocaleString("en-IN")} delta={pctChange(t.impressions, p?.impressions)} />
        <KpiTile label="CTR" value={`${t.ctr.toFixed(2)}%`} delta={pctChange(t.ctr, p?.ctr)} hint="Clicks divided by impressions. See the scorecard for the verdict per campaign type." />
        <KpiTile label="Avg CPC" value={money(cur, t.cpc, 2)} delta={pctChange(t.cpc, p?.cpc)} lowerIsBetter />
        <KpiTile label="CPM" value={money(cur, t.cpm)} delta={pctChange(t.cpm, p?.cpm)} lowerIsBetter hint="Cost per 1,000 impressions." />
        <KpiTile label="Avg order value" value={t.aov > 0 ? money(cur, t.aov) : "-"} delta={pctChange(t.aov, p?.aov)} hint="Conversion value divided by conversions." />
        {shares && <KpiTile label="Search share" value={shareText(shares.share)} verdict={judgeShare(shares.share)} hint="Share of eligible searches where your Search ads showed. 70% or more is the usual aim for core terms." />}
        {shares && <KpiTile label="Lost to budget" value={`${shares.budgetLost.toFixed(1)}%`} verdict={judgeLost(shares.budgetLost)} hint="Searches missed because the budget ran out." />}
        {shares && <KpiTile label="Lost to rank" value={`${shares.rankLost.toFixed(1)}%`} verdict={judgeLost(shares.rankLost)} hint="Searches missed because competitors outranked you." />}
        {d.optimizationScore !== null && <KpiTile label="Optimization score" value={`${d.optimizationScore.toFixed(0)}%`} hint="Google's own setup score. It isn't a profit measure, and some of its suggestions raise spend." />}
        <KpiTile label="View-through conv." value={t.viewThrough.toFixed(0)} hint="People who saw an ad without clicking, then converted later. Not included in Conversions." />
        <KpiTile label="All conversions" value={t.allConversions.toFixed(1)} hint="Includes actions Google doesn't count in the main Conversions column." />
      </div>

      {scorecard.length > 0 && (
        <Card>
          <CardHeader title="Industry Benchmark Scorecard" right="Judged per campaign type" />
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.06] text-[14px] text-[#71717A] dark:text-[#A1A1AA]">
                  <th className="text-left py-2 px-2 font-semibold">Campaign type</th>
                  <th className="text-left py-2 px-2 font-semibold">KPI</th>
                  <th className="text-right py-2 px-2 font-semibold">You</th>
                  <th className="text-right py-2 px-2 font-semibold">Standard</th>
                  <th className="text-left py-2 px-2 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {scorecard.flatMap(s => {
                  if (s.rows.length === 0) {
                    return [(
                      <tr key={s.channel} className="border-b border-black/[0.04] dark:border-white/[0.04]">
                        <td className="py-2 px-2 font-medium whitespace-nowrap text-[#18181B] dark:text-[#F4F4F5]">{CHANNEL_LABEL[s.channel]}</td>
                        <td colSpan={4} className="py-2 px-2 text-[#71717A] dark:text-[#A1A1AA]">No reliable published benchmark for this campaign type, so no verdict is shown.</td>
                      </tr>
                    )];
                  }
                  return s.rows.map((r, i) => (
                    <tr key={`${s.channel}-${r.kpi}`} className="border-b border-black/[0.04] dark:border-white/[0.04]">
                      <td className="py-2 px-2 font-medium whitespace-nowrap text-[#18181B] dark:text-[#F4F4F5]">{i === 0 ? CHANNEL_LABEL[s.channel] : ""}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-[#52525B] dark:text-[#A1A1AA]">{r.kpi}</td>
                      <td className="py-2 px-2 text-right font-semibold tabular-nums whitespace-nowrap text-[#18181B] dark:text-[#F4F4F5]">{r.you}</td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap text-[#52525B] dark:text-[#A1A1AA]">{r.standard}</td>
                      <td className="py-2 px-2"><VerdictBadge verdict={r.verdict} /></td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3"><BenchmarkNote /></div>
        </Card>
      )}

      <DiagPanel
        diags={diags}
        currency={cur}
        limit={5}
        right={<Link href="/dashboard/gads/actions" className="inline-flex items-center gap-1 font-semibold text-[#EA580C] dark:text-[#FB923C] hover:underline">All recommendations <ArrowRight size={14} /></Link>}
      />

      {chartData.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Spend and conversion value per day" />
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#E5E7EB" strokeOpacity={0.5} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={64} tickFormatter={v => `${sym(cur)}${Number(v).toLocaleString("en-IN")}`} />
                <RTooltip {...CHART_TOOLTIP} formatter={(v, name) => [money(cur, Number(v ?? 0)), String(name)]} />
                <Legend wrapperStyle={{ fontSize: 13 }} iconType="plainline" />
                <Area type="monotone" dataKey="Conv. value" stroke="#22C55E" strokeWidth={2} fill="#22C55E" fillOpacity={0.1} dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="Spend" stroke="#3B82F6" strokeWidth={2} fill="#3B82F6" fillOpacity={0.1} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <CardHeader title="Where spend goes" />
            <Donut segments={mix} centerValue={money(cur, t.spend)} centerLabel="spend" size={130} />
          </Card>
          <Card className="lg:col-span-3">
            <CardHeader title="Conversions per day" />
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#E5E7EB" strokeOpacity={0.5} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={64} />
                <RTooltip {...CHART_TOOLTIP} cursor={{ fill: "#A1A1AA", fillOpacity: 0.12 }} formatter={v => [Number(v ?? 0).toFixed(1), "Conversions"]} />
                <Bar dataKey="Conversions" fill="#F97316" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader title="Campaigns" right={`${d.campaigns.length} with activity`} />
        <DataTable rows={d.campaigns} columns={columns} rowKey={c => c.id} initialSort="spend" searchOf={c => c.name} searchPlaceholder="Search campaigns" />
      </Card>

      {d.conversionActions.length > 0 && (
        <Card>
          <CardHeader title="What's being counted as a conversion" right="Check these are real sales" />
          <DataTable rows={d.conversionActions} columns={convColumns} rowKey={(a, i) => `${a.name}-${i}`} initialSort="conv" />
        </Card>
      )}
    </>
  );
}

export default function GadsPage() {
  const state = useGadsSection<OverviewData>("overview");
  return (
    <div className="space-y-4">
      <GadsHeader
        icon={Megaphone}
        title="Google Ads Overview"
        subtitle={state.data ? `${state.data.account} · ${state.data.period.from} to ${state.data.period.to}, compared with the previous period of the same length` : "All KPIs, compared with industry benchmarks"}
      />
      <GadsGate state={state}>{d => <Overview d={d} />}</GadsGate>
    </div>
  );
}
