"use client";
import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { KPICard } from "@/components/ui/kpi-card";
import { Card, CardHeader } from "@/components/ui/card";
import { InsightCard } from "@/components/ui/insight-card";
import { Badge } from "@/components/ui/badge";
import { BarRow } from "@/components/ui/bar-row";
import { formatINR } from "@/lib/utils";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF } from "@/lib/export";
import { useDateRange, formatDateSpan, rangeText } from "@/lib/date-range-context";
import { RangeText } from "@/components/ui/period";

interface ProductRow {
  id: number; name: string; total: number; revenue: number; stock: number; price: number;
  soldPerDay: number; daysLeft: number | null; signal: string;
}
interface Stats {
  totalProducts: number; withSales: number; unitsSold: number; periodRevenue: number;
  lowStock: number; outOfStock: number; deadStockCount: number; deadStockValue: number;
  inventoryUnits: number; inventoryValue: number;
  oosBestsellers: ProductRow[];
  bestSeller: { name: string; total: number; revenue: number } | null;
  bestEarner: { name: string; revenue: number; total: number } | null;
}

const signalConfig: Record<string, { label: string; variant: "green" | "amber" | "red" | "blue" }> = {
  bestseller: { label: "Best seller", variant: "green" },
  good: { label: "Selling", variant: "green" },
  reorder: { label: "Reorder now", variant: "red" },
  oos: { label: "Out of stock", variant: "red" },
  dead: { label: "No sales", variant: "amber" },
  bundle: { label: "Bundle opp.", variant: "amber" },
};

