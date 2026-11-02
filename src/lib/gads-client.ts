// Browser-side loader for /api/google/ads, shared by every page that shows Google Ads next to
// Shopify and Meta. It keeps two rules in one place:
//  - A failed load is never read as "no spend": the reason comes back so the page can say it.
//  - Those pages add Google to ₹ totals, so an account billing in another currency stays out of them.

export interface GadsKpis {
  spend: number; clicks: number; impressions: number; conversions: number;
  conversionValue: number; roas: number; avgCpc: number; ctr: number; costPerConversion: number;
}
export interface GadsCampaignRow {
  id: string; name: string; status: string; impressions: number; clicks: number; spend: number;
  conversions: number; conversionValue: number; ctr: number; avgCpc: number; roas: number;
}
export interface GadsDailyRow { date: string; impressions: number; clicks: number; spend: number; conversions: number; convValue: number }
export interface GadsData { account: string; currency: string; kpis: GadsKpis; campaigns: GadsCampaignRow[]; daily: GadsDailyRow[] }

export interface GadsIssue { kind: string; detail?: string }
export interface GadsResult { data: GadsData | null; issue: GadsIssue | null }

/** `not_connected` is the one error that isn't a problem to report: the owner just hasn't connected yet. */
export function readGadsResponse(body: unknown): GadsResult {
  const d = body as (Partial<GadsData> & { error?: string; detail?: string; reason?: string }) | null;
  if (!d) return { data: null, issue: { kind: "fetch_failed" } };
  if (d.error) return { data: null, issue: d.error === "not_connected" ? null : { kind: d.error, detail: d.detail ?? d.reason } };
  if (!d.kpis) return { data: null, issue: { kind: "fetch_failed" } };
  // The route answers "USD" when an account had no activity to read a currency from, so only
  // spend in the range proves the account really bills in something else.
  if (d.kpis.spend > 0 && d.currency && d.currency !== "INR") return { data: null, issue: { kind: "other_currency", detail: d.currency } };
  return {
    data: { account: d.account ?? "", currency: d.currency ?? "INR", kpis: d.kpis, campaigns: d.campaigns ?? [], daily: d.daily ?? [] },
    issue: null,
  };
}

export async function fetchGoogleAds(from: string, to: string): Promise<GadsResult> {
  try {
    const r = await fetch(`/api/google/ads?from=${from}&to=${to}`);
    return readGadsResponse(await r.json());
  } catch {
    return { data: null, issue: { kind: "fetch_failed" } };
  }
}

/** One plain sentence for why Google Ads numbers are missing. Null means nothing is wrong. */
export function gadsIssueText(issue: GadsIssue | null): string | null {
  if (!issue) return null;
  switch (issue.kind) {
    case "no_customer_selected": return "Connected, but no ad account is picked yet.";
    case "test_token": return "Connected, but Google hasn't granted Skylitee full API access yet. Nothing to do on your side.";
    case "api_disabled": return "The Google Ads API is switched off on Skylitee's side, not your account.";
    case "google_ads_dev_token_missing": return "Google Ads isn't set up on Skylitee's side yet.";
    case "no_account_access": return "This Google login can't read that ad account. Reconnect with one that can.";
    case "not_authorized": return "Your login doesn't have access to this store's Google Ads.";
    case "other_currency": return `This account bills in ${issue.detail}, so it's left out of the ₹ totals here. See it on the Google Ads pages.`;
    default: return issue.detail ? `Couldn't load Google Ads. Google said: ${issue.detail}` : "Couldn't load Google Ads right now.";
  }
}
