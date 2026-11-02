import { formatINR } from "@/lib/utils";

// Plain-language layer for non-technical merchants. Pure functions over plain numbers so the
// same wording drives the Command Center "Simple" view AND the weekly summary email.
// Rule of thumb for every sentence here: no jargon (ROAS, CTR, CAC…) - say what it means in ₹.

export type Status = "good" | "warn" | "bad" | "off";

export interface PlainCampaign {
  name: string; objective: string; spend: number; purchases: number; purchaseValue: number;
  leads: number; clicks: number; impressions: number; frequency: number;
}

export interface PlainGoogleCampaign { name: string; spend: number; conversions: number; conversionValue: number }

export interface PlainInput {
  periodLabel: string;              // "today" | "yesterday" | "this month" | "last month" | "the last 7 days"
  storeHandle?: string;              // "my-store" (from my-store.myshopify.com) for admin links
  shop: {
    sales: number; orders: number; aov: number; codOrders: number;
    prepaidRevenue: number; codRevenue: number; newCustomers: number;
  } | null;
  salesChangePct?: number;           // vs previous period
  repeatRate?: number | null;        // % of customers who ordered again
  meta: { spend: number; purchaseValue: number; leads: number; clicks: number; impressions: number; frequency: number } | null;
  campaigns: PlainCampaign[];
  gads: { spend: number; conversionValue: number; conversions?: number; clicks?: number; impressions?: number } | null;
  gadsCampaigns?: PlainGoogleCampaign[]; // running campaigns only: paused ones can't be acted on
  gsc: { avgPosition: number; nearPage1: number; extraClicks: number; pending: boolean } | null;
  connected: { meta: boolean; google: boolean };
  breakEvenRoas: number | null;      // from the saved cost model, if any
  costsSet: boolean;
  rto: { rate: number; costPerOrder: number } | null;
}

export interface HealthTile { area: "Ads" | "Store" | "Customers" | "Google"; status: Status; headline: string; line: string }

export interface PlainAction {
  id: string;                        // stable across visits so Done / Not now sticks
  title: string;
  why: string;
  impact: number;                    // ₹, 0 = not estimable
  impactKind: "save" | "earn";
  source: "Meta" | "Shopify" | "Google" | "Setup";
  steps: string[];
  link?: { label: string; href: string; external: boolean };
}

export interface ExplainedMetric { label: string; value: string; sentence: string; flag: "good" | "warn" | "bad" | "info" }

export interface PlainReport { summary: string; health: HealthTile[]; actions: PlainAction[]; explained: ExplainedMetric[] }

const ADS_MANAGER = "https://adsmanager.facebook.com/adsmanager/manage/campaigns";
const EVENTS_MANAGER = "https://business.facebook.com/events_manager2";
const GSC_PERF = "https://search.google.com/search-console/performance/search-analytics";
const GADS_CAMPAIGNS = "https://ads.google.com/aw/campaigns";
const GADS_CONVERSIONS = "https://ads.google.com/aw/conversions";
const RESULT_OBJ = /SALES|CONVERSION|CATALOG|LEAD|MESSAGES/i;
const SALES_OBJ = /SALES|CONVERSION|CATALOG/i;

const per100 = (roas: number) => formatINR(Math.round(roas * 100));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shopAdmin = (h: string | undefined, path: string) =>
  h ? `https://admin.shopify.com/store/${h}${path}` : "https://admin.shopify.com";

// Stable short key from a campaign name - keeps action ids readable and URL-safe.
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

// Plain-text version for WhatsApp (*bold* is WhatsApp markup) and the email's text part.
export function reportText(r: PlainReport, title: string): string {
  const lines = [`*${title}*`, "", r.summary];
  const top = r.actions.slice(0, 3);
  if (top.length) {
    lines.push("", "*To do:*");
    top.forEach((a, n) => lines.push(`${n + 1}. ${a.title}${a.impact > 0 ? ` (≈ ${formatINR(a.impact)})` : ""}`));
  }
  return lines.join("\n");
}

