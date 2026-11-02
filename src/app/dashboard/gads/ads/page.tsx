"use client";
import { useMemo, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDateSpan } from "@/lib/date-range-context";
import {
  BenchmarkNote, DataTable, DiagPanel, EmptyNote, GadsGate, GadsHeader, GoogleCountNote, Judged, Pills,
  PartialNotice, VerdictBadge, useGadsSection, type Column,
} from "@/components/gads/shared";
import {
  adChecks, BENCHMARKS, CHANNEL_COLOR, CHANNEL_LABEL, diagnoseAds, judgeAgainst, judgeRoas, judgeStrength,
  money, rankDiags, sumMetrics, titleCase,
  type AdCopy, type AdRow, type AdsData, type AssetGroupRow, type AssetRow, type LandingRow, type ProductRow, type Verdict,
} from "@/lib/gads-analysis";

const QUERY_LABELS: Record<string, string> = {
  ads: "Ads", disapproved: "Disapproved ads", assets: "Ad copy performance", assetGroups: "Performance Max asset groups",
  assetGroupCopy: "Performance Max ad copy", products: "Products", landingPages: "Landing pages",
};

type Tab = "ads" | "copy" | "groups" | "products" | "pages";

function strengthBadge(s: string) {
  return s && s !== "UNSPECIFIED" && s !== "UNKNOWN" && s !== "PENDING" && s !== "NO_ADS"
    ? <VerdictBadge verdict={judgeStrength(s)} label={titleCase(s)} />
    : <span className="text-[#71717A] dark:text-[#A1A1AA]">-</span>;
}

function roasCell(r: { convValue: number; roas: number }) {
  return r.convValue > 0 ? <Judged verdict={judgeRoas(r.roas)}>{r.roas.toFixed(2)}x</Judged> : "-";
}

