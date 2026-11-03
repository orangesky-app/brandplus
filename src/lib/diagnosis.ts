// Growth Diagnosis engine. Takes the real numbers from Shopify, Meta, Google Ads and GA4 and
// answers one question for the owner: where is the money leaking (offer / COD, Meta, Google,
// store, spend level), how much, and what to do this week, this month and after.
// Pure function, no fetching. Every finding is built from the numbers passed in; when a source
// is missing that pillar says so instead of guessing.

export type PillarKey = "offer" | "meta" | "google" | "store" | "spend";
export type Severity = "high" | "medium" | "low";

export interface ShopDiagnosis {
  period: { days: number };
  orders: { placed: number; kept: number; keptRevenue: number; aov: number; itemsPerOrder: number; singleItemPct: number; discountPct: number; repeatPct: number };
  cod: { placed: number; cancelled: number; rto: number; failed: number; failRatePct: number; sharePct: number };
  prepaid: { placed: number; cancelled: number; rto: number; failed: number; failRatePct: number };
  highRisk: { tagged: number; failed: number };
  rtoTagsSeen: boolean;
  codes: { code: string; orders: number; aov: number; itemsPerOrder: number }[];
  topProducts: { title: string; units: number; avgPrice: number }[];
}
export interface MetaKpisLite {
  spend: number; purchases: number; purchaseValue: number; roas: number; leads: number;
  impressions: number; clicks: number; ctr: number; cpc: number; frequency: number;
  outboundClicks: number; lpv: number; atc: number; checkout: number;
}
export interface MetaCampaignLite { name: string; status: string; objective: string; spend: number; purchases: number; purchaseValue: number; leads: number; ctr: number; frequency: number }
export interface SegmentLite { label: string; spend: number; purchases: number; purchaseValue: number; leads: number; ctr: number }
export interface MetaAdLite { name: string; status: string; spend: number; purchases: number; leads: number; ctr: number; frequency: number }
export interface GadsCampaignLite { name: string; status: string; spend: number; conversions: number; conversionValue: number; roas: number }
export interface GadsLite { spend: number; conversions: number; conversionValue: number; roas: number; clicks: number; campaigns: GadsCampaignLite[] }
export interface Ga4Lite { sessions: number; itemsViewed: number; itemsAddedToCart: number; itemsCheckedOut: number; purchases: number }
export interface SavedCosts { shippingPerOrder?: number; rtoCostPerOrder?: number; gatewayPct?: number; cogsPerOrder?: number }

export interface DiagnosisInput {
  days: number;
  targetPerDay: number;
  shop: ShopDiagnosis | null;
  prevShop: ShopDiagnosis | null;
  meta: { kpis: MetaKpisLite; campaigns: MetaCampaignLite[] } | null;
  prevMeta: { kpis: MetaKpisLite } | null;
  segments: { gender: SegmentLite[]; age: SegmentLite[]; placement: SegmentLite[]; device: SegmentLite[] } | null;
  ads: MetaAdLite[] | null;
  gads: GadsLite | null;
  gadsNote: string | null;
  ga4: Ga4Lite | null;
  cogsPerOrder: number | null;   // from Shopify "Cost per item"; null = not set up
  costs: SavedCosts | null;      // what the owner typed on the Financial page
}

