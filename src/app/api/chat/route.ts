import Anthropic from "@anthropic-ai/sdk";
import { shopifyFetchAll, fetchOrdersInRange, orderRevenue, resolveShopifyPeriod, getShopTimezone, isCodGateway, ShopifyProduct } from "@/lib/shopify";
import { daysAgoInTz, formatDateSpan, todayInTz } from "@/lib/timezone";
import { NextRequest } from "next/server";
import { getShopifySession } from "@/lib/session";
import { shopKv } from "@/lib/kv";
import { getGoogleAccessToken, GADS_API, classifyGadsError, type GadsApiError } from "@/lib/google";
import { plainDashes } from "@/lib/utils";

const GADS_DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface Customer { orders_count: number; total_spent: string; }
interface MetaInsightRow {
  spend?: string; impressions?: string; clicks?: string; ctr?: string; cpc?: string;
  cpm?: string; reach?: string; frequency?: string; campaign_name?: string;
}
interface GscRow { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }
interface Ga4Row { dimensionValues: { value: string }[]; metricValues: { value: string }[] }

// ── Shopify ────────────────────────────────────────────────────────────────────

async function buildStoreContext(req: NextRequest): Promise<{ context: string; shop: string | null; tz: string }> {
  const session = await getShopifySession(req);
  if (!session) return { context: "No Shopify store connected.", shop: null, tz: "UTC" };
  const { shop, token } = session;
  const tz = await getShopTimezone(shop, token);

  try {
    // Month-to-date in the store's timezone: the server's clock is UTC and can be a day behind.
    const { startISO, startYmd, endYmd, days } = await resolveShopifyPeriod(shop, token, null, null);
    const [startY, startM] = startYmd.split("-").map(Number);
    const daysInMonth = new Date(startY, startM, 0).getDate();

    const [orders, products, customers] = await Promise.all([
      fetchOrdersInRange(shop, token, startISO),
      shopifyFetchAll<ShopifyProduct>(shop, token, "/products.json?limit=250&fields=id,title,variants", "products"),
      shopifyFetchAll<Customer>(shop, token, "/customers.json?limit=250&fields=id,orders_count,total_spent", "customers"),
    ]);

    const grossSales = Math.round(orders.reduce((s, o) => s + orderRevenue(o), 0));
    const totalOrders = orders.length;
    const aov = totalOrders ? Math.round(grossSales / totalOrders) : 0;
    const codOrders = orders.filter(o => isCodGateway(o.payment_gateway)).length;
    const codPct = totalOrders ? Math.round((codOrders / totalOrders) * 100) : 0;
    const totalCustomers = customers.length;
    const repeatCustomers = customers.filter(c => c.orders_count > 1).length;
    const repeatRate = totalCustomers ? Math.round((repeatCustomers / totalCustomers) * 100) : 0;
    const avgLTV = totalCustomers ? Math.round(customers.reduce((s, c) => s + parseFloat(c.total_spent), 0) / totalCustomers) : 0;
    const dailyAvg = days > 0 ? Math.round(grossSales / days) : 0;

    const productList = products.slice(0, 10).map(p => {
      const stock = p.variants.reduce((s, v) => s + (v.inventory_quantity || 0), 0);
      return `  - ${p.title}: stock ${stock}, price ₹${p.variants[0]?.price ?? "?"}`;
    }).join("\n");

    return {
      shop,
      tz,
      context: `
Store: ${shop} | Today: ${formatDateSpan(endYmd, endYmd)} (day ${days} of ${daysInMonth})
Revenue this month (${formatDateSpan(startYmd, endYmd)}): ₹${grossSales} | Orders: ${totalOrders} | AOV: ₹${aov}
Daily avg: ₹${dailyAvg} → projected ₹${dailyAvg * daysInMonth}/month
COD: ${codPct}% (${codOrders}/${totalOrders} orders)
Customers: ${totalCustomers} total | Repeat rate: ${repeatRate}% | Avg LTV: ₹${avgLTV}
Top products:
${productList}
`.trim(),
    };
  } catch {
    return { context: "Could not load Shopify data at this time.", shop, tz };
  }
}

