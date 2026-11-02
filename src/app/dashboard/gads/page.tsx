"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip as RTooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { AlertTriangle, ArrowRight, Megaphone } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Donut } from "@/components/ui/charts";
import {
  BenchmarkNote, DataTable, DiagPanel, EmptyNote, GadsGate, GadsHeader, Judged, KpiTile, Note,
  PartialNotice, Pills, VerdictBadge, pctChange, useGadsSection, type Column,
} from "@/components/gads/shared";
import {
  buildAdTypeTable, buildObjectiveRows, buildScorecard, CHANNEL_COLOR, CHANNEL_LABEL, CHANNEL_PURPOSE, diagnoseOverview,
  goalLabel, goalLinesText, judgeAgainst, judgeLost, judgeRoas, judgeShare, BENCHMARKS, mergeGoalLines, money,
  objectiveOfCategory, objectiveView, OBJECTIVE_GOAL, OBJECTIVE_LABEL, rankDiags, rollDaily, ROAS_MIN, ROAS_TARGET,
  shareText, sumMetrics, sym, titleCase,
  type Campaign, type Channel, type ConversionAction, type Objective, type ObjectiveFilter, type OverviewData,
} from "@/lib/gads-analysis";

const QUERY_LABELS: Record<string, string> = {
  totals: "Account totals", previous: "Previous period comparison", daily: "Daily trend", campaigns: "Campaigns",
  goals: "Campaign conversion goals", goalResults: "Results per conversion goal", goalResultsPrev: "Previous period results per goal",
  conversionActions: "Conversion actions", suggestions: "Google's own suggestions",
};

const CHART_TOOLTIP = {
  contentStyle: { background: "#18181B", border: "none", borderRadius: 8, fontSize: 13 },
  labelStyle: { color: "#fff" },
  itemStyle: { color: "#fff" },
};

const HEAD_ROW = "border-b border-black/[0.06] dark:border-white/[0.06] text-[14px] whitespace-nowrap text-[#71717A] dark:text-[#A1A1AA]";
const BODY_ROW = "border-b border-black/[0.04] dark:border-white/[0.04]";
const STRONG = "font-medium text-[#18181B] dark:text-[#F4F4F5]";
const MUTED = "text-[14px] text-[#71717A] dark:text-[#A1A1AA]";
const NUMBER_CELL = "py-2 px-2 text-right tabular-nums whitespace-nowrap text-[#18181B] dark:text-[#F4F4F5]";

const count = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });

// Sale value only means something where purchases are the goal, or where Google's own count is used.
const showsValue = (o: Objective) => o === "SALES" || o === "OTHER";

// Follow-on views and engagements can happen without a click, so a rate against clicks can pass 100%.
const hasConversionRate = (o: Objective | null, cvr: number) => o !== "VIDEO_VIEWS" && cvr <= 100;

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

