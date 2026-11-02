import { NextRequest, NextResponse } from "next/server";
import { getAllUserEmails, getUser } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { migrateShopToken } from "@/lib/shopify";

// One-time (safe to re-run) sweep that proactively migrates every connected store's Shopify
// offline token from the deprecated PERMANENT type to the new EXPIRING type, instead of waiting
// for each store's dashboard to load. Calling getValidToken performs the token-exchange migration
// for any legacy token; re-running is a no-op for already-migrated stores.
//
// Admin-only (same gate as the admin Stores tab): just open this URL in a browser while logged
// in to skylitee.io as the admin account - no secret needed.
export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  // Collect unique shops across all users.
  const emails = await getAllUserEmails();
  const shops = new Set<string>();
  const users = await Promise.allSettled(emails.map(getUser));
  for (const r of users) {
    if (r.status === "fulfilled" && r.value) {
      for (const s of r.value.shops) shops.add(s);
    }
  }

  const results = await Promise.allSettled([...shops].map(async (shop) => {
    const { status, detail } = await migrateShopToken(shop);
    return detail ? { shop, status, detail } : { shop, status };
  }));

  const rows = results.map(r => r.status === "fulfilled" ? r.value : { shop: "?", status: "error" as const });
  const summary = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ ok: true, scanned: shops.size, summary, shops: rows });
}
