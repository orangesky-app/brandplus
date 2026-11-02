import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { requireAdmin } from "@/lib/admin-auth";
import { fetchOrdersInRange, orderRevenue, resolveShopifyPeriod, isCodGateway } from "@/lib/shopify";

async function kvGet<T>(key: string): Promise<T | null> {
  try { return await kv.get<T>(key); } catch { return null; }
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) return NextResponse.json({ error: "Missing shop" }, { status: 400 });

  const [shopifyToken, metaToken] = await Promise.allSettled([
    kvGet<string>(`shop:${shop}:shopify_token`),
    kvGet<string>(`shop:${shop}:meta_token`),
  ]);

  const sToken = shopifyToken.status === "fulfilled" ? shopifyToken.value : null;
  if (!sToken) return NextResponse.json({ error: "no_shopify" });

  try {
    // Month-to-date in the store's timezone.
    const { startISO, endISO } = await resolveShopifyPeriod(shop, sToken, null, null);
    const orders = await fetchOrdersInRange(shop, sToken, startISO, endISO);

    const revenue = orders.reduce((s, o) => s + orderRevenue(o), 0);
    const ordersCount = orders.length;
    const aov = ordersCount ? Math.round(revenue / ordersCount) : 0;
    const codOrders = orders.filter(o => isCodGateway(o.payment_gateway)).length;
    const codPct = ordersCount ? Math.round((codOrders / ordersCount) * 100) : 0;
    const hasMetaToken = metaToken.status === "fulfilled" && !!metaToken.value;

    return NextResponse.json({ revenue: Math.round(revenue), orders: ordersCount, aov, codPct, hasMetaToken });
  } catch {
    return NextResponse.json({ error: "shopify_error" });
  }
}
