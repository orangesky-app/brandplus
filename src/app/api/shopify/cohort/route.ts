import { NextRequest, NextResponse } from "next/server";
import { shopifyFetchAll, isRealOrder, orderRevenue, getShopTimezone, ShopifyOrder, ORDER_FIELDS } from "@/lib/shopify";
import { getShopifySession } from "@/lib/session";
import { todayInTz, ymdInTz } from "@/lib/timezone";

// Cohorts need each customer's FULL order history (to find their true first order), so we
// fetch all-time rather than a window - but paginated (up to 25k orders) and filtered to
// real sales, instead of the old hand-rolled 10-page (2,500-order) cap that truncated.
async function fetchAllOrders(shop: string, token: string): Promise<ShopifyOrder[]> {
  const orders = await shopifyFetchAll<ShopifyOrder>(
    shop, token,
    `/orders.json?limit=250&status=any&fields=${ORDER_FIELDS}`,
    "orders",
  );
  return orders.filter(isRealOrder);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function addMonths(key: string, offset: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return monthKey(d);
}

export async function GET(req: NextRequest) {
  const session = await getShopifySession(req);
  if (!session) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const { shop, token } = session;

  // Months as the store sees them: on the server's UTC clock, an order placed just after
  // midnight on the 1st in India would land in the month before.
  const tz = await getShopTimezone(shop, token);
  const orderMonth = (d: Date) => ymdInTz(d, tz).slice(0, 7);

  const rawOrders = await fetchAllOrders(shop, token);

  // Group orders by customer
  const customerOrders = new Map<number, { date: Date; price: number }[]>();
  for (const o of rawOrders) {
    if (!o.customer?.id) continue;
    const entry = customerOrders.get(o.customer.id) ?? [];
    entry.push({ date: new Date(o.created_at), price: orderRevenue(o) });
    customerOrders.set(o.customer.id, entry);
  }

  // Sort each customer's orders chronologically
  customerOrders.forEach((orders) => orders.sort((a, b) => a.date.getTime() - b.date.getTime()));

  // Determine each customer's acquisition cohort (month of first order)
  const customerCohort = new Map<number, string>();
  customerOrders.forEach((orders, customerId) => {
    customerCohort.set(customerId, orderMonth(orders[0].date));
  });

  // Build cohort sets and revenue
  const cohortCustomers = new Map<string, Set<number>>();
  const cohortRevenue = new Map<string, number>();

  customerOrders.forEach((orders, customerId) => {
    const cohort = customerCohort.get(customerId)!;
    if (!cohortCustomers.has(cohort)) cohortCustomers.set(cohort, new Set());
    cohortCustomers.get(cohort)!.add(customerId);
    const rev = orders.reduce((s, o) => s + o.price, 0);
    cohortRevenue.set(cohort, (cohortRevenue.get(cohort) ?? 0) + rev);
  });

  // Last 6 calendar months (oldest → newest)
  const today = todayInTz(tz);
  const nowKey = today.slice(0, 7);
  const cohortMonths: string[] = [];
  for (let i = 5; i >= 0; i--) cohortMonths.push(addMonths(nowKey, -i));

  const matrix = cohortMonths.map((cohort) => {
    const customers = cohortCustomers.get(cohort)?.size ?? 0;
    const retention: (number | null)[] = [];

    for (let offset = 0; offset <= 5; offset++) {
      const targetKey = addMonths(cohort, offset);

      // Future month - no data yet
      if (targetKey > nowKey) {
        retention.push(null);
        continue;
      }

      if (offset === 0) {
        retention.push(customers > 0 ? 100 : null);
        continue;
      }

      if (customers === 0) {
        retention.push(null);
        continue;
      }

      let count = 0;
      cohortCustomers.get(cohort)?.forEach((customerId) => {
        const orders = customerOrders.get(customerId) ?? [];
        const bought = orders.some((o) => orderMonth(o.date) === targetKey);
        if (bought) count++;
      });

      retention.push(Math.round((count / customers) * 100));
    }

    return {
      month: monthLabel(cohort),
      customers,
      retention,
      revenue: Math.round(cohortRevenue.get(cohort) ?? 0),
    };
  });

  // Revenue by cohort bar chart (top 5 by revenue)
  const revenueChart = matrix
    .filter((r) => r.customers > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const maxRev = revenueChart[0]?.revenue ?? 1;
  const revenueByMonth = revenueChart.map((r) => ({
    month: r.month,
    revenue: r.revenue,
    pct: Math.round((r.revenue / maxRev) * 100),
  }));

  // Summary stats for insights
  const activeCohorts = matrix.filter((r) => r.customers > 0);
  const bestMonth1 = activeCohorts.reduce(
    (best, r) => {
      const m1 = r.retention[1] ?? 0;
      return m1 > (best?.val ?? 0) ? { month: r.month, val: m1 } : best;
    },
    null as { month: string; val: number } | null
  );
  const month2Values = activeCohorts.map((r) => r.retention[2]).filter((v): v is number => v !== null);
  const avgMonth2 = month2Values.length ? Math.round(month2Values.reduce((s, v) => s + v, 0) / month2Values.length) : null;
  const totalCustomers = activeCohorts.reduce((s, r) => s + r.customers, 0);
  const totalRevenue = activeCohorts.reduce((s, r) => s + r.revenue, 0);
  const avgOrderValue = totalCustomers > 0 ? Math.round(totalRevenue / totalCustomers) : 0;

  return NextResponse.json({
    matrix,
    revenueByMonth,
    insights: { bestMonth1, avgMonth2, totalCustomers, avgOrderValue },
    period: { from: `${cohortMonths[0]}-01`, to: today },
  });
}
