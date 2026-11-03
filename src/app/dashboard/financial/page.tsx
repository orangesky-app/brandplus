"use client";
import { useState, useEffect } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import { useDateRange, formatDateSpan, rangeDays } from "@/lib/date-range-context";
import { RangeText } from "@/components/ui/period";
import { fetchGoogleAds, gadsIssueText, type GadsIssue, type GadsKpis } from "@/lib/gads-client";
import { Settings2, ChevronDown, ChevronUp, TrendingUp, TrendingDown, AlertTriangle, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { Donut } from "@/components/ui/charts";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShopifyKpis {
  grossSales: number; totalOrders: number; aov: number;
  codOrders: number; prepaidOrders: number;
  totalDiscounts: number; refundedRevenue: number;
}

interface MetaKpis {
  spend: number; roas: number; cac: number; purchases: number; purchaseValue: number;
}

// /api/shopify/cogs - product cost from Shopify's "Cost per item".
export interface ShopifyCogs {
  status: "full" | "partial" | "none";
  orders: number;
  cogs: { actual: number; estimated: number; total: number; perOrder: number };
  coverage: { salesPct: number; coveredUnits: number; totalUnits: number };
  costRatioPct: number;
  missing: { title: string; units: number; sales: number }[];
  missingCount: number;
}

interface PLInputs {
  cogsPerOrder: number;
  shippingPerOrder: number;
  rtoRate: number;
  rtoCostPerOrder: number;
  monthlyOverheads: number;
  gatewayPct: number;
  codFeePct: number;
}

const STORAGE_KEY = "skylitee-pl-inputs";

const defaultInputs: PLInputs = {
  cogsPerOrder: 0,
  shippingPerOrder: 0,
  rtoRate: 25,
  rtoCostPerOrder: 80,
  monthlyOverheads: 0,
  gatewayPct: 2,
  codFeePct: 1.5,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function Row({ label, value, sub, deduct = false, bold = false, separator = false, highlight = false, muted = false }: {
  label: string; value: number | null; sub?: string;
  deduct?: boolean; bold?: boolean; separator?: boolean; highlight?: boolean; muted?: boolean;
}) {
  const isNegative = deduct || (value !== null && value < 0);
  const display = value === null ? "-" : `${isNegative && value > 0 ? "−" : ""}${formatINR(Math.abs(value))}`;
  return (
    <div className={cn(
      "flex items-start justify-between py-2 border-b border-black/[0.05] dark:border-white/[0.05] last:border-0",
      separator && "border-t-2 border-t-black/[0.1] dark:border-t-white/[0.1] mt-1 pt-3",
      highlight && "bg-[#FFF7ED] dark:bg-[#2A1A0E] -mx-4 px-4 rounded-none"
    )}>
      <div className="min-w-0">
        <div className={cn("text-[15px]", bold ? "font-semibold text-[#18181B] dark:text-[#F4F4F5]" : "text-[#52525B] dark:text-[#A1A1AA]", muted && "opacity-50")}>
          {label}
        </div>
        {sub && <div className="text-[13px] text-[#A1A1AA] mt-0.5">{sub}</div>}
      </div>
      <div className={cn(
        "text-[15px] font-semibold shrink-0 ml-4",
        bold ? "text-[17px]" : "",
        value === null || muted ? "text-[#A1A1AA]"
          : highlight ? (value >= 0 ? "text-[#F97316]" : "text-[#EF4444]")
          : isNegative && value > 0 ? "text-[#EF4444] dark:text-[#FCA5A5]"
          : value < 0 ? "text-[#EF4444] dark:text-[#FCA5A5]"
          : "text-[#18181B] dark:text-[#F4F4F5]"
      )}>{display}</div>
    </div>
  );
}

function InputField({ label, hint, value, onChange, prefix = "₹", suffix = "", min = 0, max = 100, step = 1, isPercent = false }: {
  label: string; hint: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; min?: number; max?: number; step?: number; isPercent?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[14px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">{label}</label>
        {isPercent && <span className="text-[14px] font-bold text-[#F97316]">{value}%</span>}
      </div>
      <div className="text-[13px] text-[#A1A1AA] mb-1.5">{hint}</div>
      {isPercent ? (
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(+e.target.value)}
          className="w-full accent-[#F97316]" />
      ) : (
        <div className="flex items-center gap-1.5 bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-lg px-2.5 py-1.5">
          <span className="text-[14px] text-[#A1A1AA]">{prefix}</span>
          <input
            type="number" min={min} step={step} value={value || ""}
            onChange={e => onChange(Math.max(0, +e.target.value))}
            placeholder="0"
            className="flex-1 bg-transparent text-[15px] font-semibold text-[#18181B] dark:text-[#F4F4F5] outline-none w-full"
          />
          {suffix && <span className="text-[14px] text-[#A1A1AA]">{suffix}</span>}
        </div>
      )}
    </div>
  );
}

// ── Visual margin bar ────────────────────────────────────────────────────────

function MarginBar({ segments }: { segments: { label: string; pct: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + Math.max(x.pct, 0), 0);
  return (
    <div>
      <div className="flex h-6 rounded-lg overflow-hidden mb-2">
        {segments.map((s, i) => {
          const w = total > 0 ? (Math.max(s.pct, 0) / total) * 100 : 0;
          return w > 1 ? (
            <div key={i} className={cn("h-full transition-all", s.color)} style={{ width: `${w}%` }}
              title={`${s.label}: ${s.pct.toFixed(1)}%`} />
          ) : null;
        })}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className={cn("w-2.5 h-2.5 rounded-sm shrink-0", s.color)} />
            <span className="text-[13px] text-[#52525B] dark:text-[#A1A1AA]">{s.label}</span>
            <span className="text-[13px] font-bold text-[#18181B] dark:text-[#F4F4F5] ml-auto">{s.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function FinancialPage() {
  const { range } = useDateRange();
  const [inputs, setInputs] = useState<PLInputs>(defaultInputs);
  const [saved, setSaved] = useState<PLInputs>(defaultInputs);
  const [showSetup, setShowSetup] = useState(false);
  const [metaConnected, setMetaConnected] = useState(false);
  const [shopify, setShopify] = useState<ShopifyKpis | null>(null);
  const [meta, setMeta] = useState<MetaKpis | null>(null);
  const [gads, setGads] = useState<GadsKpis | null>(null);
  const [gadsIssue, setGadsIssue] = useState<GadsIssue | null>(null);
  const [shopCogs, setShopCogs] = useState<ShopifyCogs | null>(null);
  const [loading, setLoading] = useState(true);

  // Load saved inputs from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = { ...defaultInputs, ...JSON.parse(raw) };
        setInputs(parsed);
        setSaved(parsed);
      }
    } catch { /* ignore */ }
  }, []);

  const saveInputs = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
    setSaved({ ...inputs });
    setShowSetup(false);
  };

  useEffect(() => {
    // A profit figure must never mix one period's sales with another's ad spend.
    let stale = false;
    setLoading(true);
    setShopify(null); setMeta(null); setGads(null); setGadsIssue(null); setShopCogs(null);
    (async () => {
      try {
        const [shopRes, metaAccRes, g, cogsJson] = await Promise.all([
          fetch(`/api/shopify/dashboard?from=${range.from}&to=${range.to}`),
          fetch("/api/meta/accounts"),
          fetchGoogleAds(range.from, range.to),
          // Optional: if this fails the page falls back to the typed-in cost per order.
          fetch(`/api/shopify/cogs?from=${range.from}&to=${range.to}`).then(r => r.json()).catch(() => null),
        ]);
        if (!stale && cogsJson && !cogsJson.error) setShopCogs(cogsJson);
        const shopJson = await shopRes.json();
        const metaAccJson = await metaAccRes.json();
        const connected = !metaAccJson.error;
        const metaJson = connected ? await (await fetch(`/api/meta?from=${range.from}&to=${range.to}`)).json() : null;
        if (stale) return;
        if (!shopJson.error) setShopify(shopJson.kpis);
        setMetaConnected(connected);
        if (metaJson && !metaJson.error) setMeta(metaJson.kpis);
        setGads(g.data?.kpis ?? null);
        setGadsIssue(g.issue);
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => { stale = true; };
  }, [range.from, range.to]);

  // ── P&L calculation ────────────────────────────────────────────────────────
  const grossSales      = shopify?.grossSales ?? 0;
  const totalOrders     = shopify?.totalOrders ?? 0;
  const codOrders       = shopify?.codOrders ?? 0;
  const prepaidOrders   = shopify?.prepaidOrders ?? 0;
  const discounts       = shopify?.totalDiscounts ?? 0;
  const refunds         = shopify?.refundedRevenue ?? 0;
  const aov             = shopify?.aov ?? 0;
  const netRevenue      = grossSales - discounts - refunds;

  // RTO: X% of COD orders × avg order value = lost revenue
  // RTO cost = number of RTO orders × cost per returned shipment
  const rtoOrders       = Math.round((saved.rtoRate / 100) * codOrders);
  const rtoRevenueLost  = Math.round(rtoOrders * aov); // revenue you don't collect
  const rtoCost         = Math.round(rtoOrders * saved.rtoCostPerOrder); // cost for reverse logistics
  const rtoTotal        = rtoRevenueLost + rtoCost;

  // Product cost: Shopify's "Cost per item" when the store has it, else the typed-in average.
  const cogsFromShopify = !!shopCogs && shopCogs.status !== "none";
  const cogsTotal       = cogsFromShopify ? shopCogs.cogs.total : Math.round(totalOrders * saved.cogsPerOrder);
  const cogsPerOrder    = cogsFromShopify ? shopCogs.cogs.perOrder : saved.cogsPerOrder;
  const shippingTotal   = Math.round(totalOrders * saved.shippingPerOrder);

  const codRevenue      = Math.round(codOrders * aov);
  const prepaidRevenue  = Math.round(prepaidOrders * aov);
  const codFeeTotal     = Math.round(codRevenue * (saved.codFeePct / 100));
  const gatewayFeeTotal = Math.round(prepaidRevenue * (saved.gatewayPct / 100));

  const grossProfit     = netRevenue - cogsTotal - shippingTotal - rtoTotal - codFeeTotal - gatewayFeeTotal;
  const metaSpend       = meta?.spend ?? 0;
  const googleSpend     = gads?.spend ?? 0;
  const adSpend         = metaSpend + googleSpend;
  const afterAdsProfit  = grossProfit - adSpend;

  // Pro-rate monthly overheads to the date range
  const days            = rangeDays(range);
  const overheadsForPeriod = Math.round((saved.monthlyOverheads / 30) * days);
  const netProfit       = afterAdsProfit - overheadsForPeriod;

  const grossMarginPct  = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
  const netMarginPct    = grossSales > 0 ? (netProfit / grossSales) * 100 : 0;
  // Sales each ad platform claims, per ₹1 across both.
  const adSalesValue    = (meta?.purchaseValue ?? 0) + (gads?.conversionValue ?? 0);
  const currentRoas     = adSpend > 0 ? +(adSalesValue / adSpend).toFixed(2) : 0;
  const hasAdValue      = adSalesValue > 0;

  // Break-even ROAS = revenue needed per ₹ of ad spend to cover all non-ad costs
  const nonAdCosts = cogsTotal + shippingTotal + rtoTotal + codFeeTotal + gatewayFeeTotal + overheadsForPeriod;
  const beRoas = adSpend > 0 && netRevenue > 0
    ? +((nonAdCosts + adSpend) / adSpend).toFixed(2)
    : null;

  const inputsConfigured = cogsPerOrder > 0 || saved.shippingPerOrder > 0;

  // ── Margin segments ────────────────────────────────────────────────────────
  const pctOf = (v: number) => grossSales > 0 ? (v / grossSales) * 100 : 0;
  const profitPct = netMarginPct;
  const segments = [
    { label: "Product cost", pct: pctOf(cogsTotal), color: "bg-[#94A3B8]" },
    { label: "Shipping", pct: pctOf(shippingTotal), color: "bg-[#64748B]" },
    { label: "RTO losses", pct: pctOf(rtoTotal), color: "bg-[#EF4444]" },
    { label: "Fees (COD/gateway)", pct: pctOf(codFeeTotal + gatewayFeeTotal), color: "bg-[#F97316]" },
    { label: "Meta ads", pct: pctOf(metaSpend), color: "bg-[#3B82F6]" },
    { label: "Google ads", pct: pctOf(googleSpend), color: "bg-[#EAB308]" },
    { label: "Overheads", pct: pctOf(overheadsForPeriod), color: "bg-[#8B5CF6]" },
    { label: profitPct >= 0 ? "Profit" : "Loss", pct: Math.abs(profitPct), color: profitPct >= 0 ? "bg-[#22C55E]" : "bg-[#DC2626]" },
  ].filter(s => s.pct > 0.5);

  if (loading) return <div className="text-[16px] text-[#A1A1AA] py-16 text-center">Loading financial data…</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold dark:text-[#F4F4F5] flex items-center gap-2"><Receipt size={18} className="text-[#F97316]" /> Financial P&amp;L</h2>
          <p className="text-[15px] text-[#A1A1AA] mt-0.5">
            <RangeText /> · Real data from Shopify{cogsFromShopify ? " (incl. product cost)" : ""}{metaConnected ? " + Meta" : ""}{gads ? " + Google Ads" : ""}
          </p>
        </div>
        <button onClick={() => setShowSetup(s => !s)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[15px] font-semibold bg-[#FFF7ED] dark:bg-[#2A1A0E] text-[#EA580C] dark:text-[#FB923C] border border-[#F97316]/30">
          <Settings2 size={13} />
          Your Costs
          {showSetup ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Setup panel */}
      {showSetup && (
        <Card className="mb-4 border-[#F97316]/30">
          <CardHeader title="Your cost setup" right="Saved to your browser" />
          <div className="text-[14px] text-[#A1A1AA] mb-4">
            We have your sales, ad spend, and orders from Shopify, Meta and Google Ads. Tell us your costs - we&apos;ll calculate the real profit.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {cogsFromShopify ? (
              <div className="rounded-lg bg-[#F0FDF4] dark:bg-[#052E16] border border-[#22C55E]/20 p-3">
                <div className="text-[14px] font-semibold text-[#15803D] dark:text-[#86EFAC]">Product cost: taken from Shopify</div>
                <div className="text-[13px] text-[#71717A] mt-1">
                  We read the &quot;Cost per item&quot; on each product in Shopify, so you don&apos;t need to type it here.
                  {shopCogs.status === "partial" && " Some products have no cost yet - see the list on this page."}
                </div>
              </div>
            ) : (
              <InputField
                label="Product cost per order (₹)"
                hint="What you paid to make or buy the products in each order. Tip: fill &quot;Cost per item&quot; on your products in Shopify and we'll use that automatically."
                value={inputs.cogsPerOrder}
                onChange={v => setInputs(i => ({ ...i, cogsPerOrder: v }))}
              />
            )}
            <InputField
              label="Shipping cost per order (₹)"
              hint="Average cost to ship one order out - BlueDart, Delhivery, Shiprocket etc."
              value={inputs.shippingPerOrder}
              onChange={v => setInputs(i => ({ ...i, shippingPerOrder: v }))}
            />
            <InputField
              label="RTO rate - COD orders that come back (%)"
              hint="What % of your COD orders are returned undelivered? Print-on-demand typically 20-40%"
              value={inputs.rtoRate}
              onChange={v => setInputs(i => ({ ...i, rtoRate: v }))}
              isPercent min={0} max={80} step={1}
            />
            <InputField
              label="Cost per RTO order (₹)"
              hint="Reverse shipping + handling cost when a COD order comes back to you"
              value={inputs.rtoCostPerOrder}
              onChange={v => setInputs(i => ({ ...i, rtoCostPerOrder: v }))}
            />
            <InputField
              label="Monthly overheads (₹)"
              hint="Rent, team salaries, tools, subscriptions - all fixed costs per month"
              value={inputs.monthlyOverheads}
              onChange={v => setInputs(i => ({ ...i, monthlyOverheads: v }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <InputField
                label="Payment gateway fee (%)"
                hint="Razorpay/Stripe charges on prepaid orders (usually 2%)"
                value={inputs.gatewayPct}
                onChange={v => setInputs(i => ({ ...i, gatewayPct: v }))}
                isPercent min={0} max={5} step={0.1}
              />
              <InputField
                label="COD collection fee (%)"
                hint="Fee courier charges for collecting COD amount (usually 1.5%)"
                value={inputs.codFeePct}
                onChange={v => setInputs(i => ({ ...i, codFeePct: v }))}
                isPercent min={0} max={5} step={0.1}
              />
            </div>
          </div>
          <button onClick={saveInputs}
            className="w-full py-2.5 bg-[#F97316] text-white rounded-xl text-[15px] font-bold hover:bg-[#EA580C] transition-colors">
            Save & Calculate P&amp;L
          </button>
        </Card>
      )}

      {/* Prompt if not configured */}
      {!inputsConfigured && !showSetup && (
        <div className="flex items-start gap-2 bg-[#FFFBEB] dark:bg-[#2D1C00] border border-[#EAB308]/30 rounded-xl p-3 mb-4">
          <AlertTriangle size={14} className="text-[#EAB308] shrink-0 mt-0.5" />
          <div>
            <div className="text-[14px] font-semibold text-[#92400E] dark:text-[#FCD34D]">Set your costs to get accurate profit numbers</div>
            <div className="text-[13px] text-[#A1A1AA] mt-0.5">Fill &quot;Cost per item&quot; on your products in Shopify (we read it automatically), and click &quot;Your Costs&quot; above for shipping and RTO. Without these, profit will show as ₹0 cost.</div>
          </div>
        </div>
      )}

      {/* Products sold with no cost in Shopify */}
      {shopCogs && shopCogs.missingCount > 0 && (shopCogs.status === "partial" || inputsConfigured) && (
        <div className="flex items-start gap-2 bg-[#FFFBEB] dark:bg-[#2D1C00] border border-[#EAB308]/30 rounded-xl p-3 mb-4">
          <AlertTriangle size={14} className="text-[#EAB308] shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-[#92400E] dark:text-[#FCD34D]">
              {shopCogs.status === "none"
                ? "No product costs found in Shopify"
                : `${shopCogs.missingCount} product${shopCogs.missingCount === 1 ? "" : "s"} sold with no cost in Shopify - estimated at ${shopCogs.costRatioPct}% of price`}
            </div>
            <div className="text-[13px] text-[#A1A1AA] mt-0.5">
              In Shopify go to Products → open the product → fill &quot;Cost per item&quot;. Profit here updates automatically.
              {shopCogs.status === "partial" && ` ${shopCogs.coverage.salesPct}% of what you sold already has a real cost.`}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {shopCogs.missing.map((m, i) => (
                <span key={i} className="text-[12px] bg-white dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.08] rounded-md px-2 py-0.5 text-[#52525B] dark:text-[#A1A1AA]">
                  {m.title} · {m.units} sold
                </span>
              ))}
              {shopCogs.missingCount > shopCogs.missing.length && (
                <span className="text-[12px] text-[#A1A1AA] px-1 py-0.5">+{shopCogs.missingCount - shopCogs.missing.length} more</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ── P&L Statement ────────────────────────────────── */}
        <Card>
          <CardHeader title="P&L Statement" right={formatDateSpan(range.from, range.to)} />

          <div className="text-[12px] font-bold text-[#A1A1AA] uppercase tracking-widest mt-2 mb-1">Money In</div>
          <Row label="Total sales" value={grossSales} bold sub={`${totalOrders} orders · from Shopify`} />
          <Row label="Discounts given to customers" value={discounts} deduct sub="Real from Shopify - coupons, offers applied" />
          <Row label="Refunds paid back" value={refunds} deduct sub="Real from Shopify - orders you refunded" />
          <Row label="What you actually collected" value={netRevenue} bold separator />

          <div className="text-[12px] font-bold text-[#A1A1AA] uppercase tracking-widest mt-3 mb-1">What It Cost to Fulfil Orders</div>
          <Row
            label="Product / manufacturing cost"
            value={cogsTotal}
            deduct
            sub={cogsFromShopify
              ? shopCogs.status === "full"
                ? `From Shopify "Cost per item" · ${shopCogs.coverage.totalUnits} items sold`
                : `From Shopify: ${formatINR(shopCogs.cogs.actual)} real + ${formatINR(shopCogs.cogs.estimated)} estimated (${shopCogs.missingCount} products have no cost)`
              : saved.cogsPerOrder > 0 ? `₹${saved.cogsPerOrder} × ${totalOrders} orders · your estimate` : "Not set - add Cost per item in Shopify or click Your Costs"}
            muted={cogsTotal === 0}
          />
          <Row
            label="Shipping (outward)"
            value={shippingTotal}
            deduct
            sub={saved.shippingPerOrder > 0 ? `₹${saved.shippingPerOrder} × ${totalOrders} orders` : "Not set - click Your Costs"}
            muted={saved.shippingPerOrder === 0}
          />
          <Row
            label="RTO losses (undelivered COD)"
            value={rtoTotal}
            deduct
            sub={`${rtoOrders} orders came back · ₹${formatINR(rtoRevenueLost)} not collected + ₹${formatINR(rtoCost)} reverse ship`}
          />
          <Row label="COD collection fee" value={codFeeTotal} deduct sub={`${saved.codFeePct}% on ${codOrders} COD orders`} />
          <Row label="Payment gateway fee" value={gatewayFeeTotal} deduct sub={`${saved.gatewayPct}% on ${prepaidOrders} prepaid orders (Razorpay etc.)`} />
          <Row
            label={`Gross profit (${grossMarginPct.toFixed(1)}% margin)`}
            value={grossProfit}
            bold separator
            sub={grossProfit >= 0 ? "Before marketing spend" : "Already in the red before ads"}
          />

          <div className="text-[12px] font-bold text-[#A1A1AA] uppercase tracking-widest mt-3 mb-1">Marketing</div>
          <Row
            label="Meta ad spend"
            value={metaSpend}
            deduct
            sub={meta ? `ROAS ${meta.roas}x · ₹1 spent → ₹${meta.roas} in sales` : "Meta not connected - connect for real ad spend"}
            muted={!meta}
          />
          <Row
            label="Google Ads spend"
            value={gads ? googleSpend : null}
            deduct
            sub={gads
              ? (gads.conversionValue > 0 ? `ROAS ${gads.roas}x · ₹1 spent → ₹${gads.roas} in sales` : `${Math.round(gads.conversions).toLocaleString("en-IN")} conversions · no ₹ value recorded`)
              : gadsIssueText(gadsIssue) ?? "Google Ads not connected - connect for real ad spend"}
            muted={!gads}
          />
          <Row label="After-ads profit" value={afterAdsProfit} bold separator />

          {saved.monthlyOverheads > 0 && (
            <>
              <div className="text-[12px] font-bold text-[#A1A1AA] uppercase tracking-widest mt-3 mb-1">Overheads</div>
              <Row
                label="Rent, team, tools"
                value={overheadsForPeriod}
                deduct
                sub={`₹${saved.monthlyOverheads.toLocaleString("en-IN")}/mo ÷ 30 × ${days} days`}
              />
            </>
          )}

          <div className={cn(
            "mt-3 -mx-4 px-4 py-4 rounded-b-2xl",
            netProfit >= 0 ? "bg-[#F0FDF4] dark:bg-[#052E16]" : "bg-[#FEF2F2] dark:bg-[#2D0A0A]"
          )}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-bold uppercase tracking-widest text-[#A1A1AA] mb-0.5">
                  {netProfit >= 0 ? "Net Profit" : "Net Loss"}
                </div>
                <div className={cn("text-[28px] font-black", netProfit >= 0 ? "text-[#15803D] dark:text-[#86EFAC]" : "text-[#DC2626] dark:text-[#FCA5A5]")}>
                  {netProfit >= 0 ? "" : "−"}{formatINR(Math.abs(netProfit))}
                </div>
                <div className="text-[14px] text-[#71717A] mt-0.5">
                  {netMarginPct >= 0
                    ? `For every ₹100 in sales, you kept ₹${Math.abs(netMarginPct).toFixed(1)}`
                    : `For every ₹100 in sales, you lost ₹${Math.abs(netMarginPct).toFixed(1)}`}
                </div>
              </div>
              {netProfit >= 0
                ? <TrendingUp size={32} className="text-[#22C55E] opacity-60" />
                : <TrendingDown size={32} className="text-[#EF4444] opacity-60" />}
            </div>
          </div>
        </Card>

        {/* ── Right panel ──────────────────────────────────── */}
        <div className="space-y-3">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
            {[
              {
                label: "Profit margin",
                value: `${Math.abs(netMarginPct).toFixed(1)}%`,
                sub: netMarginPct >= 15 ? "Healthy" : netMarginPct >= 5 ? "Thin - room to improve" : netMarginPct >= 0 ? "Very thin" : "Currently losing money",
                good: netMarginPct >= 10,
              },
              {
                label: "Gross margin",
                value: `${Math.max(0, grossMarginPct).toFixed(1)}%`,
                sub: "Before ads & overheads",
                good: grossMarginPct >= 30,
              },
              {
                label: hasAdValue ? `ROAS ${currentRoas}x` : "Ad ROAS",
                value: hasAdValue ? (currentRoas >= 3 ? "Good" : currentRoas >= 2 ? "OK" : "Below target") : "-",
                sub: hasAdValue ? `₹1 ad → ₹${currentRoas} sales${meta && gads ? " · Meta + Google" : ""}` : meta || gads ? "No ad sales tracked" : "Connect Meta or Google Ads",
                good: currentRoas >= 3,
              },
              {
                label: "Break-even ROAS",
                value: beRoas ? `${beRoas}x` : "-",
                sub: beRoas && currentRoas > 0
                  ? currentRoas >= beRoas ? "✓ You're above break-even" : `Need ${beRoas}x, have ${currentRoas}x`
                  : "Need ad + cost data",
                good: beRoas !== null && currentRoas >= beRoas,
              },
            ].map((s, i) => (
              <div key={i} className={cn(
                "rounded-2xl p-3 border",
                s.good ? "bg-[#F0FDF4] dark:bg-[#052E16] border-[#22C55E]/20" : "bg-[#FEF2F2] dark:bg-[#2D0A0A] border-[#EF4444]/20"
              )}>
                <div className="text-[13px] text-[#A1A1AA] mb-0.5">{s.label}</div>
                <div className={cn("text-[20px] font-black", s.good ? "text-[#15803D] dark:text-[#86EFAC]" : "text-[#DC2626] dark:text-[#FCA5A5]")}>{s.value}</div>
                <div className="text-[13px] text-[#71717A] mt-0.5">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Where your money goes */}
          {grossSales > 0 && (
            <Card>
              <CardHeader title="Where does your ₹100 go?" right="As % of gross sales" />
              <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr] gap-5 items-center">
                <Donut
                  segments={segments.filter(s => s.pct > 0).map(s => ({ label: s.label, value: s.pct, color: (s.color.match(/#([0-9A-Fa-f]{6})/)?.[0]) ?? "#94A3B8" }))}
                  centerValue={`${Math.abs(netMarginPct).toFixed(0)}%`}
                  centerLabel={netProfit >= 0 ? "profit" : "loss"}
                  size={150}
                />
                <MarginBar segments={segments} />
              </div>
            </Card>
          )}

          {/* Key insights in plain English */}
          <Card>
            <CardHeader title="What this means" />
            <div className="space-y-2.5">
              {netProfit >= 0 && netMarginPct >= 15 && (
                <div className="text-[14px] leading-relaxed border-l-[3px] border-l-[#22C55E] bg-[#F0FDF4] dark:bg-[#052E16] rounded-r-xl pl-3 py-2 pr-2">
                  <span className="font-bold text-[#15803D] dark:text-[#86EFAC]">Healthy business</span> - your margin of {netMarginPct.toFixed(1)}% means you&apos;re covering all costs with a solid buffer. Focus on scaling profitably.
                </div>
              )}
              {netProfit >= 0 && netMarginPct > 0 && netMarginPct < 15 && (
                <div className="text-[14px] leading-relaxed border-l-[3px] border-l-[#EAB308] bg-[#FFFBEB] dark:bg-[#2D1C00] rounded-r-xl pl-3 py-2 pr-2">
                  <span className="font-bold text-[#92400E] dark:text-[#FCD34D]">Thin margins</span> - you&apos;re profitable but any spike in ad costs or returns could flip it. The biggest lever is usually reducing RTO or improving ROAS.
                </div>
              )}
              {netProfit < 0 && (
                <div className="text-[14px] leading-relaxed border-l-[3px] border-l-[#EF4444] bg-[#FEF2F2] dark:bg-[#2D0A0A] rounded-r-xl pl-3 py-2 pr-2">
                  <span className="font-bold text-[#DC2626] dark:text-[#FCA5A5]">Currently unprofitable</span> - you&apos;re spending more than you&apos;re making. Don&apos;t increase ad spend yet. First figure out your biggest cost leak above.
                </div>
              )}
              {rtoTotal > adSpend && rtoTotal > 0 && (
                <div className="text-[14px] leading-relaxed border-l-[3px] border-l-[#EF4444] bg-[#FEF2F2] dark:bg-[#2D0A0A] rounded-r-xl pl-3 py-2 pr-2">
                  <span className="font-bold text-[#DC2626] dark:text-[#FCA5A5]">RTO is costing you more than ads</span> - {formatINR(rtoTotal)} lost to returns vs {formatINR(adSpend)} in ads. Add prepaid incentives (discount, free shipping on UPI) to reduce COD %.
                </div>
              )}
              {hasAdValue && beRoas && currentRoas < beRoas && (
                <div className="text-[14px] leading-relaxed border-l-[3px] border-l-[#F97316] bg-[#FFF7ED] dark:bg-[#2A1A0E] rounded-r-xl pl-3 py-2 pr-2">
                  <span className="font-bold text-[#EA580C] dark:text-[#FB923C]">Ads not yet profitable</span> - you need {beRoas}x ROAS to break even, currently at {currentRoas}x. Pause low-ROAS campaigns and tighten targeting before scaling.
                </div>
              )}
              {hasAdValue && beRoas && currentRoas >= beRoas && (
                <div className="text-[14px] leading-relaxed border-l-[3px] border-l-[#22C55E] bg-[#F0FDF4] dark:bg-[#052E16] rounded-r-xl pl-3 py-2 pr-2">
                  <span className="font-bold text-[#15803D] dark:text-[#86EFAC]">Ads are profitable</span> - your {currentRoas}x ROAS is above the {beRoas}x break-even. You can safely increase spend by 20-30% on winning campaigns.
                </div>
              )}
              {!inputsConfigured && (
                <div className="text-[14px] leading-relaxed border-l-[3px] border-l-[#A1A1AA] bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-r-xl pl-3 py-2 pr-2 text-[#71717A]">
                  Click &quot;Your Costs&quot; at the top to enter product cost, shipping, and RTO rate. These are required to show accurate profit numbers.
                </div>
              )}
            </div>
          </Card>

          {/* Unit economics */}
          {(meta || gads || shopify) && (
            <Card>
              <CardHeader title="Per-order economics" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { label: "Avg order value", value: aov > 0 ? formatINR(aov) : "-" },
                  { label: "Product cost", value: cogsPerOrder > 0 ? formatINR(cogsPerOrder) : "-" },
                  { label: "Shipping cost", value: saved.shippingPerOrder > 0 ? formatINR(saved.shippingPerOrder) : "-" },
                  { label: "CAC (from Meta)", value: meta?.cac ? formatINR(meta.cac) : "-" },
                  {
                    label: "Profit per order",
                    value: totalOrders > 0 && inputsConfigured
                      ? formatINR(Math.round(netProfit / totalOrders))
                      : "-",
                  },
                  {
                    label: "LTV estimate",
                    value: aov > 0 ? formatINR(aov * 2) : "-",
                  },
                ].map((s, i) => (
                  <div key={i} className="text-center bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl p-2.5">
                    <div className="text-[18px] font-black dark:text-[#F4F4F5]">{s.value}</div>
                    <div className="text-[12px] text-[#A1A1AA] mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