export interface Finding {
  id: string;
  pillar: PillarKey;
  severity: Severity;
  title: string;
  detail: string;
  fix: string;
  impact: number; // ₹ per month this costs (wasted spend or lost margin). 0 = can't be put in ₹.
}
export interface Pillar {
  key: PillarKey;
  label: string;
  status: "problem" | "watch" | "ok" | "no_data";
  impact: number;
  headline: string;
  findings: Finding[];
  wins: string[];
  missing?: string;
}
export interface PlanItem { text: string; why?: string; pillar: PillarKey | "general" }
export interface CheckRow { metric: string; now: string; target: string; grow: string; ok: boolean | null; hint: string }
export interface Diagnosis {
  pillars: Pillar[];          // biggest problem first
  biggest: Finding | null;
  totalImpact: number;
  economics: {
    aov: number; keptPerDay: number; placedPerDay: number;
    adSpendPerDay: number; costPerKept: number | null;
    breakEvenCpa: number | null; targetCpa: number | null; cpaIsEstimate: boolean;
    marginRatio: number;
  };
  math: {
    targetPerDay: number;
    atCurrentCost: number | null;   // ₹/day spend needed at today's cost per kept order
    atTargetCost: number | null;    // ₹/day spend needed after fixes
    note: string;
  };
  plan: { week1: PlanItem[]; weeks2to4: PlanItem[]; months2to3: PlanItem[] };
  checks: CheckRow[];
  timeline: { when: string; expect: string }[];
  dataNotes: string[];
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const pct = (n: number, d = 0) => `${n.toFixed(d)}%`;
const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const isSalesObjective = (o: string) => /SALES|CONVERSION|PRODUCT_CATALOG/i.test(o);
const shortList = (names: string[], n = 3) => names.slice(0, n).map(s => `"${s}"`).join(", ") + (names.length > n ? ` and ${names.length - n} more` : "");

export function buildDiagnosis(inp: DiagnosisInput): Diagnosis {
  const days = Math.max(inp.shop?.period.days ?? inp.days, 1);
  const month = 30 / days;
  const s = inp.shop, m = inp.meta?.kpis ?? null, g = inp.gads;
  const findings: Finding[] = [];
  const wins: Record<PillarKey, string[]> = { offer: [], meta: [], google: [], store: [], spend: [] };
  const dataNotes: string[] = [];
  const scaleTargets: string[] = []; // Meta segments / ads that beat the account average

  // ---------- Unit economics: what one kept order is worth before ads ----------
  const metaSpend = m?.spend ?? 0;
  const gadsSpend = g?.spend ?? 0;
  const adSpend = metaSpend + gadsSpend;
  const aov = s?.orders.aov ?? 0;
  const kept = s?.orders.kept ?? 0;
  const placed = s?.orders.placed ?? 0;
  const costPerKept = kept > 0 && adSpend > 0 ? adSpend / kept : null;
  const shipping = inp.costs?.shippingPerOrder ?? 0;
  const rtoCost = inp.costs?.rtoCostPerOrder || 80; // two-way courier on a returned COD parcel
  const gatewayPct = inp.costs?.gatewayPct ?? 0;
  const cogs = inp.cogsPerOrder ?? (inp.costs?.cogsPerOrder || null);
  let breakEvenCpa: number | null = null, targetCpa: number | null = null, cpaIsEstimate = true;
  if (aov > 0) {
    if (cogs != null && cogs > 0) {
      const rtoPerKept = s && kept > 0 ? (s.cod.rto * rtoCost) / kept : 0;
      breakEvenCpa = Math.max(aov - cogs - shipping - aov * gatewayPct / 100 - rtoPerKept, 0);
      targetCpa = breakEvenCpa * 0.7; // keep ~30% of the margin as profit
      cpaIsEstimate = false;
    } else {
      // No product cost on file: typical Indian D2C keeps ~50% of the order value before ads.
      breakEvenCpa = aov * 0.5;
      targetCpa = aov * 0.35;
      dataNotes.push("Product cost isn't set in Shopify, so the target ad cost per order is an estimate (35% of your average order). Add \"Cost per item\" on your products for an exact number.");
    }
  }
  const marginRatio = aov > 0 && breakEvenCpa != null ? Math.min(Math.max(breakEvenCpa / aov, 0.15), 0.8) : 0.4;

  // =================== OFFER & COD (Shopify) ===================
  if (s) {
    const adCostPerPlaced = placed > 0 ? adSpend / placed : 0;
    if (s.cod.placed >= 10) {
      const r = s.cod.failRatePct;
      if (r >= 25) {
        const impact = (s.cod.failed * adCostPerPlaced + s.cod.rto * rtoCost) * month;
        const vsPrepaid = s.prepaid.placed >= 5 ? ` Prepaid orders fail only ${pct(s.prepaid.failRatePct)}.` : "";
        findings.push({
          id: "cod_fail", pillar: "offer", severity: r >= 35 ? "high" : "medium",
          title: `${pct(r)} of COD orders never get paid`,
          detail: `${s.cod.failed} of ${s.cod.placed} cash-on-delivery orders were cancelled or returned (${s.cod.cancelled} cancelled, ${s.cod.rto} returned to origin).${vsPrepaid} COD is ${pct(s.cod.sharePct)} of your orders. You paid for the ad, and for the courier on returns, and got nothing.`,
          fix: "Confirm every COD order on WhatsApp or a call before shipping. Take a small advance (₹99-149) on COD, or give 5-10% off for paying online.",
          impact,
        });
      } else if (r < 15) wins.offer.push(`COD failure is only ${pct(r)} - healthy (under 15%).`);
    }
    if (s.highRisk.tagged >= 5) {
      const hitPct = Math.round((s.highRisk.failed / s.highRisk.tagged) * 100);
      findings.push({
        id: "cod_risk", pillar: "offer", severity: hitPct >= 40 ? "medium" : "low",
        title: `Courier flagged ${s.highRisk.tagged} COD orders as high return risk`,
        detail: `${s.highRisk.failed} of them (${pct(hitPct)}) did fail. The warning was right - these orders were shipped anyway.`,
        fix: "Don't ship orders tagged high RTO risk until the customer confirms or pays an advance.",
        impact: 0, // already inside the COD failure figure
      });
    }
    if (!s.rtoTagsSeen && s.cod.placed >= 10) dataNotes.push("Returned (RTO) parcels are only counted when your courier app tags the order in Shopify. If yours doesn't, real COD failure is higher than shown.");

    // Price / AOV change vs the previous period
    const p = inp.prevShop;
    if (p && p.orders.aov > 0 && p.orders.kept >= 10 && s.orders.kept > 0) {
      const aovChg = (s.orders.aov - p.orders.aov) / p.orders.aov;
      const perDayNow = s.orders.kept / days, perDayPrev = p.orders.kept / Math.max(p.period.days, 1);
      const ordChg = perDayPrev > 0 ? (perDayNow - perDayPrev) / perDayPrev : 0;
      const revNow = s.orders.keptRevenue / days, revPrev = p.orders.keptRevenue / Math.max(p.period.days, 1);
      if (aovChg <= -0.15 && revNow < revPrev) {
        findings.push({
          id: "aov_drop", pillar: "offer", severity: aovChg <= -0.3 ? "high" : "medium",
          title: `Average order fell ${pct(Math.abs(aovChg * 100))} without bringing more sales`,
          detail: `Average order went from ${inr(p.orders.aov)} to ${inr(s.orders.aov)}, while orders per day changed ${ordChg >= 0 ? "+" : ""}${pct(ordChg * 100)}. Daily sales are down from ${inr(revPrev)} to ${inr(revNow)}.`,
          fix: "Undo the price cut, or keep the lower price only inside a bundle (2-3 items) so the order value comes back up.",
          impact: (revPrev - revNow) * 30 * marginRatio,
        });
      } else if (aovChg >= 0.1) wins.offer.push(`Average order is up ${pct(aovChg * 100)} vs the previous period (${inr(p.orders.aov)} to ${inr(s.orders.aov)}).`);
    }

    // Basket size
    const bestCode = [...s.codes].filter(c => c.orders >= 3).sort((a, b) => b.itemsPerOrder - a.itemsPerOrder)[0];
    if (s.orders.kept >= 10 && s.orders.itemsPerOrder < 1.3 && s.orders.singleItemPct >= 75) {
      const unit = s.orders.itemsPerOrder > 0 ? s.orders.aov / s.orders.itemsPerOrder : s.orders.aov;
      findings.push({
        id: "basket", pillar: "offer", severity: "medium",
        title: `${pct(s.orders.singleItemPct)} of orders have just one item`,
        detail: `On average ${s.orders.itemsPerOrder} items per order. Ad cost is paid per order, so one more item per order is almost pure profit.${bestCode && bestCode.itemsPerOrder >= 1.8 ? ` Your code ${bestCode.code} already gets ${bestCode.itemsPerOrder} items per order.` : ""}`,
        fix: bestCode && bestCode.itemsPerOrder >= 1.8
          ? `Make the ${bestCode.code} offer the main offer on ads and the product page.`
          : "Add a bundle offer (Buy 2 save 10%, Buy 3 save 15%) and a 'frequently bought together' block on the product page.",
        impact: s.orders.kept * 0.2 * unit * month * marginRatio, // if 1 in 5 orders adds one item
      });
    }
    if (bestCode && bestCode.itemsPerOrder >= 1.8) wins.offer.push(`Code ${bestCode.code}: ${bestCode.orders} orders, ${bestCode.itemsPerOrder} items per order, ${inr(bestCode.aov)} average order.`);

    if (s.orders.discountPct >= 20 && s.orders.kept >= 10) {
      const discounts = s.orders.keptRevenue * s.orders.discountPct / (100 - s.orders.discountPct);
      findings.push({
        id: "discount", pillar: "offer", severity: s.orders.discountPct >= 30 ? "high" : "medium",
        title: `Discounts eat ${pct(s.orders.discountPct)} of the price`,
        detail: `${inr(discounts)} given away in discounts this period. Above 15% usually means the price is training buyers to wait for codes.`,
        fix: "Cap discounts at 10-15%. Use a free gift or bundle price instead of a bigger % off.",
        impact: discounts * ((s.orders.discountPct - 12) / s.orders.discountPct) * month,
      });
    }
    if (s.orders.repeatPct >= 25) wins.offer.push(`${pct(s.orders.repeatPct)} of orders are from repeat buyers - people come back.`);
    const top = s.topProducts[0];
    if (top) wins.offer.push(`Best seller: ${top.title} (${top.units} sold at ${inr(top.avgPrice)} average).`);
  }

  // Meta counting sales the store never kept (mostly cancelled COD)
  if (m && s && m.purchases >= 10 && kept > 0 && m.purchases > kept * 1.25) {
    findings.push({
      id: "meta_overcount", pillar: "offer", severity: "medium",
      title: `Meta counts ${m.purchases} sales, the store kept ${kept}`,
      detail: `Meta counts every order placed, including COD orders that were later cancelled or returned. So Meta learns to find people who order and don't pay, and its ROAS of ${m.roas.toFixed(2)}x looks better than reality.`,
      fix: "Send Meta only confirmed or prepaid orders as purchases (Conversions API / a 'confirmed order' event), and judge ads on the store's numbers, not Meta's.",
      impact: 0,
    });
  }

  // =================== META ===================
  let metaMissing: string | undefined;
  if (!m) metaMissing = "Connect Meta Ads to check campaigns, audiences and ads.";
  else if (m.spend <= 0) metaMissing = "No Meta ad spend in this period.";
  else {
    const camps = (inp.meta?.campaigns ?? []).filter(c => c.spend > 0);
    const salesMode = m.purchases >= 5 || m.leads < 10;
    const result = (x: { purchases: number; leads: number }) => (salesMode ? x.purchases : x.leads);
    const resultWord = salesMode ? "sales" : "leads";

    // Campaigns that spend and bring nothing
    const minSpend = Math.max(1500, m.spend * 0.03);
    const dead = camps.filter(c => c.spend >= minSpend && c.purchases === 0 && (isSalesObjective(c.objective) || c.leads === 0 || salesMode));
    if (dead.length) {
      const waste = dead.reduce((a, c) => a + c.spend, 0);
      const share = waste / m.spend;
      const leadOnes = dead.filter(c => c.leads > 0);
      findings.push({
        id: "meta_dead", pillar: "meta", severity: share >= 0.15 ? "high" : "medium",
        title: `${inr(waste)} spent on ${dead.length} campaign${dead.length > 1 ? "s" : ""} with zero sales`,
        detail: `${shortList(dead.map(c => c.name))} took ${pct(share * 100)} of Meta spend and brought no sales.${leadOnes.length ? ` ${leadOnes.length} of them got leads (${leadOnes.reduce((a, c) => a + c.leads, 0)}) but none turned into orders.` : ""}`,
        fix: "Pause these campaigns this week and move the budget to the campaigns that sell.",
        impact: waste * month,
      });
    }

    // Segments that don't buy (gender, age, placement, device)
    const acc = m.spend > 0 ? result(m) / m.spend : 0; // results per ₹
    const segFindings: { dim: string; seg: SegmentLite; excess: number }[] = [];
    const bestPerDim: string[] = [];
    if (inp.segments && result(m) >= 5) {
      const dims: [string, SegmentLite[]][] = [["Gender", inp.segments.gender], ["Age", inp.segments.age], ["Placement", inp.segments.placement], ["Device", inp.segments.device]];
      for (const [dim, list] of dims) {
        const total = list.reduce((a, b) => a + b.spend, 0);
        if (total <= 0) continue;
        for (const seg of list) {
          if (seg.spend / total < 0.08 || seg.spend < 1000) continue;
          const eff = result(seg) / seg.spend;
          if (eff < acc * 0.5) segFindings.push({ dim, seg, excess: seg.spend * (1 - eff / acc) });
        }
        const best = list.filter(x => x.spend / total >= 0.05 && result(x) >= 3).sort((a, b) => (result(b) / b.spend) - (result(a) / a.spend))[0];
        if (best && result(best) / best.spend >= acc * 1.2) {
          const cost = best.spend / result(best);
          bestPerDim.push(`${dim}: ${best.label} - ${result(best)} ${resultWord} at ${inr(cost)} each (account average ${inr(1 / acc)}).`);
          scaleTargets.push(`${dim.toLowerCase()} ${best.label}`);
        }
      }
    }
    if (segFindings.length) {
      segFindings.sort((a, b) => b.excess - a.excess);
      const topSeg = segFindings.slice(0, 4);
      const excess = topSeg.reduce((a, b) => a + b.excess, 0);
      findings.push({
        id: "meta_segments", pillar: "meta", severity: excess >= m.spend * 0.15 ? "high" : "medium",
        title: `Ads are shown to people who don't buy`,
        detail: topSeg.map(x => `${x.dim} ${x.seg.label}: ${inr(x.seg.spend)} spent, ${result(x.seg)} ${resultWord}${result(x.seg) > 0 ? ` (${inr(x.seg.spend / result(x.seg))} each)` : ""}`).join(". ") + `. Account average is ${inr(1 / acc)} per ${resultWord.slice(0, -1)}.`,
        fix: `Exclude or cut these from your sales campaigns: ${topSeg.map(x => x.seg.label).join(", ")}. Put the money behind the segments that work.`,
        impact: excess * month,
      });
    }
    wins.meta.push(...bestPerDim);

    // Budget spread over too many campaigns
    const perCampDay = camps.length ? m.spend / days / camps.length : 0;
    if (camps.length >= 6 && perCampDay < 1000) {
      findings.push({
        id: "meta_fragmented", pillar: "meta", severity: "medium",
        title: `Budget split over ${camps.length} campaigns (~${inr(perCampDay)}/day each)`,
        detail: `Meta needs about 50 results a week per ad set to learn who buys. At ${inr(perCampDay)} a day per campaign none of them get there, so they all stay in "learning" and cost more.`,
        fix: "Merge into 1 sales campaign (broad audience, 3-6 ads) plus 1 retargeting campaign. Same total budget, fewer pieces.",
        impact: 0,
      });
    }

    // Ad fatigue: CTR / CPC trend and frequency
    const prev = inp.prevMeta?.kpis;
    if (prev && prev.ctr > 0 && prev.clicks >= 200) {
      const ctrDrop = (prev.ctr - m.ctr) / prev.ctr;
      if (ctrDrop >= 0.2) {
        const extra = m.cpc > prev.cpc ? (m.cpc - prev.cpc) * m.clicks * month : 0;
        const tiredAds = (inp.ads ?? []).filter(a => a.spend >= m.spend * 0.05 && a.frequency >= 4);
        findings.push({
          id: "meta_fatigue", pillar: "meta", severity: ctrDrop >= 0.35 ? "high" : "medium",
          title: `People stopped clicking: CTR fell ${pct(ctrDrop * 100)}`,
          detail: `Click rate went from ${pct(prev.ctr, 2)} to ${pct(m.ctr, 2)} and cost per click from ${inr(prev.cpc)} to ${inr(m.cpc)}. Frequency is ${m.frequency.toFixed(1)}${tiredAds.length ? `; ${tiredAds.length} of your bigger ads are shown 4+ times to the same people (${shortList(tiredAds.map(a => a.name), 2)})` : ""}. The same ads have been seen too often.`,
          fix: "Make 8-12 new ads (short videos: unboxing, use, customer review). Launch 3-4 new ones every week.",
          impact: extra,
        });
      } else if (ctrDrop <= -0.1) wins.meta.push(`Click rate improved to ${pct(m.ctr, 2)} (was ${pct(prev.ctr, 2)}).`);
    } else if (m.frequency >= 4) {
      findings.push({
        id: "meta_fatigue", pillar: "meta", severity: "medium",
        title: `Same people see your ads ${m.frequency.toFixed(1)} times`,
        detail: `Average frequency is ${m.frequency.toFixed(1)}. Above 3-4 in a month, clicks usually drop and cost per sale climbs.`,
        fix: "Add fresh ads every week and widen the audience.",
        impact: 0,
      });
    }

    // Best ads
    const avgCost = result(m) > 0 ? m.spend / result(m) : Infinity;
    const goodAds = (inp.ads ?? []).filter(a => result(a) >= 3).map(a => ({ a, cost: a.spend / result(a) }))
      .filter(x => x.cost <= avgCost * 0.85).sort((x, y) => x.cost - y.cost).slice(0, 2);
    for (const { a, cost } of goodAds) {
      wins.meta.push(`Ad "${a.name}": ${result(a)} ${resultWord} at ${inr(cost)} each - make more like this.`);
      scaleTargets.push(`ad "${a.name}"`);
    }
    if (m.ctr >= 1.5) wins.meta.push(`Click rate ${pct(m.ctr, 2)} is above the 1.5% benchmark - ads grab attention.`);
  }

  // =================== GOOGLE ADS ===================
  let googleMissing: string | undefined;
  if (!g) googleMissing = inp.gadsNote ?? "Connect Google Ads to check search and shopping campaigns.";
  else if (g.spend <= 0) googleMissing = "No Google Ads spend in this period.";
  else {
    const camps = g.campaigns.filter(c => c.spend > 0);
    const minSpend = Math.max(1000, g.spend * 0.05);
    const dead = camps.filter(c => c.spend >= minSpend && c.conversions < 1);
    if (dead.length) {
      const waste = dead.reduce((a, c) => a + c.spend, 0);
      findings.push({
        id: "gads_dead", pillar: "google", severity: waste / g.spend >= 0.2 ? "high" : "medium",
        title: `${inr(waste)} on Google campaigns with no sales`,
        detail: `${shortList(dead.map(c => c.name))} spent ${pct((waste / g.spend) * 100)} of Google budget with zero conversions.`,
        fix: "Pause them, or cut to the search terms that convert. Check the search terms report for junk keywords.",
        impact: waste * month,
      });
    }
    const losing = camps.filter(c => c.conversions >= 1 && c.roas > 0 && c.roas < 1 && c.spend >= g.spend * 0.1);
    if (losing.length) {
      const loss = losing.reduce((a, c) => a + (c.spend - c.conversionValue), 0);
      findings.push({
        id: "gads_losing", pillar: "google", severity: "medium",
        title: `${losing.length} Google campaign${losing.length > 1 ? "s" : ""} return less than they cost`,
        detail: losing.slice(0, 3).map(c => `"${c.name}": ${inr(c.spend)} spent, ${inr(c.conversionValue)} back (${c.roas.toFixed(2)}x)`).join(". ") + ".",
        fix: "Lower bids or budget on these until ROAS is above 2x; move money to the campaigns that return more.",
        impact: loss * month,
      });
    }
    const goodCamps = camps.filter(c => c.roas >= 3 && c.conversions >= 3).sort((a, b) => b.roas - a.roas).slice(0, 2);
    for (const c of goodCamps) wins.google.push(`"${c.name}": ${c.roas.toFixed(2)}x return, ${Math.round(c.conversions)} sales - room to scale.`);
    if (!dead.length && !losing.length && g.roas >= 2) wins.google.push(`Google overall returns ${g.roas.toFixed(2)}x on ${inr(g.spend)}.`);
  }

  // =================== STORE (Meta funnel + GA4) ===================
  let storeMissing: string | undefined;
  let lpRate: number | null = null, convRate: number | null = null;
  if (m && m.outboundClicks >= 100) {
    lpRate = (m.lpv / m.outboundClicks) * 100;
    if (lpRate < 70) {
      const lost = m.outboundClicks * 0.8 - m.lpv;
      const cpcOut = m.spend / m.outboundClicks;
      findings.push({
        id: "store_speed", pillar: "store", severity: lpRate < 55 ? "high" : "medium",
        title: `Only ${pct(lpRate)} of ad clicks reach your page`,
        detail: `${m.outboundClicks.toLocaleString("en-IN")} people clicked the ad, ${m.lpv.toLocaleString("en-IN")} saw the page load. The rest left while it was loading. Healthy is 75-85%.`,
        fix: "Speed up the mobile page: compress images, remove unused apps, avoid heavy pop-ups. Test the ad link on 4G.",
        impact: Math.max(lost, 0) * cpcOut * month,
      });
    } else if (lpRate >= 80) wins.store.push(`${pct(lpRate)} of ad clicks load your page - fast enough.`);
  }
  if (inp.ga4 && inp.ga4.sessions >= 300 && s) {
    convRate = (placed / inp.ga4.sessions) * 100;
    if (convRate < 1.5) {
      const missed = inp.ga4.sessions * (1.5 - convRate) / 100;
      findings.push({
        id: "store_conv", pillar: "store", severity: convRate < 1 ? "high" : "medium",
        title: `Only ${pct(convRate, 2)} of visits turn into an order`,
        detail: `${inp.ga4.sessions.toLocaleString("en-IN")} visits, ${placed} orders. A healthy store converts 1.5-2%. At 1.5% that is ${Math.round(missed)} more orders from the same traffic.`,
        fix: "On the product page: real reviews with photos, a short product video, delivery date, clear price incl. shipping, easy return policy, and a sticky Add to Cart.",
        impact: missed * aov * month * marginRatio,
      });
    } else if (convRate >= 2) wins.store.push(`${pct(convRate, 2)} of visits order - above the 2% benchmark.`);
    const e = inp.ga4;
    if (e.itemsAddedToCart >= 50) {
      const coRate = (e.itemsCheckedOut / e.itemsAddedToCart) * 100;
      if (coRate < 35) findings.push({
        id: "store_checkout", pillar: "store", severity: "medium",
        title: `${pct(100 - coRate)} of carts never reach checkout`,
        detail: `${e.itemsAddedToCart.toLocaleString("en-IN")} items added to cart, ${e.itemsCheckedOut.toLocaleString("en-IN")} went to checkout. A surprise at the cart (shipping fee, COD fee, total) is the usual cause.`,
        fix: "Show the final price incl. shipping and COD fee on the product page, and add a one-page checkout. Start WhatsApp cart-recovery messages.",
        impact: 0,
      });
    }
  } else if (m && m.lpv >= 300 && m.purchases > 0) {
    convRate = (m.purchases / m.lpv) * 100; // fallback: Meta's own funnel
    if (convRate < 1.5) findings.push({
      id: "store_conv", pillar: "store", severity: convRate < 1 ? "high" : "medium",
      title: `Only ${pct(convRate, 2)} of ad visitors order`,
      detail: `${m.lpv.toLocaleString("en-IN")} page views from Meta ads, ${m.purchases} purchases. Healthy is 1.5-2%.`,
      fix: "On the product page: reviews with photos, a short video, delivery date, clear price, easy returns.",
      impact: m.lpv * (1.5 - convRate) / 100 * aov * month * marginRatio,
    });
  }
  if (m && m.lpv >= 300) {
    const atcRate = (m.atc / m.lpv) * 100;
    if (atcRate < 5) findings.push({
      id: "store_atc", pillar: "store", severity: "medium",
      title: `Only ${pct(atcRate, 1)} of visitors add to cart`,
      detail: `${m.lpv.toLocaleString("en-IN")} page views, ${m.atc.toLocaleString("en-IN")} add-to-carts. Healthy is 8-10%. The page doesn't convince, or the price feels high for what is shown.`,
      fix: "Lead with the offer and the main benefit above the fold, show the bundle price, add trust badges (COD, easy returns).",
      impact: 0,
    });
  }
  if (lpRate == null && convRate == null) storeMissing = "Needs Meta Ads (click to page) or Google Analytics (visits to orders) to check the store.";

  // =================== SPEND LEVEL ===================
  let spendMissing: string | undefined;
  if (!s) spendMissing = "Connect Shopify to compare ad cost with real orders.";
  else if (adSpend <= 0 || costPerKept == null) spendMissing = "No ad spend found in this period.";
  else if (breakEvenCpa != null && targetCpa != null) {
    if (costPerKept > breakEvenCpa) {
      findings.push({
        id: "spend_loss", pillar: "spend", severity: "high",
        title: `Each kept order costs ${inr(costPerKept)} in ads - more than it earns`,
        detail: `You keep about ${inr(breakEvenCpa)} per order before ads${cpaIsEstimate ? " (estimate)" : ""}. So every order loses ${inr(costPerKept - breakEvenCpa)}. Total ad spend ${inr(adSpend)} for ${kept} kept orders.`,
        fix: `Don't raise budget. Cut to the winning campaigns and ads until ad cost per kept order is under ${inr(targetCpa)}.`,
        impact: (costPerKept - breakEvenCpa) * kept * month,
      });
    } else if (costPerKept > targetCpa) {
      findings.push({
        id: "spend_thin", pillar: "spend", severity: "medium",
        title: `Ad cost per kept order is ${inr(costPerKept)} - profit is thin`,
        detail: `Break-even is about ${inr(breakEvenCpa)}${cpaIsEstimate ? " (estimate)" : ""}; healthy is under ${inr(targetCpa)}. Scaling now would grow sales but not profit.`,
        fix: `Fix the problems above first; scale only once it's under ${inr(targetCpa)}.`,
        impact: (costPerKept - targetCpa) * kept * month,
      });
    } else {
      wins.spend.push(`Ad cost per kept order is ${inr(costPerKept)} - under the ${inr(targetCpa)} target. Safe to raise budget step by step.`);
    }
  }

  // =================== Rank ===================
  const LABELS: Record<PillarKey, string> = { offer: "Offer & COD", meta: "Meta Ads", google: "Google Ads", store: "Store & website", spend: "Ad spend level" };
  const missingFor: Record<PillarKey, string | undefined> = {
    offer: !s ? "Connect Shopify to check orders, COD and offers."
      : s.orders.placed < 10 ? `Only ${s.orders.placed} orders in this period - pick a longer date range to judge the offer.` : undefined,
    meta: metaMissing, google: googleMissing, store: storeMissing, spend: spendMissing,
  };
  const pillars: Pillar[] = (Object.keys(LABELS) as PillarKey[]).map(key => {
    const fs = findings.filter(f => f.pillar === key).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.impact - a.impact);
    const impact = fs.reduce((a, f) => a + f.impact, 0);
    const hasData = !missingFor[key] || fs.length > 0;
    const status: Pillar["status"] = !hasData ? "no_data" : fs.some(f => f.severity === "high") ? "problem" : fs.length ? "watch" : "ok";
    const headline = !hasData ? missingFor[key]! : fs[0]?.title ?? (wins[key][0] ?? "Nothing wrong found here.");
    return { key, label: LABELS[key], status, impact, headline, findings: fs, wins: wins[key], missing: missingFor[key] };
  });
  // "Spend level" is the result of the other four (it goes red when they leak), so it is shown
  // last and kept out of the biggest-problem pick and the total, which would double count.
  const STATUS_RANK = { problem: 0, watch: 1, ok: 2, no_data: 3 };
  pillars.sort((a, b) => Number(a.key === "spend") - Number(b.key === "spend") || STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.impact - a.impact);
  const causes = pillars.filter(p => p.key !== "spend" && p.findings.length);
  const biggest = causes[0] ? [...causes[0].findings].sort((a, b) => b.impact - a.impact || SEV_RANK[a.severity] - SEV_RANK[b.severity])[0]
    : pillars.find(p => p.key === "spend")?.findings[0] ?? null;
  const pillarRank = new Map(pillars.map((p, i) => [p.key as string, i]));

