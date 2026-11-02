import { NextRequest, NextResponse } from "next/server";
import { getUser, createSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { email } = await req.json().catch(() => ({})) as { email?: string };
  if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });

  const user = await getUser(email);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (user.disabled) return NextResponse.json({ error: "User is suspended" }, { status: 403 });

  const activeShop = user.shops[0] ?? "";
  const newToken = await createSession(user.email, activeShop);

  const res = NextResponse.json({ ok: true, name: user.name, shop: activeShop });
  res.cookies.set(SESSION_COOKIE, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