function campaignColumns(cur: string, counting: boolean): Column<Campaign>[] {
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
    {
      key: "objective", label: "Objective", hint: "Worked out from the campaign's conversion goals, name, type and bidding. The reason is shown under each one.", sort: c => c.objective,
      render: c => (
        <div className="min-w-[150px] max-w-[220px]">
          <div className="font-medium">{OBJECTIVE_LABEL[c.objective]}</div>
          <div className={MUTED}>{c.objectiveWhy}</div>
        </div>
      ),
    },
    { key: "spend", label: "Money spent", align: "right", sort: c => c.spend, render: c => money(cur, c.spend) },
    { key: "value", label: "Sales value", align: "right", sort: c => (showsValue(c.objective) ? c.convValue : -1), render: c => (showsValue(c.objective) ? money(cur, c.convValue) : "-") },
    {
      key: "roas", label: "ROAS", align: "right", hint: "Sales value divided by money spent. 3x or more is good, under 2x is a concern. Only for campaigns with sales value.", sort: c => (showsValue(c.objective) ? c.roas : -1),
      render: c => (showsValue(c.objective) && c.convValue > 0 ? <Judged verdict={judgeRoas(c.roas)}>{c.roas.toFixed(2)}x</Judged> : "-"),
    },
    {
      key: "conv", label: "Conversions", align: "right", hint: counting ? "Only the goal matching the campaign's objective." : "Google's own count, because the split by goal couldn't load.", sort: c => c.conversions,
      render: c => (
        <div>
          <div className="tabular-nums">{count(c.conversions)}</div>
          {counting && c.objective !== "OTHER" && <div className={`${MUTED} whitespace-nowrap`}>{OBJECTIVE_GOAL[c.objective]}</div>}
        </div>
      ),
    },
    { key: "google", label: "Google's count", align: "right", hint: "What Google Ads shows in its Conversions column, including every goal the campaign uses.", sort: c => c.googleConversions, render: c => count(c.googleConversions) },
    { key: "cpa", label: "CPA", align: "right", sort: c => c.cpa, render: c => (c.cpa > 0 ? money(cur, c.cpa) : "-") },
    {
      key: "ctr", label: "CTR", align: "right", hint: "Clicks divided by impressions, compared with the benchmark for this campaign type.", sort: c => c.ctr,
      render: c => <Judged verdict={c.impressions >= 500 ? judgeAgainst(c.ctr, BENCHMARKS[c.channel].ctr) : "na"}>{c.ctr.toFixed(2)}%</Judged>,
    },
    {
      key: "cvr", label: "Conversion rate", align: "right", hint: "Conversions divided by clicks. Compared with the benchmark for Sales campaigns only, because that benchmark measures purchases.", sort: c => (hasConversionRate(c.objective, c.cvr) ? c.cvr : -1),
      render: c => (hasConversionRate(c.objective, c.cvr)
        ? <Judged verdict={c.objective === "SALES" && c.clicks >= 30 ? judgeAgainst(c.cvr, BENCHMARKS[c.channel].cvr) : "na"}>{c.cvr.toFixed(2)}%</Judged>
        : "-"),
    },
    { key: "cpc", label: "CPC", align: "right", sort: c => c.cpc, render: c => money(cur, c.cpc, 2) },
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
    { key: "cat", label: "Type", sort: a => a.category, render: a => goalLabel(a.category) },
    {
      key: "for", label: "Counted for", hint: "The objective this conversion type counts toward. Anything else is left out of the Overview's Conversions.", sort: a => objectiveOfCategory(a.category) ?? "",
      render: a => {
        const objective = objectiveOfCategory(a.category);
        return objective ? OBJECTIVE_LABEL[objective] : "Not counted";
      },
    },
    { key: "conv", label: "Conversions", align: "right", sort: a => a.conversions, render: a => a.conversions.toFixed(1) },
    { key: "value", label: "Value", align: "right", sort: a => a.value, render: a => money(cur, a.value) },
  ];
}

