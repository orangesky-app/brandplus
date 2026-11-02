import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { couponKv, Coupon, CouponKind, DurationType, normalizeCoupon } from "@/lib/kv";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const coupons = (await couponKv.listAll()).map(normalizeCoupon);
  coupons.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ coupons });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await req.json() as {
    code: string;
    kind: CouponKind;
    discountPct: number;
    durationType: DurationType;
    durationValue: number;
    maxUses: number;
    expiresAt: string | null;
  };

  const normalized = body.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized || normalized.length < 3) {
    return NextResponse.json({ error: "Code must be at least 3 characters (letters & numbers only)" }, { status: 400 });
  }

  const kind: CouponKind = body.kind === "discount" ? "discount" : "free";
  // Free codes are 100% off; discount codes need a real 1–99 percentage.
  const discountPct = kind === "free" ? 100 : Math.round(body.discountPct);
  if (kind === "discount" && (discountPct < 1 || discountPct > 99)) {
    return NextResponse.json({ error: "Discount must be between 1% and 99%" }, { status: 400 });
  }

  const durationType: DurationType =
    body.durationType === "days" || body.durationType === "months" ? body.durationType : "forever";
  const durationValue = durationType === "forever" ? 0 : Math.round(body.durationValue);
  if (durationType !== "forever" && (!durationValue || durationValue < 1)) {
    return NextResponse.json({ error: "Duration must be at least 1" }, { status: 400 });
  }

  if (body.maxUses < 0) {
    return NextResponse.json({ error: "Max uses must be 0 or more" }, { status: 400 });
  }

  const existing = await couponKv.get(normalized);
  if (existing) return NextResponse.json({ error: "A coupon with this code already exists" }, { status: 400 });

  const coupon: Coupon = {
    code: normalized,
    kind,
    discountPct,
    durationType,
    durationValue,
    maxUses: body.maxUses,
    usedCount: 0,
    expiresAt: body.expiresAt || null,
    createdAt: new Date().toISOString(),
    active: true,
    redemptions: [],
  };

  await couponKv.set(normalized, coupon);
  await couponKv.addToIndex(normalized);

  return NextResponse.json({ coupon });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const normalized = code.toUpperCase();
  await couponKv.del(normalized);
  await couponKv.removeFromIndex(normalized);

  return NextResponse.json({ ok: true });
}

// PATCH - deactivate/reactivate a coupon
export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { code, active } = await req.json() as { code: string; active: boolean };
  const normalized = code.toUpperCase();
  const coupon = await couponKv.get(normalized);
  if (!coupon) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await couponKv.set(normalized, { ...coupon, active });
  return NextResponse.json({ ok: true });
}
