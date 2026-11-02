"use client";
import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WarnBanner } from "@/components/ui/warn-banner";
import { ExportButton } from "@/components/ui/export-button";
import { exportToCSV, exportToPDF, ExportSection } from "@/lib/export";
import { formatINR } from "@/lib/utils";
import { formatDateSpan, toLocalYMD } from "@/lib/date-range-context";
import { useMounted } from "@/components/ui/period";
import { fetchGoogleAds, gadsIssueText, type GadsCampaignRow, type GadsIssue, type GadsKpis } from "@/lib/gads-client";

interface MetaKpis { spend: number; roas: number; cac: number; purchases: number; purchaseValue: number; impressions: number; clicks: number; ctr: number }
interface MetaCampaign { id: string; name: string; status: string; spend: number; roas: number; purchases: number }
interface ShopifyKpis { grossSales: number; totalOrders: number; aov: number; newCustomers: number; returningCustomers: number; codOrders: number; prepaidOrders: number }

// Monday to today in the browser's local day (the Shopify/Meta APIs then interpret these
// YYYY-MM-DD dates in the store/account timezone). offsetWeeks: 0 = this week so far,
// -1 = the SAME weekdays last week, so a Monday isn't compared against a full 7 days.
function weekSoFar(offsetWeeks: number): { from: string; to: string; label: string; days: number } {
  const now = new Date();
  const elapsed = (now.getDay() + 6) % 7; // 0 on Monday
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - elapsed + offsetWeeks * 7);
  const end = new Date(monday); end.setDate(monday.getDate() + elapsed);
  const from = toLocalYMD(monday), to = toLocalYMD(end);
  return { from, to, label: formatDateSpan(from, to), days: elapsed + 1 };
}

