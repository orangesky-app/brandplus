const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = `${process.env.SHOPIFY_APP_URL}/api/auth/google/callback`;

const GSC_SCOPE  = "https://www.googleapis.com/auth/webmasters.readonly";
const GA4_SCOPE  = "https://www.googleapis.com/auth/analytics.readonly";
const GADS_SCOPE = "https://www.googleapis.com/auth/adwords";

// Google sunsets each Ads API version ~12 months after release; an old version fails every call.
// v25 sunsets ~Aug 2027 - bump here (one place) before then. Schedule: developers.google.com/google-ads/api/docs/sunset-dates
export const GADS_API = "https://googleads.googleapis.com/v25";

export interface GadsApiError {
  code?: number;
  message?: string;
  status?: string;
  details?: {
    reason?: string;
    errors?: { errorCode?: Record<string, string>; message?: string }[];
  }[];
}

export type GadsErrorKind = "test_token" | "api_disabled" | "no_account_access" | "google_ads_api_error";

// Google's top-level message is often generic ("The caller does not have permission"). The real
// reason sits in details[].errors[].errorCode (Ads) or details[].reason (Google Cloud). Never infer
// "test token" from a bare 403: a disabled API and a login without account access both return 403.
export function classifyGadsError(err: GadsApiError): { kind: GadsErrorKind; reason?: string; detail: string } {
  const adsError = err.details?.flatMap(d => d.errors ?? [])[0];
  const reason = (adsError?.errorCode && Object.values(adsError.errorCode)[0])
    ?? err.details?.find(d => d.reason)?.reason;
  const detail = adsError?.message ?? err.message ?? "Google Ads request failed";
  const msg = detail.toLowerCase();

  const kind: GadsErrorKind =
    reason === "DEVELOPER_TOKEN_NOT_APPROVED" || msg.includes("test accounts") ? "test_token" :
    reason === "SERVICE_DISABLED" || reason === "PROJECT_DISABLED" || msg.includes("has not been used in project") ? "api_disabled" :
    reason === "USER_PERMISSION_DENIED" ? "no_account_access" :
    "google_ads_api_error";

  return { kind, reason, detail };
}

export type GoogleService = "gsc" | "ga4" | "gads" | "both";

export function buildGoogleAuthUrl(state: string, service: GoogleService = "both"): string {
  const scope =
    service === "gsc"  ? GSC_SCOPE :
    service === "ga4"  ? GA4_SCOPE :
    service === "gads" ? GADS_SCOPE :
    `${GSC_SCOPE} ${GA4_SCOPE}`;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code: string): Promise<{ access_token: string; refresh_token?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      code,
    }),
  });
  return res.json();
}

export async function getGoogleAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json() as { access_token?: string; error?: string; error_description?: string };
  // Surface a failed refresh (revoked/expired token) instead of returning undefined,
  // which would make every downstream GSC/GA4/Ads call 401 and silently produce zeros.
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token refresh failed: ${data.error_description ?? data.error ?? res.status}`);
  }
  return data.access_token;
}
