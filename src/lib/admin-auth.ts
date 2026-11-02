import { kv } from "@vercel/kv";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "./auth";

// The admin panel has its own login, separate from customer accounts. The username and the
// password hash live only in server env vars; the password itself is stored nowhere.

export const ADMIN_COOKIE = "skylitee_admin";
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours

const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW = 60 * 15; // 15 minutes
const MAX_FIELD_LENGTH = 256;

const sessionKey = (token: string) => `admin_session:${token}`;
const attemptsKey = (ip: string) => `admin_login_attempts:${ip}`;

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function sameText(a: string, b: string): boolean {
  const digest = (s: string) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

export function checkAdminCredentials(username: unknown, password: unknown): boolean {
  const expectedName = process.env.ADMIN_USERNAME;
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;
  if (!expectedName || !expectedHash?.includes(":")) return false;
  if (typeof username !== "string" || typeof password !== "string") return false;
  if (username.length > MAX_FIELD_LENGTH || password.length > MAX_FIELD_LENGTH) return false;
  // Both checks always run, so a wrong username takes as long as a wrong password.
  const nameOk = sameText(username, expectedName);
  const passwordOk = verifyPassword(password, expectedHash);
  return nameOk && passwordOk;
}

// Counts the attempt before the password is checked, so parallel guesses can't slip past the limit.
export async function countLoginAttempt(req: NextRequest): Promise<boolean> {
  const key = attemptsKey(clientIp(req));
  const attempts = await kv.incr(key);
  if (attempts === 1) await kv.expire(key, ATTEMPT_WINDOW);
  return attempts <= MAX_ATTEMPTS;
}

export async function clearLoginAttempts(req: NextRequest): Promise<void> {
  await kv.del(attemptsKey(clientIp(req)));
}

export async function createAdminSession(): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await kv.set(sessionKey(token), { createdAt: new Date().toISOString() }, { ex: ADMIN_SESSION_MAX_AGE });
  return token;
}

export async function deleteAdminSession(token: string): Promise<void> {
  await kv.del(sessionKey(token));
}

export async function isAdminRequest(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  try {
    return (await kv.get(sessionKey(token))) !== null;
  } catch {
    return false; // if the session store is down, nobody gets in
  }
}

// Returns the response to send back when the request isn't from a logged-in admin.
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (await isAdminRequest(req)) return null;
  return NextResponse.json({ error: "Admin login required" }, { status: 401 });
}