export function buildPlainReport(i: PlainInput): PlainReport {
  const s = i.shop;
  // "today" / "this month" read fine on their own; "the last 7 days" needs "in".
  const inP = /^(today|yesterday|this |last month)/.test(i.periodLabel) ? i.periodLabel : `in ${i.periodLabel}`;
  const adSpend = (i.meta?.spend ?? 0) + (i.gads?.spend ?? 0);
  const adSales = (i.meta?.purchaseValue ?? 0) + (i.gads?.conversionValue ?? 0);
  const adRoas = adSpend > 0 ? adSales / adSpend : 0;
  const target = i.breakEvenRoas ? Math.max(i.breakEvenRoas, 1) : 3;
  const codPct = s && s.orders > 0 ? Math.round((s.codOrders / s.orders) * 100) : 0;

  const salesCamps = i.campaigns.filter(c => SALES_OBJ.test(c.objective) && c.spend > 0);
  const salesSpend = salesCamps.reduce((t, c) => t + c.spend, 0);
  const salesValue = salesCamps.reduce((t, c) => t + c.purchaseValue, 0);
  // Sales campaigns spending while Meta records ₹0 in sales but the store DID sell →
  // the pixel isn't reporting orders back to Meta.
  const pixelBroken = salesSpend > 0 && salesValue === 0 && (s?.orders ?? 0) > 0;
  const totalLeads = i.meta?.leads ?? 0;
  const leadSpend = i.campaigns.filter(c => /LEAD|MESSAGES/i.test(c.objective)).reduce((t, c) => t + c.spend, 0);
  const gConversions = i.gads?.conversions ?? 0;
  const gCamps = i.gadsCampaigns ?? [];

  /* ── Health tiles ── */
  const health: HealthTile[] = [];

  if (!i.connected.meta && !i.gads) {
    health.push({ area: "Ads", status: "off", headline: "Not connected", line: "Connect Meta or Google Ads to see if your ads make money." });
  } else if (pixelBroken) {
    health.push({ area: "Ads", status: "bad", headline: "Meta can't see your sales", line: `${formatINR(salesSpend)} spent, but no orders reported back. Fix the pixel first.` });
  } else if (adSpend === 0) {
    health.push({ area: "Ads", status: "off", headline: "No ad spend", line: `You didn't run ads ${inP}.` });
  } else if (adSales > 0) {
    const st: Status = adRoas >= target ? "good" : adRoas >= Math.max(1, target * 0.67) ? "warn" : "bad";
    health.push({
      area: "Ads", status: st,
      headline: `${per100(adRoas)} back per ₹100`,
      line: st === "good" ? `Above the ${per100(target)} healthy mark - ads are paying off.`
        : st === "warn" ? `Below the ${per100(target)} healthy mark - some campaigns need fixing.`
        : `Ads cost more than they bring. Healthy is ${per100(target)}+.`,
    });
  } else if (totalLeads > 0) {
    health.push({ area: "Ads", status: "good", headline: `${plural(totalLeads, "lead")} from ads`, line: `About ${formatINR(Math.round(leadSpend / totalLeads || adSpend / totalLeads))} per lead.` });
  } else if (gConversions > 0) {
    health.push({ area: "Ads", status: "warn", headline: `${plural(Math.round(gConversions), "conversion")} on Google`, line: "Google counted these but recorded no sale value, so we can't say if the ads paid off." });
  } else {
    health.push({ area: "Ads", status: "bad", headline: `${formatINR(adSpend)} spent, nothing back`, line: "No sales or leads tracked from your ads." });
  }

  if (!s) {
    health.push({ area: "Store", status: "off", headline: "No store data", line: "Shopify data couldn't load." });
  } else if (s.orders === 0) {
    health.push({ area: "Store", status: "bad", headline: "0 orders", line: `No orders ${inP}.` });
  } else {
    const ch = i.salesChangePct;
    let st: Status = ch === undefined ? "good" : ch >= 0 ? "good" : ch >= -20 ? "warn" : "bad";
    if (codPct > 60 && st === "good") st = "warn";
    health.push({
      area: "Store", status: st,
      headline: `${formatINR(s.sales)} · ${plural(s.orders, "order")}`,
      line: ch !== undefined && ch < 0 ? `Sales down ${Math.abs(ch)}% vs the period before.`
        : codPct > 60 ? `${codPct}% pay cash on delivery - money comes late, some orders return.`
        : ch !== undefined ? `Sales up ${ch}% vs the period before.` : "Orders are coming in.",
    });
  }

  if (i.repeatRate === null || i.repeatRate === undefined || !s) {
    health.push({ area: "Customers", status: "off", headline: "Not enough data", line: "Need more orders to judge repeat buying." });
  } else {
    const r = i.repeatRate;
    const st: Status = r >= 25 ? "good" : r >= 15 ? "warn" : "bad";
    health.push({
      area: "Customers", status: st,
      headline: `${r}% buy again`,
      line: st === "good" ? "Healthy stores are at 25%+ - customers like you." : "Healthy stores are at 25%+. A thank-you offer brings buyers back.",
    });
  }

  if (!i.connected.google) {
    health.push({ area: "Google", status: "off", headline: "Not connected", line: "Connect Google to see how people find you." });
  } else if (!i.gsc) {
    // This tile is about free search, so Google Ads or Analytics alone can't fill it.
    health.push({ area: "Google", status: "off", headline: "Search not connected", line: "Connect Search Console to see how people find you on Google." });
  } else if (i.gsc.pending) {
    health.push({ area: "Google", status: "off", headline: "Data still arriving", line: "Google shares search data 2-3 days late." });
  } else {
    const p = i.gsc.avgPosition;
    const st: Status = p > 0 && p <= 10 ? "good" : p <= 20 ? "warn" : "bad";
    health.push({
      area: "Google", status: st,
      headline: p <= 10 ? "On page 1 of Google" : `On page ${Math.ceil(p / 10)} of Google`,
      line: i.gsc.nearPage1 > 0 ? `${plural(i.gsc.nearPage1, "search")} almost on page 1 - a small push gets more visitors.`
        : st === "good" ? "Most people find you without scrolling." : "Few people look past page 1 - better product pages help.",
    });
  }

  /* ── Actions (₹-ranked) ── */
  const actions: PlainAction[] = [];
  const adsLink = { label: "Open Meta Ads Manager", href: ADS_MANAGER, external: true };

  if (pixelBroken) {
    actions.push({
      id: "fix-pixel", source: "Meta", impactKind: "save", impact: Math.round(salesSpend),
      title: "Fix your Meta pixel - Meta can't see your orders",
      why: `You spent ${formatINR(salesSpend)} on sales ads, but Meta recorded ₹0 in sales while your store got ${plural(s!.orders, "order")}. Without this, Meta can't find buyers for you.`,
      steps: [
        "In Shopify, open the Facebook & Instagram app (Sales channels).",
        "Go to Settings → Data sharing and set it to Maximum.",
        "In Meta Events Manager, open your pixel and click Test events.",
        "Place a small test order - check that a Purchase event shows up.",
      ],
      link: { label: "Open Events Manager", href: EVENTS_MANAGER, external: true },
    });
  }

  // Campaigns built for orders/leads that spent money and got nothing.
  const dead = i.campaigns.filter(c => RESULT_OBJ.test(c.objective) && c.spend >= 300 && c.purchases === 0 && c.leads === 0
    && !(pixelBroken && SALES_OBJ.test(c.objective)))
    .sort((a, b) => b.spend - a.spend);
  if (dead.length) {
    const waste = Math.round(dead.reduce((t, c) => t + c.spend, 0));
    actions.push({
      id: `pause-dead:${key(dead[0].name)}`, source: "Meta", impactKind: "save", impact: waste,
      title: dead.length === 1 ? `Pause "${dead[0].name}" - it brought nothing back` : `Pause ${dead.length} campaigns that brought nothing back`,
      why: `${dead.length === 1 ? "It" : "Together they"} spent ${formatINR(waste)} ${inP} with zero orders or leads${dead.length > 1 ? ` (biggest: "${dead[0].name}")` : ""}.`,
      steps: [
        "Open Meta Ads Manager → Campaigns tab.",
        `Find "${dead[0].name}"${dead.length > 1 ? ` and the other ${dead.length - 1}` : ""}.`,
        "Switch the toggle on the left to Off.",
        "Move that budget to your best campaign (shown below if you have one).",
      ],
      link: adsLink,
    });
  }

  // Sales campaigns returning less than they cost.
  const losing = salesCamps.filter(c => c.purchaseValue > 0 && c.purchaseValue < c.spend).sort((a, b) => (b.spend - b.purchaseValue) - (a.spend - a.purchaseValue));
  if (losing.length) {
    const c = losing[0];
    const loss = Math.round(losing.reduce((t, x) => t + (x.spend - x.purchaseValue), 0));
    actions.push({
      id: `fix-losing:${key(c.name)}`, source: "Meta", impactKind: "save", impact: loss,
      title: losing.length === 1 ? `Stop "${c.name}" losing money` : `${losing.length} campaigns are losing money`,
      why: `"${c.name}" got back ${per100(c.purchaseValue / c.spend)} for every ₹100 spent - less than it cost.${losing.length > 1 ? ` Together these lost ${formatINR(loss)}.` : ""}`,
      steps: [
        "Open Meta Ads Manager → Campaigns.",
        `Open "${c.name}" and look at its ads - turn off the ones with no purchases.`,
        "If the whole campaign stays below ₹100 back per ₹100 for 3 more days, turn it off.",
      ],
      link: adsLink,
    });
  }

  // Best campaign worth scaling.
  const winners = salesCamps.filter(c => c.purchaseValue / c.spend >= Math.max(target * 1.3, 3) && c.spend >= 1000)
    .sort((a, b) => b.purchaseValue / b.spend - a.purchaseValue / a.spend);
  if (winners.length && !pixelBroken) {
    const w = winners[0];
    const r = w.purchaseValue / w.spend;
    actions.push({
      id: `scale:${key(w.name)}`, source: "Meta", impactKind: "earn", impact: Math.round(w.spend * 0.2 * r),
      title: `Give "${w.name}" 20% more budget`,
      why: `It's your best campaign: every ₹100 here brought back ${per100(r)}. A bit more budget should bring more of the same.`,
      steps: [
        "Open Meta Ads Manager → Campaigns.",
        `Click the budget of "${w.name}" and raise it by 20% (not more - big jumps reset Meta's learning).`,
        "Wait 3–4 days, check it still brings good returns, then repeat.",
      ],
      link: adsLink,
    });
  }

  /* Google Ads. Skylitee only reads the account, so every step here is done in Google Ads itself. */
  const gadsLink = { label: "Open Google Ads", href: GADS_CAMPAIGNS, external: true };

  // Money going out with no conversions anywhere: suspect the tracking before the ads.
  if (i.gads && i.gads.spend >= 500 && gConversions === 0) {
    actions.push({
      id: "google-tracking", source: "Google", impactKind: "save", impact: Math.round(i.gads.spend),
      title: "Check that Google Ads can see your sales",
      why: `You spent ${formatINR(i.gads.spend)} on Google Ads ${inP} and it recorded no sales or enquiries. Google can report a few hours late, but if this stays at 0 your tracking is probably off.`,
      steps: [
        "In Google Ads, open Goals → Conversions → Summary.",
        "Check your purchase goal says Active, not Inactive or No recent conversions.",
        "If it doesn't, set it up through the Google & YouTube app in Shopify.",
        "Place a small test order and check it shows up within a day.",
      ],
      link: { label: "Open Google Ads conversions", href: GADS_CONVERSIONS, external: true },
    });
  }

  // Only when the account is converting elsewhere, or the fault is tracking rather than the campaign.
  const gDead = gConversions > 0 ? gCamps.filter(c => c.conversions === 0 && c.spend >= 300).sort((a, b) => b.spend - a.spend) : [];
  if (gDead.length) {
    const waste = Math.round(gDead.reduce((t, c) => t + c.spend, 0));
    actions.push({
      id: `google-dead:${key(gDead[0].name)}`, source: "Google", impactKind: "save", impact: waste,
      title: gDead.length === 1 ? `Check "${gDead[0].name}" - it brought nothing back` : `Check ${gDead.length} Google campaigns that brought nothing back`,
      why: `${gDead.length === 1 ? "It" : "Together they"} spent ${formatINR(waste)} ${inP} with no sales or enquiries, while your other Google campaigns did get some.`,
      steps: [
        "Open Google Ads → Campaigns.",
        `Find "${gDead[0].name}"${gDead.length > 1 ? ` and the other ${gDead.length - 1}` : ""} and look at what people searched or where the ads ran.`,
        "Pause it if nothing there looks like a buyer, and move the budget to your best campaign.",
      ],
      link: gadsLink,
    });
  }

  const gLosing = gCamps.filter(c => c.conversionValue > 0 && c.conversionValue < c.spend).sort((a, b) => (b.spend - b.conversionValue) - (a.spend - a.conversionValue));
  if (gLosing.length) {
    const c = gLosing[0];
    const loss = Math.round(gLosing.reduce((t, x) => t + (x.spend - x.conversionValue), 0));
    actions.push({
      id: `google-losing:${key(c.name)}`, source: "Google", impactKind: "save", impact: loss,
      title: gLosing.length === 1 ? `Stop "${c.name}" losing money on Google` : `${gLosing.length} Google campaigns are losing money`,
      why: `"${c.name}" got back ${per100(c.conversionValue / c.spend)} for every ₹100 spent - less than it cost.${gLosing.length > 1 ? ` Together these lost ${formatINR(loss)}.` : ""}`,
      steps: [
        "Open Skylitee's Google Ads Recommendations to see what's holding it back.",
        `In Google Ads, open "${c.name}" and turn off the ads, keywords or products with no sales.`,
        "If it stays below ₹100 back per ₹100 for another week, pause it.",
      ],
      link: { label: "See Google Ads recommendations", href: "/dashboard/gads/actions", external: false },
    });
  }

  const gWinners = gCamps.filter(c => c.spend >= 1000 && c.conversionValue / c.spend >= Math.max(target * 1.3, 3))
    .sort((a, b) => b.conversionValue / b.spend - a.conversionValue / a.spend);
  if (gWinners.length) {
    const w = gWinners[0];
    const r = w.conversionValue / w.spend;
    actions.push({
      id: `google-scale:${key(w.name)}`, source: "Google", impactKind: "earn", impact: Math.round(w.spend * 0.2 * r),
      title: `Give "${w.name}" 20% more budget on Google`,
      why: `Every ₹100 here brought back ${per100(r)}. A bit more budget should bring more of the same.`,
      steps: [
        "Open Google Ads → Campaigns.",
        `Raise the daily budget of "${w.name}" by 20%, not more, so Google's learning doesn't reset.`,
        "Wait a week, check it still pays back, then repeat.",
      ],
      link: gadsLink,
    });
  }

  // Tired ads.
  const tired = i.campaigns.filter(c => c.frequency >= 3.5 && c.spend > 0).sort((a, b) => b.spend - a.spend);
  if (tired.length) {
    const t = tired[0];
    actions.push({
      id: `refresh:${key(t.name)}`, source: "Meta", impactKind: "save", impact: Math.round(tired.reduce((x, c) => x + c.spend, 0) * 0.2),
      title: `Show fresh ads in "${t.name}"`,
      why: `The same people have seen it ${t.frequency.toFixed(1)} times. After 3, people get bored and each sale costs more.`,
      steps: [
        `Open "${t.name}" in Ads Manager.`,
        "Add 2–3 new ads: new photo or video, new first line.",
        "Keep the old ads running for 2 days, then turn off the weakest.",
      ],
      link: adsLink,
    });
  }

  // Ads people scroll past.
  if (i.meta && i.meta.impressions >= 5000) {
    const ctr = (i.meta.clicks / i.meta.impressions) * 100;
    if (ctr < 1) actions.push({
      id: "low-clicks", source: "Meta", impactKind: "earn", impact: 0,
      title: "Make your ads more eye-catching",
      why: `Only ${ctr.toFixed(1)} in 100 people who see your ads click on them. Good ads get 1 or more.`,
      steps: [
        "Use a real customer photo or short video instead of a plain product shot.",
        "Put the offer or benefit in the first line (e.g. \"Free shipping today\").",
        "Test 2–3 new ads against your current ones for a week.",
      ],
      link: adsLink,
    });
  }

  // Too much cash on delivery.
  if (s && codPct > 50 && s.orders >= 10) {
    const rtoSave = i.rto ? Math.round(s.codOrders * (i.rto.rate / 100) * i.rto.costPerOrder * 0.3) : 0;
    actions.push({
      id: "prepaid-offer", source: "Shopify", impactKind: "save", impact: rtoSave,
      title: "Offer ₹50–100 off for paying online",
      why: `${codPct}% of orders are cash on delivery - ${formatINR(s.codRevenue)} you haven't collected yet, and some will be returned unopened.${rtoSave > 0 ? " Moving even a third of them to prepaid cuts those returns." : ""}`,
      steps: [
        "In Shopify, go to Discounts → Create discount → Amount off order.",
        "Name it PREPAID, set ₹50–100, and limit it to online payment (or use your checkout app's prepaid offer).",
        "Show the offer on the product page and at checkout.",
      ],
      link: { label: "Open Shopify Discounts", href: shopAdmin(i.storeHandle, "/discounts"), external: true },
    });
  }

  // Customers not coming back.
  if (s && i.repeatRate !== null && i.repeatRate !== undefined && i.repeatRate > 0 && i.repeatRate < 20 && s.newCustomers >= 5) {
    actions.push({
      id: "win-back", source: "Shopify", impactKind: "earn", impact: Math.round(s.newCustomers * 0.05 * s.aov),
      title: "Bring past customers back with a thank-you offer",
      why: `Only ${i.repeatRate}% of customers buy again (healthy is 25%+). If just 5 in 100 of your new buyers come back, that's about ${formatINR(Math.round(s.newCustomers * 0.05 * s.aov))}.`,
      steps: [
        "In Shopify, go to Marketing → Automations.",
        "Turn on a \"Win back customers\" or \"Thank you\" email.",
        "Add a small discount code for the next order (e.g. 10% off).",
        "Optional: send the same offer on WhatsApp to past buyers.",
      ],
      link: { label: "Open Shopify Marketing", href: shopAdmin(i.storeHandle, "/marketing"), external: true },
    });
  }

  // Leads waiting for a reply.
  if (totalLeads > 0 && s && s.aov > 0) {
    const pipeline = Math.round(totalLeads * 0.12 * s.aov);
    actions.push({
      id: "reply-leads", source: "Meta", impactKind: "earn", impact: Math.round(pipeline * 0.25),
      title: `Reply to your ${plural(totalLeads, "lead")} within an hour`,
      why: `People who asked about your products are hot for a few hours only. Replying fast can turn about 12 in 100 into orders - around ${formatINR(pipeline)}.`,
      steps: [
        "Open Meta Business Suite → Inbox (WhatsApp, Messenger) and Leads Center.",
        "Reply to every new lead the same day - ideally within an hour.",
        "Save quick replies for common questions (price, delivery time, COD).",
      ],
      link: { label: "Open Meta Business Suite", href: "https://business.facebook.com/latest/inbox", external: true },
    });
  }

  // Google searches almost on page 1.
  if (i.gsc && !i.gsc.pending && i.gsc.nearPage1 >= 2 && s && s.aov > 0) {
    const val = Math.round(i.gsc.extraClicks * 0.02 * s.aov);
    actions.push({
      id: "google-page1", source: "Google", impactKind: "earn", impact: val,
      title: `Push ${plural(i.gsc.nearPage1, "search")} onto Google page 1`,
      why: `You show up just below page 1 for these searches. Moving up could bring ~${i.gsc.extraClicks} more visitors${val > 0 ? ` (≈ ${formatINR(val)} in sales)` : ""}.`,
      steps: [
        "Open the Search Console page in Skylitee to see which searches.",
        "Add those exact words to the matching product title and description.",
        "Link to that product from your home page or a blog post.",
      ],
      link: { label: "See the searches", href: "/dashboard/gsc", external: false },
    });
  }

  // Setup gaps - no ₹ yet, so they rank last.
  if (!i.connected.meta) actions.push({
    id: "connect-meta", source: "Setup", impactKind: "save", impact: 0,
    title: "Connect your Meta ads account",
    why: "We'll show which ads make money and which waste it.",
    steps: ["Go to Connections.", "Click Connect next to Meta and log in with Facebook.", "Pick your ad account."],
    link: { label: "Go to Connections", href: "/dashboard/connections", external: false },
  });
  if (!i.costsSet && s && s.orders > 0) actions.push({
    id: "set-costs", source: "Setup", impactKind: "earn", impact: 0,
    title: "Add your product costs (2 minutes)",
    why: "Then we can tell you if each sale makes profit - not just revenue.",
    steps: ["Open Financial P&L.", "Enter product cost, shipping and return cost per order.", "Save - the numbers here update automatically."],
    link: { label: "Open Financial P&L", href: "/dashboard/financial", external: false },
  });
  if (!i.connected.google) actions.push({
    id: "connect-google", source: "Setup", impactKind: "earn", impact: 0,
    title: "Connect Google",
    why: "See which Google searches bring you customers - free traffic you can grow.",
    steps: ["Go to Connections.", "Click Connect next to Google and pick your site."],
    link: { label: "Go to Connections", href: "/dashboard/connections", external: false },
  });

  // Urgent fix first, then by ₹ impact; setup (₹0) stays at the end.
  actions.sort((a, b) => (b.id === "fix-pixel" ? 1 : 0) - (a.id === "fix-pixel" ? 1 : 0) || b.impact - a.impact);

  /* ── Every number, explained ── */
  const explained: ExplainedMetric[] = [];
  if (adSpend > 0 && adSales > 0) explained.push({
    label: "Money back from ads", value: `${per100(adRoas)} per ₹100`,
    sentence: `For every ₹100 you spent on ads, you got back ${per100(adRoas)} in sales. Healthy stores get ${per100(target)} or more${i.breakEvenRoas ? " at your costs" : ""}.`,
    flag: adRoas >= target ? "good" : "bad",
  });
  // Both platforms running: the combined figure above can hide which one is pulling its weight.
  if (i.gads && i.gads.spend > 0 && i.gads.conversionValue > 0 && (i.meta?.spend ?? 0) > 0) {
    const gRoas = i.gads.conversionValue / i.gads.spend;
    explained.push({
      label: "Money back from Google Ads", value: `${per100(gRoas)} per ₹100`,
      sentence: `Google's own tracking says every ₹100 on Google Ads brought back ${per100(gRoas)}. Healthy stores get ${per100(target)} or more.`,
      flag: gRoas >= target ? "good" : "bad",
    });
  }
  if (i.gads && i.gads.spend > 0 && gConversions > 0) {
    const perConv = Math.round(i.gads.spend / gConversions);
    explained.push({
      label: "Cost per Google conversion", value: formatINR(perConv),
      sentence: `Each sale or enquiry Google counted cost about ${formatINR(perConv)}.${s && s.aov > 0 ? ` Your average order is ${formatINR(s.aov)}.` : ""}`,
      flag: s && s.aov > 0 ? (perConv <= s.aov * 0.4 ? "good" : perConv <= s.aov ? "warn" : "bad") : "info",
    });
  }
  if (s && s.newCustomers > 0 && adSpend > 0) {
    const cac = Math.round(adSpend / s.newCustomers);
    explained.push({
      label: "Cost to win a new customer", value: formatINR(cac),
      sentence: `You spent ${formatINR(cac)} on ads for each new customer. Their first order is worth about ${formatINR(s.aov)}.${cac > s.aov ? " That's more than they spend - you need them to buy again." : ""}`,
      flag: cac <= s.aov * 0.4 ? "good" : cac <= s.aov ? "warn" : "bad",
    });
  }
  if (s && s.orders > 0) {
    explained.push({ label: "Average order", value: formatINR(s.aov), sentence: `An average customer spends ${formatINR(s.aov)} per order.`, flag: "info" });
    explained.push({
      label: "Money already in your account", value: formatINR(s.prepaidRevenue),
      sentence: `${formatINR(s.prepaidRevenue)} of your ${formatINR(s.sales)} sales is already paid. ${formatINR(s.codRevenue)} is cash on delivery - collected only when delivered.`,
      flag: codPct > 60 ? "bad" : codPct > 40 ? "warn" : "good",
    });
  }
  if (i.meta && i.meta.impressions >= 1000) {
    const ctr = (i.meta.clicks / i.meta.impressions) * 100;
    explained.push({
      label: "People who clicked your ads", value: `${ctr.toFixed(1)} in 100`,
      sentence: `Out of every 100 people who saw your ads, ${ctr.toFixed(1)} clicked. Good ads get 1 or more.`,
      flag: ctr >= 1 ? "good" : "bad",
    });
  }
  if (i.meta && i.meta.frequency > 0) explained.push({
    label: "Times each person saw your ads", value: `${i.meta.frequency.toFixed(1)}×`,
    sentence: i.meta.frequency > 3 ? "Above 3 - people are getting bored of the same ads, so each sale costs more. Time for new ads."
      : "Under 3 - people aren't tired of your ads yet.",
    flag: i.meta.frequency > 3 ? "bad" : "good",
  });
  if (totalLeads > 0) explained.push({
    label: "Cost per lead", value: formatINR(Math.round((leadSpend || adSpend) / totalLeads)),
    sentence: `Each enquiry (form, WhatsApp or call) from ads cost about ${formatINR(Math.round((leadSpend || adSpend) / totalLeads))}.`,
    flag: "info",
  });
  if (i.repeatRate !== null && i.repeatRate !== undefined && s) explained.push({
    label: "Customers who buy again", value: `${i.repeatRate}%`,
    sentence: `${i.repeatRate} out of 100 customers ordered more than once. Healthy stores are at 25 or more.`,
    flag: i.repeatRate >= 25 ? "good" : i.repeatRate >= 15 ? "warn" : "bad",
  });
  if (i.gsc && !i.gsc.pending && i.gsc.avgPosition > 0) explained.push({
    label: "Your spot on Google", value: `#${Math.round(i.gsc.avgPosition)}`,
    sentence: `On average your store shows at position ${Math.round(i.gsc.avgPosition)} in Google results. 1–10 is page 1, where most clicks happen.`,
    flag: i.gsc.avgPosition <= 10 ? "good" : i.gsc.avgPosition <= 20 ? "warn" : "bad",
  });

  /* ── One-sentence summary ── */
  const parts: string[] = [];
  if (s) {
    const ch = i.salesChangePct;
    parts.push(`${inP[0].toUpperCase()}${inP.slice(1)} you sold ${formatINR(s.sales)} from ${plural(s.orders, "order")}${ch !== undefined ? ` (${ch >= 0 ? "up" : "down"} ${Math.abs(ch)}%)` : ""}.`);
  }
  if (adSpend > 0) parts.push(adSales > 0 && !pixelBroken
    ? `You spent ${formatINR(adSpend)} on ads and got back ${per100(adRoas)} for every ₹100.`
    : `You spent ${formatINR(adSpend)} on ads.`);
  const issues = health.filter(h => h.status === "bad" || h.status === "warn").length;
  parts.push(issues === 0 ? "Everything we can see looks healthy." : `${plural(issues, "area needs", "areas need")} your attention - start with the list below.`);

  return { summary: parts.join(" "), health, actions, explained };
}
