import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { plainDashes } from "@/lib/utils";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { shopify, meta, gads, gsc, ga4, period } = body as {
    shopify: Record<string, unknown> | null;
    meta: Record<string, unknown> | null;
    gads: Record<string, unknown> | null;
    gsc: Record<string, unknown> | null;
    ga4: Record<string, unknown> | null;
    period: { from: string; to: string };
  };

  if (!shopify && !meta && !gads && !gsc && !ga4) {
    return NextResponse.json({ error: "No platform data provided." }, { status: 400 });
  }

  const lines: string[] = [`Period: ${period.from} to ${period.to}`, ""];

  if (shopify) {
    const k = shopify.kpis as Record<string, number>;
    const totalOrders = k.totalOrders ?? 0;
    const codPct = totalOrders ? Math.round(((k.codOrders ?? 0) / totalOrders) * 100) : 0;
    lines.push("=== SHOPIFY ===");
    lines.push(`Revenue: Rs.${(k.grossSales ?? 0).toLocaleString("en-IN")}, Orders: ${totalOrders}, AOV: Rs.${k.aov ?? 0}`);
    lines.push(`New customers: ${k.newCustomers ?? 0}, Returning: ${k.returningCustomers ?? 0}`);
    lines.push(`COD: ${k.codOrders ?? 0} orders (${codPct}%), Prepaid: ${k.prepaidOrders ?? 0} orders`);
    const top = (shopify.topByRevenue as {name: string; revenue: number}[])?.slice(0, 3) ?? [];
    if (top.length) lines.push(`Top products: ${top.map(p => `${p.name} (Rs.${p.revenue?.toLocaleString("en-IN")})`).join(", ")}`);
    const cities = (shopify.topCities as {city: string; orders: number}[])?.slice(0, 3) ?? [];
    if (cities.length) lines.push(`Top cities: ${cities.map(c => `${c.city} (${c.orders} orders)`).join(", ")}`);
    lines.push("");
  }

  if (meta) {
    const k = meta.kpis as Record<string, number>;
    lines.push("=== META ADS ===");
    lines.push(`Spend: Rs.${(k.spend ?? 0).toLocaleString("en-IN")}, ROAS: ${k.roas ?? 0}x, CAC: Rs.${k.cac ?? 0}`);
    lines.push(`Purchases: ${k.purchases ?? 0}, Revenue: Rs.${(k.purchaseValue ?? 0).toLocaleString("en-IN")}`);
    lines.push(`CTR: ${k.ctr ?? 0}%, CPC: Rs.${k.cpc ?? 0}, Frequency: ${k.frequency ?? 0}`);
    lines.push(`ATC: ${k.atc ?? 0}, Checkout: ${k.checkout ?? 0}, ATC ratio: ${k.atcRatio ?? 0}%, Checkout ratio: ${k.checkoutRatio ?? 0}%`);
    const campaigns = meta.campaigns as {name: string; roas: number; spend: number}[];
    if (campaigns?.length) {
      const top = [...campaigns].sort((a, b) => b.roas - a.roas).slice(0, 3);
      lines.push(`Top campaigns: ${top.map(c => `"${c.name}" ROAS ${c.roas}x, spend Rs.${(c.spend ?? 0).toLocaleString("en-IN")}`).join(" | ")}`);
    }
    lines.push("");
  }

  if (gads) {
    const k = gads.kpis as Record<string, number>;
    lines.push("=== GOOGLE ADS ===");
    lines.push(`Spend: Rs.${(k.spend ?? 0).toLocaleString("en-IN")}, ROAS: ${k.roas ?? 0}x, Cost per conversion: Rs.${k.costPerConversion ?? 0}`);
    // Google's total across every conversion goal, which may include more than purchases.
    lines.push(`Conversions: ${Math.round(k.conversions ?? 0)}, Conversion value: Rs.${(k.conversionValue ?? 0).toLocaleString("en-IN")}`);
    lines.push(`Clicks: ${k.clicks ?? 0}, Impressions: ${k.impressions ?? 0}, CTR: ${k.ctr ?? 0}%, Avg CPC: Rs.${k.avgCpc ?? 0}`);
    const campaigns = gads.campaigns as {name: string; roas: number; spend: number; conversions: number}[];
    if (campaigns?.length) {
      const top = [...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 3);
      lines.push(`Top campaigns by spend: ${top.map(c => `"${c.name}" ROAS ${c.roas}x, spend Rs.${(c.spend ?? 0).toLocaleString("en-IN")}, ${Math.round(c.conversions ?? 0)} conversions`).join(" | ")}`);
    }
    lines.push("");
  }

  if (gsc) {
    const k = gsc.kpis as Record<string, number>;
    lines.push("=== GOOGLE SEARCH CONSOLE ===");
    lines.push(`Clicks: ${k.clicks ?? 0}, Impressions: ${k.impressions ?? 0}, CTR: ${k.ctr ?? 0}%, Avg position: ${(k.avgPosition ?? 0).toFixed(1)}`);
    const kws = gsc.keywords as {query: string; clicks: number; position: number}[];
    if (kws?.length) lines.push(`Top keywords: ${kws.slice(0, 5).map(k => `"${k.query}" (${k.clicks} clicks, pos ${(k.position ?? 0).toFixed(1)})`).join(", ")}`);
    lines.push("");
  }

  if (ga4) {
    const k = ga4.kpis as Record<string, number | string>;
    lines.push("=== GOOGLE ANALYTICS 4 ===");
    lines.push(`Sessions: ${k.sessions ?? 0}, Users: ${k.users ?? 0}, Bounce: ${Number(k.bounceRate ?? 0).toFixed(1)}%, Avg session: ${k.avgSessionMin ?? "-"}`);
    lines.push(`New users: ${k.newUsers ?? 0}, Pageviews: ${k.pageviews ?? 0}`);
    const channels = ga4.channels as {channel: string; sessions: number}[];
    if (channels?.length) lines.push(`Channels: ${channels.slice(0, 4).map(c => `${c.channel} (${c.sessions} sessions)`).join(", ")}`);
    const ec = ga4.ecommerce as Record<string, number> | null;
    if (ec) lines.push(`Ecommerce - ATC rate: ${ec.atcRate ?? 0}%, Checkout: ${ec.checkoutRate ?? 0}%, Purchase: ${ec.purchaseRate ?? 0}%`);
    lines.push("");
  }

  const dataContext = lines.join("\n");

  const systemPrompt = `You are Skylitee AI, an expert D2C ecommerce performance advisor for Indian brands.
Return ONLY valid JSON - no markdown fences, no extra text outside the JSON object.`;

  const userPrompt = `Analyse this D2C brand data and return ONLY a JSON object:

{
  "executiveSummary": "2-3 sentences - overall performance assessment with specific numbers",
  "overallScore": 72,
  "scoreLabel": "Good",
  "working": [
    { "metric": "ROAS", "value": "3.2x", "insight": "Above the 3x profitability mark - campaigns are efficient and can scale." }
  ],
  "notWorking": [
    { "metric": "COD Rate", "value": "72%", "insight": "High COD increases RTO risk and ties up cash. Target is below 40%.", "severity": "high" }
  ],
  "recommendations": [
    { "action": "Add Rs.75 prepaid discount", "why": "Shifts COD buyers - reduces return rate and unlocks cash faster", "priority": "high", "effort": "low" }
  ],
  "priorities": ["Top action this week", "Second action", "Third action"],
  "channelSummary": {
    "bestChannel": "Meta Ads",
    "bestChannelReason": "Driving purchases at 3.2x ROAS",
    "weakestChannel": "Organic Search",
    "weakestChannelReason": "Low CTR of 1.1% - titles need optimisation"
  }
}

Rules:
- 3-5 items in working[] (specific numbers, positive observations)
- 2-4 items in notWorking[] (issues, severity: "high" | "medium" | "low")
- 4-6 recommendations[] with priority: "high" | "medium" and effort: "low" | "medium" | "high"
- overallScore: 0-100 integer
- scoreLabel: "Excellent" (85+) | "Good" (70-84) | "Average" (50-69) | "Needs Work" (<50)
- Skip platforms not in the data. Be specific with Indian rupee amounts and D2C context.

Data:
${dataContext}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1800,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const rawText = response.content[0].type === "text" ? plainDashes(response.content[0].text.trim()) : "";

  let report;
  try {
    report = JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]+\}/);
    if (match) {
      try { report = JSON.parse(match[0]); } catch { /* ignore */ }
    }
  }

  if (!report) return NextResponse.json({ error: "AI response could not be parsed" }, { status: 500 });

  return NextResponse.json({
    report,
    platforms: { shopify: !!shopify, meta: !!meta, gads: !!gads, gsc: !!gsc, ga4: !!ga4 },
    generatedAt: new Date().toISOString(),
  });
}
