import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getUser, getAllUserEmails } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { shopKv } from "@/lib/kv";
import { getFunnel, listFunnelShops } from "@/lib/funnel";
import { getOnboarding } from "@/lib/onboarding";

async function kvExists(key: string): Promise<boolean> {
  try { return (await kv.exists(key)) > 0; } catch { return false; }
}

// Admin onboarding funnel: one row per store ever installed, with how far it got
// (installed → account → plan → Meta → Google → came back after day 7) and whether it
// uninstalled (plus the reason, if the merchant answered the feedback email).
//
// Stores that connected before funnel tracking existed have no funnel record - their steps
// are derived from live state (tokens, plan, connect date) and flagged `tracked: false`.
export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const emails = await getAllUserEmails();
  const users = (await Promise.allSettled(emails.map(e => getUser(e))))
    .flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
  const linkedShops = new Set(users.flatMap(u => u.shops));
  const createdByEmail = new Map(users.map(u => [u.email, u.createdAt]));

  const shops = [...new Set([...await listFunnelShops(), ...linkedShops])];

  const rows = await Promise.all(shops.map(async (shop) => {
    const [f, onboarding, shopify, meta, gsc, ga4, gads, plan, connectedAt, owner] = await Promise.all([
      getFunnel(shop),
      getOnboarding(shop),
      kvExists(`shop:${shop}:shopify_token`),
      kvExists(`shop:${shop}:meta_token`),
      kvExists(`shop:${shop}:gsc_token`),
      kvExists(`shop:${shop}:ga4_token`),
      kvExists(`shop:${shop}:gads_token`),
      shopKv.getPlan(shop),
      shopKv.getConnectedAt(shop),
      shopKv.getOwner(shop),
    ]);

    const installedAt = f?.installedAt ?? connectedAt ?? (owner ? createdByEmail.get(owner) : null) ?? null;
    const status: "active" | "uninstalled" | "disconnected" =
      f?.uninstalledAt ? "uninstalled" : shopify ? "active" : "disconnected";

    return {
      shop,
      owner,
      tracked: !!f?.installedAt,
      installedAt,
      status,
      uninstalledAt: f?.uninstalledAt ?? null,
      uninstallCount: Number(f?.uninstallCount ?? 0),
      reason: f?.uninstallReason ?? null,
      reasonNote: f?.uninstallNote ?? null,
      activeDays: Number(f?.activeDays ?? 0),
      lastSeenDay: f?.lastSeenDay ?? null,
      steps: {
        account:  linkedShops.has(shop),
        plan:     !!f?.planAt || plan === "growth",
        meta:     !!f?.metaAt || meta,
        google:   !!f?.googleAt || gsc || ga4 || gads,
        returned: !!f?.returnedD7At,
      },
      // Only stores that went through the /welcome flow (new installs after it shipped).
      welcome: onboarding ? {
        questions: !!f?.questionsAt || !!onboarding.answeredAt,
        xray:      !!f?.xrayAt,
        done:      !!f?.welcomeDoneAt || onboarding.status === "done",
      } : null,
    };
  }));

  rows.sort((a, b) => (b.installedAt ?? "").localeCompare(a.installedAt ?? ""));
  return NextResponse.json({ rows });
}