export default function ProductsPage() {
  const { range } = useDateRange();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [days, setDays] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/shopify/products?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then(p => {
        if (p.products) setProducts(p.products);
        if (p.stats) setStats(p.stats);
        if (p.period?.days) setDays(p.period.days);
      })
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  const topProduct = products[0];
  const withSales = products.filter(p => p.total > 0);
  const deadStock = products.filter(p => p.stock > 0 && p.total === 0);
  const stockoutRisk = products.filter(p => p.daysLeft !== null && p.daysLeft <= 15);
  const maxRev = Math.max(...products.map(p => p.revenue), 1);

  function buildSections() {
    const sigLabel = (s: string) => signalConfig[s]?.label ?? s;
    return [
      {
        title: "Product Summary",
        headers: ["Metric", "Value"],
        rows: [
          ["Total Products", products.length],
          ["Products with Sales", withSales.length],
          ["Units Sold", stats?.unitsSold ?? 0],
          ["Revenue", formatINR(stats?.periodRevenue ?? 0)],
          ["Dead Stock (no sales)", `${stats?.deadStockCount ?? 0} · ${formatINR(stats?.deadStockValue ?? 0)} locked`],
          ["Out of Stock", stats?.outOfStock ?? 0],
          ["Inventory Value", formatINR(stats?.inventoryValue ?? 0)],
        ],
      },
      {
        title: "All Products",
        headers: ["#", "Product", "Units Sold", "Revenue", "Stock", "Sold/day", "Days left", "Price", "Signal"],
        rows: products.map((p, i) => [i + 1, p.name, p.total, formatINR(p.revenue), p.stock, p.soldPerDay || "-", p.daysLeft ?? "-", formatINR(p.price), sigLabel(p.signal)]),
      },
      {
        title: "Stockout Risk (≤15 days)",
        headers: ["Product", "Stock", "Sold/day", "Days left"],
        rows: stockoutRisk.map(p => [p.name, p.stock, p.soldPerDay, p.daysLeft ?? "-"]),
      },
      {
        title: "Dead Stock (in stock, no sales)",
        headers: ["Product", "Stock", "Capital locked"],
        rows: deadStock.map(p => [p.name, p.stock, formatINR(Math.round(p.stock * p.price))]),
      },
    ];
  }

  function handleExportCSV() { exportToCSV("skylitee-products", buildSections()); }
  async function handleExportPDF() {
    await exportToPDF("skylitee-products", "Product Analytics", `${rangeText(range)} · ${days} days · Shopify live data`, buildSections());
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Package size={18} className="text-[#F97316]" /> Product Analytics</h2>
          <p className="text-[17px] text-[#686864] mt-0.5">Shopify · live inventory & sales · <RangeText /></p>
        </div>
        <ExportButton onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} disabled={products.length === 0} />
      </div>

      {loading ? (
        <div className="text-[17px] text-[#686864] py-8 text-center">Loading real product data...</div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
            <KPICard label="Total Products" value={products.length.toString()} sub={`${withSales.length} sold in ${formatDateSpan(range.from, range.to)}`} />
            <KPICard label="Units Sold" value={(stats?.unitsSold ?? 0).toLocaleString("en-IN")} sub={`${formatINR(stats?.periodRevenue ?? 0)} revenue`} />
            <KPICard
              label="Best Seller"
              value={topProduct ? topProduct.name.substring(0, 14) : "-"}
              sub={topProduct ? `${topProduct.total} units · ${formatINR(topProduct.revenue)}` : "No sales yet"}
            />
            <KPICard
              label="Dead Stock"
              value={(stats?.deadStockCount ?? 0).toString()}
              sub={`${formatINR(stats?.deadStockValue ?? 0)} capital locked`}
              change={(stats?.deadStockCount ?? 0) > 0 ? -1 : 1}
            />
            <KPICard
              label="Stockout Risk"
              value={stockoutRisk.length.toString()}
              sub={stockoutRisk.length > 0 ? "≤15 days left - reorder" : "All healthy"}
              change={stockoutRisk.length > 0 ? -1 : 1}
            />
            <KPICard
              label="Out of Stock"
              value={(stats?.outOfStock ?? 0).toString()}
              sub={(stats?.oosBestsellers?.length ?? 0) > 0 ? `${stats!.oosBestsellers.length} were selling - lost sales` : "Nothing critical"}
              change={(stats?.outOfStock ?? 0) > 0 ? -1 : 1}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
            {/* Revenue by product */}
            <Card>
              <CardHeader title="Revenue by product" right={rangeText(range)} />
              {withSales.length === 0 ? (
                <div className="text-[17px] text-[#686864] py-6 text-center">No sales in {formatDateSpan(range.from, range.to)}</div>
              ) : (
                <>
                  {withSales.slice(0, 8).map((p, i) => (
                    <BarRow
                      key={i}
                      label={p.name.substring(0, 18)}
                      pct={Math.round((p.revenue / maxRev) * 100)}
                      value={formatINR(p.revenue)}
                      color={["green", "blue", "amber", "purple", "teal", "green", "blue", "amber"][i] as "green" | "blue" | "amber" | "purple" | "teal"}
                    />
                  ))}
                  {withSales.length >= 2 && (
                    <InsightCard type="info" title={`Top 2 products drive ${Math.round(((withSales[0].revenue + (withSales[1]?.revenue || 0)) / Math.max(stats?.periodRevenue ?? 1, 1)) * 100)}% of revenue`} body="High concentration - protect stock on these and bundle them with slow movers to lift AOV and clear dead inventory." />
                  )}
                  {stats?.bestEarner && stats?.bestSeller && stats.bestEarner.name !== stats.bestSeller.name && (
                    <InsightCard type="warning" title="Your best seller isn't your best earner" body={`"${stats.bestSeller.name.substring(0, 22)}" sells most units, but "${stats.bestEarner.name.substring(0, 22)}" earns the most revenue. Feature the earner in ads.`} />
                  )}
                </>
              )}
            </Card>

            {/* Inventory & demand forecast */}
            <Card>
              <CardHeader title="Inventory & demand forecast" right={`Based on ${formatDateSpan(range.from, range.to)}`} />
              <div className="overflow-x-auto">
                <table className="w-full text-[17px] border-collapse">
                  <thead>
                    <tr className="border-b border-black/[0.09]">
                      {["Product", "Stock", "Sold/day", "Days left", "Action"].map(h => (
                        <th key={h} className="text-left py-1.5 px-1.5 text-[16px] font-semibold text-[#686864]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {products.slice(0, 10).map((p, i) => (
                      <tr key={i} className="border-b border-black/[0.06] last:border-0 hover:bg-[#f7f7f5]">
                        <td className="py-1.5 px-1.5 max-w-[120px] truncate">{p.name}</td>
                        <td className={`py-1.5 px-1.5 font-medium ${p.stock <= 10 ? "text-[#d94040]" : ""}`}>{p.stock}</td>
                        <td className="py-1.5 px-1.5">{p.soldPerDay > 0 ? `${p.soldPerDay}/day` : "-"}</td>
                        <td className={`py-1.5 px-1.5 font-medium ${p.daysLeft !== null && p.daysLeft <= 15 ? "text-[#d94040]" : ""}`}>
                          {p.daysLeft !== null ? `${p.daysLeft}d` : "-"}
                        </td>
                        <td className="py-1.5 px-1.5">
                          <Badge variant={signalConfig[p.signal]?.variant || "blue"}>
                            {signalConfig[p.signal]?.label || p.signal}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Dead stock + Lost sales */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Card>
              <CardHeader title="Dead stock - capital locked" right={`${formatINR(stats?.deadStockValue ?? 0)} in ${stats?.deadStockCount ?? 0} products`} />
              {deadStock.length === 0 ? (
                <div className="text-[17px] text-[#686864] py-6 text-center">No dead stock - everything moved in {formatDateSpan(range.from, range.to)}.</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[17px] border-collapse">
                      <thead>
                        <tr className="border-b border-black/[0.09]">
                          {["Product", "Stock", "Capital locked"].map(h => (
                            <th key={h} className="text-left py-1.5 px-1.5 text-[16px] font-semibold text-[#686864]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {deadStock.slice(0, 8).map((p, i) => (
                          <tr key={i} className="border-b border-black/[0.06] last:border-0 hover:bg-[#f7f7f5]">
                            <td className="py-1.5 px-1.5 max-w-[160px] truncate">{p.name}</td>
                            <td className="py-1.5 px-1.5 font-medium">{p.stock}</td>
                            <td className="py-1.5 px-1.5 font-medium text-[#d94040]">{formatINR(Math.round(p.stock * p.price))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <InsightCard type="warning" title={`${formatINR(stats?.deadStockValue ?? 0)} tied up in non-selling stock`} body="Discount, bundle with bestsellers, or stop reordering these. Freed cash funds your winners." />
                </>
              )}
            </Card>

            <Card>
              <CardHeader title="Lost sales - out of stock" right="Were selling, now 0 stock" />
              {(stats?.oosBestsellers?.length ?? 0) === 0 ? (
                <div className="text-[17px] text-[#686864] py-6 text-center">No bestsellers are out of stock. 👍</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[17px] border-collapse">
                      <thead>
                        <tr className="border-b border-black/[0.09]">
                          {["Product", "Units sold", "Revenue"].map(h => (
                            <th key={h} className="text-left py-1.5 px-1.5 text-[16px] font-semibold text-[#686864]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stats!.oosBestsellers.map((p, i) => (
                          <tr key={i} className="border-b border-black/[0.06] last:border-0 hover:bg-[#f7f7f5]">
                            <td className="py-1.5 px-1.5 max-w-[160px] truncate">{p.name}</td>
                            <td className="py-1.5 px-1.5 font-medium">{p.total}</td>
                            <td className="py-1.5 px-1.5 font-medium">{formatINR(p.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <InsightCard type="warning" title="You're losing sales on proven products" body="These sold well but are now out of stock - every day OOS is lost revenue. Reorder first, and pause ads pointing to them until restocked." />
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
