import { NextRequest, NextResponse } from "next/server";
import { swrCache } from "@/lib/swr-cache";
import { fetchOrdersInRange, orderRevenue, resolveShopifyPeriod, isCodGateway, type ShopifyOrder } from "@/lib/shopify";
import { getShopifySession } from "@/lib/session";

// Store-side facts for Growth Diagnosis that the other Shopify routes leave out on purpose:
// cancelled orders (so COD failure can be measured), Shiprocket-style RTO tags, discount-code
// performance and basket size. Same period rules as every other Shopify route.
export async function GET(req: NextRequest) {
  const session = await getShopifySession(req);
  if (!session) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const { shop, token } = session;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  try {
    const cacheKey = `cache:${shop}:diagnosis:v1:${fromParam ?? "mtd"}:${toParam ?? "now"}`;
    const result = await swrCache(cacheKey, 600, 21600, () => build(shop, token, fromParam, toParam));
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "diagnosis_failed", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

const FIELDS = "id,created_at,cancelled_at,cancel_reason,test,financial_status,fulfillment_status,payment_gateway,total_price,current_total_price,total_discounts,tags,discount_codes,line_items,customer";

function tagList(o: ShopifyOrder): string[] {
  return (o.tags ?? "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
}
// Courier apps (Shiprocket etc.) tag orders. A prediction tag is a risk score, not an outcome.
const isPredictionTag = (t: string) => t.includes("prediction") || t.includes("risk");
function isRtoOrder(o: ShopifyOrder): boolean {
  return tagList(o).some(t => !isPredictionTag(t) && (/(^|[\s_-])rto($|[\s_-])/.test(t) || t.includes("return to origin") || t.includes("returned to origin")));
}
function isHighRisk(o: ShopifyOrder): boolean {
  return tagList(o).some(t => isPredictionTag(t) && t.includes("rto") && t.includes("high"));
}
const isFailedOrder = (o: ShopifyOrder) => !!o.cancelled_at || o.financial_status === "voided" || isRtoOrder(o);

function units(o: ShopifyOrder) {
  return (o.line_items ?? []).filter(li => !li.gift_card).reduce((s, li) => s + li.quantity, 0);
}

async function build(shop: string, token: string, fromParam: string | null, toParam: string | null) {
  const { startISO, endISO, days } = await resolveShopifyPeriod(shop, token, fromParam, toParam);
  const all = await fetchOrdersInRange(shop, token, startISO, endISO, FIELDS, true);

  const outcome = (list: ShopifyOrder[]) => {
    const cancelled = list.filter(o => !!o.cancelled_at || o.financial_status === "voided").length;
    const rto = list.filter(o => !o.cancelled_at && o.financial_status !== "voided" && isRtoOrder(o)).length;
    const failed = cancelled + rto;
    return { placed: list.length, cancelled, rto, failed, failRatePct: list.length ? Math.round((failed / list.length) * 100) : 0 };
  };
  const cod = all.filter(o => isCodGateway(o.payment_gateway));
  const prepaid = all.filter(o => !isCodGateway(o.payment_gateway));
  const highRisk = cod.filter(isHighRisk);

  // "Kept" = placed and not cancelled / voided / returned - the orders that actually earn money.
  const kept = all.filter(o => !isFailedOrder(o));
  const keptRevenue = kept.reduce((s, o) => s + orderRevenue(o), 0);
  const keptUnits = kept.reduce((s, o) => s + units(o), 0);
  const singleItem = kept.filter(o => units(o) === 1).length;
  const discounts = kept.reduce((s, o) => s + parseFloat(o.total_discounts ?? "0"), 0);
  const repeat = kept.filter(o => (o.customer?.orders_count ?? 0) > 1).length;

  // Discount codes: which offers bring bigger baskets.
  const codeMap = new Map<string, { code: string; orders: number; revenue: number; units: number }>();
  for (const o of kept) for (const dc of o.discount_codes ?? []) {
    const code = dc.code.toUpperCase();
    const m = codeMap.get(code) ?? { code, orders: 0, revenue: 0, units: 0 };
    m.orders++; m.revenue += orderRevenue(o); m.units += units(o);
    codeMap.set(code, m);
  }
  const codes = [...codeMap.values()].sort((a, b) => b.orders - a.orders).slice(0, 8).map(c => ({
    code: c.code, orders: c.orders, aov: Math.round(c.revenue / c.orders), itemsPerOrder: +(c.units / c.orders).toFixed(1),
  }));

  // Best sellers with their average selling price - shows what the store is really known for.
  const prodMap = new Map<string, { title: string; units: number; revenue: number; orders: number }>();
  for (const o of kept) for (const li of o.line_items ?? []) {
    if (li.gift_card) continue;
    const key = String(li.product_id ?? li.title);
    const m = prodMap.get(key) ?? { title: li.title, units: 0, revenue: 0, orders: 0 };
    m.units += li.quantity; m.orders++;
    m.revenue += parseFloat(li.price) * li.quantity - parseFloat(li.total_discount ?? "0");
    prodMap.set(key, m);
  }
  const topProducts = [...prodMap.values()].sort((a, b) => b.units - a.units).slice(0, 5).map(p => ({
    title: p.title, units: p.units, avgPrice: Math.round(p.revenue / Math.max(p.units, 1)),
  }));

  return {
    period: { days },
    orders: {
      placed: all.length,
      kept: kept.length,
      keptRevenue: Math.round(keptRevenue),
      aov: kept.length ? Math.round(keptRevenue / kept.length) : 0,
      itemsPerOrder: kept.length ? +(keptUnits / kept.length).toFixed(2) : 0,
      singleItemPct: kept.length ? Math.round((singleItem / kept.length) * 100) : 0,
      discountPct: keptRevenue + discounts > 0 ? Math.round((discounts / (keptRevenue + discounts)) * 100) : 0,
      repeatPct: kept.length ? Math.round((repeat / kept.length) * 100) : 0,
    },
    cod: { ...outcome(cod), sharePct: all.length ? Math.round((cod.length / all.length) * 100) : 0 },
    prepaid: outcome(prepaid),
    // Did the courier's RTO-risk tag predict the failures? (only when the store uses such tags)
    highRisk: { tagged: highRisk.length, failed: highRisk.filter(isFailedOrder).length },
    rtoTagsSeen: all.some(isRtoOrder),
    codes,
    topProducts,
  };
}
