import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE, ADMIN_SESSION_MAX_AGE, checkAdminCredentials, clearLoginAttempts,
  countLoginAttempt, createAdminSession, deleteAdminSession, isAdminRequest,
} from "@/lib/admin-auth";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
} as const;

export async function GET(req: NextRequest) {
  return NextResponse.json({ authed: await isAdminRequest(req) });
}

export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({})) as { username?: unknown; password?: unknown };

  try {
    if (!await countLoginAttempt(req)) {
      return NextResponse.json({ error: "Too many tries. Please wait 15 minutes and try again." }, { status: 429 });
    }
    if (!checkAdminCredentials(username, password)) {
      return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
    }
    const token = await createAdminSession();
    await clearLoginAttempts(req);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, token, { ...cookieOptions, maxAge: ADMIN_SESSION_MAX_AGE });
    return res;
  } catch (err) {
    console.error("[admin/auth] login failed:", err);
    return NextResponse.json({ error: "Could not log in right now. Please try again." }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (token) await deleteAdminSession(token).catch(() => {});

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