// ── Meta Ads ──────────────────────────────────────────────────────────────────

async function buildMetaContext(_req: NextRequest, shop: string, tz: string): Promise<string> {
  const token = await shopKv.getMetaToken(shop);
  if (!token) return "Meta Ads: not connected.";

  try {
    const accountsRes = await fetch(`https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,currency&access_token=${token}`);
    const accountsData = await accountsRes.json() as { data?: { id: string; name: string; currency: string }[]; error?: { message: string } };
    if (accountsData.error || !accountsData.data?.length) return "Meta Ads: token error or no accounts.";

    const savedAccount = await shopKv.getMetaAccount(shop);
    const account = (savedAccount && accountsData.data.find(a => a.id === savedAccount))
      || (accountsData.data.length === 1 ? accountsData.data[0] : null);
    if (!account) return "Meta Ads: no ad account selected yet.";
    const cur = account.currency === "INR" ? "₹" : account.currency === "USD" ? "$" : account.currency + " ";

    const to = todayInTz(tz);
    const from = daysAgoInTz(tz, 27);
    const timeRange = encodeURIComponent(JSON.stringify({ since: from, until: to }));

    const [overviewRes, campaignRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v19.0/${account.id}/insights?fields=spend,impressions,clicks,ctr,cpc,cpm,reach,frequency&time_range=${timeRange}&access_token=${token}`),
      fetch(`https://graph.facebook.com/v19.0/${account.id}/insights?fields=campaign_name,spend,impressions,clicks,ctr&time_range=${timeRange}&level=campaign&limit=5&access_token=${token}`),
    ]);
    const [overviewData, campaignData] = await Promise.all([
      overviewRes.json() as Promise<{ data?: MetaInsightRow[] }>,
      campaignRes.json() as Promise<{ data?: MetaInsightRow[] }>,
    ]);

    const o = overviewData.data?.[0];
    const topCampaigns = (campaignData.data ?? []).slice(0, 5).map(c =>
      `  - ${c.campaign_name}: spend ${cur}${parseFloat(c.spend ?? "0").toFixed(2)}, CTR ${parseFloat(c.ctr ?? "0").toFixed(2)}%`
    ).join("\n");

    return `
Meta Ads (last 28 days, ${formatDateSpan(from, to)} · ${account.name}):
Spend: ${cur}${parseFloat(o?.spend ?? "0").toFixed(2)} | Impressions: ${parseInt(o?.impressions ?? "0").toLocaleString()}
Clicks: ${parseInt(o?.clicks ?? "0").toLocaleString()} | CTR: ${parseFloat(o?.ctr ?? "0").toFixed(2)}%
CPC: ${cur}${parseFloat(o?.cpc ?? "0").toFixed(2)} | CPM: ${cur}${parseFloat(o?.cpm ?? "0").toFixed(2)}
Reach: ${parseInt(o?.reach ?? "0").toLocaleString()} | Frequency: ${parseFloat(o?.frequency ?? "0").toFixed(2)}x
Top campaigns:
${topCampaigns || "  No campaign data"}
`.trim();
  } catch {
    return "Meta Ads: could not load data.";
  }
}

// ── Google Search Console ─────────────────────────────────────────────────────

