import { shopKv, type ShopifyToken } from "@/lib/kv";
import { startOfMonthInTz, todayInTz, zonedDayStartISO, zonedDayEndISO, dayCount } from "@/lib/timezone";

// Shopify releases API versions quarterly. Update when Shopify deprecates this version.
const API_VERSION = "2025-04";

export function shopifyApiUrl(shop: string, path: string) {
  return `https://${shop}/admin/api/${API_VERSION}${path}`;
}

// Shopify rotating offline tokens: when a token is rotated, the response includes
// X-Shopify-Access-Token-Next. We must persist it immediately or future calls will fail.
// Merge into the existing record so any refresh-token/expiry metadata is preserved.
function rotateTokenIfNeeded(shop: string, res: Response) {
  const next = res.headers.get("X-Shopify-Access-Token-Next");
  if (!next) return;
  shopKv.getTokenRecord(shop)
    .then(rec => shopKv.setTokenRecord(shop, { ...(rec ?? {}), access_token: next }))
    .catch(() => {});
}

export async function shopifyFetch<T = unknown>(
  shop: string,
  accessToken: string,
  path: string
): Promise<T> {
  const res = await fetch(shopifyApiUrl(shop, path), {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    next: { revalidate: 120 },
  });
  rotateTokenIfNeeded(shop, res);
  if (!res.ok) throw new Error(`Shopify API ${res.status}: ${path}`);
  return res.json();
}

// Parse the `next` URL out of Shopify's cursor-pagination Link header.
// Format: <https://…?page_info=…>; rel="previous", <https://…?page_info=…>; rel="next"
function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

// Follows Shopify cursor pagination (Link header) and returns every page concatenated.
// `path` is the first-page path (include limit + fields); subsequent pages follow the
// full URL Shopify returns in the Link header. `key` is the JSON array key, e.g. "customers".
// maxPages bounds the loop (100 × 250 = 25,000 records) so a huge store can't hang the request.
export async function shopifyFetchAll<T = unknown>(
  shop: string,
  accessToken: string,
  path: string,
  key: string,
  maxPages = 100
): Promise<T[]> {
  let url: string | null = shopifyApiUrl(shop, path);
  const all: T[] = [];
  for (let page = 0; page < maxPages && url; page++) {
    let res: Response | null = null;
    // Parallel windows can briefly exceed Shopify's REST bucket → back off on 429 and retry.
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        next: { revalidate: 120 },
      });
      if (res.status !== 429) break;
      const wait = parseFloat(res.headers.get("Retry-After") ?? "") || 1 + attempt;
      await new Promise(r => setTimeout(r, wait * 1000));
    }
    if (!res) break;
    rotateTokenIfNeeded(shop, res);
    if (!res.ok) throw new Error(`Shopify API ${res.status}: ${path}`);
    const json = (await res.json()) as Record<string, T[]>;
    all.push(...(json[key] ?? []));
    url = parseNextLink(res.headers.get("Link"));
  }
  return all;
}

