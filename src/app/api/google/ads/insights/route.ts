import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getGoogleAccessToken, GADS_API, classifyGadsError, type GadsApiError } from "@/lib/google";
import { getGadsRefreshToken, getGadsCustomerId, getAuthorizedShop } from "@/lib/session";
import {
  channelOf, countForObjective, derive, detectObjective, rollDaily, sumMetrics, titleCase,
  type AdCopy, type AdRow, type AssetRow, type Campaign, type DailyRow, type GMetrics, type GoalCount, type GoalResult, type HeatRow, type Objective, type ObjectiveDaily, type SegmentRow, type SearchTermRow,
} from "@/lib/gads-analysis";

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";

// All reads, one section per page. API quota is shared across every store, so results are cached
// and sections are only fetched by the pages that need them.
const CACHE_SECONDS = 1800;
const PARTIAL_CACHE_SECONDS = 300;
const META_CACHE_SECONDS = 86400;
const MAX_PAGES = 5;

type Section = "overview" | "ads" | "keywords" | "audience";
const SECTIONS: Section[] = ["overview", "ads", "keywords", "audience"];

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

interface QueryResult { rows: Row[]; error?: GadsApiError }

async function gadsSearchAll(accessToken: string, customerId: string, query: string): Promise<QueryResult> {
  const rows: Row[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`${GADS_API}/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": DEV_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
    });
    const data = await res.json() as { results?: Row[]; nextPageToken?: string; error?: GadsApiError };
    if (data.error) return { rows, error: data.error };
    rows.push(...(data.results ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return { rows };
}

// Each query runs on its own, so one rejected field costs one table rather than the whole page.
async function runQueries<K extends string>(accessToken: string, customerId: string, queries: Record<K, string>) {
  const keys = Object.keys(queries) as K[];
  const settled = await Promise.allSettled(keys.map(k => gadsSearchAll(accessToken, customerId, queries[k])));
  const rows = {} as Record<K, Row[]>;
  const errors: Partial<Record<K, GadsApiError>> = {};
  settled.forEach((r, i) => {
    const key = keys[i];
    if (r.status === "fulfilled") {
      rows[key] = r.value.rows;
      if (r.value.error) errors[key] = r.value.error;
    } else {
      rows[key] = [];
      errors[key] = { message: "Google Ads request failed" };
    }
  });
  return { rows, errors, total: keys.length };
}

const num =(v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const micros = (v: unknown) => num(v) / 1_000_000;
const share = (v: unknown) => (v === undefined || v === null ? null : num(v) * 100);

const METRICS = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value";

function metricsOf(r: Row): GMetrics {
  const m = r.metrics ?? {};
  return derive({
    impressions: num(m.impressions), clicks: num(m.clicks), spend: micros(m.costMicros),
    conversions: num(m.conversions), convValue: num(m.conversionsValue),
  });
}

function shiftedPeriod(from: string, to: string) {
  const day = 86_400_000;
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  const iso = (t: number) => new Date(t).toISOString().split("T")[0];
  return { from: iso(start - (end - start) - day), to: iso(start - day) };
}

function rollUp(rows: Row[], key: (r: Row) => string | undefined, label: (k: string) => string): SegmentRow[] {
  const groups = new Map<string, GMetrics[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), metricsOf(r)]);
  }
  return [...groups.entries()]
    .map(([k, list]) => ({ key: k, label: label(k), ...sumMetrics(list) }))
    .sort((a, b) => b.spend - a.spend);
}

const copyOf = (list?: Row[]): AdCopy[] =>
  (list ?? []).filter(x => x?.text).map(x => (x.pinnedField ? { text: x.text, pinned: x.pinnedField } : { text: x.text }));

const NETWORK_LABEL: Record<string, string> = {
  SEARCH: "Google Search", SEARCH_PARTNERS: "Search Partners", CONTENT: "Display Network",
  YOUTUBE: "YouTube", YOUTUBE_SEARCH: "YouTube Search", YOUTUBE_WATCH: "YouTube Videos",
  MIXED: "Performance Max (mixed)", GOOGLE_TV: "Google TV",
};
const AGE_LABEL: Record<string, string> = {
  AGE_RANGE_18_24: "18-24", AGE_RANGE_25_34: "25-34", AGE_RANGE_35_44: "35-44",
  AGE_RANGE_45_54: "45-54", AGE_RANGE_55_64: "55-64", AGE_RANGE_65_UP: "65+", AGE_RANGE_UNDETERMINED: "Unknown",
};

function goalRow(r: Row): GoalResult {
  const m = r.metrics ?? {};
  return {
    category: String(r.segments?.conversionActionCategory ?? ""), conversions: num(m.conversions), value: num(m.conversionsValue),
    allConversions: num(m.allConversions), allValue: num(m.allConversionsValue),
  };
}

function groupRows<T>(rows: Row[], key: (r: Row) => string, value: (r: Row) => T) {
  const groups = new Map<string, T[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), value(r)]);
  return groups;
}

const withCount = (m: GMetrics, c: GoalCount) =>
  derive({ impressions: m.impressions, clicks: m.clicks, spend: m.spend, conversions: c.conversions, convValue: c.convValue });

async function buildOverview(token: string, id: string, from: string, to: string, dateFilter: string) {
  const prevPeriod = shiftedPeriod(from, to);
  const prevFilter = `segments.date BETWEEN '${prevPeriod.from}' AND '${prevPeriod.to}'`;
  const goalFields = "campaign.id, segments.conversion_action_category, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value";
  const { rows, errors, total } = await runQueries(token, id, {
    totals: `SELECT ${METRICS}, metrics.all_conversions, metrics.view_through_conversions FROM customer WHERE ${dateFilter}`,
    previous: `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.bidding_strategy_type, ${METRICS} FROM campaign WHERE ${prevFilter} AND metrics.impressions > 0`,
    daily: `SELECT campaign.id, segments.date, ${METRICS} FROM campaign WHERE ${dateFilter} AND metrics.impressions > 0`,
    // Removed campaigns stay in: their money was spent, so the totals have to include them.
    campaigns: `
      SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status,
        campaign.advertising_channel_type, campaign.bidding_strategy_type,
        campaign.target_roas.target_roas, campaign.maximize_conversion_value.target_roas,
        campaign.target_cpa.target_cpa_micros, campaign.maximize_conversions.target_cpa_micros,
        campaign_budget.amount_micros, ${METRICS}, metrics.all_conversions, metrics.view_through_conversions,
        metrics.search_impression_share, metrics.search_budget_lost_impression_share,
        metrics.search_rank_lost_impression_share, metrics.search_top_impression_share,
        metrics.search_absolute_top_impression_share, metrics.content_impression_share
      FROM campaign
      WHERE ${dateFilter} AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC`,
    goals: "SELECT campaign.id, campaign_conversion_goal.category, campaign_conversion_goal.origin, campaign_conversion_goal.biddable FROM campaign_conversion_goal",
    // Google won't return cost alongside the category segment, so results per goal are a separate query.
    goalResults: `SELECT segments.date, ${goalFields} FROM campaign WHERE ${dateFilter}`,
    goalResultsPrev: `SELECT ${goalFields} FROM campaign WHERE ${prevFilter}`,
    conversionActions: `
      SELECT segments.conversion_action_name, segments.conversion_action_category,
        metrics.conversions, metrics.conversions_value
      FROM customer WHERE ${dateFilter} AND metrics.conversions > 0`,
    suggestions: `
      SELECT recommendation.type, recommendation.impact.base_metrics.conversions,
        recommendation.impact.potential_metrics.conversions
      FROM recommendation WHERE recommendation.dismissed = FALSE`,
  });

  const totalRow = rows.totals[0] ?? {};
  const suggestionMap = new Map<string, { type: string; count: number; extraConversions: number }>();
  for (const r of rows.suggestions) {
    const rec = r.recommendation ?? {};
    const type = String(rec.type ?? "");
    if (!type) continue;
    const item = suggestionMap.get(type) ?? { type, count: 0, extraConversions: 0 };
    item.count += 1;
    item.extraConversions += Math.max(0, num(rec.impact?.potentialMetrics?.conversions) - num(rec.impact?.baseMetrics?.conversions));
    suggestionMap.set(type, item);
  }

  // When the split per goal fails, every figure stays Google's own count and the page says so,
  // rather than showing a false zero for every objective.
  const counting = !errors.goalResults && !errors.campaigns;
  const campaignId = (r: Row) => String(r.campaign?.id ?? "");
  const goalsById = groupRows(rows.goals.filter(r => r.campaignConversionGoal?.biddable === true), campaignId, r => String(r.campaignConversionGoal?.category ?? ""));
  const resultsById = groupRows(rows.goalResults, campaignId, goalRow);
  const resultsByDay = groupRows(rows.goalResults, r => `${campaignId(r)}|${r.segments?.date ?? ""}`, goalRow);
  const prevResultsById = groupRows(rows.goalResultsPrev, campaignId, goalRow);

  const campaigns: Campaign[] = rows.campaigns.map(r => {
    const c = r.campaign ?? {};
    const m = r.metrics ?? {};
    const targetRoas = c.targetRoas?.targetRoas ?? c.maximizeConversionValue?.targetRoas;
    const targetCpa = c.targetCpa?.targetCpaMicros ?? c.maximizeConversions?.targetCpaMicros;
    const cid = campaignId(r);
    const name = c.name ?? "Unknown";
    const channel = channelOf(c.advertisingChannelType);
    const bidding = c.biddingStrategyType ?? "";
    const results = resultsById.get(cid) ?? [];
    const google = metricsOf(r);
    const { objective, why } = detectObjective({ name, channel, bidding, goals: goalsById.get(cid) ?? [], results });
    const count = countForObjective(counting ? objective : "OTHER", results, google);
    return {
      id: cid, name, status: c.status ?? "UNKNOWN",
      primaryStatus: c.primaryStatus ?? "", channel,
      bidding, dailyBudget: micros(r.campaignBudget?.amountMicros),
      targetRoas: targetRoas ? num(targetRoas) : null,
      targetCpa: targetCpa ? micros(targetCpa) : null,
      searchIS: share(m.searchImpressionShare), searchBudgetLost: share(m.searchBudgetLostImpressionShare),
      searchRankLost: share(m.searchRankLostImpressionShare), searchTopIS: share(m.searchTopImpressionShare),
      searchAbsTopIS: share(m.searchAbsoluteTopImpressionShare), contentIS: share(m.contentImpressionShare),
      objective, objectiveWhy: why, googleConversions: google.conversions, googleValue: google.convValue,
      notCounted: count.notCounted, usedSecondary: count.usedSecondary,
      allConversions: num(m.allConversions), viewThrough: num(m.viewThroughConversions),
      ...withCount(google, count),
    };
  });
  const known = new Map(campaigns.map(c => [c.id, c]));

  const dailyGroups = new Map<Objective, DailyRow[]>();
  for (const r of rows.daily) {
    const cid = campaignId(r);
    const date = r.segments?.date ?? "";
    const campaign = known.get(cid);
    const objective = campaign?.objective ?? "OTHER";
    const google = metricsOf(r);
    const count = countForObjective(counting ? objective : "OTHER", resultsByDay.get(`${cid}|${date}`) ?? [], google, campaign?.usedSecondary ?? false);
    dailyGroups.set(objective, [...(dailyGroups.get(objective) ?? []), { date, ...withCount(google, count) }]);
  }
  // Rolled up per objective and day: one row per campaign per day could outgrow the cache entry.
  const dailyByObjective: ObjectiveDaily[] = [...dailyGroups.entries()].flatMap(([objective, list]) => rollDaily(list).map(r => ({ ...r, objective })));

  // Comparing Google's count with the counted goal would look like a change that never happened.
  const canCompare = !errors.previous && !(counting && errors.goalResultsPrev);
  const prevGroups = new Map<Objective, GMetrics[]>();
  if (canCompare) {
    for (const r of rows.previous) {
      const c = r.campaign ?? {};
      const cid = campaignId(r);
      const results = prevResultsById.get(cid) ?? [];
      const objective = known.get(cid)?.objective ?? detectObjective({
        name: c.name ?? "", channel: channelOf(c.advertisingChannelType), bidding: c.biddingStrategyType ?? "",
        goals: goalsById.get(cid) ?? [], results,
      }).objective;
      const google = metricsOf(r);
      prevGroups.set(objective, [...(prevGroups.get(objective) ?? []), withCount(google, countForObjective(counting ? objective : "OTHER", results, google))]);
    }
  }
  const prevByObjective: Partial<Record<Objective, GMetrics>> = {};
  for (const [objective, list] of prevGroups) prevByObjective[objective] = sumMetrics(list);

  const fromCampaigns = campaigns.length > 0;
  const addUp = (f: (c: Campaign) => number) => campaigns.reduce((s, c) => s + f(c), 0);
  const accountTotals = sumMetrics(rows.totals.map(metricsOf));

  return {
    errors,
    total,
    payload: {
      prevPeriod,
      totals: {
        ...(fromCampaigns ? sumMetrics(campaigns) : accountTotals),
        allConversions: fromCampaigns ? addUp(c => c.allConversions) : num(totalRow.metrics?.allConversions),
        viewThrough: fromCampaigns ? addUp(c => c.viewThrough) : num(totalRow.metrics?.viewThroughConversions),
        googleConversions: fromCampaigns ? addUp(c => c.googleConversions) : accountTotals.conversions,
        googleValue: fromCampaigns ? addUp(c => c.googleValue) : accountTotals.convValue,
      },
      prev: canCompare ? sumMetrics([...prevGroups.values()].flat()) : null,
      prevByObjective,
      daily: rollDaily(dailyByObjective),
      dailyByObjective,
      goalCounting: counting,
      campaigns,
      conversionActions: rows.conversionActions
        .map(r => ({
          name: r.segments?.conversionActionName ?? "Unknown", category: r.segments?.conversionActionCategory ?? "",
          conversions: num(r.metrics?.conversions), value: num(r.metrics?.conversionsValue),
        }))
        .sort((a, b) => b.conversions - a.conversions),
      suggestions: [...suggestionMap.values()].sort((a, b) => b.extraConversions - a.extraConversions),
    },
  };
}

function adFromRow(r: Row): AdRow {
  const ad = r.adGroupAd?.ad ?? {};
  const rsa = ad.responsiveSearchAd;
  const rda = ad.responsiveDisplayAd;
  const dg = ad.demandGenMultiAssetAd;
  const video = ad.videoResponsiveAd;
  const eta = ad.expandedTextAd;
  const etaHeadlines = eta ? [eta.headlinePart1, eta.headlinePart2, eta.headlinePart3].filter(Boolean).map(text => ({ text })) : [];
  const etaDescriptions = eta ? [eta.description, eta.description2].filter(Boolean).map(text => ({ text })) : [];
  return {
    id: String(ad.id ?? ""), name: ad.name ?? "", type: ad.type ?? "",
    channel: channelOf(r.campaign?.advertisingChannelType),
    campaign: r.campaign?.name ?? "", adGroup: r.adGroup?.name ?? "",
    status: r.adGroupAd?.status ?? "", approval: r.adGroupAd?.policySummary?.approvalStatus ?? "",
    strength: r.adGroupAd?.adStrength ?? "",
    finalUrl: ad.finalUrls?.[0] ?? "",
    path: [rsa?.path1, rsa?.path2].filter(Boolean).join("/"),
    business: rda?.businessName ?? dg?.businessName ?? "",
    headlines: [...copyOf(rsa?.headlines), ...copyOf(rda?.headlines), ...copyOf(dg?.headlines), ...copyOf(video?.headlines), ...etaHeadlines],
    longHeadlines: [...(rda?.longHeadline?.text ? [{ text: rda.longHeadline.text }] : []), ...copyOf(video?.longHeadlines)],
    descriptions: [...copyOf(rsa?.descriptions), ...copyOf(rda?.descriptions), ...copyOf(dg?.descriptions), ...copyOf(video?.descriptions), ...etaDescriptions],
    ...metricsOf(r),
  };
}

async function buildAds(token: string, id: string, dateFilter: string) {
  const { rows, errors, total } = await runQueries(token, id, {
    ads: `
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.final_urls,
        ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2,
        ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.long_headline,
        ad_group_ad.ad.responsive_display_ad.descriptions, ad_group_ad.ad.responsive_display_ad.business_name,
        ad_group_ad.ad.demand_gen_multi_asset_ad.headlines, ad_group_ad.ad.demand_gen_multi_asset_ad.descriptions,
        ad_group_ad.ad.demand_gen_multi_asset_ad.business_name,
        ad_group_ad.ad.video_responsive_ad.headlines, ad_group_ad.ad.video_responsive_ad.long_headlines,
        ad_group_ad.ad.video_responsive_ad.descriptions,
        ad_group_ad.ad.expanded_text_ad.headline_part1, ad_group_ad.ad.expanded_text_ad.headline_part2,
        ad_group_ad.ad.expanded_text_ad.headline_part3, ad_group_ad.ad.expanded_text_ad.description,
        ad_group_ad.ad.expanded_text_ad.description2,
        ad_group_ad.ad_strength, ad_group_ad.status, ad_group_ad.policy_summary.approval_status,
        campaign.name, campaign.advertising_channel_type, ad_group.name, ${METRICS}
      FROM ad_group_ad
      WHERE ${dateFilter} AND ad_group_ad.status != 'REMOVED' AND campaign.status != 'REMOVED' AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 300`,
    disapproved: `
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.policy_summary.approval_status,
        ad_group_ad.policy_summary.policy_topic_entries, campaign.name, ad_group.name
      FROM ad_group_ad
      WHERE ad_group_ad.policy_summary.approval_status IN ('DISAPPROVED', 'AREA_OF_INTEREST_ONLY')
        AND ad_group_ad.status = 'ENABLED' AND campaign.status = 'ENABLED' AND ad_group.status = 'ENABLED'
      LIMIT 100`,
    assets: `
      SELECT ad_group_ad.ad.id, ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.performance_label,
        ad_group_ad_asset_view.pinned_field, asset.text_asset.text, campaign.name, ${METRICS}
      FROM ad_group_ad_asset_view
      WHERE ${dateFilter} AND ad_group_ad_asset_view.enabled = TRUE AND asset.type = 'TEXT' AND campaign.status != 'REMOVED'
      LIMIT 2000`,
    assetGroups: `
      SELECT asset_group.id, asset_group.name, asset_group.status, asset_group.ad_strength, campaign.name, ${METRICS}
      FROM asset_group
      WHERE ${dateFilter} AND asset_group.status != 'REMOVED' AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 100`,
    assetGroupCopy: `
      SELECT asset_group.id, asset_group_asset.field_type, asset.text_asset.text
      FROM asset_group_asset
      WHERE asset.type = 'TEXT' AND asset_group_asset.status = 'ENABLED' AND campaign.status != 'REMOVED'
      LIMIT 2000`,
    products: `
      SELECT segments.product_title, segments.product_item_id, segments.product_brand, ${METRICS}
      FROM shopping_performance_view
      WHERE ${dateFilter} AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 200`,
    landingPages: `
      SELECT landing_page_view.unexpanded_final_url, ${METRICS}
      FROM landing_page_view
      WHERE ${dateFilter} AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 100`,
  });

  // The same line often runs in many ads, so copy performance is merged by its text and slot.
  const assetMap = new Map<string, { row: Row; list: GMetrics[]; ads: Set<string>; bestImpr: number }>();
  for (const r of rows.assets) {
    const text = r.asset?.textAsset?.text;
    const field = r.adGroupAdAssetView?.fieldType ?? "";
    if (!text) continue;
    const key = `${field}|${text}`;
    const entry = assetMap.get(key) ?? { row: r, list: [], ads: new Set<string>(), bestImpr: -1 };
    const m = metricsOf(r);
    entry.list.push(m);
    entry.ads.add(String(r.adGroupAd?.ad?.id ?? ""));
    if (m.impressions > entry.bestImpr) { entry.bestImpr = m.impressions; entry.row = r; }
    assetMap.set(key, entry);
  }
  const assets: AssetRow[] = [...assetMap.values()]
    .map(e => ({
      text: e.row.asset?.textAsset?.text ?? "",
      field: e.row.adGroupAdAssetView?.fieldType ?? "",
      label: e.row.adGroupAdAssetView?.performanceLabel ?? "",
      pinned: e.row.adGroupAdAssetView?.pinnedField ?? "",
      adCount: e.ads.size,
      campaign: e.row.campaign?.name ?? "",
      ...sumMetrics(e.list),
    }))
    .sort((a, b) => b.spend - a.spend || b.impressions - a.impressions);

  const groupCopy = new Map<string, { headlines: string[]; longHeadlines: string[]; descriptions: string[] }>();
  for (const r of rows.assetGroupCopy) {
    const gid = String(r.assetGroup?.id ?? "");
    const text = r.asset?.textAsset?.text;
    if (!gid || !text) continue;
    const entry = groupCopy.get(gid) ?? { headlines: [], longHeadlines: [], descriptions: [] };
    const field = r.assetGroupAsset?.fieldType;
    if (field === "HEADLINE") entry.headlines.push(text);
    else if (field === "LONG_HEADLINE") entry.longHeadlines.push(text);
    else if (field === "DESCRIPTION") entry.descriptions.push(text);
    groupCopy.set(gid, entry);
  }

  return {
    errors,
    total,
    payload: {
      ads: rows.ads.map(adFromRow),
      disapproved: rows.disapproved.map(r => ({
        id: String(r.adGroupAd?.ad?.id ?? ""), type: r.adGroupAd?.ad?.type ?? "",
        approval: r.adGroupAd?.policySummary?.approvalStatus ?? "",
        topics: ((r.adGroupAd?.policySummary?.policyTopicEntries ?? []) as Row[]).map(t => String(t.topic ?? "")).filter(Boolean),
        campaign: r.campaign?.name ?? "", adGroup: r.adGroup?.name ?? "",
      })),
      assets,
      assetGroups: rows.assetGroups.map(r => {
        const g = r.assetGroup ?? {};
        const gid = String(g.id ?? "");
        return {
          id: gid, name: g.name ?? "", status: g.status ?? "", strength: g.adStrength ?? "", campaign: r.campaign?.name ?? "",
          ...(groupCopy.get(gid) ?? { headlines: [], longHeadlines: [], descriptions: [] }),
          ...metricsOf(r),
        };
      }),
      products: rows.products.map(r => ({
        title: r.segments?.productTitle ?? "Unknown product", itemId: r.segments?.productItemId ?? "",
        brand: r.segments?.productBrand ?? "", ...metricsOf(r),
      })),
      landingPages: rows.landingPages.map(r => ({ url: r.landingPageView?.unexpandedFinalUrl ?? "", ...metricsOf(r) })),
    },
  };
}

async function buildKeywords(token: string, id: string, dateFilter: string) {
  const { rows, errors, total } = await runQueries(token, id, {
    keywords: `
      SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
        ad_group_criterion.status, ad_group_criterion.quality_info.quality_score,
        ad_group_criterion.quality_info.creative_quality_score, ad_group_criterion.quality_info.post_click_quality_score,
        ad_group_criterion.quality_info.search_predicted_ctr, campaign.name, ad_group.name, ${METRICS},
        metrics.search_impression_share, metrics.search_rank_lost_impression_share
      FROM keyword_view
      WHERE ${dateFilter} AND campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED'
        AND ad_group_criterion.status != 'REMOVED' AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 500`,
    searchTerms: `
      SELECT search_term_view.search_term, search_term_view.status, campaign.name, ad_group.name, ${METRICS}
      FROM search_term_view
      WHERE ${dateFilter} AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 500`,
    pmaxTerms: `
      SELECT campaign_search_term_view.search_term, campaign.name, ${METRICS}
      FROM campaign_search_term_view
      WHERE ${dateFilter} AND campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 300`,
  });

  // One term can match in several ad groups, so it's merged into a single line per term.
  const termMap = new Map<string, { row: SearchTermRow; list: GMetrics[] }>();
  const addTerm = (term: string, source: "search" | "pmax", r: Row, status: string, adGroup: string) => {
    if (!term) return;
    const key = `${source}|${term.toLowerCase()}`;
    const entry = termMap.get(key) ?? {
      row: { term, status, campaign: r.campaign?.name ?? "", adGroup, source, ...metricsOf(r) },
      list: [] as GMetrics[],
    };
    entry.list.push(metricsOf(r));
    termMap.set(key, entry);
  };
  for (const r of rows.searchTerms) addTerm(r.searchTermView?.searchTerm ?? "", "search", r, r.searchTermView?.status ?? "", r.adGroup?.name ?? "");
  for (const r of rows.pmaxTerms) addTerm(r.campaignSearchTermView?.searchTerm ?? "", "pmax", r, "", "");

  return {
    errors,
    total,
    payload: {
      keywords: rows.keywords.map(r => {
        const c = r.adGroupCriterion ?? {};
        const q = c.qualityInfo ?? {};
        return {
          id: String(c.criterionId ?? ""), keyword: c.keyword?.text ?? "", matchType: c.keyword?.matchType ?? "",
          status: c.status ?? "", campaign: r.campaign?.name ?? "", adGroup: r.adGroup?.name ?? "",
          qs: q.qualityScore ? num(q.qualityScore) : null,
          adRelevance: q.creativeQualityScore ?? "", landingExp: q.postClickQualityScore ?? "", expectedCtr: q.searchPredictedCtr ?? "",
          searchIS: share(r.metrics?.searchImpressionShare), rankLost: share(r.metrics?.searchRankLostImpressionShare),
          ...metricsOf(r),
        };
      }),
      searchTerms: [...termMap.values()]
        .map(e => ({ ...e.row, ...sumMetrics(e.list) }))
        .sort((a, b) => b.spend - a.spend),
    },
  };
}

async function buildAudience(token: string, id: string, dateFilter: string) {
  const { rows, errors, total } = await runQueries(token, id, {
    devices: `SELECT segments.device, ${METRICS} FROM customer WHERE ${dateFilter}`,
    networks: `SELECT segments.ad_network_type, ${METRICS} FROM customer WHERE ${dateFilter}`,
    heat: `SELECT segments.day_of_week, segments.hour, ${METRICS} FROM campaign WHERE ${dateFilter} AND metrics.impressions > 0`,
    ages: `SELECT ad_group_criterion.age_range.type, ${METRICS} FROM age_range_view WHERE ${dateFilter} AND metrics.impressions > 0`,
    genders: `SELECT ad_group_criterion.gender.type, ${METRICS} FROM gender_view WHERE ${dateFilter} AND metrics.impressions > 0`,
    states: `
      SELECT segments.geo_target_state, ${METRICS}
      FROM user_location_view
      WHERE ${dateFilter} AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC
      LIMIT 300`,
  });

  // Google returns locations as ids, so names need one more lookup. Ids are checked before use.
  const stateIds = [...new Set(rows.states.map(r => String(r.segments?.geoTargetState ?? "")))].filter(s => /^geoTargetConstants\/\d+$/.test(s));
  const stateNames = new Map<string, string>();
  if (stateIds.length > 0) {
    const list = stateIds.slice(0, 200).map(s => `'${s}'`).join(", ");
    const lookup = await gadsSearchAll(token, id, `SELECT geo_target_constant.resource_name, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${list})`);
    for (const r of lookup.rows) {
      const g = r.geoTargetConstant ?? {};
      if (g.resourceName && g.name) stateNames.set(g.resourceName, g.name);
    }
  }

  const heatMap = new Map<string, { day: string; hour: number; list: GMetrics[] }>();
  for (const r of rows.heat) {
    const day = r.segments?.dayOfWeek ?? "";
    const hour = num(r.segments?.hour);
    if (!day) continue;
    const key = `${day}|${hour}`;
    const entry = heatMap.get(key) ?? { day, hour, list: [] as GMetrics[] };
    entry.list.push(metricsOf(r));
    heatMap.set(key, entry);
  }
  const heat: HeatRow[] = [...heatMap.values()].map(e => ({ day: e.day, hour: e.hour, ...sumMetrics(e.list) }));

  return {
    errors,
    total,
    payload: {
      devices: rollUp(rows.devices, r => r.segments?.device, k => (k === "CONNECTED_TV" ? "Connected TV" : titleCase(k))),
      networks: rollUp(rows.networks, r => r.segments?.adNetworkType, k => NETWORK_LABEL[k] ?? titleCase(k)),
      ages: rollUp(rows.ages, r => r.adGroupCriterion?.ageRange?.type, k => AGE_LABEL[k] ?? titleCase(k)),
      genders: rollUp(rows.genders, r => r.adGroupCriterion?.gender?.type, k => (k === "UNDETERMINED" ? "Unknown" : titleCase(k))),
      states: rollUp(rows.states, r => r.segments?.geoTargetState, k => stateNames.get(k) ?? "Unknown location"),
      heat,
    },
  };
}

export async function GET(req: NextRequest) {
  const shop = await getAuthorizedShop(req);
  if (!shop) return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  if (!DEV_TOKEN) return NextResponse.json({ error: "google_ads_dev_token_missing" }, { status: 503 });

  const refreshToken = await getGadsRefreshToken(req, shop);
  if (!refreshToken) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const customerId = await getGadsCustomerId(req, shop);
  if (!customerId) return NextResponse.json({ error: "no_customer_selected" }, { status: 400 });

  const params = req.nextUrl.searchParams;
  const section = params.get("section") as Section;
  if (!SECTIONS.includes(section)) return NextResponse.json({ error: "invalid_section" }, { status: 400 });

  // These values go into the query text, so only strict dates are accepted.
  const now = new Date();
  const from = params.get("from") ?? new Date(now.getTime() - 27 * 86_400_000).toISOString().split("T")[0];
  const to = params.get("to") ?? now.toISOString().split("T")[0];
  const isDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!isDate.test(from) || !isDate.test(to)) return NextResponse.json({ error: "invalid_dates" }, { status: 400 });

  const cacheKey = `cache:${shop}:gads-insights:v2:${customerId}:${section}:${from}:${to}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return NextResponse.json(cached);
  } catch { /* skip cache */ }

  try {
    const accessToken = await getGoogleAccessToken(refreshToken);
    const dateFilter = `segments.date BETWEEN '${from}' AND '${to}'`;

    // Account details rarely change, so a day's cache saves a query on every section.
    const metaKey = `cache:${shop}:gads-insights:v1:${customerId}:account`;
    let account: { account: string; currency: string; timeZone: string; optimizationScore: number | null } | null = null;
    try { account = await kv.get(metaKey); } catch { /* skip cache */ }
    if (!account) {
      const meta = await gadsSearchAll(accessToken, customerId, "SELECT customer.descriptive_name, customer.currency_code, customer.time_zone, customer.optimization_score FROM customer LIMIT 1");
      if (meta.error) {
        const { kind, reason, detail } = classifyGadsError(meta.error);
        return NextResponse.json({ error: kind, reason, detail }, { status: kind === "google_ads_api_error" ? 502 : 403 });
      }
      const c = meta.rows[0]?.customer ?? {};
      account = {
        account: c.descriptiveName ?? `Account ${customerId}`,
        currency: c.currencyCode ?? "",
        timeZone: c.timeZone ?? "",
        optimizationScore: c.optimizationScore === undefined ? null : num(c.optimizationScore) * 100,
      };
      kv.set(metaKey, account, { ex: META_CACHE_SECONDS }).catch(() => {});
    }

    const built =
      section === "overview" ? await buildOverview(accessToken, customerId, from, to, dateFilter)
      : section === "ads" ? await buildAds(accessToken, customerId, dateFilter)
      : section === "keywords" ? await buildKeywords(accessToken, customerId, dateFilter)
      : await buildAudience(accessToken, customerId, dateFilter);

    const failed = Object.entries(built.errors) as [string, GadsApiError][];
    const errors: Record<string, string> = {};
    for (const [name, err] of failed) errors[name] = classifyGadsError(err).detail;

    // Nothing came back at all: report Google's reason and don't cache it as an empty account.
    if (failed.length >= built.total) {
      const { kind, reason, detail } = classifyGadsError(failed[0][1]);
      return NextResponse.json({ error: kind, reason, detail }, { status: kind === "google_ads_api_error" ? 502 : 403 });
    }

    const result = { ...account, period: { from, to }, ...built.payload, errors };
    // A partial answer is retried sooner, so a brief Google error doesn't stick for half an hour.
    kv.set(cacheKey, result, { ex: failed.length > 0 ? PARTIAL_CACHE_SECONDS : CACHE_SECONDS }).catch(() => {});
    return NextResponse.json(result);
  } catch (e) {
    console.error("Google Ads insights error:", e);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
