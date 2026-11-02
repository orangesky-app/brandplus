import { NextRequest, NextResponse } from "next/server";
import { getGoogleAccessToken, GADS_API, classifyGadsError, type GadsApiError } from "@/lib/google";
import { getGadsRefreshToken, getGadsCustomerId, getAuthorizedShop, requireShopPermission } from "@/lib/session";
import { shopKv } from "@/lib/kv";
import { canManageAccounts, connectorLabel } from "@/lib/connector";

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";

interface GadsSearchResult {
  results?: { customer?: { id?: string; descriptiveName?: string; currencyCode?: string } }[];
  error?: { message?: string; status?: string };
}

async function gadsSearch(accessToken: string, customerId: string, query: string): Promise<GadsSearchResult> {
  const res = await fetch(
    `${GADS_API}/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": DEV_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  return res.json() as Promise<GadsSearchResult>;
}

export async function GET(req: NextRequest) {
  const shop = await getAuthorizedShop(req);
  if (!shop) return NextResponse.json({ error: "not_authorized" }, { status: 403 });

  if (!DEV_TOKEN) {
    return NextResponse.json({ error: "google_ads_dev_token_missing" }, { status: 503 });
  }

  const refreshToken = await getGadsRefreshToken(req, shop);
  if (!refreshToken) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const savedCustomerId = await getGadsCustomerId(req, shop);
  // Only whoever connected this Google login may list / pick its Ads accounts (lib/connector).
  if (!(await canManageAccounts(req, shop, "gads"))) {
    return NextResponse.json({
      locked: true, connectedBy: await connectorLabel(shop, "gads"), savedCustomerId,
      customers: savedCustomerId ? [{ id: savedCustomerId, name: `Account ${savedCustomerId}`, currency: "" }] : [],
    });
  }

  try {
    const accessToken = await getGoogleAccessToken(refreshToken);

    // List all accessible customer resource names
    const listRes = await fetch(
      `${GADS_API}/customers:listAccessibleCustomers`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": DEV_TOKEN,
        },
      }
    );
    const listData = await listRes.json() as { resourceNames?: string[]; error?: GadsApiError };

    // Listing failed - report Google's actual reason and fall back to manual entry mode
    if (listData.error) {
      const { kind, reason, detail } = classifyGadsError(listData.error);
      return NextResponse.json({
        error: kind,
        reason,
        detail,
        savedCustomerId,          // still return saved ID so UI can show it
      });
    }

    if (!listData.resourceNames?.length) {
      return NextResponse.json({ error: "no_customers", savedCustomerId });
    }

    // Fetch name + currency for each customer (parallel, max 20)
    const customerIds = listData.resourceNames
      .map(r => r.replace("customers/", ""))
      .slice(0, 20);

    const details = await Promise.allSettled(
      customerIds.map(async (id) => {
        const data = await gadsSearch(
          accessToken,
          id,
          "SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1"
        );
        const row = data.results?.[0]?.customer;
        return {
          id,
          name: row?.descriptiveName ?? `Account ${id}`,
          currency: row?.currencyCode ?? "",   // unknown if the details query failed - don't claim USD
        };
      })
    );

    const customers = details
      .filter(r => r.status === "fulfilled")
      .map(r => (r as PromiseFulfilledResult<{ id: string; name: string; currency: string }>).value);

    return NextResponse.json({ customers, savedCustomerId });
  } catch (e) {
    console.error("Google Ads customers error:", e);
    return NextResponse.json({ error: "fetch_failed", savedCustomerId }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const perm = await requireShopPermission(req, "connections");
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });
  const shop = perm.shop;

  if (!(await canManageAccounts(req, shop, "gads"))) {
    return NextResponse.json({ error: "locked", message: "Only the person who connected this Google account can change it." }, { status: 403 });
  }
  const { customerId } = await req.json() as { customerId?: string };
  if (!customerId) return NextResponse.json({ error: "missing_customer_id" }, { status: 400 });

  // Strip hyphens in case user typed "401-789-2231" instead of "4017892231"
  const cleanId = customerId.replace(/-/g, "").trim();
  await shopKv.setGadsCustomerId(shop, cleanId);
  return NextResponse.json({ ok: true });
}
