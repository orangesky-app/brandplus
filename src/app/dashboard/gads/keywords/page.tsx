"use client";
import { useMemo, useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { KeyRound } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDateSpan } from "@/lib/date-range-context";
import {
  BenchmarkNote, DataTable, DiagPanel, GadsGate, GadsHeader, GoogleCountNote, Judged, KpiTile, Pills,
  PartialNotice, VerdictBadge, useGadsSection, type Column,
} from "@/components/gads/shared";
import {
  BENCHMARKS, diagnoseKeywords, judgeAgainst, judgeLost, judgeQs, judgeRoas, judgeShare, money, rankDiags,
  shareText, sumMetrics, titleCase,
  type KeywordRow, type KeywordsData, type SearchTermRow, type Verdict,
} from "@/lib/gads-analysis";

const QUERY_LABELS: Record<string, string> = { keywords: "Keywords", searchTerms: "Search terms", pmaxTerms: "Performance Max search terms" };

const COMPONENT_VERDICT: Record<string, { verdict: Verdict; label: string }> = {
  ABOVE_AVERAGE: { verdict: "good", label: "Above avg" },
  AVERAGE: { verdict: "watch", label: "Average" },
  BELOW_AVERAGE: { verdict: "bad", label: "Below avg" },
};

function component(v: string) {
  const c = COMPONENT_VERDICT[v];
  return c ? <VerdictBadge verdict={c.verdict} label={c.label} /> : "-";
}

function roasCell(r: { convValue: number; roas: number }) {
  return r.convValue > 0 ? <Judged verdict={judgeRoas(r.roas)}>{r.roas.toFixed(2)}x</Judged> : "-";
}

function keywordColumns(cur: string): Column<KeywordRow>[] {
  return [
    {
      key: "kw", label: "Keyword", sort: k => k.keyword,
      render: k => (
        <div className="min-w-[200px] max-w-[300px]">
          <div className="font-medium truncate" title={k.keyword}>{k.keyword}</div>
          <div className="text-[14px] text-[#71717A] dark:text-[#A1A1AA] truncate" title={`${k.campaign} > ${k.adGroup}`}>{titleCase(k.matchType)} · {k.adGroup}</div>
        </div>
      ),
    },
    { key: "qs", label: "Quality Score", align: "right", hint: "Google's 1-10 rating of keyword, ad and page relevance. 7 or more is good, 4 or less costs you more per click.", sort: k => k.qs ?? -1, render: k => (k.qs === null ? "-" : <Judged verdict={judgeQs(k.qs)}>{k.qs}/10</Judged>) },
    { key: "ectr", label: "Expected CTR", hint: "Google's estimate of how likely people are to click for this keyword.", sort: k => k.expectedCtr, render: k => component(k.expectedCtr) },
    { key: "rel", label: "Ad relevance", hint: "How closely the ad matches the keyword.", sort: k => k.adRelevance, render: k => component(k.adRelevance) },
    { key: "page", label: "Landing page", hint: "How useful and relevant Google finds the page.", sort: k => k.landingExp, render: k => component(k.landingExp) },
    { key: "spend", label: "Spend", align: "right", sort: k => k.spend, render: k => money(cur, k.spend) },
    { key: "roas", label: "ROAS", align: "right", sort: k => k.roas, render: roasCell },
    { key: "conv", label: "Conv.", align: "right", sort: k => k.conversions, render: k => k.conversions.toFixed(1) },
    { key: "cpa", label: "Cost / conv.", align: "right", sort: k => k.cpa, render: k => (k.cpa > 0 ? money(cur, k.cpa) : "-") },
    { key: "clicks", label: "Clicks", align: "right", sort: k => k.clicks, render: k => k.clicks.toLocaleString("en-IN") },
    { key: "ctr", label: "CTR", align: "right", sort: k => k.ctr, render: k => <Judged verdict={k.impressions >= 500 ? judgeAgainst(k.ctr, BENCHMARKS.SEARCH.ctr) : "na"}>{k.ctr.toFixed(2)}%</Judged> },
    { key: "cvr", label: "Conv. rate", align: "right", sort: k => k.cvr, render: k => <Judged verdict={k.clicks >= 30 ? judgeAgainst(k.cvr, BENCHMARKS.SEARCH.cvr) : "na"}>{k.cvr.toFixed(2)}%</Judged> },
    { key: "cpc", label: "Avg CPC", align: "right", sort: k => k.cpc, render: k => money(cur, k.cpc, 2) },
    { key: "is", label: "Search share", align: "right", sort: k => k.searchIS ?? -1, render: k => <Judged verdict={judgeShare(k.searchIS)}>{shareText(k.searchIS)}</Judged> },
    { key: "lost", label: "Lost: rank", align: "right", sort: k => k.rankLost ?? -1, render: k => (k.rankLost === null ? "-" : <Judged verdict={judgeLost(k.rankLost)}>{k.rankLost.toFixed(1)}%</Judged>) },
  ];
}