  // =================== Math for the target ===================
  const keptPerDay = kept / days;
  const atCurrentCost = costPerKept != null ? inp.targetPerDay * costPerKept : null;
  const atTargetCost = targetCpa != null && targetCpa > 0 ? inp.targetPerDay * targetCpa : null;
  const mathNote = costPerKept == null
    ? "Needs Shopify orders and ad spend in the same period to work out."
    : costPerKept <= (targetCpa ?? 0)
      ? "Your cost per order is already healthy - the budget can grow toward this number in 20% steps."
      : `At today's cost, ${inp.targetPerDay} orders a day would need ${inr(atCurrentCost ?? 0)} a day. Fixing the problems above brings it toward ${inr(atTargetCost ?? 0)}.`;

  // =================== Plan of action ===================
  const has = (id: string) => findings.find(f => f.id === id);
  const week1: PlanItem[] = [], weeks2to4: PlanItem[] = [], months2to3: PlanItem[] = [];
  const cod = has("cod_fail");
  if (cod) {
    week1.push({ pillar: "offer", text: "Confirm every COD order on WhatsApp or a call before it ships. No reply in 24 hours = don't ship.", why: cod.title });
    week1.push({ pillar: "offer", text: "Add a ₹99-149 COD advance, or 5-10% off for paying online.", why: "Moves buyers to prepaid, which fails far less." });
  }
  if (has("cod_risk")) week1.push({ pillar: "offer", text: "Hold every order tagged high RTO risk until the customer confirms." });
  const dead = has("meta_dead");
  if (dead) week1.push({ pillar: "meta", text: "Pause the Meta campaigns with zero sales.", why: dead.title });
  const seg = has("meta_segments");
  if (seg) week1.push({ pillar: "meta", text: seg.fix });
  if (has("meta_fragmented")) week1.push({ pillar: "meta", text: `Merge into 1 sales campaign + 1 retargeting campaign${m ? ` at about ${inr(m.spend / days)}/day total` : ""}.` });
  const gd = has("gads_dead");
  if (gd) week1.push({ pillar: "google", text: "Pause the Google campaigns with zero sales.", why: gd.title });
  if (has("gads_losing")) week1.push({ pillar: "google", text: "Lower budget on Google campaigns returning under 1x." });
  if (has("spend_loss")) week1.push({ pillar: "spend", text: `Don't add budget. Keep only what brings orders under ${inr(targetCpa ?? 0)} each.` });
  if (has("meta_overcount")) week1.push({ pillar: "offer", text: "Judge ads on kept orders in Shopify, not on Meta's purchase count." });
  const basket = has("basket");
  if (basket) week1.push({ pillar: "offer", text: basket.fix });
  if (has("aov_drop")) week1.push({ pillar: "offer", text: "Bring back the earlier price, or keep the low price only in a bundle." });
  if (has("discount")) week1.push({ pillar: "offer", text: "Cap discounts at 10-15%; use a free gift instead of deeper % off." });
  if (has("store_speed")) week1.push({ pillar: "store", text: "Fix mobile page speed (images, apps, pop-ups). Target: 75%+ of clicks load the page." });
  if (has("store_checkout")) week1.push({ pillar: "store", text: "Show the full price with shipping and COD fee before checkout." });

