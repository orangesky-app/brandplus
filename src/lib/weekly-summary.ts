import crypto from "crypto";
import { Resend } from "resend";
import { shopKv } from "@/lib/kv";
import { getValidToken, fetchOrdersInRange, getShopTimezone, orderRevenue, isCodGateway, shopifyFetch } from "@/lib/shopify";
import { daysAgoInTz, formatDateSpan, todayInTz, zonedDayStartISO } from "@/lib/timezone";
import { resolveMetaAccount, leadCount } from "@/lib/meta";
import { getGoogleAccessToken, GADS_API } from "@/lib/google";
import { buildPlainReport, reportText, type PlainReport, type PlainCampaign, type PlainGoogleCampaign } from "@/lib/plain-insights";
import { embeddedModeOn, shopAdminAppUrl } from "@/lib/embedded";
import { formatINR } from "@/lib/utils";
import { isEmbeddedEmail } from "@/lib/auth";

// Weekly plain-language summary: last 7 days vs the 7 before, run through the same
// buildPlainReport the Command Center Simple view uses, rendered as an email.

const APP_URL = process.env.SHOPIFY_APP_URL ?? "https://skylitee.io";

export function weeklySig(shop: string): string {
  return crypto.createHmac("sha256", process.env.SHOPIFY_CLIENT_SECRET ?? "")
    .update(`weekly-unsub:${shop}`).digest("hex").slice(0, 32);
}
export function verifyWeeklySig(shop: string, sig: string): boolean {
  const expected = weeklySig(shop);
  try { return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
  catch { return false; }
}

type ActionEntry = { action_type: string; value: string };
const actVal = (arr: ActionEntry[] | undefined, t: string) => parseFloat(arr?.find(a => a.action_type === t)?.value ?? "0");
const purchases = (a?: ActionEntry[]) => Math.round(Math.max(actVal(a, "offsite_conversion.fb_pixel_purchase"), actVal(a, "purchase")));
const purchaseValue = (a?: ActionEntry[]) => Math.max(actVal(a, "offsite_conversion.fb_pixel_purchase"), actVal(a, "purchase"));

export interface WeeklyResult { shop: string; report: PlainReport; email: string | null; storeName: string; dashboardUrl: string; period: { from: string; to: string } }

interface GadsRow {
  campaign?: { name?: string };
  customer?: { currencyCode?: string };
  metrics?: { clicks?: string; impressions?: string; costMicros?: string; conversions?: string; conversionsValue?: string };
}

// Google Ads for the same 7 days (best effort, like Meta). The email is in ₹, so an account
// billed in another currency stays out rather than being added to rupee totals.
async function fetchWeeklyGoogle(shop: string, from: string, to: string) {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const [refreshToken, customerId] = await Promise.all([shopKv.getGadsToken(shop), shopKv.getGadsCustomerId(shop)]);
  if (!devToken || !refreshToken || !customerId) return null;

  const accessToken = await getGoogleAccessToken(refreshToken);
  const search = (query: string) => fetch(`${GADS_API}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "developer-token": devToken, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  }).then(r => r.json() as Promise<{ results?: GadsRow[]; error?: unknown }>);

  const dates = `segments.date BETWEEN '${from}' AND '${to}'`;
  const fields = "metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions, metrics.conversions_value";
  const [totals, byCampaign] = await Promise.all([
    search(`SELECT customer.currency_code, ${fields} FROM customer WHERE ${dates}`),
    search(`SELECT campaign.name, ${fields} FROM campaign WHERE ${dates} AND campaign.status = 'ENABLED' AND metrics.cost_micros > 0 ORDER BY metrics.cost_micros DESC LIMIT 20`),
  ]);
  if (totals.error) return null;

  const n = (v?: string) => parseFloat(v ?? "0");
  const rows = totals.results ?? [];
  const sum = (pick: (m: NonNullable<GadsRow["metrics"]>) => string | undefined) => rows.reduce((t, r) => t + n(pick(r.metrics ?? {})), 0);
  const spend = sum(m => m.costMicros) / 1_000_000;
  if (spend <= 0 || rows.some(r => r.customer?.currencyCode !== "INR")) return null;

  const campaigns: PlainGoogleCampaign[] = byCampaign.error ? [] : (byCampaign.results ?? []).map(r => ({
    name: r.campaign?.name ?? "Campaign",
    spend: n(r.metrics?.costMicros) / 1_000_000,
    conversions: n(r.metrics?.conversions),
    conversionValue: n(r.metrics?.conversionsValue),
  }));
  return {
    kpis: { spend, conversionValue: sum(m => m.conversionsValue), conversions: sum(m => m.conversions), clicks: sum(m => m.clicks), impressions: sum(m => m.impressions) },
    campaigns,
  };
}

export async function buildWeekly(shop: string): Promise<WeeklyResult | null> {
  const token = await getValidToken(shop);
  if (!token) return null;
  const tz = await getShopTimezone(shop, token);
  const from = daysAgoInTz(tz, 6);
  const prevFrom = daysAgoInTz(tz, 13);
  const to = todayInTz(tz);
  const fromISO = zonedDayStartISO(from, tz);

  const [orders, shopInfo, metaToken, metaAcct, owner] = await Promise.all([
    fetchOrdersInRange(shop, token, zonedDayStartISO(prevFrom, tz)),
    shopifyFetch<{ shop?: { email?: string; name?: string } }>(shop, token, "/shop.json?fields=email,name").catch(() => ({ shop: undefined })),
    shopKv.getMetaToken(shop),
    shopKv.getMetaAccount(shop),
    shopKv.getOwner(shop),
  ]);

  // created_at carries the store's offset, so compare instants, not strings.
  const cutoff = new Date(fromISO).getTime();
  const cur = orders.filter(o => new Date(o.created_at).getTime() >= cutoff);
  const prev = orders.filter(o => new Date(o.created_at).getTime() < cutoff);
  const sales = cur.reduce((s, o) => s + orderRevenue(o), 0);
  const prevSales = prev.reduce((s, o) => s + orderRevenue(o), 0);
  const cod = cur.filter(o => isCodGateway(o.payment_gateway));
  const codRevenue = cod.reduce((s, o) => s + orderRevenue(o), 0);
  const customers = new Map<number, number>();
  for (const o of cur) if (o.customer?.id) customers.set(o.customer.id, o.customer.orders_count ?? 1);
  const returning = [...customers.values()].filter(n => n > 1).length;
  const newCustomers = customers.size - returning;

  // Meta (best effort - the email still goes out with store data alone).
  let meta: { spend: number; purchaseValue: number; leads: number; clicks: number; impressions: number; frequency: number } | null = null;
  let campaigns: PlainCampaign[] = [];
  if (metaToken) {
    try {
      const acct = await resolveMetaAccount(metaAcct, metaToken);
      if (acct) {
        const tr = encodeURIComponent(JSON.stringify({ since: from, until: to }));
        const aw = encodeURIComponent(JSON.stringify(["7d_click", "1d_view"]));
        const base = `https://graph.facebook.com/v19.0/${acct.id}/insights?time_range=${tr}&action_attribution_windows=${aw}&access_token=${metaToken}`;
        const [aRes, cRes] = await Promise.all([
          fetch(`${base}&fields=spend,impressions,inline_link_clicks,frequency,actions,action_values`),
          fetch(`${base}&level=campaign&limit=200&fields=campaign_name,objective,spend,impressions,inline_link_clicks,frequency,actions,action_values`),
        ]);
        type Row = { campaign_name?: string; objective?: string; spend?: string; impressions?: string; inline_link_clicks?: string; frequency?: string; actions?: ActionEntry[]; action_values?: ActionEntry[] };
        const a = (await aRes.json() as { data?: Row[] }).data?.[0];
        const c = (await cRes.json().catch(() => ({})) as { data?: Row[] }).data ?? [];
        meta = {
          spend: parseFloat(a?.spend ?? "0"), purchaseValue: purchaseValue(a?.action_values), leads: leadCount(a?.actions),
          clicks: parseFloat(a?.inline_link_clicks ?? "0"), impressions: parseFloat(a?.impressions ?? "0"), frequency: parseFloat(a?.frequency ?? "0"),
        };
        campaigns = c.map(r => ({
          name: r.campaign_name ?? "Campaign", objective: r.objective ?? "", spend: parseFloat(r.spend ?? "0"),
          purchases: purchases(r.actions), purchaseValue: purchaseValue(r.action_values), leads: leadCount(r.actions),
          clicks: parseFloat(r.inline_link_clicks ?? "0"), impressions: parseFloat(r.impressions ?? "0"), frequency: parseFloat(r.frequency ?? "0"),
        }));
      }
    } catch { /* skip Meta */ }
  }

  const google = await fetchWeeklyGoogle(shop, from, to).catch(() => null);

  const report = buildPlainReport({
    periodLabel: "the last 7 days",
    storeHandle: shop.replace(".myshopify.com", ""),
    shop: {
      sales, orders: cur.length, aov: cur.length ? sales / cur.length : 0, codOrders: cod.length,
      prepaidRevenue: sales - codRevenue, codRevenue, newCustomers,
    },
    salesChangePct: prevSales > 0 ? Math.round(((sales - prevSales) / prevSales) * 100) : undefined,
    repeatRate: customers.size >= 5 ? Math.round((returning / customers.size) * 100) : null,
    meta, campaigns,
    gads: google?.kpis ?? null,
    gadsCampaigns: google?.campaigns,
    gsc: null,
    connected: { meta: !!meta, google: true }, // Search Console isn't fetched here - don't nag about connecting it
    breakEvenRoas: null,
    costsSet: true,                             // cost model lives in the browser; skip the setup nudge
    rto: null,
  });
  // The Google tile is about free search, which this email doesn't fetch, so it's dropped.
  report.health = report.health.filter(h => h.area !== "Google");

  // Embedded installs have a pseudo-user owner with no inbox → use the store's contact email.
  const email = owner && owner.includes("@") && !isEmbeddedEmail(owner) ? owner : shopInfo.shop?.email ?? null;
  return {
    shop, report, email,
    storeName: shopInfo.shop?.name ?? shop.replace(".myshopify.com", ""),
    dashboardUrl: embeddedModeOn() ? shopAdminAppUrl(shop) : `${APP_URL}/dashboard`,
    period: { from, to },
  };
}

