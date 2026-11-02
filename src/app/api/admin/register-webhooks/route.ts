import { NextRequest, NextResponse } from "next/server";
import { getAllUserEmails, getUser } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { getValidToken, registerUninstallWebhook } from "@/lib/shopify";

// One-time (safe to re-run) sweep: subscribe every already-connected store to app/uninstalled.
// New installs are subscribed automatically in the OAuth callback; this covers stores that
// installed before uninstall tracking existed. Admin-only.
export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const emails = await getAllUserEmails();
  const shops = new Set<string>();
  for (const r of await Promise.allSettled(emails.map(getUser))) {
    if (r.status === "fulfilled" && r.value) r.value.shops.forEach(s => shops.add(s));
  }

  const results = await Promise.allSettled([...shops].map(async (shop) => {
    const accessToken = await getValidToken(shop);
    if (!accessToken) return { shop, status: "no_token" as const };
    const { ok, detail } = await registerUninstallWebhook(shop, accessToken);
    return ok ? { shop, status: "ok" as const } : { shop, status: "error" as const, detail };
  }));

  const rows = results.map(r => r.status === "fulfilled" ? r.value : { shop: "?", status: "error" as const });
  const summary = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ ok: true, scanned: shops.size, summary, shops: rows });
}
