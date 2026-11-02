import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getUser, getAllUserEmails } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import type { UserProfile } from "@/app/api/profile/route";

async function kvGet<T>(key: string): Promise<T | null> {
  try { return await kv.get<T>(key); } catch { return null; }
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const emails = await getAllUserEmails();

  const users = await Promise.allSettled(
    emails.map(async (email) => {
      const user = await getUser(email);
      if (!user) return null;

      const shop = user.shops[0] ?? null;

      const [profile, shopify, meta, ga4, gsc, plan] = await Promise.allSettled([
        kvGet<UserProfile>(`user:${email}:profile`),
        shop ? kvGet<string>(`shop:${shop}:shopify_token`) : Promise.resolve(null),
        shop ? kvGet<string>(`shop:${shop}:meta_token`)    : Promise.resolve(null),
        shop ? kvGet<string>(`shop:${shop}:ga4_token`)     : Promise.resolve(null),
        shop ? kvGet<string>(`shop:${shop}:gsc_token`)     : Promise.resolve(null),
        shop ? kvGet<string>(`shop:${shop}:plan`)          : Promise.resolve(null),
      ]);

      const p = profile.status === "fulfilled" ? profile.value : null;

      return {
        name:     user.name,
        email:    user.email,
        shops:    user.shops,
        createdAt: user.createdAt,
        disabled: user.disabled ?? false,
        profile: p ? {
          brandName:    p.brandName    ?? "",
          niche:        p.niche        ?? "",
          businessType: p.businessType ?? "",
          phone:        p.phone        ?? "",
          country:      p.country      ?? "",
          city:         p.city         ?? "",
        } : null,
        connections: {
          shopify: !!(shopify.status === "fulfilled" && shopify.value),
          meta:    !!(meta.status    === "fulfilled" && meta.value),
          ga4:     !!(ga4.status     === "fulfilled" && ga4.value),
          gsc:     !!(gsc.status     === "fulfilled" && gsc.value),
        },
        plan: plan.status === "fulfilled" ? (plan.value ?? "free") : "free",
      };
    })
  );

  interface UserRow {
    name: string; email: string; shops: string[]; createdAt: string; disabled: boolean;
    profile: { brandName: string; niche: string; businessType: string; phone: string; country: string; city: string } | null;
    connections: { shopify: boolean; meta: boolean; ga4: boolean; gsc: boolean };
    plan: string;
  }
  const list: UserRow[] = users
    .filter((r): r is PromiseFulfilledResult<UserRow> => r.status === "fulfilled" && r.value !== null)
    .map(r => r.value)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({ users: list, total: list.length });
}
