import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getUser, getAllUserEmails } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { shopKv } from "@/lib/kv";
import type { UserProfile } from "@/app/api/profile/route";

async function kvGet<T>(key: string): Promise<T | null> {
  try { return await kv.get<T>(key); } catch { return null; }
}

type TeamRole = "admin" | "marketing" | "view_only";

interface StoreUser {
  name: string;
  email: string;
  role: "owner" | TeamRole;
  status: "active" | "pending";
}

// Store-centric view for the admin panel: one row per connected Shopify store, with its
// owner, every user who has access (and their role), platform connections, the access code
// applied to it, plan, and how long it's been connected.
export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  // Load every user once, then invert user.shops[] into shop -> [users].
  const emails = await getAllUserEmails();
  const users = (await Promise.allSettled(emails.map(e => getUser(e))))
    .flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
  const byEmail = new Map(users.map(u => [u.email, u]));

  const shopUsers = new Map<string, Set<string>>();
  for (const u of users) {
    for (const shop of u.shops) {
      if (!shopUsers.has(shop)) shopUsers.set(shop, new Set());
      shopUsers.get(shop)!.add(u.email);
    }
  }

  const stores = await Promise.all([...shopUsers.keys()].map(async (shop) => {
    const memberEmails = shopUsers.get(shop)!;
    const [shopify, meta, ga4, gsc, plan, grantRaw, team, connectedAt, ownerStored] = await Promise.all([
      kvGet<string>(`shop:${shop}:shopify_token`),
      kvGet<string>(`shop:${shop}:meta_token`),
      kvGet<string>(`shop:${shop}:ga4_token`),
      kvGet<string>(`shop:${shop}:gsc_token`),
      shopKv.getPlan(shop),
      shopKv.getGrant(shop),
      shopKv.getTeam(shop),
      shopKv.getConnectedAt(shop),
      shopKv.getOwner(shop),
    ]);

    const teamList = team ?? [];
    const roleOf = (email: string): TeamRole => teamList.find(m => m.email === email)?.role ?? "view_only";
    const statusOf = (email: string): "active" | "pending" =>
      teamList.find(m => m.email === email)?.status === "pending" ? "pending" : "active";

    // Owner: the stored connector if known, else a user with access who isn't a team member.
    const ownerEmail = ownerStored
      ?? [...memberEmails].find(e => !teamList.some(m => m.email === e))
      ?? [...memberEmails][0]
      ?? null;
    const owner = ownerEmail ? byEmail.get(ownerEmail) ?? null : null;

    const accessUsers: StoreUser[] = [...memberEmails].map(email => {
      const u = byEmail.get(email);
      const isOwner = email === ownerEmail;
      return {
        name: u?.name ?? email,
        email,
        role: isOwner ? "owner" : roleOf(email),
        status: isOwner ? "active" : statusOf(email),
      };
    });

    // Invitees who haven't created an account yet still appear on the team list.
    for (const m of teamList) {
      if (!memberEmails.has(m.email)) {
        accessUsers.push({ name: m.email, email: m.email, role: m.role ?? "view_only", status: m.status === "pending" ? "pending" : "active" });
      }
    }
    accessUsers.sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0));

    // Connected date: stored value, else fall back to the owner's registration date.
    const connected = connectedAt ?? owner?.createdAt ?? null;

    let grant: { code: string; kind: "free" | "discount"; discountPct: number; expiresAt: string | null } | null = null;
    if (grantRaw) {
      grant = {
        code: grantRaw.couponCode === "ADMIN" ? "Admin comp" : grantRaw.couponCode,
        kind: grantRaw.kind,
        discountPct: grantRaw.discountPct,
        expiresAt: grantRaw.expiresAt,
      };
    }

    const ownerProfile = ownerEmail ? await kvGet<UserProfile>(`user:${ownerEmail}:profile`) : null;

    return {
      shop,
      brand: ownerProfile?.brandName || null,
      owner: owner ? { name: owner.name, email: owner.email } : (ownerEmail ? { name: ownerEmail, email: ownerEmail } : null),
      users: accessUsers,
      userCount: accessUsers.length,
      connections: { shopify: !!shopify, meta: !!meta, ga4: !!ga4, gsc: !!gsc },
      plan: plan ?? "free",
      grant,
      connectedAt: connected,
    };
  }));

  // Connected (has a Shopify token) first, then newest connect date.
  stores.sort((a, b) => {
    if (a.connections.shopify !== b.connections.shopify) return a.connections.shopify ? -1 : 1;
    return (b.connectedAt ?? "").localeCompare(a.connectedAt ?? "");
  });

  return NextResponse.json({ stores, total: stores.length });
}