export async function shopifyPost<T = unknown>(
  shop: string,
  accessToken: string,
  path: string,
  body: unknown
): Promise<T> {
  const res = await fetch(shopifyApiUrl(shop, path), {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  rotateTokenIfNeeded(shop, res);
  if (!res.ok) throw new Error(`Shopify API ${res.status}: ${path}`);
  return res.json();
}

export async function shopifyDelete(
  shop: string,
  accessToken: string,
  path: string
): Promise<boolean> {
  const res = await fetch(shopifyApiUrl(shop, path), {
    method: "DELETE",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });
  rotateTokenIfNeeded(shop, res);
  // 200/404 both mean "no longer active" - treat as success.
  return res.ok || res.status === 404;
}

// Subscribe this shop to the app/uninstalled webhook (GraphQL). Safe to call repeatedly:
// an existing subscription to the same address comes back as a "taken" user error, which
// counts as success.
export async function registerUninstallWebhook(shop: string, accessToken: string): Promise<{ ok: boolean; detail?: string }> {
  const appUrl = process.env.SHOPIFY_APP_URL ?? "https://skylitee.io";
  const res = await fetch(shopifyApiUrl(shop, "/graphql.json"), {
    method: "POST",
    headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
          webhookSubscription { id }
          userErrors { message }
        }
      }`,
      variables: { topic: "APP_UNINSTALLED", sub: { uri: `${appUrl}/api/webhooks/app/uninstalled` } },
    }),
    signal: AbortSignal.timeout(5000),   // never hold up the install redirect
  });
  rotateTokenIfNeeded(shop, res);
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
  const json = await res.json() as {
    data?: { webhookSubscriptionCreate?: { webhookSubscription?: { id: string } | null; userErrors?: { message: string }[] } };
    errors?: { message: string }[];
  };
  if (json.errors?.length) return { ok: false, detail: json.errors[0].message };
  const errs = json.data?.webhookSubscriptionCreate?.userErrors ?? [];
  if (errs.length === 0 || errs.every(e => /taken|already/i.test(e.message))) return { ok: true };
  return { ok: false, detail: errs[0].message };
}

export function buildAuthUrl(shop: string, state: string): string {
  const appUrl = process.env.SHOPIFY_APP_URL!;
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_CLIENT_ID!,
    scope: process.env.SHOPIFY_SCOPES!,
    redirect_uri: `${appUrl}/api/auth/callback`,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params}`;
}

// ── Offline access tokens: expiring-token acquisition, refresh & legacy migration ───────────
// Shopify is retiring permanent offline tokens. Public apps must use EXPIRING offline tokens by
// 2027-01-01: a ~1h access token plus a 90-day refresh token. We request them with `expiring=1`,
// refresh via grant_type=refresh_token, and migrate any legacy permanent token in-code (token
// exchange) - no merchant reinstall needed. See getValidToken below for the resolution flow.

interface ShopifyTokenResponse {
  access_token: string;
  expires_in?: number;                // seconds; present only for expiring tokens
  refresh_token?: string;
  refresh_token_expires_in?: number;  // seconds (90 days)
  scope?: string;
}

// Turn Shopify's OAuth response into a stored record with ABSOLUTE expiry timestamps.
function toTokenRecord(data: ShopifyTokenResponse): ShopifyToken {
  const now = Date.now();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? now + data.expires_in * 1000 : undefined,
    refresh_token_expires_at: data.refresh_token_expires_in ? now + data.refresh_token_expires_in * 1000 : undefined,
    scope: data.scope,
  };
}

async function postOAuth(shop: string, body: Record<string, unknown>): Promise<ShopifyTokenResponse> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Shopify OAuth ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return res.json() as Promise<ShopifyTokenResponse>;
}

// Authorization-code grant → request an EXPIRING offline token (expiring=1). New installs get
// expiring tokens straight away. Returns the record to persist (via shopKv.setTokenRecord).
export async function exchangeCodeForToken(shop: string, code: string): Promise<ShopifyToken> {
  const data = await postOAuth(shop, {
    client_id: process.env.SHOPIFY_CLIENT_ID,
    client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    code,
    expiring: 1,
  });
  return toTokenRecord(data);
}

// Migrate a legacy permanent offline token to an expiring one via token exchange, using the
// permanent token itself as the subject (no merchant reinstall). The old token is REVOKED on
// success (irreversible), so we persist the new record before returning it.
async function migrateLegacyToken(shop: string, legacy: string): Promise<ShopifyToken> {
  const data = await postOAuth(shop, {
    client_id: process.env.SHOPIFY_CLIENT_ID,
    client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: legacy,
    subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
    expiring: 1,
  });
  const rec = toTokenRecord(data);
  await shopKv.setTokenRecord(shop, rec);
  return rec;
}