function Overview({ d }: { d: OverviewData }) {
  const cur = d.currency;
  const [picked, setPicked] = useState<ObjectiveFilter>("ALL");
  const objectiveRows = useMemo(() => buildObjectiveRows(d.campaigns), [d.campaigns]);
  // A new date range can drop the objective that was picked, so fall back rather than show nothing.
  const filter: ObjectiveFilter = picked !== "ALL" && objectiveRows.some(r => r.objective === picked) ? picked : "ALL";
  const view = useMemo(() => objectiveView(d, filter), [d, filter]);
  const t = view.totals;
  const p = view.prev;
  const shares = useMemo(() => accountShares(view.campaigns), [view.campaigns]);
  const scorecard = useMemo(() => buildScorecard(view.campaigns), [view.campaigns]);
  const adTypes = useMemo(() => buildAdTypeTable(view.campaigns, cur), [view.campaigns, cur]);
  const diags = useMemo(() => rankDiags(diagnoseOverview(d, filter)), [d, filter]);
  const columns = useMemo(() => campaignColumns(cur, d.goalCounting), [cur, d.goalCounting]);
  const convColumns = useMemo(() => conversionColumns(cur), [cur]);
  const salesByDay = useMemo(
    () => new Map(rollDaily(d.dailyByObjective.filter(r => r.objective === "SALES")).map(r => [r.date, r.convValue])),
    [d.dailyByObjective],
  );

  if (t.impressions === 0 && d.campaigns.length === 0) {
    return (
      <>
        <PartialNotice errors={d.errors} labels={QUERY_LABELS} />
        <Card><EmptyNote>No Google Ads activity in this date range. Try a wider range from the date picker at the top.</EmptyNote></Card>
      </>
    );
  }

  // Campaign detail can fail on its own, and then the account totals are all there is.
  const noCampaignData = d.campaigns.length === 0;
  const salesCampaigns = view.campaigns.filter(c => c.objective === "SALES");
  const salesM = noCampaignData ? t : sumMetrics(salesCampaigns);
  const salesPrev = noCampaignData ? p : d.prevByObjective.SALES;
  const hasSales = salesM.convValue > 0;
  const noSalesReason = salesCampaigns.length > 0 ? "No sale value recorded" : "Only for Sales campaigns";
  // Adding purchases and leads into one cost would describe neither, so those wait for a pick.
  const mixed = d.goalCounting && filter === "ALL" && objectiveRows.length >= 2;
  const active: Objective | null = filter !== "ALL" ? filter : objectiveRows.length === 1 ? objectiveRows[0].objective : null;
  const goalNamed = active !== null && active !== "OTHER" && d.goalCounting;
  const leftOut = mergeGoalLines(view.campaigns.map(c => c.notCounted));
  const anySecondary = view.campaigns.some(c => c.usedSecondary);
  const notRunning = (Object.keys(CHANNEL_PURPOSE) as Channel[]).filter(ch => ch !== "OTHER" && !d.campaigns.some(c => c.channel === ch));

  const chartData = view.daily.map(r => ({
    date: r.date.slice(5), "Money spent": Math.round(r.spend),
    "Sales value": Math.round(noCampaignData ? r.convValue : salesByDay.get(r.date) ?? 0),
    Conversions: r.conversions,
  }));
  const showSales = (filter === "ALL" || filter === "SALES") && hasSales;
  const mix = scorecard.map(s => ({ label: CHANNEL_LABEL[s.channel], value: s.spend, color: CHANNEL_COLOR[s.channel] }));
  const conversionsTitle = goalNamed ? `${OBJECTIVE_GOAL[active as Objective]} per day` : mixed ? "Conversions per day (mixed goals)" : "Conversions per day";

  return (
    <>
      <PartialNotice errors={d.errors} labels={QUERY_LABELS} />

      {!d.goalCounting && (
        <div className="border-l-[3px] border-l-[#EAB308] bg-[#FFFBEB] dark:bg-[#2D1C00] rounded-r-xl p-3 text-[15px] text-[#92400E] dark:text-[#FCD34D]">
          <div className="font-semibold mb-1 flex items-center gap-1.5"><AlertTriangle size={14} /> These are Google&apos;s own conversion counts</div>
          The split by goal couldn&apos;t load, so Conversions may include actions like Add to cart, and cost per conversion may look better than it is.
        </div>
      )}

      {objectiveRows.length >= 2 && (
        <Pills<ObjectiveFilter>
          options={[
            { key: "ALL", label: "All objectives", count: d.campaigns.length },
            ...objectiveRows.map(r => ({ key: r.objective as ObjectiveFilter, label: OBJECTIVE_LABEL[r.objective], count: r.campaigns })),
          ]}
          value={filter}
          onChange={setPicked}
        />
      )}

      {objectiveRows.length > 0 && (
        <Card>
          <CardHeader title="Performance by objective" right="Each objective counts one goal" />
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className={HEAD_ROW}>
                  <th className="text-left py-2 px-2 font-semibold">Objective</th>
                  <th className="text-left py-2 px-2 font-semibold">Goal counted</th>
                  <th className="text-right py-2 px-2 font-semibold">Money Spent</th>
                  <th className="text-right py-2 px-2 font-semibold">Conversions</th>
                  <th className="text-right py-2 px-2 font-semibold">CPA</th>
                  <th className="text-right py-2 px-2 font-semibold">Sales Value</th>
                  <th className="text-right py-2 px-2 font-semibold">ROAS</th>
                  <th className="text-left py-2 px-2 font-semibold">Not counted</th>
                </tr>
              </thead>
              <tbody>
                {objectiveRows.map(r => {
                  const m = r.metrics;
                  const value = showsValue(r.objective) && m.convValue > 0;
                  return (
                    <tr key={r.objective} className={BODY_ROW}>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <div className={STRONG}>{OBJECTIVE_LABEL[r.objective]}</div>
                        <div className={MUTED}>{r.campaigns} {r.campaigns === 1 ? "campaign" : "campaigns"}</div>
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap text-[#52525B] dark:text-[#A1A1AA]">{d.goalCounting && r.objective !== "OTHER" ? OBJECTIVE_GOAL[r.objective] : "Google's count"}</td>
                      <td className={NUMBER_CELL}>{money(cur, m.spend)}</td>
                      <td className={NUMBER_CELL}>{count(m.conversions)}</td>
                      <td className={NUMBER_CELL}>{m.cpa > 0 ? money(cur, m.cpa) : "-"}</td>
                      <td className={NUMBER_CELL}>{value ? money(cur, m.convValue) : "-"}</td>
                      <td className={NUMBER_CELL}>{value ? <Judged verdict={judgeRoas(m.roas)}>{m.roas.toFixed(2)}x</Judged> : "-"}</td>
                      <td className="py-2 px-2 min-w-[160px] text-[14px] text-[#52525B] dark:text-[#A1A1AA]">{r.notCounted.length > 0 ? goalLinesText(r.notCounted) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 space-y-1.5">
            <Note>Skylitee works out each campaign&apos;s objective from its conversion goals, name, type and bidding, because it couldn&apos;t read the objective directly from Google. The Campaigns table shows the reason for each.</Note>
            {objectiveRows.some(r => r.objective === "LEADS") && <Note>The same lead can count more than once if it passes several stages, such as form submit and qualified lead.</Note>}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <KpiTile label="Money Spent" value={money(cur, t.spend)} delta={pctChange(t.spend, p?.spend)} sub="How much money we gave Google to show our ads" />
        <KpiTile label="Impressions" value={t.impressions.toLocaleString("en-IN")} delta={pctChange(t.impressions, p?.impressions)} sub="How many times people saw our ads" />
        <KpiTile label="Clicks" value={t.clicks.toLocaleString("en-IN")} delta={pctChange(t.clicks, p?.clicks)} sub="How many times people clicked our ads" />
        <KpiTile label="CTR" value={`${t.ctr.toFixed(2)}%`} delta={pctChange(t.ctr, p?.ctr)} sub="Out of 100 people who saw our ad, how many clicked" />
        <KpiTile label="CPC" value={money(cur, t.cpc, 2)} delta={pctChange(t.cpc, p?.cpc)} lowerIsBetter sub="How much we paid for one click" />
        {mixed ? (
          <KpiTile
            label="Conversions"
            value={count(t.conversions)}
            hint="How many people completed the action we wanted, such as buying or submitting a form. Each objective counts only its own goal."
            sub={objectiveRows.map(r => `${count(r.metrics.conversions)} ${OBJECTIVE_GOAL[r.objective]}`).join(", ")}
          />
        ) : (
          <KpiTile
            label={goalNamed ? `Conversions (${OBJECTIVE_GOAL[active as Objective]})` : "Conversions"}
            value={count(t.conversions)}
            delta={pctChange(t.conversions, p?.conversions)}
            sub="How many people completed the action we wanted, such as buying or submitting a form"
          />
        )}
        {mixed
          ? <KpiTile label="CPA" value="-" sub="Pick an objective above" hint="How much advertising money we spent to get one conversion. A purchase and a lead cost different amounts, so one combined figure would mislead." />
          : <KpiTile label="CPA" value={t.cpa > 0 ? money(cur, t.cpa) : "-"} delta={pctChange(t.cpa, p?.cpa)} lowerIsBetter sub="How much advertising money we spent to get one conversion" />}
        <KpiTile label="Sales Value" value={hasSales ? money(cur, salesM.convValue) : "-"} delta={hasSales ? pctChange(salesM.convValue, salesPrev?.convValue) : null} sub={hasSales ? "Total sales value recorded from ads" : noSalesReason} />
        <KpiTile label="ROAS" value={hasSales ? `${salesM.roas.toFixed(2)}x` : "-"} delta={hasSales ? pctChange(salesM.roas, salesPrev?.roas) : null} verdict={hasSales ? judgeRoas(salesM.roas) : "na"} sub={hasSales ? `How much sales value we received for every ${sym(cur)}1 spent on ads` : noSalesReason} />
        {mixed
          ? <KpiTile label="Conversion Rate" value="-" sub="Pick an objective above" hint="Out of 100 people who clicked, how many completed our desired action. Each objective has a different action, so one combined figure would mislead." />
          : hasConversionRate(active, t.cvr)
            ? <KpiTile label="Conversion Rate" value={`${t.cvr.toFixed(2)}%`} delta={pctChange(t.cvr, p?.cvr)} sub="Out of 100 people who clicked, how many completed our desired action" />
            : <KpiTile label="Conversion Rate" value="-" sub="This goal can happen without a click, so a rate against clicks would mislead" />}
      </div>

      {d.goalCounting && Math.abs(t.googleConversions - t.conversions) >= 0.5 && (
        <Note>
          {`Google Ads shows ${count(t.googleConversions)} Conversions. Skylitee counts ${count(t.conversions)} here, because only the goal matching each campaign's objective counts.`}
          {leftOut.length > 0 && ` Left out: ${goalLinesText(leftOut)}.`}
          {anySecondary && " Some campaigns record their goal without bidding toward it, so those are read from All conversions."}
        </Note>
      )}

      {adTypes.length > 0 && (
        <Card>
          <CardHeader title="Which ads are working and which need attention" right="By ad type and objective" />
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className={HEAD_ROW}>
                  <th className="text-left py-2 px-2 font-semibold">Ad type</th>
                  <th className="text-left py-2 px-2 font-semibold">Objective</th>
                  <th className="text-right py-2 px-2 font-semibold">Money spent</th>
                  <th className="text-right py-2 px-2 font-semibold">Result</th>
                  <th className="text-right py-2 px-2 font-semibold">Sales value</th>
                  <th className="text-left py-2 px-2 font-semibold">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {adTypes.map(r => (
                  <tr key={`${r.channel}-${r.objective}`} className={BODY_ROW}>
                    <td className="py-2 px-2 min-w-[200px]">
                      <div className={`flex items-center gap-1.5 ${STRONG}`}>
                        <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: CHANNEL_COLOR[r.channel] }} />
                        {CHANNEL_LABEL[r.channel]}
                      </div>
                      <div className={MUTED}>{CHANNEL_PURPOSE[r.channel]}</div>
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap text-[#52525B] dark:text-[#A1A1AA]">{OBJECTIVE_LABEL[r.objective]}</td>
                    <td className={NUMBER_CELL}>{money(cur, r.metrics.spend)}</td>
                    <td className={NUMBER_CELL}>
                      {count(r.metrics.conversions)}
                      <div className={MUTED}>{d.goalCounting ? OBJECTIVE_GOAL[r.objective] : "Conversions"}</div>
                    </td>
                    <td className={NUMBER_CELL}>{showsValue(r.objective) && r.metrics.convValue > 0 ? money(cur, r.metrics.convValue) : "-"}</td>
                    <td className="py-2 px-2 min-w-[200px]">
                      <VerdictBadge verdict={r.verdict} label={r.label} />
                      <div className={`${MUTED} mt-0.5`}>{r.why}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 space-y-1.5">
            <Note>For Sales, Good means ROAS of {ROAS_TARGET}x or more, Check means {ROAS_MIN}x to {ROAS_TARGET}x, and Review means under {ROAS_MIN}x. These are general rules, not your store&apos;s break-even. Leads are compared with your own average cost per lead, and Traffic with a published CTR benchmark.</Note>
            {filter === "ALL" && notRunning.length > 0 && (
              <p className={MUTED}>
                <span className="font-semibold">Not running in this period: </span>
                {notRunning.map(ch => `${CHANNEL_LABEL[ch]} (${CHANNEL_PURPOSE[ch].toLowerCase()})`).join(", ")}.
              </p>
            )}
          </div>
        </Card>
      )}

      <div>
        <h3 className="text-[15px] font-semibold text-[#52525B] dark:text-[#A1A1AA] mb-2">More KPIs</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <KpiTile label="Avg order value" value={salesM.aov > 0 ? money(cur, salesM.aov) : "-"} delta={salesM.aov > 0 ? pctChange(salesM.aov, salesPrev?.aov) : null} hint="Sales value divided by purchases, for Sales campaigns." />
          <KpiTile label="CPM" value={money(cur, t.cpm)} delta={pctChange(t.cpm, p?.cpm)} lowerIsBetter hint="Cost per 1,000 impressions." />
          {shares && <KpiTile label="Search share" value={shareText(shares.share)} verdict={judgeShare(shares.share)} hint="Share of eligible searches where your Search ads showed. 70% or more is the usual aim for core terms." />}
          {shares && <KpiTile label="Lost to budget" value={`${shares.budgetLost.toFixed(1)}%`} verdict={judgeLost(shares.budgetLost)} hint="Searches missed because the budget ran out." />}
          {shares && <KpiTile label="Lost to rank" value={`${shares.rankLost.toFixed(1)}%`} verdict={judgeLost(shares.rankLost)} hint="Searches missed because competitors outranked you." />}
          {d.optimizationScore !== null && <KpiTile label="Optimization score" value={`${d.optimizationScore.toFixed(0)}%`} hint="Google's own setup score. It isn't a profit measure, and some of its suggestions raise spend." />}
          <KpiTile label="View-through conv." value={t.viewThrough.toFixed(0)} hint="People who saw an ad without clicking, then converted later. Not included in Conversions." />
          <KpiTile label="All conversions" value={count(t.allConversions)} hint="Every action Google recorded, including ones it doesn't count in its main Conversions column." />
        </div>
      </div>

      {scorecard.length > 0 && (
        <Card>
          <CardHeader title="Industry Benchmark Scorecard" right="Conversion rate and ROAS use Sales campaigns only" />
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className={HEAD_ROW}>
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
                      <tr key={s.channel} className={BODY_ROW}>
                        <td className="py-2 px-2 font-medium whitespace-nowrap text-[#18181B] dark:text-[#F4F4F5]">{CHANNEL_LABEL[s.channel]}</td>
                        <td colSpan={4} className="py-2 px-2 text-[#71717A] dark:text-[#A1A1AA]">No reliable published benchmark for this campaign type, so no verdict is shown.</td>
                      </tr>
                    )];
                  }
                  return s.rows.map((r, i) => (
                    <tr key={`${s.channel}-${r.kpi}`} className={BODY_ROW}>
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
            <CardHeader title={showSales ? "Money spent and sales value per day" : "Money spent per day"} />
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#E5E7EB" strokeOpacity={0.5} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={64} tickFormatter={v => `${sym(cur)}${Number(v).toLocaleString("en-IN")}`} />
                <RTooltip {...CHART_TOOLTIP} formatter={(v, name) => [money(cur, Number(v ?? 0)), String(name)]} />
                {showSales && <Legend wrapperStyle={{ fontSize: 13 }} iconType="plainline" />}
                {showSales && <Area type="monotone" dataKey="Sales value" stroke="#22C55E" strokeWidth={2} fill="#22C55E" fillOpacity={0.1} dot={false} isAnimationActive={false} />}
                <Area type="monotone" dataKey="Money spent" stroke="#3B82F6" strokeWidth={2} fill="#3B82F6" fillOpacity={0.1} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <CardHeader title="Where spend goes" />
            <Donut segments={mix} centerValue={money(cur, t.spend)} centerLabel="spend" size={160} />
          </Card>
          <Card className="lg:col-span-3">
            <CardHeader title={conversionsTitle} />
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
        <CardHeader title="Campaigns" right={`${view.campaigns.length} with activity`} />
        <DataTable rows={view.campaigns} columns={columns} rowKey={c => c.id} initialSort="spend" searchOf={c => c.name} searchPlaceholder="Search campaigns" />
      </Card>

      {d.conversionActions.length > 0 && (
        <Card>
          <CardHeader title="What's being counted as a conversion" right="Only the matching type counts" />
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
        subtitle={state.data ? `${state.data.account} · ${state.data.period.from} to ${state.data.period.to}, compared with the previous period of the same length` : "All KPIs by objective, compared with industry benchmarks"}
      />
      <GadsGate state={state}>{d => <Overview d={d} />}</GadsGate>
    </div>
  );
}