async function buildGscContext(shop: string): Promise<string> {
  try {
    const refreshToken = await shopKv.getGscToken(shop);
    if (!refreshToken) return "Google Search Console: not connected.";
    const siteUrl = await shopKv.getGscSite(shop);
    if (!siteUrl) return "Google Search Console: connected but no site selected.";

    const token = await getGoogleAccessToken(refreshToken);
    // Search Console runs on Pacific time and finalises about 3 days late, same window as /api/gsc.
    const PT = "America/Los_Angeles";
    const endDate = daysAgoInTz(PT, 3);
    const startDate = daysAgoInTz(PT, 30);

    const query = (extra: object) =>
      fetch(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ startDate, endDate, ...extra }),
        }
      ).then(r => r.json() as Promise<{ rows?: GscRow[] }>);

    const [totalsData, keywordsData] = await Promise.all([
      query({ rowLimit: 1 }),
      query({ dimensions: ["query"], rowLimit: 10 }),
    ]);

    const t = totalsData.rows?.[0];
    if (!t) return `Google Search Console (${siteUrl}): no data for this period.`;

    const topKeywords = ((keywordsData.rows ?? []) as (GscRow & { keys: string[] })[])
      .slice(0, 5)
      .map(r => `  - "${r.keys[0]}": ${r.clicks} clicks, pos ${r.position.toFixed(1)}`)
      .join("\n");

    return `
Google Search Console (${formatDateSpan(startDate, endDate)}, Google shares this data about 3 days late · ${siteUrl}):
Clicks: ${t.clicks} | Impressions: ${t.impressions}
CTR: ${(t.ctr * 100).toFixed(2)}% | Avg position: ${t.position.toFixed(1)}
Top keywords:
${topKeywords || "  No keyword data"}
`.trim();
  } catch {
    return "Google Search Console: could not load data.";
  }
}

// ── Google Analytics 4 ────────────────────────────────────────────────────────

async function buildGa4Context(shop: string, tz: string): Promise<string> {
  try {
    const refreshToken = await shopKv.getGa4Token(shop);
    if (!refreshToken) return "Google Analytics 4: not connected.";
    const propertyId = await shopKv.getGa4Property(shop);
    if (!propertyId) return "Google Analytics 4: connected but no property selected.";

    const token = await getGoogleAccessToken(refreshToken);
    const endDate = todayInTz(tz);
    const startDate = daysAgoInTz(tz, 27);

    const runReport = (dimensions: { name: string }[], metrics: { name: string }[], limit = 10) =>
      fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ dateRanges: [{ startDate, endDate }], dimensions, metrics, limit }),
      }).then(r => r.json() as Promise<{ rows?: Ga4Row[] }>);

    const [overviewData, sourcesData] = await Promise.all([
      runReport([], [
        { name: "sessions" }, { name: "totalUsers" }, { name: "newUsers" },
        { name: "bounceRate" }, { name: "averageSessionDuration" },
      ], 1),
      runReport([{ name: "sessionDefaultChannelGroup" }], [{ name: "sessions" }], 5),
    ]);

    const row = overviewData.rows?.[0];
    if (!row) return `Google Analytics 4 (${propertyId}): no data for this period.`;

    const [sessions, users, newUsers, bounceRate, avgDuration] = row.metricValues.map(m => m.value);
    const dur = parseFloat(avgDuration);
    const mins = Math.floor(dur / 60);
    const secs = Math.round(dur % 60);

    const topSources = (sourcesData.rows ?? []).slice(0, 5)
      .map(r => `  - ${r.dimensionValues[0].value}: ${parseInt(r.metricValues[0].value).toLocaleString()} sessions`)
      .join("\n");

    return `
Google Analytics 4 (last 28 days, ${formatDateSpan(startDate, endDate)}):
Sessions: ${parseInt(sessions).toLocaleString()} | Users: ${parseInt(users).toLocaleString()}
New users: ${parseInt(newUsers).toLocaleString()} | Bounce rate: ${(parseFloat(bounceRate) * 100).toFixed(1)}%
Avg session: ${mins}m ${secs}s
Traffic channels:
${topSources || "  No source data"}
`.trim();
  } catch {
    return "Google Analytics 4: could not load data.";
  }
}

// ── Google Ads ────────────────────────────────────────────────────────────────