export default function WeeklyPage() {
  const [metaConnected, setMetaConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [thisWeekMeta, setThisWeekMeta] = useState<MetaKpis | null>(null);
  const [lastWeekMeta, setLastWeekMeta] = useState<MetaKpis | null>(null);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [thisWeekShopify, setThisWeekShopify] = useState<ShopifyKpis | null>(null);
  const [lastWeekShopify, setLastWeekShopify] = useState<ShopifyKpis | null>(null);
  const [gads, setGads] = useState<GadsKpis | null>(null);
  const [gadsLast, setGadsLast] = useState<GadsKpis | null>(null);
  const [gadsCampaigns, setGadsCampaigns] = useState<GadsCampaignRow[]>([]);
  const [gadsIssue, setGadsIssue] = useState<GadsIssue | null>(null);
  const mounted = useMounted();

  const thisW = weekSoFar(0);
  const lastW = weekSoFar(-1);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [metaAccountRes, shopRes, shopLastRes, gadsThis, gadsPrev] = await Promise.all([
          fetch("/api/meta/accounts"),
          fetch(`/api/shopify/dashboard?from=${thisW.from}&to=${thisW.to}`),
          fetch(`/api/shopify/dashboard?from=${lastW.from}&to=${lastW.to}`),
          fetchGoogleAds(thisW.from, thisW.to),
          fetchGoogleAds(lastW.from, lastW.to),
        ]);
        const metaAccountJson = await metaAccountRes.json();
        const shopJson = await shopRes.json();
        const shopLastJson = await shopLastRes.json();
        if (!shopJson.error) setThisWeekShopify(shopJson.kpis);
        if (!shopLastJson.error) setLastWeekShopify(shopLastJson.kpis);
        if (gadsThis.data) { setGads(gadsThis.data.kpis); setGadsCampaigns(gadsThis.data.campaigns); }
        setGadsIssue(gadsThis.issue);
        if (gadsPrev.data) setGadsLast(gadsPrev.data.kpis);

        const connected = !metaAccountJson.error;
        setMetaConnected(connected);
        if (connected) {
          const [thisRes, lastRes] = await Promise.all([
            fetch(`/api/meta?from=${thisW.from}&to=${thisW.to}`),
            fetch(`/api/meta?from=${lastW.from}&to=${lastW.to}`),
          ]);
          const [thisJson, lastJson] = await Promise.all([thisRes.json(), lastRes.json()]);
          if (!thisJson.error) { setThisWeekMeta(thisJson.kpis); setCampaigns((thisJson.campaigns ?? []).slice(0, 8)); }
          if (!lastJson.error) setLastWeekMeta(lastJson.kpis);
        }
      } finally { setLoading(false); }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = (n: number) => formatINR(Math.round(n));
  const delta = (cur?: number, prev?: number) => (cur === undefined || !prev ? null : +(((cur - prev) / prev) * 100).toFixed(1));
  const deltaStr = (d: number | null) => (d === null ? "vs last week" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}% vs last week`);

  const s = thisWeekShopify, sl = lastWeekShopify, m = thisWeekMeta, ml = lastWeekMeta;
  const codPct = s && s.totalOrders > 0 ? Math.round((s.codOrders / s.totalOrders) * 100) : 0;
  const adSpend = (m?.spend ?? 0) + (gads?.spend ?? 0);
  const adSpendLast = (ml?.spend ?? 0) + (gadsLast?.spend ?? 0);
  const blendedRoas = adSpend > 0 && s ? +(s.grossSales / adSpend).toFixed(2) : null;       // store revenue ÷ ad spend (the real test)
  const blendedRoasLast = adSpendLast > 0 && sl ? +(sl.grossSales / adSpendLast).toFixed(2) : null;

  const revenueDelta = delta(s?.grossSales, sl?.grossSales);
  const ordersDelta = delta(s?.totalOrders, sl?.totalOrders);
  // Only when both weeks cover the same platforms, or a failed load reads as a swing.
  const spendComparable = (!m || !!ml) && (!gads || !!gadsLast);
  const spendDelta = spendComparable ? delta(adSpend, adSpendLast) : null;
  const roasDelta = delta(m?.roas, ml?.roas);
  const gRoasDelta = delta(gads?.roas, gadsLast?.roas);
  const blendedDelta = delta(blendedRoas ?? undefined, blendedRoasLast ?? undefined);

  // ── Action items from real data ──
  const actionItems: { color: string; title: string; sub: string }[] = [];
  if (metaConnected && campaigns.length > 0) {
    const zero = campaigns.filter(c => c.spend > 500 && c.roas === 0);
    if (zero.length) actionItems.push({ color: "bg-[#d94040]", title: `Pause ${zero.length} campaign${zero.length > 1 ? "s" : ""} with zero conversions`, sub: `${zero.map(c => c.name).join(", ")} - spending without returns. Reallocate budget.` });
    const best = campaigns.filter(c => c.roas >= 1.5).sort((a, b) => b.roas - a.roas)[0];
    if (best) actionItems.push({ color: "bg-[#e89820]", title: `Scale "${best.name}" - ROAS ${best.roas}×`, sub: "Top performer this week. Increase budget ~20% every 3 days while ROAS holds." });
  }
  const gLive = gadsCampaigns.filter(c => c.status !== "PAUSED" && c.spend > 0);
  if (gads && gads.spend >= 500 && gads.conversions === 0) {
    actionItems.push({ color: "bg-[#d94040]", title: `${fmt(gads.spend)} on Google Ads, 0 conversions`, sub: "Check that your conversion tag is working in Google Ads under Goals > Conversions. It can report a few hours late, so a same-day 0 isn't proof yet." });
  } else if (gads) {
    const dead = gLive.filter(c => c.conversions === 0 && c.spend >= 300);
    if (dead.length) actionItems.push({ color: "bg-[#d94040]", title: `Review ${dead.length} Google campaign${dead.length > 1 ? "s" : ""} with no conversions`, sub: `${dead.map(c => c.name).join(", ")} - spending without returns. Check the search terms, then pause or move the budget.` });
    const bestG = gLive.filter(c => c.roas >= 1.5).sort((a, b) => b.roas - a.roas)[0];
    if (bestG) actionItems.push({ color: "bg-[#e89820]", title: `Scale "${bestG.name}" - Google ROAS ${bestG.roas}×`, sub: "Top Google campaign this week. Raise the budget about 20% at a time while ROAS holds." });
  }
  if (blendedRoas !== null && blendedRoas < 1) actionItems.push({ color: "bg-[#d94040]", title: `Ads aren't paying back - blended ROAS ${blendedRoas}×`, sub: `You spent ${fmt(adSpend)} and the store made ${fmt(s?.grossSales ?? 0)}. Pause sub-1× campaigns and fix the worst funnel stage before adding budget.` });
  if (codPct > 50) actionItems.push({ color: "bg-[#3478d4]", title: `COD at ${codPct}% - add a prepaid incentive`, sub: "Offer ₹50–75 off prepaid orders to cut RTO and improve cash flow." });
  if ((s?.returningCustomers ?? 0) > 0) actionItems.push({ color: "bg-[#3478d4]", title: `Nurture ${s!.returningCustomers} repeat buyers`, sub: "They ordered again this week - enrol them in a VIP / loyalty flow." });
  if (!gads && !gadsIssue) actionItems.push({ color: "bg-[#d94040]", title: "Connect Google Ads - capture intent-based buyers", sub: "Search demand on your top GSC keywords converts higher than social. Adds a profitable channel + true blended ROAS." });

  const headline = (() => {
    if (loading) return "";
    if (!s) return "Connect Shopify to see your weekly headline.";
    const base = `${fmt(s.grossSales)} revenue from ${s.totalOrders} orders this week so far`;
    if (!metaConnected && !gads) return `${base}. Connect Meta or Google Ads to see ad ROAS.`;
    if (adSpend === 0) return `${base}. No ad spend recorded this week.`;
    const verdict = blendedRoas !== null
      ? blendedRoas >= 1.5 ? `Ads are working - ${blendedRoas}× blended ROAS.`
        : blendedRoas >= 1 ? `Ads roughly break even - ${blendedRoas}× blended ROAS.`
        : `Ads are losing money - ${blendedRoas}× blended ROAS (spent ${fmt(adSpend)}).`
      : "";
    return `${base}. ${verdict}`;
  })();

  // ── Export ──
  function buildSections(): ExportSection[] {
    return [
      { title: `Weekly Digest - ${thisW.label}`, headers: ["Metric", `This week (${thisW.label})`, `Last week (${lastW.label})`], rows: [
        ["Shopify Revenue", fmt(s?.grossSales ?? 0), fmt(sl?.grossSales ?? 0)],
        ["Orders", String(s?.totalOrders ?? 0), String(sl?.totalOrders ?? 0)],
        ["AOV", fmt(s?.aov ?? 0), fmt(sl?.aov ?? 0)],
        ["Meta Spend", fmt(m?.spend ?? 0), fmt(ml?.spend ?? 0)],
        ["Google Ads Spend", fmt(gads?.spend ?? 0), fmt(gadsLast?.spend ?? 0)],
        ["Blended ROAS", blendedRoas !== null ? `${blendedRoas}x` : "-", blendedRoasLast !== null ? `${blendedRoasLast}x` : "-"],
        ["Meta ROAS (attributed)", m ? `${m.roas}x` : "-", ml ? `${ml.roas}x` : "-"],
        ["Google Ads ROAS (attributed)", gads ? `${gads.roas}x` : "-", gadsLast ? `${gadsLast.roas}x` : "-"],
        ["Google Ads Conversions", gads ? String(Math.round(gads.conversions)) : "-", gadsLast ? String(Math.round(gadsLast.conversions)) : "-"],
        ["COD %", `${codPct}%`, "-"],
      ]},
      { title: "Meta campaigns this week", headers: ["Campaign", "Status", "Spend", "ROAS"], rows: campaigns.map(c => [c.name, c.status, fmt(c.spend), c.roas > 0 ? `${c.roas}x` : "-"]) },
      { title: "Google Ads campaigns this week", headers: ["Campaign", "Status", "Spend", "Conversions", "ROAS"], rows: gadsCampaigns.map(c => [c.name, c.status, fmt(c.spend), String(Math.round(c.conversions)), c.roas > 0 ? `${c.roas}x` : "-"]) },
      { title: "Action items", headers: ["#", "Action", "Detail"], rows: actionItems.map((a, i) => [i + 1, a.title, a.sub]) },
    ];
  }
  const sources = ["Shopify", metaConnected && "Meta", gads && "Google Ads"].filter(Boolean).join(" + ");
  const handleCSV = () => exportToCSV("skylitee-weekly", buildSections());
  const handlePDF = () => exportToPDF("skylitee-weekly", "Weekly Digest", `${thisW.label} vs ${lastW.label} · ${sources} live`, buildSections());

  const tiles = [
    { label: "Shopify Revenue", value: s ? fmt(s.grossSales) : "-", sub: `${s?.totalOrders ?? 0} orders · ${deltaStr(revenueDelta)}`, bg: "bg-[#e0f5ee]", color: "text-[#0d6b4f]" },
    { label: "Orders", value: s ? String(s.totalOrders) : "-", sub: `AOV ${fmt(s?.aov ?? 0)} · ${deltaStr(ordersDelta)}`, bg: "bg-[#f7f7f5]", color: "text-[#181816]" },
    { label: "Ad Spend", value: fmt(adSpend), sub: `${m && gads ? `Meta ${fmt(m.spend)} · Google ${fmt(gads.spend)} · ` : gads ? "Google Ads · " : m ? "Meta · " : ""}${deltaStr(spendDelta)}`, bg: "bg-[#f7f7f5]", color: adSpend > 0 ? "text-[#181816]" : "text-[#9e9e9a]" },
    { label: "Blended ROAS", value: blendedRoas !== null ? `${blendedRoas}×` : "-", sub: `store ÷ ad spend · ${deltaStr(blendedDelta)}`,
      bg: (blendedRoas ?? 0) >= 1.5 ? "bg-[#e0f5ee]" : (blendedRoas ?? 0) >= 1 ? "bg-[#fff3e0]" : "bg-[#fce8e8]",
      color: (blendedRoas ?? 0) >= 1.5 ? "text-[#0d6b4f]" : (blendedRoas ?? 0) >= 1 ? "text-[#e89820]" : "text-[#d94040]" },
    ...(m || !gads ? [{ label: "Meta ROAS", value: m && m.roas > 0 ? `${m.roas}×` : "-", sub: `attributed · ${deltaStr(roasDelta)}`, bg: "bg-[#f7f7f5]", color: "text-[#686864]" }] : []),
    ...(gads ? [{ label: "Google Ads ROAS", value: gads.conversionValue > 0 ? `${gads.roas}×` : "-", sub: `${Math.round(gads.conversions).toLocaleString("en-IN")} conversions · ${deltaStr(gRoasDelta)}`, bg: "bg-[#f7f7f5]", color: "text-[#686864]" }] : []),
    { label: "COD share", value: s ? `${codPct}%` : "-", sub: `${s?.prepaidOrders ?? 0} prepaid · ${s?.codOrders ?? 0} COD`, bg: codPct > 50 ? "bg-[#fce8e8]" : "bg-[#f7f7f5]", color: codPct > 50 ? "text-[#d94040]" : "text-[#181816]" },
  ];

  // A full week's estimate from the days so far, so it doesn't change meaning between Monday and Sunday.
  const fullWeek = (v: number) => (v / thisW.days) * 7;
  const fc = [
    { label: "Revenue", val: s ? fmt(Math.round(fullWeek(s.grossSales) * 1.05)) : "-", now: s?.grossSales ?? 0, color: "bg-[#17a773]" },
    { label: "Ad Spend", val: fmt(Math.round(fullWeek(adSpend) * 1.1)), now: adSpend, color: "bg-[#d94040]" },
    { label: "Orders", val: String(Math.round(fullWeek(s?.totalOrders ?? 0) * 1.05)), now: s?.totalOrders ?? 0, color: "bg-[#3478d4]" },
  ];

  return (
    <div>
      {!metaConnected && !gads && !gadsIssue && !loading && (
        <WarnBanner type="amber">
          <span className="font-semibold">No ad platform connected</span> - ad spend & ROAS are hidden. Shopify figures below are live. Connect Meta or Google Ads in Settings → Connections.
        </WarnBanner>
      )}
      {gadsIssue && !loading && (
        <WarnBanner type="amber">
          <span className="font-semibold">Google Ads isn&apos;t in these numbers.</span> {gadsIssueText(gadsIssue)}
        </WarnBanner>
      )}

      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><CalendarDays size={18} className="text-[#F97316]" /> Weekly Digest</h2>
          <p className="text-[17px] text-[#686864] mt-0.5">{mounted && <>This week so far <span className="font-medium text-[#181816]">{thisW.label}</span> vs same days last week <span className="font-medium text-[#181816]">{lastW.label}</span> · </>}{loading ? "Loading" : `${sources} live`}</p>
        </div>
        <ExportButton onExportCSV={handleCSV} onExportPDF={handlePDF} disabled={loading || !s} />
      </div>

      {loading ? (
        <div className="text-[17px] text-[#686864] py-12 text-center">Loading weekly data…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <div>
            {/* Headline */}
            <div className="bg-[#e0f5ee] border border-[#9FE1CB] rounded-xl px-3.5 py-3 mb-2">
              <div className="text-[16px] font-semibold text-[#064d38] mb-1.5 flex items-center gap-1.5">✨ This week&apos;s headline</div>
              <div className="text-[17px] font-medium text-[#0d6b4f] leading-relaxed">{headline}</div>
            </div>

            {/* This week vs last week */}
            <Card className="mb-2">
              <CardHeader title="This week vs last week" right={<span className="text-[15px] text-[#9e9e9a]">{thisW.label} vs {lastW.label}</span>} />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {tiles.map((t, i) => (
                  <div key={i} className={`text-center p-2.5 rounded-lg ${t.bg}`}>
                    <div className={`text-lg font-semibold ${t.color}`}>{t.value}</div>
                    <div className="text-[15px] text-[#686864] mt-0.5">{t.label}</div>
                    <div className="text-[14px] text-[#9e9e9a]">{t.sub}</div>
                  </div>
                ))}
              </div>
              {blendedRoas !== null && (
                <p className="text-[14px] text-[#9e9e9a] mt-2">Blended ROAS = store revenue ÷ all ad spend (the real payback). {m && gads ? "Meta and Google ROAS each count" : m ? "Meta ROAS only counts" : "Google Ads ROAS only counts"} the sales that platform claims, and ignore organic/repeat.</p>
              )}
            </Card>

            {/* Campaigns this week */}
            {metaConnected && campaigns.length > 0 && (
              <Card>
                <CardHeader title="Meta campaigns this week" right={<span className="text-[15px] text-[#9e9e9a]">{campaigns.length} active</span>} />
                <div className="space-y-1.5">
                  {campaigns.slice(0, 6).map(c => (
                    <div key={c.id} className="flex items-center justify-between text-[16px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.status === "ACTIVE" ? "bg-[#17a773]" : "bg-[#9e9e9a]"}`} />
                        <span className="text-[#686864] truncate">{c.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[#9e9e9a]">{fmt(c.spend)}</span>
                        <span className={`font-semibold ${c.roas >= 1.5 ? "text-[#0d6b4f]" : c.roas >= 1 ? "text-[#e89820]" : c.roas > 0 ? "text-[#d94040]" : "text-[#9e9e9a]"}`}>
                          {c.roas > 0 ? `${c.roas}×` : "-"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Google Ads campaigns this week */}
            {gLive.length > 0 && (
              <Card className="mt-2">
                <CardHeader title="Google Ads campaigns this week" right={<span className="text-[15px] text-[#9e9e9a]">{gLive.length} running</span>} />
                <div className="space-y-1.5">
                  {gLive.slice(0, 6).map(c => (
                    <div key={c.id} className="flex items-center justify-between text-[16px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#17a773]" />
                        <span className="text-[#686864] truncate">{c.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[#9e9e9a]">{fmt(c.spend)}</span>
                        <span className={`font-semibold ${c.roas >= 1.5 ? "text-[#0d6b4f]" : c.roas >= 1 ? "text-[#e89820]" : c.roas > 0 ? "text-[#d94040]" : "text-[#9e9e9a]"}`}>
                          {c.roas > 0 ? `${c.roas}×` : "-"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div>
            {/* Action items */}
            <Card className="mb-2">
              <CardHeader title="This week's action items" right={<Badge variant="amber">{actionItems.length} priority tasks</Badge>} />
              {actionItems.map((a, i) => (
                <div key={i} className="flex items-start gap-2.5 p-2.5 bg-[#f7f7f5] rounded-lg mb-1.5 last:mb-0">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] text-white font-semibold shrink-0 ${a.color}`}>{i + 1}</div>
                  <div>
                    <div className="text-[16px] font-semibold text-[#181816]">{a.title}</div>
                    <div className="text-[17px] text-[#686864] mt-0.5">{a.sub}</div>
                  </div>
                </div>
              ))}
            </Card>

            {/* Forecast */}
            <Card>
              <CardHeader title="Next week forecast" right={<span className="text-[15px] text-[#9e9e9a]">conservative</span>} />
              {s ? (
                <>
                  <div className="space-y-2">
                    {fc.map((f, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-[16px] text-[#686864] w-20">{f.label}</span>
                        <div className="flex-1 mx-2 h-1.5 bg-[#f0f0ee] rounded-full overflow-hidden">
                          <div className={`h-full ${f.color}`} style={{ width: "82%" }} />
                        </div>
                        <span className="text-[16px] font-semibold text-[#181816] w-20 text-right">{f.val}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[15px] text-[#686864] bg-[#f7f7f5] rounded-lg px-2.5 py-1.5">
                    Revenue/orders +5%, ad spend +10% on this week&apos;s daily pace ({thisW.days} day{thisW.days > 1 ? "s" : ""} so far{thisW.days < 3 ? ", so treat it as rough" : ""}). A planning estimate, not a guarantee.
                  </div>
                </>
              ) : (
                <div className="text-[17px] text-[#9e9e9a] py-4 text-center">Connect Shopify to see a forecast.</div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