const weeklySpan = (w: WeeklyResult) => formatDateSpan(w.period.from, w.period.to);
export const weeklyText = (w: WeeklyResult) => reportText(w.report, `${w.storeName} - ${weeklySpan(w)}`);

export async function sendWeekly(w: WeeklyResult, to: string): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? "noreply@skylitee.io",
    to,
    subject: `${w.storeName}: your week in plain English (${weeklySpan(w)})`,
    html: weeklyHtml(w),
    text: `${weeklyText(w).replace(/\*/g, "")}\n\nOpen your dashboard: ${w.dashboardUrl}`,
  });
  if (error) throw new Error(error.message);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TILE = { good: ["#F0FDF4", "#16A34A", "Good"], warn: ["#FFFBEB", "#CA8A04", "Needs a look"], bad: ["#FEF2F2", "#DC2626", "Fix this"], off: ["#F5F5F4", "#A1A1AA", "No data"] } as const;

export function weeklyHtml(w: WeeklyResult): string {
  const unsub = `${APP_URL}/api/weekly-summary/unsubscribe?shop=${encodeURIComponent(w.shop)}&sig=${weeklySig(w.shop)}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(weeklyText(w))}`;
  const tiles = w.report.health.map(h => {
    const [bg, fg, word] = TILE[h.status];
    return `<tr><td style="padding:10px 12px;background:${bg};border-radius:10px">
      <div style="font-size:13px;color:#52525B"><b>${h.area}</b> · <span style="color:${fg};font-weight:700">${word}</span></div>
      <div style="font-size:16px;font-weight:800;color:#18181B;margin-top:2px">${esc(h.headline)}</div>
      <div style="font-size:13px;color:#52525B;margin-top:2px">${esc(h.line)}</div>
    </td></tr><tr><td style="height:8px"></td></tr>`;
  }).join("");
  const actions = w.report.actions.slice(0, 3).map((a, i) => `
    <tr><td style="padding:12px;border:1px solid #E7E5E4;border-radius:10px">
      <div style="font-size:15px;font-weight:800;color:#18181B">${i + 1}. ${esc(a.title)}</div>
      <div style="font-size:13px;color:#52525B;margin-top:4px;line-height:1.5">${esc(a.why)}</div>
      ${a.impact > 0 ? `<div style="font-size:13px;color:#15803D;font-weight:700;margin-top:6px">≈ ${formatINR(a.impact)} ${a.impactKind === "save" ? "you could save" : "you could earn"}</div>` : ""}
      ${a.link?.external ? `<a href="${esc(a.link.href)}" style="display:inline-block;margin-top:8px;font-size:13px;font-weight:700;color:#EA580C">${esc(a.link.label)} →</a>` : ""}
    </td></tr><tr><td style="height:8px"></td></tr>`).join("");

  return `<!doctype html><html><body style="margin:0;background:#FAFAF9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;padding:20px">
    <tr><td style="font-size:13px;color:#A1A1AA">Skylitee · weekly summary</td></tr>
    <tr><td style="font-size:20px;font-weight:800;color:#18181B;padding:4px 0 2px">${esc(w.storeName)} - your week in plain English</td></tr>
    <tr><td style="font-size:13px;color:#71717A;padding-bottom:12px">${esc(weeklySpan(w))}, compared with the 7 days before</td></tr>
    <tr><td style="font-size:15px;color:#18181B;line-height:1.6;padding:12px;background:#FFF7ED;border-radius:10px">${esc(w.report.summary)}</td></tr>
    <tr><td style="height:16px"></td></tr>
    <tr><td><table width="100%" cellpadding="0" cellspacing="0">${tiles}</table></td></tr>
    ${actions ? `<tr><td style="font-size:16px;font-weight:800;color:#18181B;padding:8px 0">Do these 3 things this week</td></tr>
    <tr><td><table width="100%" cellpadding="0" cellspacing="0">${actions}</table></td></tr>` : ""}
    <tr><td style="padding-top:8px">
      <a href="${esc(w.dashboardUrl)}" style="display:inline-block;background:#F97316;color:#fff;font-weight:700;font-size:14px;padding:10px 16px;border-radius:10px;text-decoration:none">Open your dashboard</a>
      &nbsp; <a href="${esc(wa)}" style="font-size:14px;font-weight:700;color:#15803D">Share on WhatsApp</a>
    </td></tr>
    <tr><td style="font-size:12px;color:#A1A1AA;padding-top:20px">Sent every Monday. <a href="${esc(unsub)}" style="color:#A1A1AA">Stop these emails</a></td></tr>
  </table></td></tr></table></body></html>`;
}