const TERM_STATUS: Record<string, string> = { ADDED: "Keyword", EXCLUDED: "Blocked", ADDED_EXCLUDED: "Keyword + blocked", NONE: "Not added" };

function termColumns(cur: string): Column<SearchTermRow>[] {
  return [
    {
      key: "term", label: "What people typed", sort: t => t.term,
      render: t => (
        <div className="min-w-[200px] max-w-[320px]">
          <div className="font-medium truncate" title={t.term}>{t.term}</div>
          <div className="text-[14px] text-[#71717A] dark:text-[#A1A1AA] truncate" title={t.campaign}>{t.source === "pmax" ? "Performance Max" : "Search"} · {t.campaign}</div>
        </div>
      ),
    },
    { key: "status", label: "Status", hint: "Whether you've added this term as a keyword or blocked it as a negative.", sort: t => t.status, render: t => <span className="whitespace-nowrap text-[14px]">{TERM_STATUS[t.status] ?? "-"}</span> },
    { key: "spend", label: "Spend", align: "right", sort: t => t.spend, render: t => money(cur, t.spend) },
    { key: "conv", label: "Conv.", align: "right", sort: t => t.conversions, render: t => t.conversions.toFixed(1) },
    { key: "value", label: "Conv. value", align: "right", sort: t => t.convValue, render: t => money(cur, t.convValue) },
    { key: "roas", label: "ROAS", align: "right", sort: t => t.roas, render: roasCell },
    { key: "clicks", label: "Clicks", align: "right", sort: t => t.clicks, render: t => t.clicks.toLocaleString("en-IN") },
    { key: "ctr", label: "CTR", align: "right", sort: t => t.ctr, render: t => `${t.ctr.toFixed(2)}%` },
    { key: "cvr", label: "Conv. rate", align: "right", sort: t => t.cvr, render: t => `${t.cvr.toFixed(2)}%` },
  ];
}

const MATCH_ORDER = ["EXACT", "PHRASE", "BROAD"];