  if (m && m.spend > 0) {
    weeks2to4.push({ pillar: "meta", text: "Make 8-12 new ads: short videos (unboxing, product in use, customer reviews), not just photos.", why: has("meta_fatigue")?.title });
    weeks2to4.push({ pillar: "meta", text: `Test 3-4 new ads every week. Turn off any ad that spends ${inr(Math.max((targetCpa ?? 500) * 2, 1000))} without a sale.` });
  }
  if (has("store_conv") || has("store_atc")) weeks2to4.push({ pillar: "store", text: "Rework the product page: photo reviews, a 15-second video, delivery date, clear returns, sticky Add to Cart." });
  if (scaleTargets.length) weeks2to4.push({ pillar: "meta", text: "Move budget toward what already works: " + scaleTargets.slice(0, 3).join(", ") + "." });
  if (g && g.spend > 0 && wins.google.length) weeks2to4.push({ pillar: "google", text: "Shift Google budget into the campaigns returning 3x or more." });
  weeks2to4.push({ pillar: "general", text: "Check the weekly numbers below every Monday." });
  // Biggest problem area's actions first (stable within an area).
  const byRank = (a: PlanItem, b: PlanItem) => (pillarRank.get(a.pillar) ?? 9) - (pillarRank.get(b.pillar) ?? 9);
  week1.sort(byRank); weeks2to4.sort(byRank);

