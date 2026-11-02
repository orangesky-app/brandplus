"use client";
import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import {
  Users, BarChart2, LayoutDashboard,
  Search, UserX, UserCheck, ShieldCheck,
  Eye, EyeOff, Lock, LogOut, User, RefreshCw, LogIn, TrendingUp,
  Tag, Plus, Trash2, ToggleLeft, ToggleRight, KeyRound, Gift,
  Store, ChevronRight, Calendar, Filter,
} from "lucide-react";
import { FunnelTab } from "./funnel-tab";
import { isEmbedded, openTop } from "@/lib/embedded-client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminUser {
  name: string;
  email: string;
  shops: string[];
  createdAt: string;
  disabled: boolean;
  profile: { brandName: string; niche: string; businessType: string; phone: string; country: string; city: string } | null;
  connections: { shopify: boolean; meta: boolean; ga4: boolean; gsc: boolean };
  plan: string;
}

interface StoreStats {
  revenue: number;
  orders: number;
  aov: number;
  codPct: number;
  hasMetaToken: boolean;
  loading: boolean;
  error: boolean;
}

type CouponKind = "free" | "discount";
type DurationType = "days" | "months" | "forever";

interface Coupon {
  code: string;
  kind?: CouponKind;
  discountPct: number;
  durationType?: DurationType;
  durationValue?: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
  active: boolean;
  redemptions: string[];
}

const PRO_PRICE = 29;

// What a code gives, in plain English - e.g. "Free for 14 days", "50% off for 3 months".
function describeBenefit(c: Coupon): string {
  const kind: CouponKind = c.kind ?? (c.discountPct >= 100 ? "free" : "discount");
  const durationType: DurationType = c.durationType ?? "forever";
  const durationValue = c.durationValue ?? 0;
  const what = kind === "free" ? "Free" : `${c.discountPct}% off`;
  if (durationType === "forever") return `${what} · forever`;
  const unit = durationType === "days"
    ? (durationValue === 1 ? "day" : "days")
    : (durationValue === 1 ? "month" : "months");
  return `${what} · ${durationValue} ${unit}`;
}

function PlatformDots({ c }: { c: AdminUser["connections"] }) {
  const dots = [
    { key: "shopify", label: "Shopify", color: "#96BF48", on: c.shopify },
    { key: "meta",    label: "Meta",    color: "#1877F2", on: c.meta    },
    { key: "ga4",     label: "GA4",     color: "#E37400", on: c.ga4     },
    { key: "gsc",     label: "GSC",     color: "#34A853", on: c.gsc     },
  ];
  return (
    <div className="flex items-center gap-1">
      {dots.map(d => (
        <span key={d.key} title={`${d.label}: ${d.on ? "connected" : "not connected"}`}
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: d.on ? d.color : "#D4D4D4" }} />
      ))}
    </div>
  );
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) { onSuccess(); return; }
      const data = await res.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? "Could not log in. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    }
    setBusy(false);
  };

  const inputClass = cn(
    "w-full bg-[#F5F5F4] dark:bg-[#1C1C1C] border rounded-xl pl-9 py-2.5 text-[17px] dark:text-[#F4F4F5] outline-none transition-all",
    error ? "border-[#EF4444] ring-1 ring-[#EF4444]/30" : "border-black/[0.06] dark:border-white/[0.06] focus:border-[#F97316] focus:ring-1 focus:ring-[#F97316]/30"
  );

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <form onSubmit={submit} className="bg-white dark:bg-[#171717] rounded-2xl shadow-xl p-6 sm:p-8 w-full max-w-sm border border-black/[0.06] dark:border-white/[0.06]">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-[#F97316] rounded-xl flex items-center justify-center shrink-0">
            <ShieldCheck size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-[20px] font-bold dark:text-[#F4F4F5]">Admin Panel</h1>
            <div className="text-[15px] text-[#A1A1AA]">Skylitee · Owner access only</div>
          </div>
        </div>
        <label htmlFor="admin-username" className="text-[15px] font-semibold dark:text-[#F4F4F5] block mb-1">Username</label>
        <div className="relative mb-3">
          <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
          <input
            id="admin-username" name="username" type="text" required autoFocus
            autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={username} onChange={e => setUsername(e.target.value)}
            className={cn(inputClass, "pr-3")}
          />
        </div>
        <label htmlFor="admin-password" className="text-[15px] font-semibold dark:text-[#F4F4F5] block mb-1">Password</label>
        <div className="relative mb-3">
          <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
          <input
            id="admin-password" name="password" type={show ? "text" : "password"} required
            autoComplete="current-password"
            value={password} onChange={e => setPassword(e.target.value)}
            className={cn(inputClass, "pr-10")}
          />
          <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]">
            {show ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        {error && <div role="alert" className="text-[15px] text-[#EF4444] mb-2">{error}</div>}
        <button type="submit" disabled={busy}
          className="w-full bg-[#F97316] hover:bg-[#EA580C] disabled:opacity-60 text-white rounded-xl py-2.5 text-[17px] font-bold transition-colors">
          {busy ? "Checking..." : "Log in"}
        </button>
        <div className="mt-4 text-center text-[14px] text-[#A1A1AA]">Authorised access only.</div>
      </form>
    </div>
  );
}

type AdminTab = "overview" | "funnel" | "stores" | "users" | "analytics" | "coupons";

type StoreRole = "owner" | "admin" | "marketing" | "view_only";
interface AdminStore {
  shop: string;
  brand: string | null;
  owner: { name: string; email: string } | null;
  users: { name: string; email: string; role: StoreRole; status: "active" | "pending" }[];
  userCount: number;
  connections: { shopify: boolean; meta: boolean; ga4: boolean; gsc: boolean };
  plan: string;
  grant: { code: string; kind: "free" | "discount"; discountPct: number; expiresAt: string | null } | null;
  connectedAt: string | null;
}

