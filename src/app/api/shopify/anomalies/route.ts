import { NextRequest, NextResponse } from "next/server";
import { shopifyFetchAll, fetchOrdersInRange, orderRevenue, resolveShopifyPeriod, isCodGateway, ShopifyProduct } from "@/lib/shopify";
import { getShopifySession } from "@/lib/session";

interface Customer { orders_count: number; total_spent: string; created_at: string; }

export async function GET(req: NextRequest) {
  const session = await getShopifySession(req);
  if (!session) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const { shop, token } = session;

  // Month-to-date in the store's timezone, including the day count: the server's own clock
  // is UTC and can still be on the previous day for an Indian store.
  const { startISO, startYmd, endYmd, days } = await resolveShopifyPeriod(shop, token, null, null);
  const [startY, startM] = startYmd.split("-").map(Number);
  const daysInMonth = new Date(startY, startM, 0).getDate();

  const [orders, products, customers] = await Promise.all([
    fetchOrdersInRange(shop, token, startISO),
    shopifyFetchAll<ShopifyProduct>(shop, token, "/products.json?limit=250&fields=id,title,variants", "products"),
    shopifyFetchAll<Customer>(shop, token, "/customers.json?limit=250&fields=id,orders_count,total_spent", "customers"),
  ]);

  const grossSales = orders.reduce((s, o) => s + orderRevenue(o), 0);
  const totalOrders = orders.length;
  const codOrders = orders.filter(o => isCodGateway(o.payment_gateway)).length;
  const codPct = totalOrders ? Math.round((codOrders / totalOrders) * 100) : 0;
  const dailyAvg = days > 0 ? grossSales / days : 0;
  const projectedMonthly = Math.round(dailyAvg * daysInMonth);

  // Sales map
  const salesMap: Record<number, number> = {};
  orders.forEach(o => o.line_items.forEach(item => {
    salesMap[item.product_id] = (salesMap[item.product_id] || 0) + item.quantity;
  }));

  // Product analysis
  const productData = products.map(p => ({
    name: p.title,
    stock: p.variants.reduce((s, v) => s + (v.inventory_quantity || 0), 0),
    sold: salesMap[p.id] || 0,
  }));

  const totalCustomers = customers.length;
  const repeatCustomers = customers.filter(c => c.orders_count > 1).length;
  const repeatRate = totalCustomers ? Math.round((repeatCustomers / totalCustomers) * 100) : 0;

  // Compute anomalies
  const critical: { title: string; desc: string }[] = [];
  const warnings: { title: string; desc: string }[] = [];
  const positive: { title: string; desc: string }[] = [];

  const lowStock = productData.filter(p => p.stock <= 10 && p.sold > 0);
  if (lowStock.length > 0) {
    critical.push({
      title: `${lowStock.length} selling product${lowStock.length > 1 ? "s" : ""} critically low on stock`,
      desc: `${lowStock.map(p => p.name).slice(0, 3).join(", ")} - reorder immediately to avoid stockout and lost sales.`,
    });
  }

  const zeroStock = productData.filter(p => p.stock === 0 && p.sold > 0);
  if (zeroStock.length > 0) {
    critical.push({
      title: `${zeroStock.length} product${zeroStock.length > 1 ? "s" : ""} out of stock but had sales`,
      desc: `${zeroStock.map(p => p.name).slice(0, 2).join(", ")} - these had orders this month but are now at zero stock.`,
    });
  }

  if (codPct > 50 && totalOrders > 0) {
    warnings.push({
      title: `COD is ${codPct}% - above 50% benchmark`,
      desc: `${codOrders} of ${totalOrders} orders are COD. Add a ₹75 prepaid discount to shift buyers and reduce return risk.`,
    });
  }

  if (repeatRate < 20 && totalCustomers > 5) {
    warnings.push({
      title: `Repeat rate ${repeatRate}% - below 20% benchmark`,
      desc: `${totalCustomers - repeatCustomers} one-time buyers haven't returned. Set up a 7-day post-purchase email trigger.`,
    });
  }

  if (totalOrders === 0 && days > 3) {
    warnings.push({
      title: "No orders yet this month",
      desc: "It's been more than 3 days with no sales. Check that products are active and payment is configured correctly.",
    });
  }

  // Positive signals
  if (repeatRate >= 25) {
    positive.push({
      title: `Strong repeat rate: ${repeatRate}%`,
      desc: "Above 25% benchmark - your customers are loyal. Double down on acquisition to grow this base.",
    });
  }

  if (totalOrders > 0 && dailyAvg > 0) {
    positive.push({
      title: `On track for ₹${projectedMonthly.toLocaleString("en-IN")} this month`,
      desc: `${totalOrders} orders in ${days} days at ₹${Math.round(dailyAvg).toLocaleString("en-IN")}/day average.`,
    });
  }

  const topSellers = productData.filter(p => p.sold > 10).sort((a, b) => b.sold - a.sold);
  if (topSellers.length > 0) {
    positive.push({
      title: `${topSellers[0].name} is a clear bestseller`,
      desc: `${topSellers[0].sold} units sold this month. Prioritise this SKU in ads and keep stock levels high.`,
    });
  }

  return NextResponse.json({
    critical,
    warnings,
    positive,
    period: { from: startYmd, to: endYmd },
    summary: { totalOrders, codPct, repeatRate, projectedMonthly, days, grossSales: Math.round(grossSales) },
  });
}