async function buildGadsContext(shop: string, tz: string): Promise<string> {
  try {
    const refreshToken = await shopKv.getGadsToken(shop);
    if (!refreshToken) return "Google Ads: not connected.";
    const customerId = await shopKv.getGadsCustomerId(shop);
    if (!customerId) return "Google Ads: connected but no account selected.";
    if (!GADS_DEV_TOKEN) return "Google Ads: not configured.";

    const accessToken = await getGoogleAccessToken(refreshToken);
    const endDate   = todayInTz(tz);
    const startDate = daysAgoInTz(tz, 27);

    const res = await fetch(
      `${GADS_API}/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": GADS_DEV_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `
            SELECT customer.currency_code, metrics.impressions, metrics.clicks, metrics.cost_micros,
                   metrics.conversions, metrics.conversions_value, metrics.ctr
            FROM customer
            WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
          `,
        }),
      }
    );
    const data = await res.json() as {
      results?: { customer?: { currencyCode?: string }; metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: string; conversionsValue?: string; ctr?: string } }[];
      error?: GadsApiError;
    };

    if (data.error) {
      const { kind, reason, detail } = classifyGadsError(data.error);
      return kind === "test_token"
        ? "Google Ads: connected but developer token pending production approval."
        : `Google Ads: connected but data could not be loaded (${reason ?? detail}).`;
    }

    let totalImpressions = 0, totalClicks = 0, totalCost = 0, totalConversions = 0, totalConvValue = 0;
    for (const row of data.results ?? []) {
      totalImpressions  += parseFloat(row.metrics?.impressions  ?? "0");
      totalClicks       += parseFloat(row.metrics?.clicks       ?? "0");
      totalCost         += parseFloat(row.metrics?.costMicros   ?? "0") / 1_000_000;
      totalConversions  += parseFloat(row.metrics?.conversions  ?? "0");
      totalConvValue    += parseFloat(row.metrics?.conversionsValue ?? "0");
    }
    if (totalImpressions === 0 && totalClicks === 0) return "Google Ads: connected but no data for this period.";

    const roas = totalCost > 0 ? (totalConvValue / totalCost).toFixed(2) : "0.00";
    const ctr  = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : "0.00";
    const code = data.results?.find(r => r.customer?.currencyCode)?.customer?.currencyCode ?? "INR";
    const cur  = code === "INR" ? "₹" : code === "USD" ? "$" : code + " ";

    return `
Google Ads (last 28 days, ${formatDateSpan(startDate, endDate)} · Account ${customerId}):
Spend: ${cur}${totalCost.toFixed(2)} | Impressions: ${Math.round(totalImpressions).toLocaleString()}
Clicks: ${Math.round(totalClicks).toLocaleString()} | CTR: ${ctr}%
Conversions: ${totalConversions.toFixed(1)} | Conv. Value: ${cur}${totalConvValue.toFixed(2)} | ROAS: ${roas}x
`.trim();
  } catch {
    return "Google Ads: could not load data.";
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    const { context: storeContext, shop, tz } = await buildStoreContext(req);

    const [metaContext, gscContext, ga4Context, gadsContext] = await Promise.all([
      shop ? buildMetaContext(req, shop, tz) : Promise.resolve("Meta Ads: not connected."),
      shop ? buildGscContext(shop)           : Promise.resolve("Google Search Console: not connected."),
      shop ? buildGa4Context(shop, tz)       : Promise.resolve("Google Analytics 4: not connected."),
      shop ? buildGadsContext(shop, tz)      : Promise.resolve("Google Ads: not connected."),
    ]);

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `You are Skylitee AI, an expert D2C ecommerce analytics assistant.
You have real-time access to the brand's store data across all connected platforms.

SHOPIFY DATA:
${storeContext}

META ADS DATA:
${metaContext}

GOOGLE SEARCH CONSOLE DATA:
${gscContext}

GOOGLE ANALYTICS 4 DATA:
${ga4Context}

GOOGLE ADS DATA:
${gadsContext}

Rules:
- Give specific, numbers-based answers using ONLY the data above
- Each section above covers its own dates. When you quote a number, say which dates it covers, and never add numbers from sections with different dates without saying so
- Use the currency shown in each section (₹ for Indian accounts)
- Format action items as numbered lists
- Keep responses under 300 words unless deep analysis is requested
- Never say a platform is "not connected" if its data section above has real numbers`,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const content = response.content[0];
    if (content.type !== "text") return Response.json({ error: "Unexpected response type" }, { status: 500 });
    return Response.json({ reply: plainDashes(content.text), shop: shop ?? "your store" });
  } catch (error) {
    console.error("Chat API error:", error);
    return Response.json({ error: "Failed to get AI response" }, { status: 500 });
  }
}