function CopyList({ title, lines }: { title: string; lines: AdCopy[] | string[] }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <div className="text-[14px] font-semibold text-[#71717A] dark:text-[#A1A1AA] mb-1">{title} ({lines.length})</div>
      <ul className="space-y-0.5 text-[15px] text-[#18181B] dark:text-[#F4F4F5]">
        {lines.map((l, i) => {
          const line = typeof l === "string" ? { text: l } : l;
          return (
            <li key={i}>
              {line.text}
              {line.pinned && <span className="ml-1.5 text-[13px] text-[#71717A] dark:text-[#A1A1AA]">pinned: {titleCase(line.pinned)}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function displayPath(ad: AdRow) {
  try {
    const host = new URL(ad.finalUrl).hostname.replace(/^www\./, "");
    return ad.path ? `${host}/${ad.path}` : host;
  } catch {
    return ad.finalUrl;
  }
}

function AdDetail({ ad, cur, avgCpa }: { ad: AdRow; cur: string; avgCpa: number }) {
  const checks = adChecks(ad, cur, avgCpa);
  const previewHead = ad.headlines.slice(0, 3).map(h => h.text).join(" | ") || ad.longHeadlines[0]?.text;
  const previewBody = ad.descriptions.slice(0, 2).map(x => x.text).join(" ");
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 cursor-default" onClick={e => e.stopPropagation()}>
      <div className="space-y-3 min-w-0">
        {previewHead && (
          <div>
            <div className="text-[14px] font-semibold text-[#71717A] dark:text-[#A1A1AA] mb-1">Sample of how it can look (Google mixes the lines itself)</div>
            <div className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-xl p-3">
              <div className="text-[13px] text-[#71717A] dark:text-[#A1A1AA]">Sponsored · {displayPath(ad)}</div>
              <div className="text-[17px] text-[#1A0DAB] dark:text-[#8AB4F8] leading-snug mt-0.5">{previewHead}</div>
              {previewBody && <div className="text-[15px] text-[#52525B] dark:text-[#A1A1AA] mt-0.5">{previewBody}</div>}
            </div>
          </div>
        )}
        <CopyList title="Headlines" lines={ad.headlines} />
        <CopyList title="Long headlines" lines={ad.longHeadlines} />
        <CopyList title="Descriptions" lines={ad.descriptions} />
        {ad.headlines.length === 0 && ad.longHeadlines.length === 0 && ad.descriptions.length === 0 && (
          <div className="text-[15px] text-[#71717A] dark:text-[#A1A1AA]">Google doesn&apos;t share text for this ad type ({titleCase(ad.type)}).</div>
        )}
        {ad.finalUrl && (
          <a href={ad.finalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[15px] font-semibold text-[#EA580C] dark:text-[#FB923C] hover:underline break-all">
            Open landing page <ExternalLink size={13} className="shrink-0" />
          </a>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-[#71717A] dark:text-[#A1A1AA] mb-1">This ad against the standard</div>
        {checks.length === 0 && <div className="text-[15px] text-[#71717A] dark:text-[#A1A1AA]">Not enough data yet to judge this ad.</div>}
        <div className="space-y-2">
          {checks.map(c => (
            <div key={c.kpi} className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-xl p-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[15px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">{c.kpi}</span>
                <VerdictBadge verdict={c.verdict} />
              </div>
              <div className="text-[14px] text-[#52525B] dark:text-[#A1A1AA] tabular-nums">You: {c.you} · Standard: {c.standard}</div>
              <div className="text-[15px] text-[#52525B] dark:text-[#A1A1AA] mt-0.5">{c.advice}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function adTitle(ad: AdRow) {
  return ad.headlines[0]?.text || ad.longHeadlines[0]?.text || ad.name || `${titleCase(ad.type)} ${ad.id}`;
}

function adColumns(cur: string): Column<AdRow>[] {
  return [
    {
      key: "ad", label: "Ad", sort: a => adTitle(a),
      render: a => (
        <div className="min-w-[220px] max-w-[320px]">
          <div className="font-medium truncate" title={adTitle(a)}>{adTitle(a)}</div>
          <div className="flex items-center gap-1.5 text-[14px] text-[#71717A] dark:text-[#A1A1AA]">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: CHANNEL_COLOR[a.channel] }} />
            <span className="truncate" title={`${a.campaign} > ${a.adGroup}`}>{CHANNEL_LABEL[a.channel]} · {a.adGroup || a.campaign}</span>
          </div>
        </div>
      ),
    },
    { key: "strength", label: "Ad Strength", hint: "Google's own rating of how much useful variety the ad has.", sort: a => ({ EXCELLENT: 4, GOOD: 3, AVERAGE: 2, POOR: 1 } as Record<string, number>)[a.strength] ?? 0, render: a => strengthBadge(a.strength) },
    { key: "spend", label: "Spend", align: "right", sort: a => a.spend, render: a => money(cur, a.spend) },
    { key: "value", label: "Conv. value", align: "right", sort: a => a.convValue, render: a => money(cur, a.convValue) },
    { key: "roas", label: "ROAS", align: "right", sort: a => a.roas, render: roasCell },
    { key: "conv", label: "Conv.", align: "right", sort: a => a.conversions, render: a => a.conversions.toFixed(1) },
    { key: "cpa", label: "Cost / conv.", align: "right", sort: a => a.cpa, render: a => (a.cpa > 0 ? money(cur, a.cpa) : "-") },
    { key: "impr", label: "Impr.", align: "right", sort: a => a.impressions, render: a => a.impressions.toLocaleString("en-IN") },
    { key: "clicks", label: "Clicks", align: "right", sort: a => a.clicks, render: a => a.clicks.toLocaleString("en-IN") },
    { key: "ctr", label: "CTR", align: "right", sort: a => a.ctr, render: a => <Judged verdict={a.impressions >= 500 ? judgeAgainst(a.ctr, BENCHMARKS[a.channel].ctr) : "na"}>{a.ctr.toFixed(2)}%</Judged> },
    { key: "cvr", label: "Conv. rate", align: "right", sort: a => a.cvr, render: a => <Judged verdict={a.clicks >= 30 ? judgeAgainst(a.cvr, BENCHMARKS[a.channel].cvr) : "na"}>{a.cvr.toFixed(2)}%</Judged> },
    { key: "cpc", label: "Avg CPC", align: "right", sort: a => a.cpc, render: a => money(cur, a.cpc, 2) },
    { key: "status", label: "Status", sort: a => a.status, render: a => <span className="whitespace-nowrap text-[14px]">{titleCase(a.status)}{a.approval && a.approval !== "APPROVED" && a.approval !== "UNSPECIFIED" && a.approval !== "UNKNOWN" ? ` · ${titleCase(a.approval)}` : ""}</span> },
  ];
}

const LABEL_VERDICT: Record<string, Verdict> = { BEST: "good", GOOD: "good", LOW: "bad", LEARNING: "na", PENDING: "na" };

function copyColumns(cur: string): Column<AssetRow>[] {
  return [
    { key: "text", label: "Ad line", sort: a => a.text, render: a => <div className="min-w-[240px] max-w-[420px] font-medium">{a.text}</div> },
    { key: "field", label: "Type", sort: a => a.field, render: a => <span className="whitespace-nowrap">{titleCase(a.field)}</span> },
    {
      key: "label", label: "Google rating", hint: "Google's rating of this line compared with others of the same type in your ads.",
      sort: a => ({ BEST: 3, GOOD: 2, LOW: 0 } as Record<string, number>)[a.label] ?? 1,
      render: a => (a.label in LABEL_VERDICT ? <VerdictBadge verdict={LABEL_VERDICT[a.label]} label={titleCase(a.label)} /> : "-"),
    },
    { key: "ads", label: "Used in", align: "right", sort: a => a.adCount, render: a => `${a.adCount} ad${a.adCount === 1 ? "" : "s"}` },
    { key: "impr", label: "Impr.", align: "right", sort: a => a.impressions, render: a => a.impressions.toLocaleString("en-IN") },
    { key: "clicks", label: "Clicks", align: "right", sort: a => a.clicks, render: a => a.clicks.toLocaleString("en-IN") },
    { key: "ctr", label: "CTR", align: "right", sort: a => a.ctr, render: a => `${a.ctr.toFixed(2)}%` },
    { key: "conv", label: "Conv.", align: "right", sort: a => a.conversions, render: a => a.conversions.toFixed(1) },
    { key: "spend", label: "Spend", align: "right", sort: a => a.spend, render: a => money(cur, a.spend) },
  ];
}

function groupColumns(cur: string): Column<AssetGroupRow>[] {
  return [
    {
      key: "name", label: "Asset group", sort: g => g.name,
      render: g => (
        <div className="min-w-[200px] max-w-[300px]">
          <div className="font-medium truncate" title={g.name}>{g.name}</div>
          <div className="text-[14px] text-[#71717A] dark:text-[#A1A1AA] truncate" title={g.campaign}>{g.campaign}</div>
        </div>
      ),
    },
    { key: "strength", label: "Ad Strength", sort: g => ({ EXCELLENT: 4, GOOD: 3, AVERAGE: 2, POOR: 1 } as Record<string, number>)[g.strength] ?? 0, render: g => strengthBadge(g.strength) },
    { key: "spend", label: "Spend", align: "right", sort: g => g.spend, render: g => money(cur, g.spend) },
    { key: "value", label: "Conv. value", align: "right", sort: g => g.convValue, render: g => money(cur, g.convValue) },
    { key: "roas", label: "ROAS", align: "right", sort: g => g.roas, render: roasCell },
    { key: "conv", label: "Conv.", align: "right", sort: g => g.conversions, render: g => g.conversions.toFixed(1) },
    { key: "cvr", label: "Conv. rate", align: "right", sort: g => g.cvr, render: g => <Judged verdict={g.clicks >= 30 ? judgeAgainst(g.cvr, BENCHMARKS.PERFORMANCE_MAX.cvr) : "na"}>{g.cvr.toFixed(2)}%</Judged> },
    { key: "cpc", label: "Avg CPC", align: "right", sort: g => g.cpc, render: g => money(cur, g.cpc, 2) },
  ];
}

function productColumns(cur: string): Column<ProductRow>[] {
  return [
    {
      key: "title", label: "Product", sort: p => p.title,
      render: p => (
        <div className="min-w-[220px] max-w-[340px]">
          <div className="font-medium truncate" title={p.title}>{p.title}</div>
          <div className="text-[14px] text-[#71717A] dark:text-[#A1A1AA] truncate">{[p.brand, p.itemId].filter(Boolean).join(" · ")}</div>
        </div>
      ),
    },
    { key: "spend", label: "Spend", align: "right", sort: p => p.spend, render: p => money(cur, p.spend) },
    { key: "value", label: "Conv. value", align: "right", sort: p => p.convValue, render: p => money(cur, p.convValue) },
    { key: "roas", label: "ROAS", align: "right", sort: p => p.roas, render: roasCell },
    { key: "conv", label: "Conv.", align: "right", sort: p => p.conversions, render: p => p.conversions.toFixed(1) },
    { key: "clicks", label: "Clicks", align: "right", sort: p => p.clicks, render: p => p.clicks.toLocaleString("en-IN") },
    { key: "ctr", label: "CTR", align: "right", sort: p => p.ctr, render: p => <Judged verdict={p.impressions >= 500 ? judgeAgainst(p.ctr, BENCHMARKS.SHOPPING.ctr) : "na"}>{p.ctr.toFixed(2)}%</Judged> },
    { key: "cvr", label: "Conv. rate", align: "right", sort: p => p.cvr, render: p => <Judged verdict={p.clicks >= 30 ? judgeAgainst(p.cvr, BENCHMARKS.SHOPPING.cvr) : "na"}>{p.cvr.toFixed(2)}%</Judged> },
  ];
}

function pageColumns(cur: string, avgCvr: number): Column<LandingRow>[] {
  return [
    {
      key: "url", label: "Page", sort: l => l.url,
      render: l => (
        <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium hover:underline min-w-[220px] max-w-[420px]" title={l.url}>
          <span className="truncate">{l.url.replace(/^https?:\/\/(www\.)?/, "")}</span> <ExternalLink size={12} className="shrink-0 text-[#A1A1AA]" />
        </a>
      ),
    },
    { key: "spend", label: "Spend", align: "right", sort: l => l.spend, render: l => money(cur, l.spend) },
    { key: "clicks", label: "Clicks", align: "right", sort: l => l.clicks, render: l => l.clicks.toLocaleString("en-IN") },
    {
      key: "cvr", label: "Conv. rate", align: "right", hint: "Compared with your own account average, since a page's rate depends on what it sells.", sort: l => l.cvr,
      render: l => <Judged verdict={l.clicks >= 100 && avgCvr > 0 ? judgeAgainst(l.cvr, avgCvr) : "na"}>{l.cvr.toFixed(2)}%</Judged>,
    },
    { key: "conv", label: "Conv.", align: "right", sort: l => l.conversions, render: l => l.conversions.toFixed(1) },
    { key: "value", label: "Conv. value", align: "right", sort: l => l.convValue, render: l => money(cur, l.convValue) },
    { key: "roas", label: "ROAS", align: "right", sort: l => l.roas, render: roasCell },
  ];
}

function AdsView({ d }: { d: AdsData }) {
  const cur = d.currency;
  const diags = useMemo(() => rankDiags(diagnoseAds(d)), [d]);
  const avg = useMemo(() => sumMetrics(d.ads), [d.ads]);
  const adCols = useMemo(() => adColumns(cur), [cur]);
  const copyCols = useMemo(() => copyColumns(cur), [cur]);
  const groupCols = useMemo(() => groupColumns(cur), [cur]);
  const productCols = useMemo(() => productColumns(cur), [cur]);
  const pageCols = useMemo(() => pageColumns(cur, sumMetrics(d.landingPages).cvr), [cur, d.landingPages]);

  const firstTab: Tab = d.ads.length > 0 ? "ads" : d.assetGroups.length > 0 ? "groups" : d.products.length > 0 ? "products" : "ads";
  const [tab, setTab] = useState<Tab>(firstTab);
  const [field, setField] = useState<"all" | "HEADLINE" | "DESCRIPTION">("all");
  const [rating, setRating] = useState<"all" | "BEST" | "GOOD" | "LOW">("all");

  const copyRows = useMemo(
    () => d.assets.filter(a => (field === "all" || a.field === field) && (rating === "all" || a.label === rating)),
    [d.assets, field, rating],
  );

  return (
    <>
      <PartialNotice errors={d.errors} labels={QUERY_LABELS} />
      <DiagPanel diags={diags} currency={cur} limit={4} right="Ads, copy, products, pages" />

      {d.disapproved.length > 0 && (
        <Card>
          <CardHeader title="Ads Google has blocked or limited" right={`${d.disapproved.length} ads`} />
          <div className="space-y-2">
            {d.disapproved.slice(0, 10).map(a => (
              <div key={`${a.id}-${a.adGroup}`} className="border-l-[3px] border-l-[#EF4444] bg-[#FEF2F2] dark:bg-[#2D0A0A] rounded-r-xl p-3 text-[15px]">
                <div className="font-semibold text-[#18181B] dark:text-[#F4F4F5]">{a.campaign} &gt; {a.adGroup}</div>
                <div className="text-[#52525B] dark:text-[#A1A1AA]">
                  {titleCase(a.approval)}{a.topics.length > 0 && ` - policy: ${a.topics.map(titleCase).join(", ")}`}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Pills<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { key: "ads", label: "Ads", count: d.ads.length },
          { key: "copy", label: "Ad Copy", count: d.assets.length },
          { key: "groups", label: "Performance Max", count: d.assetGroups.length },
          { key: "products", label: "Products", count: d.products.length },
          { key: "pages", label: "Landing Pages", count: d.landingPages.length },
        ]}
      />

      {tab === "ads" && (
        <Card>
          <CardHeader title="Every ad" right="Click a row for its full copy and benchmark check" />
          {d.ads.length === 0 && <EmptyNote>No individual ads with activity in this date range. Performance Max runs through asset groups, so check that tab.</EmptyNote>}
          {d.ads.length > 0 && (
            <DataTable
              rows={d.ads}
              columns={adCols}
              rowKey={a => `${a.id}-${a.adGroup}`}
              initialSort="spend"
              searchOf={a => [a.campaign, a.adGroup, ...a.headlines.map(h => h.text), ...a.descriptions.map(x => x.text)].join(" ")}
              searchPlaceholder="Search ads, copy, campaigns"
              expand={a => <AdDetail ad={a} cur={cur} avgCpa={avg.cpa} />}
            />
          )}
        </Card>
      )}

      {tab === "copy" && (
        <Card>
          <CardHeader title="Which ad lines work" right="Merged across ads" />
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
            <Pills value={field} onChange={setField} options={[{ key: "all", label: "All" }, { key: "HEADLINE", label: "Headlines" }, { key: "DESCRIPTION", label: "Descriptions" }]} />
            <Pills value={rating} onChange={setRating} options={[{ key: "all", label: "Any rating" }, { key: "BEST", label: "Best" }, { key: "GOOD", label: "Good" }, { key: "LOW", label: "Low" }]} />
          </div>
          <DataTable rows={copyRows} columns={copyCols} rowKey={a => `${a.field}-${a.text}`} initialSort="impr" searchOf={a => a.text} searchPlaceholder="Search ad lines" empty="No ad lines match. Google rates lines once they have enough impressions." />
          <p className="mt-2 text-[14px] text-[#71717A] dark:text-[#A1A1AA]">Google shows several lines together in each ad, so one view counts toward every line in it. Compare lines, but don&apos;t add these numbers up.</p>
        </Card>
      )}

      {tab === "groups" && (
        <Card>
          <CardHeader title="Performance Max asset groups" right="Click a row for its copy" />
          <DataTable
            rows={d.assetGroups}
            columns={groupCols}
            rowKey={g => g.id}
            initialSort="spend"
            searchOf={g => `${g.name} ${g.campaign}`}
            searchPlaceholder="Search asset groups"
            empty="No Performance Max activity in this date range."
            expand={g => (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 cursor-default" onClick={e => e.stopPropagation()}>
                <CopyList title="Headlines" lines={g.headlines} />
                <CopyList title="Long headlines" lines={g.longHeadlines} />
                <CopyList title="Descriptions" lines={g.descriptions} />
                {g.headlines.length + g.longHeadlines.length + g.descriptions.length === 0 && <div className="text-[15px] text-[#71717A] dark:text-[#A1A1AA]">No text assets found for this group.</div>}
              </div>
            )}
          />
          <p className="mt-2 text-[14px] text-[#71717A] dark:text-[#A1A1AA]">Google doesn&apos;t rate or report individual Performance Max text lines here, so results are per asset group.</p>
        </Card>
      )}

      {tab === "products" && (
        <Card>
          <CardHeader title="Products in Shopping and Performance Max" right="Benchmarks: Shopping" />
          <DataTable rows={d.products} columns={productCols} rowKey={(p, i) => `${p.itemId}-${i}`} initialSort="spend" searchOf={p => `${p.title} ${p.itemId} ${p.brand}`} searchPlaceholder="Search products" empty="No product data in this date range. This needs Shopping or Performance Max with a product feed." />
        </Card>
      )}

      {tab === "pages" && (
        <Card>
          <CardHeader title="Landing pages" right="Rates compared with your average" />
          <DataTable rows={d.landingPages} columns={pageCols} rowKey={l => l.url} initialSort="spend" searchOf={l => l.url} searchPlaceholder="Search pages" empty="No landing page data in this date range." />
        </Card>
      )}

      <BenchmarkNote />
    </>
  );
}

export default function GadsAdsPage() {
  const state = useGadsSection<AdsData>("ads");
  return (
    <div className="space-y-4">
      <GadsHeader
        icon={FileText}
        title="Ads & Ad Copy"
        subtitle={state.data ? `${state.data.account} · ${formatDateSpan(state.data.period.from, state.data.period.to)}` : "Ad-wise results, full copy, products and landing pages"}
      />
      <GoogleCountNote />
      <GadsGate state={state}>{d => <AdsView d={d} />}</GadsGate>
    </div>
  );
}
