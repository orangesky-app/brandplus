import { NextRequest, NextResponse } from "next/server";
import { getUser, updateUser, hashPassword } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";
import { shopKv, Grant, DurationType, computeGrantExpiry } from "@/lib/kv";

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await req.json() as {
    email: string;
    action: "disable" | "enable" | "reset-password" | "grant-access" | "revoke-access";
    newPassword?: string;
    durationType?: DurationType;
    durationValue?: number;
  };
  const { email, action } = body;
  if (!email || !action) return NextResponse.json({ error: "email and action required" }, { status: 400 });

  const target = await getUser(email);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (action === "reset-password") {
    if (!body.newPassword || body.newPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    target.passwordHash = hashPassword(body.newPassword);
    await updateUser(target);
    return NextResponse.json({ ok: true });
  }

  // Comp a client: write a free access grant directly on their store (no code needed).
  if (action === "grant-access") {
    const shop = target.shops[0];
    if (!shop) return NextResponse.json({ error: "User has no connected store" }, { status: 400 });
    const durationType: DurationType =
      body.durationType === "days" || body.durationType === "months" ? body.durationType : "forever";
    const durationValue = durationType === "forever" ? 0 : Math.max(1, Math.round(body.durationValue ?? 1));
    const grant: Grant = {
      couponCode: "ADMIN",
      kind: "free",
      discountPct: 100,
      startedAt: new Date().toISOString(),
      expiresAt: computeGrantExpiry(durationType, durationValue),
    };
    await Promise.allSettled([shopKv.setGrant(shop, grant), shopKv.setPlan(shop, "growth")]);
    return NextResponse.json({ ok: true, grant });
  }

  // Remove a comp: clear the grant and reset to free.
  if (action === "revoke-access") {
    const shop = target.shops[0];
    if (!shop) return NextResponse.json({ error: "User has no connected store" }, { status: 400 });
    await Promise.allSettled([shopKv.delGrant(shop), shopKv.setPlan(shop, "free")]);
    return NextResponse.json({ ok: true });
  }

  target.disabled = action === "disable";
  await updateUser(target);

  return NextResponse.json({ ok: true, disabled: target.disabled });
}