// "2y 3mo", "5mo 12d", "23 days" - compact age from a connect date to now.
function ageSince(iso: string | null): string {
  if (!iso) return "-";
  const then = new Date(iso), now = new Date();
  let months = (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  if (now.getDate() < then.getDate()) months--;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  const days = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
  if (years > 0) return `${years}y${remMonths > 0 ? ` ${remMonths}mo` : ""}`;
  if (months > 0) return `${months}mo`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

export default function AdminPage() {
  const [authed, setAuthed]       = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [embedded, setEmbedded]   = useState(false);
  useEffect(() => { setEmbedded(isEmbedded()); }, []);
  const [tab, setTab]             = useState<AdminTab>("overview");
  const [users, setUsers]         = useState<AdminUser[]>([]);
  const [stores, setStores]       = useState<AdminStore[]>([]);
  const [storesLoading, setStoresLoading] = useState(false);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [toast, setToast]         = useState("");
  const [loginAsLoading, setLoginAsLoading] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<string | null>(null); // email of user being reset
  const [resetPassword, setResetPassword] = useState("");
  const [grantTarget, setGrantTarget] = useState<string | null>(null); // email of user being comped
  const [grantBusy, setGrantBusy] = useState(false);
  const [storeStats, setStoreStats] = useState<Record<string, StoreStats>>({});

  // Coupons state
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponsLoading, setCouponsLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newKind, setNewKind] = useState<CouponKind>("free");
  const [newDiscount, setNewDiscount] = useState(50);
  const [newDurationType, setNewDurationType] = useState<DurationType>("days");
  const [newDurationValue, setNewDurationValue] = useState(14);
  const [newMaxUses, setNewMaxUses] = useState(1);
  const [newExpiry, setNewExpiry] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 401) setAuthed(false);
      if (res.ok) {
        const data = await res.json() as { users: AdminUser[] };
        setUsers(data.users ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // Load store stats for all Shopify-connected stores
  const loadStoreStats = useCallback(async (userList: AdminUser[]) => {
    const shopifyUsers = userList.filter(u => u.connections.shopify && u.shops[0]);
    for (const u of shopifyUsers) {
      const shop = u.shops[0];
      setStoreStats(prev => ({ ...prev, [shop]: { revenue: 0, orders: 0, aov: 0, codPct: 0, hasMetaToken: false, loading: true, error: false } }));
      fetch(`/api/admin/store-stats?shop=${encodeURIComponent(shop)}`)
        .then(r => r.json())
        .then(d => {
          if (d.error) {
            setStoreStats(prev => ({ ...prev, [shop]: { ...prev[shop], loading: false, error: true } }));
          } else {
            setStoreStats(prev => ({ ...prev, [shop]: { revenue: d.revenue, orders: d.orders, aov: d.aov, codPct: d.codPct, hasMetaToken: d.hasMetaToken, loading: false, error: false } }));
          }
        })
        .catch(() => setStoreStats(prev => ({ ...prev, [shop]: { ...prev[shop], loading: false, error: true } })));
    }
  }, []);

  useEffect(() => {
    fetch("/api/admin/auth")
      .then(r => r.json())
      .then(d => { if (d.authed) { setAuthed(true); loadUsers(); } })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, [loadUsers]);

  useEffect(() => {
    if (users.length > 0 && tab === "users") {
      loadStoreStats(users);
    }
  }, [users, tab, loadStoreStats]);

  const loadCoupons = useCallback(async () => {
    setCouponsLoading(true);
    try {
      const res = await fetch("/api/admin/coupons");
      if (res.status === 401) setAuthed(false);
      if (res.ok) {
        const data = await res.json() as { coupons: Coupon[] };
        setCoupons(data.coupons ?? []);
      }
    } catch { /* ignore */ }
    setCouponsLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "coupons") loadCoupons();
  }, [tab, loadCoupons]);

  const loadStores = useCallback(async () => {
    setStoresLoading(true);
    try {
      const res = await fetch("/api/admin/stores");
      if (res.status === 401) setAuthed(false);
      if (res.ok) {
        const data = await res.json() as { stores: AdminStore[] };
        setStores(data.stores ?? []);
      }
    } catch { /* ignore */ }
    setStoresLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "stores") loadStores();
  }, [tab, loadStores]);

  const logOut = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" }).catch(() => {});
    window.location.href = "/admin"; // full reload, so no customer data stays in memory
  };

  const toggleDisabled = async (email: string, currentlyDisabled: boolean) => {
    const action = currentlyDisabled ? "enable" : "disable";
    const res = await fetch("/api/admin/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, action }),
    });
    if (res.ok) {
      setUsers(prev => prev.map(u => u.email === email ? { ...u, disabled: !currentlyDisabled } : u));
      showToast(`User ${action}d.`);
    }
  };

  const doResetPassword = async () => {
    if (!resetTarget || resetPassword.length < 6) return;
    const res = await fetch("/api/admin/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: resetTarget, action: "reset-password", newPassword: resetPassword }),
    });
    if (res.ok) {
      showToast(`Password reset for ${resetTarget}.`);
      setResetTarget(null);
      setResetPassword("");
    } else {
      showToast("Failed to reset password.");
    }
  };

  const giveAccess = async (durationType: DurationType, durationValue: number) => {
    if (!grantTarget) return;
    setGrantBusy(true);
    const res = await fetch("/api/admin/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: grantTarget, action: "grant-access", durationType, durationValue }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    setGrantBusy(false);
    if (data.ok) {
      showToast(`Access granted to ${grantTarget}.`);
      setGrantTarget(null);
    } else {
      showToast(data.error ?? "Could not grant access.");
    }
  };

  const revokeAccess = async () => {
    if (!grantTarget) return;
    setGrantBusy(true);
    const res = await fetch("/api/admin/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: grantTarget, action: "revoke-access" }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    setGrantBusy(false);
    if (data.ok) {
      showToast(`Access removed for ${grantTarget}.`);
      setGrantTarget(null);
    } else {
      showToast(data.error ?? "Could not remove access.");
    }
  };

  const loginAs = async (email: string) => {
    setLoginAsLoading(email);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        showToast(`Logging in as ${email}…`);
        setTimeout(() => { window.location.href = "/dashboard"; }, 600);
      } else {
        showToast("Could not impersonate user.");
        setLoginAsLoading(null);
      }
    } catch {
      showToast("Network error.");
      setLoginAsLoading(null);
    }
  };

  // The admin login cookie isn't sent inside the Shopify admin's iframe, so every admin API would
  // refuse. Point to the website instead of showing a dead panel.
  if (embedded) return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="bg-white dark:bg-[#141414] rounded-2xl border border-black/[0.06] dark:border-white/[0.06] p-6 max-w-[380px] text-center">
        <div className="text-[20px] font-bold dark:text-[#F4F4F5] mb-1">Admin Panel</div>
        <div className="text-[16px] text-[#71717A] mb-4">The admin panel only works on the Skylitee website.</div>
        <button onClick={() => openTop("https://skylitee.io/admin")}
          className="w-full bg-[#F97316] hover:bg-[#EA580C] text-white font-bold text-[17px] rounded-xl py-2.5">
          Open skylitee.io/admin
        </button>
      </div>
    </div>
  );

  if (!authChecked) return null;
  if (!authed) return <AdminLogin onSuccess={() => { setAuthed(true); loadUsers(); }} />;

  const activeUsers  = users.filter(u => !u.disabled).length;
  const shopifyCount = users.filter(u => u.connections.shopify).length;
  const metaCount    = users.filter(u => u.connections.meta).length;
  const ga4Count     = users.filter(u => u.connections.ga4).length;

  const filteredUsers = users.filter(u => {
    const q = search.toLowerCase();
    const matchQ = !search
      || u.name.toLowerCase().includes(q)
      || u.email.toLowerCase().includes(q)
      || (u.profile?.brandName ?? "").toLowerCase().includes(q)
      || (u.shops[0] ?? "").toLowerCase().includes(q);
    const matchStatus = filterStatus === "all"
      || (filterStatus === "active"   && !u.disabled)
      || (filterStatus === "disabled" &&  u.disabled);
    return matchQ && matchStatus;
  });

  const createCoupon = async () => {
    setCreateError(null);
    setCreateLoading(true);
    try {
      const res = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: newCode,
          kind: newKind,
          discountPct: newDiscount,
          durationType: newDurationType,
          durationValue: newDurationValue,
          maxUses: newMaxUses,
          expiresAt: newExpiry || null,
        }),
      });
      const data = await res.json() as { coupon?: Coupon; error?: string };
      if (data.coupon) {
        setCoupons(prev => [data.coupon!, ...prev]);
        setShowCreateForm(false);
        setNewCode("");
        setNewKind("free");
        setNewDiscount(50);
        setNewDurationType("days");
        setNewDurationValue(14);
        setNewMaxUses(1);
        setNewExpiry("");
        showToast("Access code created.");
      } else {
        setCreateError(data.error ?? "Failed to create coupon");
      }
    } catch {
      setCreateError("Network error.");
    }
    setCreateLoading(false);
  };

  const applyPreset = (preset: "trial" | "freeClient" | "discountClient") => {
    if (preset === "trial") {
      setNewKind("free"); setNewDurationType("days"); setNewDurationValue(14); setNewMaxUses(0);
    } else if (preset === "freeClient") {
      setNewKind("free"); setNewDurationType("forever"); setNewMaxUses(1);
    } else {
      setNewKind("discount"); setNewDiscount(50); setNewDurationType("months"); setNewDurationValue(3); setNewMaxUses(1);
    }
  };

  const deleteCoupon = async (code: string) => {
    const res = await fetch(`/api/admin/coupons?code=${encodeURIComponent(code)}`, { method: "DELETE" });
    if (res.ok) {
      setCoupons(prev => prev.filter(c => c.code !== code));
      showToast("Coupon deleted.");
    }
  };

  const toggleCoupon = async (coupon: Coupon) => {
    const res = await fetch("/api/admin/coupons", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: coupon.code, active: !coupon.active }),
    });
    if (res.ok) {
      setCoupons(prev => prev.map(c => c.code === coupon.code ? { ...c, active: !c.active } : c));
      showToast(`Coupon ${coupon.active ? "deactivated" : "activated"}.`);
    }
  };

  const generateRandomCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    setNewCode(code);
  };

  const couponStatus = (c: Coupon) => {
    if (!c.active) return { label: "Inactive", color: "text-[#A1A1AA]" };
    if (c.expiresAt && new Date(c.expiresAt) < new Date()) return { label: "Expired", color: "text-[#EF4444]" };
    if (c.maxUses > 0 && c.usedCount >= c.maxUses) return { label: "Exhausted", color: "text-[#EAB308]" };
    return { label: "Active", color: "text-[#22C55E]" };
  };

  const tabs: { key: AdminTab; label: string; icon: React.ElementType }[] = [
    { key: "overview",  label: "Overview",            icon: LayoutDashboard },
    { key: "funnel",    label: "Funnel",              icon: Filter          },
    { key: "stores",    label: `Stores (${stores.length})`, icon: Store     },
    { key: "users",     label: `Users (${users.length})`, icon: Users       },
    { key: "analytics", label: "Analytics",           icon: BarChart2       },
    { key: "coupons",   label: `Coupons (${coupons.length})`, icon: Tag     },
  ];

  return (
    <div className="space-y-4 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-[#F97316] rounded-xl flex items-center justify-center shrink-0">
            <ShieldCheck size={15} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold dark:text-[#F4F4F5]">Admin Panel</h2>
            <p className="text-[17px] text-[#A1A1AA]">Skylitee platform management · Owner only · Live data</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadUsers} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[20px] font-semibold text-[#71717A] dark:text-[#A1A1AA] border border-black/[0.06] dark:border-white/[0.06] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors disabled:opacity-50">
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={logOut}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[20px] font-semibold text-[#71717A] dark:text-[#A1A1AA] border border-black/[0.06] dark:border-white/[0.06] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors">
            <LogOut size={11} /> Log out
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Registered",  value: users.length,  sub: "all time",          color: "text-[#F97316]"  },
          { label: "Active Stores",     value: activeUsers,   sub: `${users.length - activeUsers} suspended`, color: "text-[#22C55E]" },
          { label: "Shopify Connected", value: shopifyCount,  sub: `${users.length - shopifyCount} not connected`, color: "text-[#96BF48]" },
          { label: "Meta Connected",    value: metaCount,     sub: `GA4: ${ga4Count}`,   color: "text-[#1877F2]"  },
        ].map(k => (
          <Card key={k.label}>
            <div className="text-[17px] font-bold text-[#A1A1AA] uppercase tracking-wide">{k.label}</div>
            <div className={cn("text-[30px] font-black mt-1", k.color)}>{k.value}</div>
            <div className="text-[17px] text-[#A1A1AA] mt-0.5">{k.sub}</div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-black/[0.06] dark:border-white/[0.06] overflow-x-auto">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-[19px] font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors",
                tab === t.key
                  ? "border-[#F97316] text-[#F97316]"
                  : "border-transparent text-[#71717A] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#F4F4F5]"
              )}>
              <Icon size={13} />{t.label}
            </button>
          );
        })}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Platform Connections" right={`${users.length} stores total`} />
            <div className="space-y-3 mt-3">
              {[
                { label: "Shopify",  count: shopifyCount,                              color: "#96BF48" },
                { label: "Meta Ads", count: metaCount,                                 color: "#1877F2" },
                { label: "GA4",      count: ga4Count,                                  color: "#E37400" },
                { label: "GSC",      count: users.filter(u => u.connections.gsc).length, color: "#34A853" },
              ].map(p => {
                const pct = users.length ? Math.round((p.count / users.length) * 100) : 0;
                return (
                  <div key={p.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[19px] font-semibold dark:text-[#F4F4F5]">{p.label}</span>
                      <span className="text-[20px] font-bold" style={{ color: p.color }}>{p.count} / {users.length}</span>
                    </div>
                    <div className="w-full h-2 bg-[#F5F5F4] dark:bg-[#262626] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: p.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Recent registrations */}
          <Card>
            <CardHeader title="Recent Registrations" right="Last 10 stores" />
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-[19px] min-w-[600px]">
                <thead>
                  <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                    {["User", "Brand", "Shopify Store", "Platforms", "Registered", "Status"].map(h => (
                      <th key={h} className="text-left text-[16px] font-bold text-[#A1A1AA] uppercase tracking-wide py-2 pr-4 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.slice(0, 10).map(u => (
                    <tr key={u.email} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-semibold dark:text-[#F4F4F5] text-[19px]">{u.name}</div>
                        <div className="text-[17px] text-[#A1A1AA] truncate max-w-[160px]">{u.email}</div>
                      </td>
                      <td className="py-3 pr-4 text-[20px] dark:text-[#F4F4F5]">
                        {u.profile?.brandName || <span className="text-[#A1A1AA] italic">not set</span>}
                      </td>
                      <td className="py-3 pr-4 text-[20px] text-[#71717A] dark:text-[#A1A1AA]">
                        {u.shops[0] ? u.shops[0].replace(".myshopify.com", "") : <span className="italic">none</span>}
                      </td>
                      <td className="py-3 pr-4"><PlatformDots c={u.connections} /></td>
                      <td className="py-3 pr-4 text-[20px] text-[#A1A1AA] whitespace-nowrap">
                        {new Date(u.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
                      </td>
                      <td className="py-3">
                        <span className={cn("text-[17px] font-bold flex items-center gap-1",
                          u.disabled ? "text-[#EF4444]" : "text-[#22C55E]")}>
                          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0",
                            u.disabled ? "bg-[#EF4444]" : "bg-[#22C55E]")} />
                          {u.disabled ? "suspended" : "active"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── FUNNEL ── */}
      {tab === "funnel" && <FunnelTab onToast={showToast} />}

      {/* ── STORES ── */}
      {tab === "stores" && (
        <div className="space-y-3">
          <div>
            <h3 className="text-[17px] font-bold dark:text-[#F4F4F5]">Connected Stores</h3>
            <p className="text-[15px] text-[#A1A1AA]">Each store, who has access, what it&apos;s connected to, its access code and how long it&apos;s been live.</p>
          </div>

          {storesLoading ? (
            <Card><div className="py-10 text-center text-[15px] text-[#A1A1AA]">Loading stores…</div></Card>
          ) : stores.length === 0 ? (
            <Card><div className="py-10 text-center text-[15px] text-[#A1A1AA]">No stores yet.</div></Card>
          ) : stores.map(s => {
            const conns: { label: string; on: boolean; color: string }[] = [
              { label: "Shopify", on: s.connections.shopify, color: "#96BF48" },
              { label: "Meta",    on: s.connections.meta,    color: "#1877F2" },
              { label: "GA4",     on: s.connections.ga4,     color: "#E37400" },
              { label: "GSC",     on: s.connections.gsc,     color: "#34A853" },
            ];
            const roleBadge = (role: StoreRole) => {
              const map: Record<StoreRole, string> = {
                owner:      "bg-[#FFF7ED] text-[#EA580C]",
                admin:      "bg-[#EFF6FF] text-[#1D4ED8]",
                marketing:  "bg-[#FDF2F8] text-[#BE185D]",
                view_only:  "bg-[#F5F5F4] text-[#71717A]",
              };
              return map[role];
            };
            const expanded = expandedStore === s.shop;
            return (
              <Card key={s.shop}>
                {/* Header */}
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-[16px] text-[#18181B] dark:text-[#F4F4F5]">{s.shop}</span>
                      {s.brand && <span className="text-[14px] text-[#A1A1AA]">· {s.brand}</span>}
                      <span className={cn("text-[13px] font-bold px-2 py-0.5 rounded-full",
                        s.plan === "growth" ? "bg-[#F0FDF4] text-[#15803D]" : "bg-[#F5F5F4] text-[#71717A]")}>
                        {s.plan === "growth" ? "Pro" : "Free"}
                      </span>
                    </div>
                    <div className="text-[14px] text-[#A1A1AA] mt-0.5">
                      Owner: <span className="font-semibold text-[#52525B] dark:text-[#A1A1AA]">{s.owner?.name ?? "-"}</span>
                      {s.owner?.email && <span className="text-[#A1A1AA]"> · {s.owner.email}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-center gap-1 text-[14px] text-[#71717A] dark:text-[#A1A1AA] justify-end">
                      <Calendar size={11} />
                      {s.connectedAt
                        ? new Date(s.connectedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                        : "-"}
                    </div>
                    <div className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5]">{ageSince(s.connectedAt)} ago</div>
                  </div>
                </div>

                {/* Connections + access code */}
                <div className="flex items-center justify-between flex-wrap gap-3 mt-3 pt-3 border-t border-black/[0.05] dark:border-white/[0.05]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {conns.map(c => (
                      <span key={c.label}
                        className={cn("inline-flex items-center gap-1 text-[13px] font-semibold px-2 py-0.5 rounded-lg",
                          c.on ? "text-[#18181B] dark:text-[#F4F4F5] bg-[#F5F5F4] dark:bg-[#262626]" : "text-[#C4C4C8] dark:text-[#555] bg-transparent")}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.on ? c.color : "#D4D4D8" }} />
                        {c.label}
                      </span>
                    ))}
                  </div>
                  <div className="text-[14px]">
                    {s.grant ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Tag size={11} className="text-[#F97316]" />
                        <span className="font-mono font-bold text-[#F97316]">{s.grant.code}</span>
                        <span className="text-[#A1A1AA]">
                          ({s.grant.kind === "free" ? "Free" : `${s.grant.discountPct}% off`}
                          {s.grant.expiresAt ? ` · till ${new Date(s.grant.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}` : " · forever"})
                        </span>
                      </span>
                    ) : <span className="text-[#A1A1AA]">No access code</span>}
                  </div>
                </div>

                {/* Users with access (expandable) */}
                <button
                  onClick={() => setExpandedStore(expanded ? null : s.shop)}
                  className="flex items-center gap-1.5 mt-3 text-[14px] font-semibold text-[#52525B] dark:text-[#A1A1AA] hover:text-[#F97316] transition-colors"
                >
                  <ChevronRight size={13} className={cn("transition-transform", expanded && "rotate-90")} />
                  {s.userCount} user{s.userCount === 1 ? "" : "s"} with access
                </button>
                {expanded && (
                  <div className="mt-2 space-y-1.5 pl-5">
                    {s.users.map(u => (
                      <div key={u.email} className="flex items-center justify-between gap-2 text-[14px]">
                        <div className="min-w-0">
                          <span className="font-semibold text-[#18181B] dark:text-[#F4F4F5]">{u.name}</span>
                          <span className="text-[#A1A1AA]"> · {u.email}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {u.status === "pending" && <span className="text-[13px] text-[#B45309] bg-[#FFFBEB] px-1.5 py-0.5 rounded-full font-semibold">pending</span>}
                          <span className={cn("text-[13px] font-bold px-2 py-0.5 rounded-full capitalize", roleBadge(u.role))}>
                            {u.role.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── USERS ── */}
      {tab === "users" && (
        <div className="space-y-3">
          {/* Filters - only search + status */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, email, brand, store…"
                className="w-full bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-xl pl-8 pr-3 py-2 text-[19px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]" />
            </div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-2 text-[19px] dark:text-[#F4F4F5] outline-none appearance-none">
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="disabled">Suspended</option>
            </select>
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-[19px] min-w-[900px]">
                <thead>
                  <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                    {["User / Email", "Brand", "Phone", "Shopify Store", "Platforms", "This Month", "Status", "Access", "Reset Pwd", "Login As"].map(h => (
                      <th key={h} className="text-left text-[16px] font-bold text-[#A1A1AA] uppercase tracking-wide py-2.5 pr-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => {
                    const shop = u.shops[0] ?? "";
                    const stats = shop ? storeStats[shop] : null;
                    return (
                      <tr key={u.email} className={cn(
                        "border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#FAFAF9] dark:hover:bg-[#1C1C1C] transition-colors",
                        u.disabled && "opacity-60"
                      )}>
                        <td className="py-3 pr-3">
                          <div className="font-semibold dark:text-[#F4F4F5] leading-tight">{u.name}</div>
                          <div className="text-[17px] text-[#A1A1AA] truncate max-w-[170px]">{u.email}</div>
                        </td>
                        <td className="py-3 pr-3 text-[20px] dark:text-[#F4F4F5]">
                          {u.profile?.brandName || <span className="text-[#A1A1AA] italic">-</span>}
                        </td>
                        <td className="py-3 pr-3 text-[20px] text-[#71717A] dark:text-[#A1A1AA]">
                          {u.profile?.phone || "-"}
                        </td>
                        <td className="py-3 pr-3 text-[20px] text-[#71717A] dark:text-[#A1A1AA]">
                          {u.shops[0] ? u.shops[0].replace(".myshopify.com", "") : <span className="italic">none</span>}
                        </td>
                        <td className="py-3 pr-3"><PlatformDots c={u.connections} /></td>
                        {/* Monthly stats */}
                        <td className="py-3 pr-3">
                          {!u.connections.shopify ? (
                            <span className="text-[17px] text-[#A1A1AA] italic">No Shopify</span>
                          ) : stats?.loading ? (
                            <span className="text-[17px] text-[#A1A1AA]">Loading…</span>
                          ) : stats?.error ? (
                            <span className="text-[17px] text-[#EF4444]">Error</span>
                          ) : stats ? (
                            <div>
                              <div className="flex items-center gap-1 text-[20px] font-bold text-[#22C55E]">
                                <TrendingUp size={10} />
                                {formatINR(stats.revenue)}
                              </div>
                              <div className="text-[17px] text-[#A1A1AA]">{stats.orders} orders · AOV {formatINR(stats.aov)}</div>
                              {stats.codPct > 0 && <div className="text-[17px] text-[#EAB308]">COD {stats.codPct}%</div>}
                            </div>
                          ) : (
                            <span className="text-[17px] text-[#A1A1AA]">-</span>
                          )}
                        </td>
                        <td className="py-3 pr-3">
                          <span className={cn("text-[17px] font-bold flex items-center gap-1 whitespace-nowrap",
                            u.disabled ? "text-[#EF4444]" : "text-[#22C55E]")}>
                            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0",
                              u.disabled ? "bg-[#EF4444]" : "bg-[#22C55E]")} />
                            {u.disabled ? "suspended" : "active"}
                          </span>
                        </td>
                        <td className="py-3 pr-3">
                          <button
                            onClick={() => toggleDisabled(u.email, u.disabled)}
                            title={u.disabled ? "Restore access" : "Suspend access"}
                            className={cn(
                              "flex items-center gap-1 px-2.5 py-1 rounded-xl text-[17px] font-bold transition-colors",
                              u.disabled
                                ? "bg-[#F0FDF4] text-[#16A34A] dark:bg-[#052E16] hover:bg-[#DCFCE7]"
                                : "bg-[#FEF2F2] text-[#DC2626] dark:bg-[#2D0A0A] hover:bg-[#FEE2E2]"
                            )}>
                            {u.disabled ? <><UserCheck size={10} /> Restore</> : <><UserX size={10} /> Suspend</>}
                          </button>
                        </td>
                        {/* Reset Password + Give access */}
                        <td className="py-3 pr-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => { setResetTarget(u.email); setResetPassword(""); }}
                              title={`Reset password for ${u.name}`}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-[17px] font-bold bg-[#FFF7ED] text-[#EA580C] dark:bg-[#2A1A0E] hover:bg-[#FFEDD5] transition-colors">
                              <KeyRound size={10} /> Reset
                            </button>
                            <button
                              onClick={() => setGrantTarget(u.email)}
                              disabled={!u.shops[0]}
                              title={u.shops[0] ? `Give free access to ${u.name}` : "No connected store"}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-[17px] font-bold bg-[#F0FDF4] text-[#16A34A] dark:bg-[#052E16] hover:bg-[#DCFCE7] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                              <Gift size={10} /> Access
                            </button>
                          </div>
                        </td>
                        {/* Login As */}
                        <td className="py-3">
                          <button
                            onClick={() => loginAs(u.email)}
                            disabled={u.disabled || loginAsLoading === u.email}
                            title={`Login as ${u.name}`}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-[17px] font-bold bg-[#EFF6FF] text-[#1D4ED8] dark:bg-[#1E3A5F] hover:bg-[#DBEAFE] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                            {loginAsLoading === u.email
                              ? <RefreshCw size={10} className="animate-spin" />
                              : <LogIn size={10} />}
                            Login
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={9} className="py-10 text-center text-[19px] text-[#A1A1AA]">
                      {loading ? "Loading…" : "No users found"}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── ANALYTICS ── */}
      {tab === "analytics" && (
        <div className="space-y-4">
          {/* Platform adoption */}
          <Card>
            <CardHeader title="Platform Adoption Rate" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3">
              {[
                { label: "Shopify",  count: shopifyCount,                                 color: "#96BF48" },
                { label: "Meta Ads", count: metaCount,                                    color: "#1877F2" },
                { label: "GA4",      count: ga4Count,                                     color: "#E37400" },
                { label: "GSC",      count: users.filter(u => u.connections.gsc).length, color: "#34A853" },
              ].map(p => {
                const pct = users.length ? Math.round((p.count / users.length) * 100) : 0;
                return (
                  <div key={p.label} className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-4 text-center">
                    <div className="text-[32px] font-black" style={{ color: p.color }}>{pct}%</div>
                    <div className="text-[19px] font-semibold dark:text-[#F4F4F5]">{p.label}</div>
                    <div className="text-[17px] text-[#A1A1AA]">{p.count} of {users.length} stores</div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Full user list */}
          <Card>
            <CardHeader title="All Stores - Full Details" right="Newest first" />
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-[20px] min-w-[700px]">
                <thead>
                  <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                    {["#", "Name", "Email", "Brand", "Phone", "City", "Shopify Store", "Connections", "Joined"].map(h => (
                      <th key={h} className="text-left text-[16px] font-bold text-[#A1A1AA] uppercase tracking-wide py-2 pr-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => (
                    <tr key={u.email} className={cn(
                      "border-b border-black/[0.04] dark:border-white/[0.04] last:border-0",
                      u.disabled && "opacity-50"
                    )}>
                      <td className="py-2.5 pr-3 text-[#A1A1AA] font-bold">{i + 1}</td>
                      <td className="py-2.5 pr-3 font-semibold dark:text-[#F4F4F5]">{u.name}</td>
                      <td className="py-2.5 pr-3 text-[#71717A] dark:text-[#A1A1AA] max-w-[160px] truncate">{u.email}</td>
                      <td className="py-2.5 pr-3 dark:text-[#F4F4F5]">{u.profile?.brandName || "-"}</td>
                      <td className="py-2.5 pr-3 text-[#71717A] dark:text-[#A1A1AA]">{u.profile?.phone || "-"}</td>
                      <td className="py-2.5 pr-3 text-[#71717A] dark:text-[#A1A1AA]">{u.profile?.city || "-"}</td>
                      <td className="py-2.5 pr-3 text-[#71717A] dark:text-[#A1A1AA]">{u.shops[0]?.replace(".myshopify.com", "") || "-"}</td>
                      <td className="py-2.5 pr-3"><PlatformDots c={u.connections} /></td>
                      <td className="py-2.5 pr-3 text-[#A1A1AA] whitespace-nowrap">
                        {new Date(u.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── COUPONS ── */}
      {tab === "coupons" && (
        <div className="space-y-4">
          {/* Header + Create button */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-[17px] font-bold dark:text-[#F4F4F5]">Access Codes</h3>
              <p className="text-[15px] text-[#A1A1AA]">Free trials, comped clients & discount codes</p>
            </div>
            <button
              onClick={() => setShowCreateForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[15px] font-bold bg-[#F97316] hover:bg-[#EA580C] text-white transition-colors"
            >
              <Plus size={12} /> New Code
            </button>
          </div>

          {/* Create form */}
          {showCreateForm && (
            <Card>
              <div className="text-[16px] font-bold dark:text-[#F4F4F5] mb-1">New Access Code</div>

              {/* Quick-start presets */}
              <div className="flex flex-wrap gap-2 mb-4">
                {([
                  { id: "trial" as const, label: "Trial · Free 14d" },
                  { id: "freeClient" as const, label: "Free client" },
                  { id: "discountClient" as const, label: "Discount client" },
                ]).map(p => (
                  <button
                    key={p.id}
                    onClick={() => applyPreset(p.id)}
                    className="px-2.5 py-1 rounded-lg text-[14px] font-semibold bg-[#FFF7ED] dark:bg-[#2A1A0E] text-[#EA580C] hover:bg-[#FFEDD5] dark:hover:bg-[#3A2410] transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Code */}
                <div className="sm:col-span-2">
                  <label className="text-[14px] font-semibold text-[#A1A1AA] uppercase tracking-wide block mb-1">Code</label>
                  <div className="flex gap-2">
                    <input
                      value={newCode}
                      onChange={e => setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                      placeholder="e.g. AGENCY30"
                      maxLength={20}
                      className="flex-1 bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-2 text-[15px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316] font-mono uppercase"
                    />
                    <button
                      onClick={generateRandomCode}
                      className="px-3 py-2 rounded-xl text-[14px] font-bold bg-[#F5F5F4] dark:bg-[#262626] text-[#71717A] hover:text-[#18181B] dark:hover:text-[#F4F4F5] transition-colors whitespace-nowrap"
                    >
                      Random
                    </button>
                  </div>
                </div>

                {/* What it gives */}
                <div className="sm:col-span-2">
                  <label className="text-[14px] font-semibold text-[#A1A1AA] uppercase tracking-wide block mb-1.5">What it gives</label>
                  <div className="flex gap-2 mb-2">
                    {([
                      { id: "free" as const, label: "Free access" },
                      { id: "discount" as const, label: "Discount" },
                    ]).map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setNewKind(opt.id)}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-[15px] font-bold border transition-colors",
                          newKind === opt.id
                            ? "bg-[#F97316] text-white border-[#F97316]"
                            : "bg-[#F5F5F4] dark:bg-[#1C1C1C] text-[#71717A] dark:text-[#A1A1AA] border-black/[0.06] dark:border-white/[0.06] hover:border-[#F97316]"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {newKind === "discount" && (
                    <>
                      <input
                        type="range"
                        min={1}
                        max={99}
                        value={newDiscount}
                        onChange={e => setNewDiscount(Number(e.target.value))}
                        className="w-full accent-[#F97316]"
                      />
                      <div className="flex justify-between text-[13px] text-[#A1A1AA] mt-0.5">
                        <span>1%</span>
                        <span className="text-[#F97316] font-bold">
                          {newDiscount}% off · ${(PRO_PRICE * (1 - newDiscount / 100)).toFixed(2)}/mo
                        </span>
                        <span>99%</span>
                      </div>
                    </>
                  )}
                </div>

                {/* How long */}
                <div className="sm:col-span-2">
                  <label className="text-[14px] font-semibold text-[#A1A1AA] uppercase tracking-wide block mb-1.5">How long</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex gap-2">
                      {([
                        { id: "days" as const, label: "Days" },
                        { id: "months" as const, label: "Months" },
                        { id: "forever" as const, label: "Forever" },
                      ]).map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => setNewDurationType(opt.id)}
                          className={cn(
                            "px-3 py-2 rounded-xl text-[15px] font-bold border transition-colors",
                            newDurationType === opt.id
                              ? "bg-[#F97316] text-white border-[#F97316]"
                              : "bg-[#F5F5F4] dark:bg-[#1C1C1C] text-[#71717A] dark:text-[#A1A1AA] border-black/[0.06] dark:border-white/[0.06] hover:border-[#F97316]"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {newDurationType !== "forever" && (
                      <input
                        type="number"
                        min={1}
                        value={newDurationValue}
                        onChange={e => setNewDurationValue(Math.max(1, Number(e.target.value)))}
                        className="w-24 bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-2 text-[15px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]"
                      />
                    )}
                  </div>
                </div>

                {/* Max uses */}
                <div>
                  <label className="text-[14px] font-semibold text-[#A1A1AA] uppercase tracking-wide block mb-1">Max Uses (0 = unlimited)</label>
                  <input
                    type="number"
                    min={0}
                    value={newMaxUses}
                    onChange={e => setNewMaxUses(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-2 text-[15px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]"
                  />
                </div>

                {/* Claim deadline */}
                <div>
                  <label className="text-[14px] font-semibold text-[#A1A1AA] uppercase tracking-wide block mb-1">Claimable until (optional)</label>
                  <input
                    type="date"
                    value={newExpiry}
                    onChange={e => setNewExpiry(e.target.value)}
                    className="w-full bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-2 text-[15px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316]"
                  />
                </div>
              </div>

              {/* Live preview */}
              <div className="mt-3 bg-[#FAFAF9] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-2 text-[14px] text-[#52525B] dark:text-[#A1A1AA]">
                <span className="font-mono font-bold text-[#F97316]">{newCode || "CODE"}</span>
                {" → "}
                {newKind === "free" ? "Free" : `${newDiscount}% off`}
                {newDurationType === "forever"
                  ? " forever"
                  : ` for ${newDurationValue} ${newDurationType}`}
                {" · "}
                {newMaxUses === 0 ? "unlimited stores" : `up to ${newMaxUses} store${newMaxUses === 1 ? "" : "s"}`}
              </div>

              {createError && (
                <p className="text-[14px] text-[#EF4444] font-semibold mt-3">{createError}</p>
              )}

              <div className="flex gap-2 mt-4">
                <button
                  onClick={createCoupon}
                  disabled={createLoading || !newCode.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[15px] font-bold bg-[#F97316] hover:bg-[#EA580C] text-white transition-colors disabled:opacity-50"
                >
                  {createLoading ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />}
                  Create Code
                </button>
                <button
                  onClick={() => { setShowCreateForm(false); setCreateError(null); }}
                  className="px-4 py-2 rounded-xl text-[15px] font-semibold text-[#71717A] dark:text-[#A1A1AA] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </Card>
          )}

          {/* Coupons table */}
          <Card>
            {couponsLoading ? (
              <div className="py-10 text-center text-[15px] text-[#A1A1AA]">Loading coupons…</div>
            ) : coupons.length === 0 ? (
              <div className="py-10 text-center text-[15px] text-[#A1A1AA]">No coupons yet. Generate your first one above.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[15px] min-w-[700px]">
                  <thead>
                    <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                      {["Code", "Gives", "Uses", "Claim by", "Status", "Actions"].map(h => (
                        <th key={h} className="text-left text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide py-2.5 pr-4 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {coupons.map(c => {
                      const status = couponStatus(c);
                      return (
                        <tr key={c.code} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 hover:bg-[#FAFAF9] dark:hover:bg-[#1C1C1C] transition-colors">
                          <td className="py-3 pr-4">
                            <span className="font-mono font-bold text-[#F97316] bg-[#FFF7ED] dark:bg-[#2A1A0E] px-2 py-0.5 rounded-lg text-[14px]">
                              {c.code}
                            </span>
                          </td>
                          <td className="py-3 pr-4 font-bold dark:text-[#F4F4F5]">
                            {describeBenefit(c)}
                            {(c.kind ?? (c.discountPct >= 100 ? "free" : "discount")) === "discount" && (
                              <div className="text-[13px] text-[#A1A1AA] font-normal">
                                ${(PRO_PRICE * (1 - c.discountPct / 100)).toFixed(2)}/mo
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-4 dark:text-[#F4F4F5]">
                            {c.usedCount} / {c.maxUses === 0 ? "∞" : c.maxUses}
                          </td>
                          <td className="py-3 pr-4 text-[#71717A] dark:text-[#A1A1AA] whitespace-nowrap">
                            {c.expiresAt
                              ? new Date(c.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })
                              : "Never"}
                          </td>
                          <td className="py-3 pr-4">
                            <span className={cn("text-[14px] font-bold", status.color)}>
                              {status.label}
                            </span>
                          </td>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => toggleCoupon(c)}
                                title={c.active ? "Deactivate" : "Activate"}
                                className="text-[#A1A1AA] hover:text-[#F97316] transition-colors"
                              >
                                {c.active ? <ToggleRight size={16} className="text-[#22C55E]" /> : <ToggleLeft size={16} />}
                              </button>
                              <button
                                onClick={() => deleteCoupon(c.code)}
                                title="Delete coupon"
                                className="text-[#A1A1AA] hover:text-[#EF4444] transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Give Access modal */}
      {grantTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white dark:bg-[#171717] rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-black/[0.06] dark:border-white/[0.06]">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 bg-[#F0FDF4] dark:bg-[#052E16] rounded-xl flex items-center justify-center shrink-0">
                <Gift size={14} className="text-[#16A34A]" />
              </div>
              <div>
                <div className="text-[16px] font-bold dark:text-[#F4F4F5]">Give Free Access</div>
                <div className="text-[14px] text-[#A1A1AA] truncate max-w-[220px]">{grantTarget}</div>
              </div>
            </div>
            <label className="text-[14px] font-semibold text-[#A1A1AA] uppercase tracking-wide block mb-2">For how long</label>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {([
                { label: "Forever", type: "forever" as DurationType, value: 0 },
                { label: "3 months", type: "months" as DurationType, value: 3 },
                { label: "1 month", type: "months" as DurationType, value: 1 },
                { label: "14 days", type: "days" as DurationType, value: 14 },
              ]).map(opt => (
                <button
                  key={opt.label}
                  onClick={() => giveAccess(opt.type, opt.value)}
                  disabled={grantBusy}
                  className="py-2.5 rounded-xl text-[15px] font-bold bg-[#F0FDF4] text-[#16A34A] dark:bg-[#052E16] hover:bg-[#DCFCE7] transition-colors disabled:opacity-50"
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={revokeAccess}
                disabled={grantBusy}
                className="flex-1 py-2.5 rounded-xl text-[15px] font-bold bg-[#FEF2F2] text-[#DC2626] dark:bg-[#2D0A0A] hover:bg-[#FEE2E2] transition-colors disabled:opacity-50"
              >
                Remove access
              </button>
              <button
                onClick={() => setGrantTarget(null)}
                disabled={grantBusy}
                className="px-4 py-2.5 rounded-xl text-[15px] font-semibold text-[#71717A] dark:text-[#A1A1AA] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password modal */}
      {resetTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white dark:bg-[#171717] rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-black/[0.06] dark:border-white/[0.06]">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 bg-[#FFF7ED] dark:bg-[#2A1A0E] rounded-xl flex items-center justify-center shrink-0">
                <KeyRound size={14} className="text-[#EA580C]" />
              </div>
              <div>
                <div className="text-[16px] font-bold dark:text-[#F4F4F5]">Reset Password</div>
                <div className="text-[14px] text-[#A1A1AA] truncate max-w-[220px]">{resetTarget}</div>
              </div>
            </div>
            <label className="text-[14px] font-semibold text-[#A1A1AA] uppercase tracking-wide block mb-1.5">New Password</label>
            <input
              type="text"
              value={resetPassword}
              onChange={e => setResetPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && doResetPassword()}
              placeholder="Minimum 6 characters"
              className="w-full bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] rounded-xl px-3 py-2.5 text-[15px] dark:text-[#F4F4F5] outline-none focus:border-[#F97316] mb-4 font-mono"
            />
            <div className="flex gap-2">
              <button
                onClick={doResetPassword}
                disabled={resetPassword.length < 6}
                className="flex-1 py-2.5 rounded-xl text-[15px] font-bold bg-[#F97316] hover:bg-[#EA580C] text-white transition-colors disabled:opacity-50"
              >
                Set Password
              </button>
              <button
                onClick={() => { setResetTarget(null); setResetPassword(""); }}
                className="px-4 py-2.5 rounded-xl text-[15px] font-semibold text-[#71717A] dark:text-[#A1A1AA] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 bg-[#18181B] dark:bg-[#F4F4F5] text-white dark:text-[#18181B] px-3.5 py-2 rounded-xl text-[19px] font-semibold z-50 shadow-xl">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
