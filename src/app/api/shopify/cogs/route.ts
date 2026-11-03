import { NextRequest, NextResponse } from "next/server";
import { swrCache } from "@/lib/swr-cache";
import { fetchOrdersInRange, fetchVariantCosts, resolveShopifyPeriod } from "@/lib/shopify";
import { getShopifySession } from "@/lib/session";

// Product cost (COGS) for a period, from the "Cost per item" the merchant entered in Shopify.
// Items sold without a cost are estimated at the same cost-to-price ratio as the items that
// have one, and reported separately so the page can say how much is real vs estimated.
export async function GET(req: NextRequest) {
  const session = await getShopifySession(req);
  if (!session) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const { shop, token } = session;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  try {
    const cacheKey = `cache:${shop}:cogs:v1:${fromParam ?? "mtd"}:${toParam ?? "now"}`;
    const result = await swrCache(cacheKey, 600, 21600, () => buildCogs(shop, token, fromParam, toParam));
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "cogs_failed", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

// Own field list: line items + refunds (to drop restocked units), plus what isRealOrder needs.
const COGS_FIELDS = "id,created_at,cancelled_at,test,financial_status,line_items,refunds";

async function buildCogs(shop: string, token: string, fromParam: string | null, toParam: string | null) {
  const { startISO, endISO } = await resolveShopifyPeriod(shop, token, fromParam, toParam);
  const orders = await fetchOrdersInRange(shop, token, startISO, endISO, COGS_FIELDS);

  // Units that were refunded AND put back in stock never cost you the product.
  const restocked = new Map<number, number>();
  for (const o of orders) for (const r of o.refunds ?? []) for (const rl of r.refund_line_items ?? []) {
    if (rl.restock_type && rl.restock_type !== "no_restock") {
      restocked.set(rl.line_item_id, (restocked.get(rl.line_item_id) ?? 0) + rl.quantity);
    }
  }

  const lines = orders.flatMap(o => o.line_items.filter(li => !li.gift_card).map(li => ({
    variantId: li.variant_id ?? null,
    productId: li.product_id,
    title: li.title,
    units: Math.max(0, li.quantity - (li.id ? restocked.get(li.id) ?? 0 : 0)),
    unitPrice: parseFloat(li.price ?? "0") || 0,
  }))).filter(l => l.units > 0);

  const variantIds = lines.map(l => l.variantId).filter((v): v is number => !!v);
  const costs = await fetchVariantCosts(shop, token, variantIds);

  let actual = 0, coveredSales = 0, uncoveredSales = 0, coveredUnits = 0, totalUnits = 0;
  const missing = new Map<string, { title: string; units: number; sales: number }>();
  for (const l of lines) {
    const sales = l.units * l.unitPrice;
    totalUnits += l.units;
    const cost = l.variantId ? costs.get(l.variantId) : undefined;
    if (cost !== undefined) {
      actual += cost * l.units;
      coveredSales += sales;
      coveredUnits += l.units;
    } else {
      uncoveredSales += sales;
      const key = String(l.productId ?? l.title);
      const m = missing.get(key) ?? { title: l.title, units: 0, sales: 0 };
      m.units += l.units; m.sales += sales;
      missing.set(key, m);
    }
  }

  const costRatio = coveredSales > 0 ? actual / coveredSales : 0;
  const estimated = coveredSales > 0 ? uncoveredSales * costRatio : 0;
  const allSales = coveredSales + uncoveredSales;

  return {
    // "full" = every item has a Shopify cost, "partial" = some estimated, "none" = no costs set.
    status: actual === 0 ? "none" : uncoveredSales > 0 ? "partial" : "full",
    orders: orders.length,
    cogs: {
      actual: Math.round(actual),
      estimated: Math.round(estimated),
      total: Math.round(actual + estimated),
      perOrder: orders.length ? Math.round((actual + estimated) / orders.length) : 0,
    },
    coverage: {
      salesPct: allSales > 0 ? Math.round((coveredSales / allSales) * 100) : 0,
      coveredUnits,
      totalUnits,
    },
    costRatioPct: Math.round(costRatio * 1000) / 10,
    missing: [...missing.values()].sort((a, b) => b.sales - a.sales).slice(0, 8)
      .map(m => ({ ...m, sales: Math.round(m.sales) })),
    missingCount: missing.size,
  };
}
