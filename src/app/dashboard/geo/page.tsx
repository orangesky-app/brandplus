"use client";
import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { KPICard } from "@/components/ui/kpi-card";
import { Card, CardHeader } from "@/components/ui/card";
import { InsightCard } from "@/components/ui/insight-card";
import { BarRow } from "@/components/ui/bar-row";
import { formatINR } from "@/lib/utils";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF } from "@/lib/export";
import { useDateRange, formatDateSpan, rangeText } from "@/lib/date-range-context";
import { RangeText } from "@/components/ui/period";

interface CityRevenue { city: string; revenue: number; }
interface CityCustomers { city: string; count: number; pct: number; }

const cityColors = ["green", "blue", "amber", "purple", "teal"] as const;

export default function GeoPage() {
  const { range } = useDateRange();
  const [revenueByCity, setRevenueByCity] = useState<CityRevenue[]>([]);
  const [customersByCity, setCustomersByCity] = useState<CityCustomers[]>([]);
  const [loading, setLoading] = useState(true);

  // Both revenue-by-city and buyers-by-city follow the selected date range.
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/shopify/dashboard?from=${range.from}&to=${range.to}`).then(r => r.json()),
      fetch(`/api/shopify/customers/period?from=${range.from}&to=${range.to}`).then(r => r.json()),
    ]).then(([d, c]) => {
      setRevenueByCity(d.topCities ?? []);
      setCustomersByCity(c.topCities ?? []);
    }).finally(() => setLoading(false));
  }, [range.from, range.to]);

  const topCity = revenueByCity[0];
  const totalRevenue = revenueByCity.reduce((s, c) => s + c.revenue, 0);
  const maxRev = Math.max(...revenueByCity.map(c => c.revenue), 1);
  const totalBuyers = customersByCity.reduce((s, c) => s + c.count, 0);

  function buildSections() {
    const mergedData = revenueByCity.map(r => {
      const cd = customersByCity.find(c => c.city.toLowerCase() === r.city.toLowerCase());
      const share = Math.round((r.revenue / Math.max(totalRevenue, 1)) * 100);
      return { city: r.city, revenue: r.revenue, customers: cd?.count ?? 0, share };
    });
    return [
      {
        title: `Geo KPIs (${rangeText(range)})`,
        headers: ["Metric", "Value"],
        rows: [
          ["Top City", topCity?.city ?? "-"],
          ["Top City Revenue", topCity ? formatINR(topCity.revenue) : "-"],
          ["Cities with Orders", revenueByCity.length],
          ["Total Revenue", formatINR(totalRevenue)],
          ["Buyers Tracked", totalBuyers],
        ],
      },
      {
        title: "City Performance",
        headers: ["#", "City", "Revenue", "Revenue Share", "Buyers"],
        rows: mergedData.map((g, i) => [i + 1, g.city, formatINR(g.revenue), `${g.share}%`, g.customers > 0 ? g.customers : "-"]),
      },
    ];
  }

  function handleExportCSV() { exportToCSV("skylitee-geo", buildSections()); }
  async function handleExportPDF() {
    await exportToPDF("skylitee-geo", "Geo Performance", `City-level revenue & buyers · Shopify · ${rangeText(range)}`, buildSections());
  }

  // Merge city data
  const merged = revenueByCity.map(r => {
    const custData = customersByCity.find(c => c.city.toLowerCase() === r.city.toLowerCase());
    return { city: r.city, revenue: r.revenue, customers: custData?.count ?? 0 };
  });

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold flex items-center gap-2"><MapPin size={18} className="text-[#F97316]" /> Geo Performance</h2>
            <span className="text-[13px] font-semibold text-[#0d6b4f] bg-[#e0f5ee] px-2 py-0.5 rounded-full"><RangeText /></span>
          </div>
          <p className="text-[17px] text-[#686864] mt-0.5">City-level revenue &amp; buyers from Shopify · change the date range up top</p>
        </div>
        <ExportButton onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} disabled={revenueByCity.length === 0} />
      </div>

      {loading ? (
        <div className="text-[17px] text-[#686864] py-8 text-center">Loading real geo data...</div>
      ) : revenueByCity.length === 0 ? (
        <div className="text-[17px] text-[#686864] py-8 text-center">No geo data for <RangeText /> - orders need shipping addresses to show city data.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <KPICard label="Top city" value={topCity?.city ?? "-"} sub={topCity ? formatINR(topCity.revenue) : ""} />
            <KPICard label="Cities with orders" value={revenueByCity.length.toString()} sub="Unique delivery cities" />
            <KPICard
              label="Top city share"
              value={topCity ? `${Math.round((topCity.revenue / Math.max(totalRevenue, 1)) * 100)}%` : "-"}
              sub="of total revenue"
            />
            <KPICard label="Buyers tracked" value={totalBuyers.toString()} sub={`With location data · ${formatDateSpan(range.from, range.to)}`} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Card>
              <CardHeader title="City performance" right={`By revenue · ${formatDateSpan(range.from, range.to)}`} />
              <div className="overflow-x-auto">
                <table className="w-full text-[17px] border-collapse">
                  <thead>
                    <tr className="border-b border-black/[0.09]">
                      {["City", "Revenue", "Buyers", "Revenue share"].map(h => (
                        <th key={h} className="text-left py-1.5 px-1.5 text-[16px] font-semibold text-[#686864]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {merged.map((g, i) => (
                      <tr key={i} className="border-b border-black/[0.06] last:border-0 hover:bg-[#f7f7f5]">
                        <td className="py-1.5 px-1.5 font-medium">{g.city}</td>
                        <td className="py-1.5 px-1.5 font-semibold">{formatINR(g.revenue)}</td>
                        <td className="py-1.5 px-1.5">{g.customers > 0 ? g.customers : "-"}</td>
                        <td className="py-1.5 px-1.5">
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1 h-1.5 bg-[#f0f0ee] rounded-full overflow-hidden">
                              <div className="h-full bg-[#17a773] rounded-full" style={{ width: `${Math.round((g.revenue / totalRevenue) * 100)}%` }} />
                            </div>
                            <span className="text-[15px] text-[#686864] w-8 text-right">{Math.round((g.revenue / totalRevenue) * 100)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div>
              <Card className="mb-2">
                <CardHeader title="Revenue by city" />
                {revenueByCity.map((c, i) => (
                  <BarRow
                    key={i}
                    label={c.city}
                    pct={Math.round((c.revenue / maxRev) * 100)}
                    value={formatINR(c.revenue)}
                    color={cityColors[i % cityColors.length]}
                  />
                ))}
              </Card>

              <Card>
                <CardHeader title="Geo AI insights" />
                {topCity && (
                  <InsightCard title={`${topCity.city} is your top market`} body={`${Math.round((topCity.revenue / Math.max(totalRevenue, 1)) * 100)}% of revenue in ${formatDateSpan(range.from, range.to)}. Run city-specific Meta ads targeting ${topCity.city} for higher relevance and lower CPMs.`} />
                )}
                {revenueByCity.length >= 3 && (
                  <InsightCard type="info" title="Multi-city presence detected" body={`Revenue spread across ${revenueByCity.length} cities. Consider city-specific delivery speed messaging in ads - converts better in metros.`} />
                )}
                <InsightCard type="warning" title="Add ROAS by city" body="Connect Meta Ads and Google Ads to see which cities give the best return on ad spend." />
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