function KeywordsView({ d }: { d: KeywordsData }) {
  const cur = d.currency;
  const diags = useMemo(() => rankDiags(diagnoseKeywords(d)), [d]);
  const kwCols = useMemo(() => keywordColumns(cur), [cur]);
  const trmCols = useMemo(() => termColumns(cur), [cur]);
  const [termFilter, setTermFilter] = useState<"all" | "winners" | "waste" | "pmax">("all");

  const totals = useMemo(() => sumMetrics(d.keywords), [d.keywords]);
  const termTotals = useMemo(() => sumMetrics(d.searchTerms), [d.searchTerms]);
  const wasteBar = termTotals.cpa > 0 ? termTotals.cpa : termTotals.spend * 0.025;
  const isWaste = (t: SearchTermRow) => t.conversions === 0 && t.spend > 0 && t.spend >= wasteBar;

  const scored = d.keywords.filter(k => k.qs !== null && k.impressions > 0);
  const scoredImpr = scored.reduce((s, k) => s + k.impressions, 0);
  const avgQs = scoredImpr > 0 ? scored.reduce((s, k) => s + (k.qs ?? 0) * k.impressions, 0) / scoredImpr : null;
  const lowQsSpend = scored.filter(k => (k.qs ?? 0) <= 4).reduce((s, k) => s + k.spend, 0);
  const wastedTerms = d.searchTerms.filter(isWaste);

  const qsBars = Array.from({ length: 10 }, (_, i) => {
    const q = i + 1;
    const list = scored.filter(k => k.qs === q);
    return { qs: String(q), Keywords: list.length, spend: list.reduce((s, k) => s + k.spend, 0), verdict: judgeQs(q) };
  });

  const matchRows = MATCH_ORDER.map(m => {
    const list = d.keywords.filter(k => k.matchType === m);
    return list.length > 0 ? { match: m, count: list.length, ...sumMetrics(list) } : null;
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  const terms = useMemo(() => {
    if (termFilter === "winners") return d.searchTerms.filter(t => t.conversions >= 2);
    if (termFilter === "waste") return d.searchTerms.filter(isWaste);
    if (termFilter === "pmax") return d.searchTerms.filter(t => t.source === "pmax");
    return d.searchTerms;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.searchTerms, termFilter, wasteBar]);

  return (
    <>
      <PartialNotice errors={d.errors} labels={QUERY_LABELS} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <KpiTile label="Active keywords" value={d.keywords.length.toLocaleString("en-IN")} sub={d.keywords.length >= 500 ? "Top 500 by spend" : "With impressions"} />
        <KpiTile label="Keyword spend" value={money(cur, totals.spend)} sub={totals.convValue > 0 ? `ROAS ${totals.roas.toFixed(2)}x` : undefined} />
        <KpiTile label="Avg Quality Score" value={avgQs === null ? "-" : avgQs.toFixed(1)} verdict={avgQs === null ? "na" : judgeQs(avgQs)} hint="Weighted by impressions, so keywords that show more count more." />
        <KpiTile label="Spend on QS 4 or less" value={money(cur, lowQsSpend)} verdict={lowQsSpend > 0 ? "bad" : scored.length > 0 ? "good" : "na"} hint="Money going to keywords where Google charges you more for weaker positions." />
        <KpiTile label="Spend on 0-sale terms" value={money(cur, wastedTerms.reduce((s, t) => s + t.spend, 0))} sub={`${wastedTerms.length} search terms`} hint="Search terms costing at least one average conversion without converting." />
      </div>

      <DiagPanel diags={diags} currency={cur} limit={4} right="Keywords and search terms" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {scored.length > 0 && (
          <Card>
            <CardHeader title="Quality Score spread" right="Keywords at each score" />
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={qsBars} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#E5E7EB" strokeOpacity={0.5} />
                <XAxis dataKey="qs" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                <RTooltip
                  cursor={{ fill: "#A1A1AA", fillOpacity: 0.12 }}
                  contentStyle={{ background: "#18181B", border: "none", borderRadius: 8, fontSize: 13 }}
                  labelStyle={{ color: "#fff" }}
                  itemStyle={{ color: "#fff" }}
                  labelFormatter={l => `Quality Score ${l}`}
                  formatter={(v, _n, item) => [`${v} keywords, ${money(cur, (item.payload as { spend: number }).spend)} spend`, ""]}
                  separator=""
                />
                <Bar dataKey="Keywords" radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false}>
                  {qsBars.map(b => <Cell key={b.qs} fill={b.verdict === "good" ? "#22C55E" : b.verdict === "watch" ? "#EAB308" : "#EF4444"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-3 mt-2 text-[14px] text-[#52525B] dark:text-[#A1A1AA]">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#EF4444]" />1-4 Poor</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#EAB308]" />5-6 Fair</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#22C55E]" />7-10 Good</span>
            </div>
          </Card>
        )}
        {matchRows.length > 0 && (
          <Card>
            <CardHeader title="Match type comparison" />
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="border-b border-black/[0.06] dark:border-white/[0.06] text-[14px] text-[#71717A] dark:text-[#A1A1AA]">
                    <th className="text-left py-2 px-2 font-semibold">Match</th>
                    <th className="text-right py-2 px-2 font-semibold">Keywords</th>
                    <th className="text-right py-2 px-2 font-semibold">Spend</th>
                    <th className="text-right py-2 px-2 font-semibold">ROAS</th>
                    <th className="text-right py-2 px-2 font-semibold">Conv. rate</th>
                    <th className="text-right py-2 px-2 font-semibold">Avg CPC</th>
                  </tr>
                </thead>
                <tbody>
                  {matchRows.map(m => (
                    <tr key={m.match} className="border-b border-black/[0.04] dark:border-white/[0.04] text-[#18181B] dark:text-[#F4F4F5]">
                      <td className="py-2 px-2 font-medium">{titleCase(m.match)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{m.count}</td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{money(cur, m.spend)}</td>
                      <td className="py-2 px-2 text-right">{roasCell(m)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{m.cvr.toFixed(2)}%</td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{money(cur, m.cpc, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader title="Every keyword" right={`${d.keywords.length} keywords`} />
        <DataTable rows={d.keywords} columns={kwCols} rowKey={k => `${k.id}-${k.adGroup}`} initialSort="spend" searchOf={k => `${k.keyword} ${k.adGroup} ${k.campaign}`} searchPlaceholder="Search keywords" empty="No keyword activity in this date range. Keywords only exist in Search campaigns." />
      </Card>

      <Card>
        <CardHeader title="Search terms: what people actually typed" right={`${d.searchTerms.length} terms`} />
        <div className="mb-3">
          <Pills
            value={termFilter}
            onChange={setTermFilter}
            options={[
              { key: "all", label: "All", count: d.searchTerms.length },
              { key: "winners", label: "Winners (2+ conv.)", count: d.searchTerms.filter(t => t.conversions >= 2).length },
              { key: "waste", label: "Waste", count: wastedTerms.length },
              { key: "pmax", label: "Performance Max", count: d.searchTerms.filter(t => t.source === "pmax").length },
            ]}
          />
        </div>
        <DataTable rows={terms} columns={trmCols} rowKey={t => `${t.source}-${t.term}`} initialSort="spend" searchOf={t => `${t.term} ${t.campaign}`} searchPlaceholder="Search terms" empty="No search terms match this filter. Google hides terms too rare to report." />
      </Card>

      <BenchmarkNote />
    </>
  );
}

export default function GadsKeywordsPage() {
  const state = useGadsSection<KeywordsData>("keywords");
  return (
    <div className="space-y-4">
      <GadsHeader
        icon={KeyRound}
        title="Keywords & Searches"
        subtitle={state.data ? `${state.data.account} · ${formatDateSpan(state.data.period.from, state.data.period.to)}` : "Quality Score, match types and the searches you pay for"}
      />
      <GoogleCountNote />
      <GadsGate state={state}>{d => <KeywordsView d={d} />}</GadsGate>
    </div>
  );
}