  months2to3.push({ pillar: "spend", text: `Raise budget 20% every 3 days, only while ad cost per kept order stays under ${inr(targetCpa ?? 0)}.` });
  months2to3.push({ pillar: "store", text: "Turn on WhatsApp abandoned-cart and COD-confirmation flows." });
  months2to3.push({ pillar: "offer", text: s && s.orders.repeatPct < 20 ? `Repeat buyers are only ${pct(s.orders.repeatPct)} - send a second-order offer 15-20 days after delivery.` : "Reward repeat buyers with a second-order offer." });
  months2to3.push({ pillar: "general", text: "Add new sales channels once ads are profitable: marketplaces (Amazon, Flipkart, Meesho) and small influencer collaborations." });

  // =================== Weekly checks ===================
  const week4Cpa = targetCpa ? (costPerKept != null && costPerKept > targetCpa ? (costPerKept + targetCpa) / 2 : targetCpa) : null;
  const checks: CheckRow[] = [];
  const yes = (ok: boolean | null) => ok;
  checks.push({
    metric: "Ad click rate (Meta CTR)", hint: "Are the ads interesting?",
    now: m && m.spend > 0 ? pct(m.ctr, 2) : "-", target: "1.5%+", grow: "1.2%+",
    ok: m && m.spend > 0 ? yes(m.ctr >= 1.2) : null,
  });
  checks.push({
    metric: "Clicks that load the page", hint: "Is the site fast?",
    now: lpRate != null ? pct(lpRate) : "-", target: "75%+", grow: "70%+",
    ok: lpRate != null ? lpRate >= 70 : null,
  });
  checks.push({
    metric: "Visits that order", hint: "Does the page sell?",
    now: convRate != null ? pct(convRate, 2) : "-", target: "1.5%+", grow: "1.2%+",
    ok: convRate != null ? convRate >= 1.2 : null,
  });
  checks.push({
    metric: "COD cancelled or returned", hint: "Do COD buyers pay?",
    now: s && s.cod.placed >= 10 ? pct(s.cod.failRatePct) : "-", target: "under 25%", grow: "under 30%",
    ok: s && s.cod.placed >= 10 ? s.cod.failRatePct < 30 : null,
  });
  checks.push({
    metric: "Average order value", hint: "Is the offer pulling bigger baskets?",
    now: aov > 0 ? inr(aov) : "-", target: aov > 0 ? inr(aov * 1.15) : "-", grow: aov > 0 ? `${inr(aov)}+` : "-",
    ok: null,
  });
  checks.push({
    metric: "Ad cost per kept order", hint: "The one number that decides scaling",
    now: costPerKept != null ? inr(costPerKept) : "-", target: week4Cpa ? `under ${inr(week4Cpa)}` : "-", grow: targetCpa ? `under ${inr(targetCpa)}` : "-",
    ok: costPerKept != null && targetCpa ? costPerKept <= targetCpa : null,
  });

