import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getGoogleAccessToken, GADS_API, classifyGadsError, type GadsApiError } from "@/lib/google";
import { getGadsRefreshToken, getGadsCustomerId, getAuthorizedShop } from "@/lib/session";

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";

interface GadsRow {
  campaign?: { id?: string; name?: string; status?: string };
  adGroupCriterion?: { keyword?: { text?: string } };
  metrics?: {
    impressions?: string;
    clicks?: string;
    costMicros?: string;
    conversions?: string;
    conversionsValue?: string;
    ctr?: string;
    averageCpc?: string;
  };
  segments?: { date?: string };
  customer?: { descriptiveName?: string; currencyCode?: string };
}

interface GadsResponse {
  results?: GadsRow[];
  error?: GadsApiError;
}

async function gadsSearch(accessToken: string, customerId: string, query: string): Promise<GadsResponse> {
  const res = await fetch(
    `${GADS_API}/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": DEV_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  return res.json() as Promise<GadsResponse>;
}

const micros = (v?: string) => parseFloat(v ?? "0") / 1_000_000;
const num    = (v?: string) => parseFloat(v ?? "0");

export async function GET(req: NextRequest) {
  const shop = await getAuthorizedShop(req);
  if (!shop) return NextResponse.json({ error: "not_authorized" }, { status: 403 });

  if (!DEV_TOKEN) return NextResponse.json({ error: "google_ads_dev_token_missing" }, { status: 503 });

  const refreshToken = await getGadsRefreshToken(req, shop);
  if (!refreshToken) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const customerId = await getGadsCustomerId(req, shop);
  if (!customerId) return NextResponse.json({ error: "no_customer_selected" }, { status: 400 });

  const now = new Date();
  const defaultEnd   = now.toISOString().split("T")[0];
  const defaultStart = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const startDate = req.nextUrl.searchParams.get("from") ?? defaultStart;
  const endDate   = req.nextUrl.searchParams.get("to")   ?? defaultEnd;

  const cacheKey = `cache:${shop}:gads:${customerId}:${startDate}:${endDate}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return NextResponse.json(cached);
  } catch { /* skip cache */ }

  try {
    const accessToken = await getGoogleAccessToken(refreshToken);
    const dateFilter  = `segments.date BETWEEN '${startDate}' AND '${endDate}'`;

    const [overviewData, campaignData, dailyData, keywordData] = await Promise.allSettled([
      // Account-level overview totals
      gadsSearch(accessToken, customerId, `
        SELECT
          customer.descriptive_name,
          customer.currency_code,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.ctr,
          metrics.average_cpc
        FROM customer
        WHERE ${dateFilter}
      `),

      // Campaign breakdown
      gadsSearch(accessToken, customerId, `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.ctr,
          metrics.average_cpc
        FROM campaign
        WHERE ${dateFilter}
          AND campaign.status != 'REMOVED'
          AND metrics.impressions > 0
        ORDER BY metrics.cost_micros DESC
        LIMIT 20
      `),

      // Daily spend + conversions trend
      gadsSearch(accessToken, customerId, `
        SELECT
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value
        FROM customer
        WHERE ${dateFilter}
        ORDER BY segments.date ASC
      `),

      // Top keywords
      gadsSearch(accessToken, customerId, `
        SELECT
          ad_group_criterion.keyword.text,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.ctr,
          metrics.average_cpc
        FROM keyword_view
        WHERE ${dateFilter}
          AND campaign.status != 'REMOVED'
          AND ad_group.status != 'REMOVED'
          AND ad_group_criterion.status NOT IN ('REMOVED', 'PAUSED')
          AND metrics.impressions > 0
        ORDER BY metrics.clicks DESC
        LIMIT 20
      `),
    ]);

    const safe = <T>(r: PromiseSettledResult<T>): T | null =>
      r.status === "fulfilled" ? r.value : null;

    const overview  = safe(overviewData);
    const campaigns = safe(campaignData);
    const daily     = safe(dailyData);
    const keywords  = safe(keywordData);

    // Any API error (test token, API disabled, no account access, expired token, quota, version
    // sunset) must NOT fall through to summed zeros - that reads as a real "no spend" account and
    // would be cached for 15 min. Fail loudly with Google's actual reason instead.
    if (!overview || (overview as GadsResponse).error) {
      const err = (overview as GadsResponse | null)?.error;
      const { kind, reason, detail } = classifyGadsError(err ?? { message: "Google Ads overview query failed" });
      return NextResponse.json({ error: kind, reason, detail }, { status: kind === "google_ads_api_error" ? 502 : 403 });
    }

    // Overview aggregates (sum across all rows - customer query returns one row per date)
    let totalImpressions = 0, totalClicks = 0, totalCost = 0, totalConversions = 0, totalConvValue = 0;
    let accountName = `Account ${customerId}`, currency = "USD";

    for (const row of overview?.results ?? []) {
      totalImpressions  += num(row.metrics?.impressions);
      totalClicks       += num(row.metrics?.clicks);
      totalCost         += micros(row.metrics?.costMicros);
      totalConversions  += num(row.metrics?.conversions);
      totalConvValue    += num(row.metrics?.conversionsValue);
      if (row.customer?.descriptiveName) accountName = row.customer.descriptiveName;
      if (row.customer?.currencyCode)    currency    = row.customer.currencyCode;
    }

    const avgCpc  = totalClicks  > 0 ? totalCost / totalClicks  : 0;
    const ctr     = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const roas    = totalCost > 0 ? totalConvValue / totalCost : 0;
    const costPerConv = totalConversions > 0 ? totalCost / totalConversions : 0;

    const result = {
      account: accountName,
      currency,
      period: { startDate, endDate },
      kpis: {
        spend: +totalCost.toFixed(2),
        clicks: Math.round(totalClicks),
        impressions: Math.round(totalImpressions),
        conversions: +totalConversions.toFixed(1),
        conversionValue: +totalConvValue.toFixed(2),
        roas: +roas.toFixed(2),
        avgCpc: +avgCpc.toFixed(2),
        ctr: +ctr.toFixed(2),
        costPerConversion: +costPerConv.toFixed(2),
      },
      campaigns: (campaigns?.results ?? []).map(r => ({
        id:              r.campaign?.id ?? "",
        name:            r.campaign?.name ?? "Unknown",
        status:          r.campaign?.status ?? "UNKNOWN",
        impressions:     Math.round(num(r.metrics?.impressions)),
        clicks:          Math.round(num(r.metrics?.clicks)),
        spend:           +micros(r.metrics?.costMicros).toFixed(2),
        conversions:     +num(r.metrics?.conversions).toFixed(1),
        conversionValue: +num(r.metrics?.conversionsValue).toFixed(2),
        ctr:             +(num(r.metrics?.ctr) * 100).toFixed(2),
        avgCpc:          +micros(r.metrics?.averageCpc).toFixed(2),
        roas:            micros(r.metrics?.costMicros) > 0
          ? +(num(r.metrics?.conversionsValue) / micros(r.metrics?.costMicros)).toFixed(2)
          : 0,
      })),
      daily: (daily?.results ?? []).map(r => ({
        date:        r.segments?.date ?? "",
        impressions: Math.round(num(r.metrics?.impressions)),
        clicks:      Math.round(num(r.metrics?.clicks)),
        spend:       +micros(r.metrics?.costMicros).toFixed(2),
        conversions: +num(r.metrics?.conversions).toFixed(1),
        convValue:   +num(r.metrics?.conversionsValue).toFixed(2),
      })),
      keywords: (keywords?.results ?? []).map(r => ({
        keyword:     r.adGroupCriterion?.keyword?.text ?? "",
        impressions: Math.round(num(r.metrics?.impressions)),
        clicks:      Math.round(num(r.metrics?.clicks)),
        spend:       +micros(r.metrics?.costMicros).toFixed(2),
        conversions: +num(r.metrics?.conversions).toFixed(1),
        ctr:         +(num(r.metrics?.ctr) * 100).toFixed(2),
        avgCpc:      +micros(r.metrics?.averageCpc).toFixed(2),
      })),
    };

    kv.set(cacheKey, result, { ex: 900 }).catch(() => {});
    return NextResponse.json(result);
  } catch (e) {
    console.error("Google Ads data error:", e);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }
}