// Refresh an expiring offline token (grant_type=refresh_token). Persists and returns the new
// record (Shopify rotates the refresh token too, resetting its 90-day window).
async function refreshExpiringToken(shop: string, refreshToken: string): Promise<ShopifyToken> {
  const data = await postOAuth(shop, {
    client_id: process.env.SHOPIFY_CLIENT_ID,
    client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const rec = toTokenRecord(data);
  await shopKv.setTokenRecord(shop, rec);
  return rec;
}

// Diagnostic wrapper for the admin migration sweep: migrate one shop's legacy token and report
// exactly what happened (with the Shopify error text on failure - e.g. a 400 "invalid subject
// token" means the store uninstalled/revoked the app, so there's nothing left to migrate).
export type MigrateStatus = "migrated" | "already_expiring" | "no_token" | "failed";
export async function migrateShopToken(shop: string): Promise<{ status: MigrateStatus; detail?: string }> {
  const rec = await shopKv.getTokenRecord(shop);
  if (!rec) return { status: "no_token" };
  if (rec.expires_at || rec.refresh_token) return { status: "already_expiring" };
  try {
    await migrateLegacyToken(shop, rec.access_token);
    return { status: "migrated" };
  } catch (e) {
    return { status: "failed", detail: e instanceof Error ? e.message : String(e) };
  }
}

// Refresh a little early so a token doesn't expire mid-request.
const TOKEN_EXPIRY_BUFFER_MS = 2 * 60 * 1000;

// Resolve a VALID Shopify access token for a shop, handling the expiring-token lifecycle:
//   • legacy permanent token (no expiry/refresh)  → migrate once via token exchange, then use it
//   • expiring token still comfortably valid       → use as-is
//   • expiring token expired / near expiry         → refresh
// On a failed migrate/refresh, re-reads KV once (a concurrent request may have already rotated
// it). Use this everywhere instead of shopKv.getToken so every Shopify call uses a fresh token.
export async function getValidToken(shop: string): Promise<string | null> {
  const rec = await shopKv.getTokenRecord(shop);
  if (!rec) return null;

  // Legacy permanent token → migrate to expiring. Fall back to the old token if migration fails
  // (still valid until the 2027-01-01 cutoff), so a transient error never breaks the dashboard.
  if (!rec.expires_at && !rec.refresh_token) {
    try {
      return (await migrateLegacyToken(shop, rec.access_token)).access_token;
    } catch {
      return (await shopKv.getTokenRecord(shop))?.access_token ?? rec.access_token;
    }
  }

  // Expiring token still valid.
  if (rec.expires_at && Date.now() < rec.expires_at - TOKEN_EXPIRY_BUFFER_MS) {
    return rec.access_token;
  }

  // Expired / near expiry → refresh.
  if (rec.refresh_token) {
    try {
      return (await refreshExpiringToken(shop, rec.refresh_token)).access_token;
    } catch {
      return (await shopKv.getTokenRecord(shop))?.access_token ?? null;
    }
  }

  return rec.access_token;
}

// ── Data helpers ────────────────────────────────────────────────────────────

export interface ShopifyOrder {
  id: number;
  name?: string;
  total_price: string;
  current_total_price?: string;   // live order total - reflects refunds & edits (matches Shopify "Total sales")
  subtotal_price: string;
  total_discounts: string;
  created_at: string;
  cancelled_at?: string | null;
  test?: boolean;
  financial_status: string;
  fulfillment_status: string | null;
  payment_gateway: string;
  customer?: { id: number; orders_count: number; total_spent: string };
  line_items: { id?: number; product_id: number; variant_id?: number | null; title: string; quantity: number; price: string; total_discount?: string; gift_card?: boolean }[];
  shipping_address?: { city: string; province: string };
  // Only present when requested via the `fields` argument of fetchOrdersInRange.
  tags?: string;
  cancel_reason?: string | null;
  discount_codes?: { code: string; amount: string; type: string }[];
  refunds?: { refund_line_items?: { line_item_id: number; quantity: number; restock_type?: string }[] }[];
}

// Field set covering every Shopify route. Must include cancelled_at/test/financial_status
// (for filtering) and current_total_price (for refund-aware revenue) or the helpers below break.
export const ORDER_FIELDS =
  "id,name,total_price,current_total_price,subtotal_price,total_discounts,created_at,cancelled_at,test,financial_status,fulfillment_status,payment_gateway,customer,line_items,shipping_address";

// A real, counted sale: Shopify excludes test orders, cancelled orders, and voided ones
// from its sales reports - so we must too, or our totals run higher than the admin.
export function isRealOrder(o: ShopifyOrder): boolean {
  return !o.cancelled_at && !o.test && o.financial_status !== "voided";
}

// Order revenue matching Shopify "Total sales": current_total_price stays in sync as the
// order is refunded or edited; total_price is the frozen creation-time value (ignores refunds).
export function orderRevenue(o: ShopifyOrder): number {
  return parseFloat(o.current_total_price ?? o.total_price ?? "0");
}

// Recognise a Cash-on-Delivery order from its payment-gateway label. Covers the common
// Shopify and 3rd-party checkout labels (COD, Cash on Delivery, Pay on Delivery). Centralised
// so every route classifies COD identically - if a store's checkout app (GoKwik / Shiprocket /
// Razorpay) uses a custom COD label, add the token here once.
export function isCodGateway(gateway?: string | null): boolean {
  const g = (gateway ?? "").toLowerCase();
  return g.includes("cod") || g.includes("cash") || g.includes("pay on delivery") || g.includes("pay-on-delivery") || g.includes("payondelivery");
}

// Fetch EVERY real order in a window (paginated past the 250/page limit, test/cancelled/
// voided filtered out). `fromISO` required; `toISO` optional. Use this everywhere instead of
// a one-page shopifyFetch so stores with >250 orders aren't silently undercounted.
export async function fetchOrdersInRange(
  shop: string,
  accessToken: string,
  fromISO: string,
  toISO?: string,
  // Override the field list (keep cancelled_at,test,financial_status - isRealOrder needs them).
  fields: string = ORDER_FIELDS,
  // true = keep cancelled/voided orders too (still drops test orders) - for COD failure analysis.
  includeCancelled = false,
): Promise<ShopifyOrder[]> {
  // Speed: cursor pagination is strictly sequential (~1s per 250-order page), so a busy month
  // took many round-trips in a row. Split the range into date windows and page through them
  // IN PARALLEL - same orders, a fraction of the wall-clock time.
  const startMs = new Date(fromISO).getTime();
  const endMs = toISO ? new Date(toISO).getTime() : Date.now();
  const spanDays = Math.max(1, (endMs - startMs) / 86_400_000);
  const windows = Math.min(MAX_ORDER_WINDOWS, Math.max(1, Math.ceil(spanDays / 5)));
  const step = (endMs - startMs) / windows;

  const chunks = await Promise.all(Array.from({ length: windows }, (_, i) => {
    const wFrom = new Date(startMs + step * i).toISOString();
    // Last window keeps the caller's open end (no max) so "through now" stays live.
    const wTo = i === windows - 1 ? toISO : new Date(startMs + step * (i + 1)).toISOString();
    const max = wTo ? `&created_at_max=${encodeURIComponent(wTo)}` : "";
    const path = `/orders.json?status=any&created_at_min=${encodeURIComponent(wFrom)}${max}&limit=250&fields=${fields}`;
    return shopifyFetchAll<ShopifyOrder>(shop, accessToken, path, "orders", 100);
  }));

  // Window edges are inclusive on both sides → de-dupe an order created exactly on a boundary.
  const seen = new Set<number>();
  const orders: ShopifyOrder[] = [];
  for (const o of chunks.flat()) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    orders.push(o);
  }
  return includeCancelled ? orders.filter(o => !o.test) : orders.filter(isRealOrder);
}

// Concurrent order windows per request. Shopify's REST bucket is 40 requests (refilling 2/s),
// and a page can fire 2–3 Shopify routes at once - 6 keeps us well inside it.
const MAX_ORDER_WINDOWS = 6;

// The store's IANA timezone (e.g. "Asia/Kolkata"), cached. Shopify reports sales by the
// store's local day, so we need this to build matching date-range boundaries. Falls back to
// UTC if unavailable.
export async function getShopTimezone(shop: string, accessToken: string): Promise<string> {
  const cached = await shopKv.getTz(shop);
  if (cached) return cached;
  try {
    const data = await shopifyFetch<{ shop?: { iana_timezone?: string } }>(shop, accessToken, "/shop.json?fields=iana_timezone");
    const tz = data.shop?.iana_timezone || "UTC";
    shopKv.setTz(shop, tz).catch(() => {});
    return tz;
  } catch { return "UTC"; }
}

// Resolve a reporting period in the STORE's timezone so created_at boundaries and the day
// count line up with the Shopify admin. `fromParam`/`toParam` are YYYY-MM-DD (or null →
// month-to-date). Returns absolute ISO instants for the Shopify query plus the store tz.
export async function resolveShopifyPeriod(
  shop: string,
  accessToken: string,
  fromParam: string | null,
  toParam: string | null,
): Promise<{ startISO: string; endISO: string; startYmd: string; endYmd: string; days: number; tz: string }> {
  const tz = await getShopTimezone(shop, accessToken);
  const startYmd = fromParam || startOfMonthInTz(tz);
  const endYmd = toParam || todayInTz(tz);
  const startISO = zonedDayStartISO(startYmd, tz);
  // Open-ended through "now" when the period runs to today; otherwise local end-of-day.
  const endISO = toParam ? zonedDayEndISO(toParam, tz) : new Date().toISOString();
  return { startISO, endISO, startYmd, endYmd, days: dayCount(startYmd, endYmd), tz };
}

// "Cost per item" the merchant entered in Shopify for each variant (InventoryItem.unitCost).
// Returns variantId → cost; variants with no cost set are simply absent. Needs read_products
// or read_inventory. This is the CURRENT cost - Shopify doesn't expose the cost at sale time.
export async function fetchVariantCosts(shop: string, accessToken: string, variantIds: number[]): Promise<Map<number, number>> {
  const costs = new Map<number, number>();
  const ids = [...new Set(variantIds)];
  const BATCH = 100;   // ~3 query-cost points per node keeps each call well under the 1000 limit
  const batches: number[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));

  const runBatch = async (batch: number[]) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(shopifyApiUrl(shop, "/graphql.json"), {
        method: "POST",
        headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { legacyResourceId inventoryItem { unitCost { amount } } } } }`,
          variables: { ids: batch.map(id => `gid://shopify/ProductVariant/${id}`) },
        }),
      });
      rotateTokenIfNeeded(shop, res);
      if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: variant costs`);
      const json = await res.json() as {
        data?: { nodes?: ({ legacyResourceId?: string; inventoryItem?: { unitCost?: { amount: string } | null } | null } | null)[] };
        errors?: { message: string; extensions?: { code?: string } }[];
      };
      if (json.errors?.some(e => e.extensions?.code === "THROTTLED")) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (json.errors?.length) throw new Error(`Shopify GraphQL: ${json.errors[0].message}`);
      for (const n of json.data?.nodes ?? []) {
        const amount = parseFloat(n?.inventoryItem?.unitCost?.amount ?? "");
        if (n?.legacyResourceId && amount > 0) costs.set(Number(n.legacyResourceId), amount);
      }
      return;
    }
    throw new Error("Shopify GraphQL throttled: variant costs");
  };

  // A few batches at a time - large catalogues finish fast without tripping the cost bucket.
  for (let i = 0; i < batches.length; i += 3) await Promise.all(batches.slice(i, i + 3).map(runBatch));
  return costs;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  variants: { id: number; price: string; inventory_quantity: number; sku: string }[];
}

export interface ShopifyCustomer {
  id: number;
  orders_count: number;
  total_spent: string;
  created_at: string;
  default_address?: { city: string; province: string };
}