  // =================== Timeline ===================
  // Cost per kept order realistically closes about half the gap in the first month and reaches
  // the target in month 2; orders only grow from there, never backwards.
  const spendPerDay = adSpend / days;
  const tgt = inp.targetPerDay;
  const leaks = [has("cod_fail") && "COD failure under 25%", (has("meta_dead") || has("gads_dead")) && "zero-sale campaigns off", m && m.spend > 0 && "new ads live", has("store_speed") && "page loading faster"].filter(Boolean).join(", ");
  let timeline: { when: string; expect: string }[];
  if (keptPerDay >= tgt) {
    timeline = [
      { when: "Now", expect: `You already average ${keptPerDay.toFixed(1)} kept orders a day - above the ${tgt}/day goal. Raise the goal at the top of the page.` },
      { when: "Month 2-3", expect: "Grow budget 20% at a time while the weekly checks stay green." },
    ];
  } else if (costPerKept != null && targetCpa && spendPerDay > 0) {
    const w4Orders = spendPerDay / week4Cpa!;
    const m2 = Math.min(tgt, Math.max(spendPerDay / targetCpa, (keptPerDay + tgt) / 2, w4Orders));
    timeline = [
      { when: "Week 4", expect: `${leaks ? `Leaks closed: ${leaks}. ` : ""}Ad cost per kept order down to about ${inr(week4Cpa!)}, so the same ${inr(spendPerDay)}/day gives about ${w4Orders.toFixed(1)} kept orders a day (now ${keptPerDay.toFixed(1)}).` },
      { when: "Month 2", expect: `Cost per order near ${inr(targetCpa)}. Budget goes up 20% at a time while the checks stay green - about ${Math.round(m2)} orders a day.` },
      { when: "Month 3", expect: `${tgt} orders a day at about ${inr(tgt * targetCpa)}/day ad spend.` },
    ];
  } else {
    timeline = [
      { when: "Week 4", expect: leaks ? `Leaks closed: ${leaks}.` : "Weekly checks set up and tracked." },
      { when: "Month 2", expect: "Budget grows 20% at a time while the checks stay green." },
      { when: "Month 3", expect: `${tgt} orders a day, if the weekly checks hold.` },
    ];
  }

  return {
    pillars,
    biggest,
    totalImpact: findings.filter(f => f.pillar !== "spend").reduce((a, f) => a + f.impact, 0),
    economics: { aov, keptPerDay, placedPerDay: placed / days, adSpendPerDay: spendPerDay, costPerKept, breakEvenCpa, targetCpa, cpaIsEstimate, marginRatio },
    math: { targetPerDay: inp.targetPerDay, atCurrentCost, atTargetCost, note: mathNote },
    plan: { week1, weeks2to4, months2to3 },
    checks,
    timeline,
    dataNotes,
  };
}
