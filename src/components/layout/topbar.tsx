"use client";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw, Bell, ChevronDown, Calendar, Sun, Moon, Menu, LogOut, User, ShieldCheck, Store } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useDateRange, DatePreset } from "@/lib/date-range-context";
import { useTheme } from "@/lib/theme-context";
import { isEmbedded } from "@/lib/embedded-client";

const titles: Record<string, string> = {
  "/dashboard": "Command Center",
  "/dashboard/anomaly": "Anomaly Feed",
  "/dashboard/insights": "AI Insights Engine",
  "/dashboard/chat": "AI Assistant",
  "/dashboard/sales": "Sales Report",
  "/dashboard/goals": "Monthly Goals",
  "/dashboard/products": "Product Analytics",
  "/dashboard/customers": "Customer Intelligence",
  "/dashboard/cohort": "Cohort Analysis",
  "/dashboard/geo": "Geo Performance",
  "/dashboard/meta": "Meta Campaigns",
  "/dashboard/placement": "Ads Placement",
  "/dashboard/creative": "Creative Studio",
  "/dashboard/timing": "Time Intelligence",
  "/dashboard/gads": "Google Ads",
  "/dashboard/gads/ads": "Google Ads - Ads & Ad Copy",
  "/dashboard/gads/keywords": "Google Ads - Keywords & Searches",
  "/dashboard/gads/audience": "Google Ads - Audience & Timing",
  "/dashboard/gads/actions": "Google Ads - Recommendations",
  "/dashboard/gsc": "Search Console",
  "/dashboard/ga4": "Analytics GA4",
  "/dashboard/attribution": "Attribution",
  "/dashboard/financial": "Financial P&L",
  "/dashboard/benchmarking": "Benchmarking",
  "/dashboard/weekly": "Weekly Digest",
  "/dashboard/connections": "Connections",
  "/dashboard/admin": "Admin Panel",
  "/dashboard/profile": "My Profile",
};

const presets: { id: DatePreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "28d", label: "Last 28 days" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "custom", label: "Custom range" },
];

// Only period-shiftable comparisons - every option maps to a real date range
// and updates the figures. (Dropped "vs Yesterday" / "vs Goal": they had no
// date mapping, so selecting them silently did nothing.)
const compareOptions = [
  { id: "prev_period", label: "vs Previous period" },
  { id: "last_week", label: "vs Last week" },
  { id: "last_month", label: "vs Last month" },
  { id: "last_year", label: "vs Last year" },
];

export function Topbar({ onMenuClick, isAdmin = false }: { onMenuClick: () => void; isAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const title = titles[pathname] || "Skylitee";
  const [toast, setToast] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showBell, setShowBell] = useState(false);
  const [userName, setUserName] = useState("S");
  const userMenuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const [connections, setConnections] = useState({ shopify: false, meta: false, gsc: false, ga4: false, gads: false });
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const datePickerRef = useRef<HTMLDivElement>(null);
  const [invites, setInvites] = useState<Array<{ shop: string; role: string; addedAt: string; inviterEmail: string }>>([]);
  const [inviteLoading, setInviteLoading] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Array<{ id: string; type: string; message: string; read: boolean; createdAt: string }>>([]);
  // Auto data alerts - live signals from the store's own data (COD/RTO, stock,
  // repeat-rate, order anomalies), so the bell is never empty when invites are.
  const [alerts, setAlerts] = useState<Array<{ sev: "danger" | "warning"; title: string; body: string }>>([]);
  const [alertsSeen, setAlertsSeen] = useState(false);
  const { range, setPreset, setCustomRange, compareWith, setCompareWith } = useDateRange();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) setShowDatePicker(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setShowBell(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (isAdmin) return;
    fetch("/api/invites")
      .then(r => r.json())
      .then(d => setInvites(d.invites ?? []))
      .catch(() => {});
    fetch("/api/notifications")
      .then(r => r.json())
      .then(d => setNotifications(d.notifications ?? []))
      .catch(() => {});
    fetch("/api/shopify/anomalies")
      .then(r => r.json())
      .then(d => {
        if (!d || d.error) return;
        setAlerts([
          ...((d.critical ?? []) as Array<{ title: string; desc: string }>).map(x => ({ sev: "danger" as const, title: x.title, body: x.desc })),
          ...((d.warnings ?? []) as Array<{ title: string; desc: string }>).map(x => ({ sev: "warning" as const, title: x.title, body: x.desc })),
        ]);
      })
      .catch(() => {});
  }, [isAdmin]);

  const handleInvite = async (shop: string, action: "accept" | "decline") => {
    setInviteLoading(shop);
    await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop, action }),
    });
    setInvites(prev => prev.filter(i => i.shop !== shop));
    setInviteLoading(null);
    if (action === "accept") {
      showToast(`Store added! Reloading…`);
      setTimeout(() => window.location.reload(), 1200);
    }
  };

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => { if (d.name) setUserName(d.name[0].toUpperCase()); })
      .catch(() => {});
  }, []);

  // Inside the Shopify admin the store owner is signed in by Shopify - no profile/logout menu.
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => { setEmbedded(isEmbedded()); }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  useEffect(() => {
    if (isAdmin) return; // admin doesn't need platform connection status
    fetch("/api/shopify/dashboard")
      .then(r => r.json())
      .then(d => { if (d.shop) setConnections(c => ({ ...c, shopify: true })); })
      .catch(() => {});

    fetch("/api/meta/accounts")
      .then(r => r.json())
      .then(d => { setConnections(c => ({ ...c, meta: !d.error })); })
      .catch(() => {});

    fetch("/api/google/sites")
      .then(r => r.json())
      .then(d => {
        setConnections(c => ({
          ...c,
          gsc:  !!(d.gscConnected  ?? (d.gscSites?.length > 0)),
          ga4:  !!(d.ga4Connected  ?? (d.ga4Properties?.length > 0)),
          gads: !!d.gadsConnected,
        }));
      })
      .catch(() => {});
  }, [isAdmin]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const handlePreset = (id: DatePreset) => {
    setPreset(id);
    if (id !== "custom") setShowDatePicker(false);
  };

  const applyCustom = () => {
    if (customFrom && customTo) {
      setCustomRange(customFrom, customTo);
      setShowDatePicker(false);
    }
  };

  const platforms = [
    { label: "Shopify", connected: connections.shopify },
    { label: "Meta", connected: connections.meta },
    { label: "GSC", connected: connections.gsc },
    { label: "GA4", connected: connections.ga4 },
    { label: "G.Ads", connected: connections.gads },
  ];

  return (
    <>
      <header className="bg-white dark:bg-[#111111] border-b border-black/[0.06] dark:border-white/[0.06] px-3 md:px-4 h-12 flex items-center gap-2 sticky top-0 z-20">
        {/* Hamburger - mobile only, hidden for admin */}
        {!isAdmin && (
          <button
            onClick={onMenuClick}
            className="md:hidden w-8 h-8 rounded-lg border border-black/[0.08] dark:border-white/[0.08] flex items-center justify-center text-[#71717A] dark:text-[#A1A1AA] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors shrink-0"
          >
            <Menu size={14} />
          </button>
        )}

        {/* Admin badge - clickable, always goes back to admin panel */}
        {isAdmin && (
          <button
            onClick={() => router.push("/dashboard/admin")}
            title="Go to Admin Panel"
            className="flex items-center gap-1.5 shrink-0 hover:opacity-75 transition-opacity"
          >
            <div className="w-6 h-6 bg-[#F97316] rounded-lg flex items-center justify-center">
              <ShieldCheck size={12} className="text-white" />
            </div>
          </button>
        )}

        <h1 className="text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5] flex-1 uppercase tracking-wider truncate">{title}</h1>

        {/* Date picker - hidden for admin */}
        {!isAdmin && (
          <div className="relative" ref={datePickerRef}>
            <button
              onClick={() => setShowDatePicker(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-black/[0.08] dark:border-white/[0.08] rounded-lg text-[15px] text-[#71717A] dark:text-[#A1A1AA] bg-[#F5F5F4] dark:bg-[#1C1C1C] hover:bg-[#EBEBEB] dark:hover:bg-[#262626] transition-colors"
            >
              <Calendar size={11} />
              {range.label}
              <ChevronDown size={10} />
            </button>

            {showDatePicker && (
              <div className="absolute top-full right-0 mt-1 bg-white dark:bg-[#1C1C1C] border border-black/[0.08] dark:border-white/[0.08] rounded-xl shadow-lg z-50 py-1.5 min-w-[200px]">
                {presets.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handlePreset(p.id)}
                    className={`w-full text-left px-3.5 py-2 text-[15px] transition-colors ${
                      range.preset === p.id
                        ? "font-semibold text-[#EA580C] bg-[#FFF7ED] dark:bg-[#2A1A0E] dark:text-[#FB923C]"
                        : "text-[#18181B] dark:text-[#F4F4F5] hover:bg-[#F5F5F4] dark:hover:bg-[#262626]"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                {range.preset === "custom" && (
                  <div className="px-3.5 pb-2.5 pt-1.5 border-t border-black/[0.06] dark:border-white/[0.06] space-y-1.5">
                    <div className="text-[14px] text-[#71717A] font-semibold pt-1">From</div>
                    <input
                      type="date"
                      value={customFrom}
                      onChange={e => setCustomFrom(e.target.value)}
                      className="w-full text-[15px] border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-[#262626] text-[#18181B] dark:text-[#F4F4F5] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#F97316]"
                    />
                    <div className="text-[14px] text-[#71717A] font-semibold">To</div>
                    <input
                      type="date"
                      value={customTo}
                      onChange={e => setCustomTo(e.target.value)}
                      className="w-full text-[15px] border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-[#262626] text-[#18181B] dark:text-[#F4F4F5] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#F97316]"
                    />
                    <button
                      onClick={applyCustom}
                      disabled={!customFrom || !customTo}
                      className="w-full py-1.5 bg-[#F97316] text-white rounded-lg text-[15px] font-semibold disabled:opacity-40 hover:bg-[#EA580C] transition-colors"
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Compare - hidden on mobile and for admin */}
        {!isAdmin && (
          <select
            value={compareWith}
            onChange={e => setCompareWith(e.target.value)}
            className="hidden sm:block text-[15px] px-2.5 py-1.5 border border-black/[0.08] dark:border-white/[0.08] rounded-lg bg-[#F5F5F4] dark:bg-[#1C1C1C] text-[#18181B] dark:text-[#F4F4F5] focus:outline-none focus:border-[#F97316]"
          >
            {compareOptions.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        )}

        {/* Platform pills - hidden on mobile and for admin */}
        {!isAdmin && (
          <div className="hidden lg:flex items-center gap-1.5">
            {platforms.map((p) => (
              <div
                key={p.label}
                onClick={() => !p.connected && router.push("/dashboard/connections")}
                title={p.connected ? `${p.label} connected` : `${p.label} not connected - click to connect`}
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-[13px] font-semibold border transition-colors ${
                  p.connected
                    ? "bg-[#F5F5F4] dark:bg-[#1C1C1C] border-black/[0.06] dark:border-white/[0.06] text-[#52525B] dark:text-[#A1A1AA]"
                    : "bg-[#FEF2F2] dark:bg-[#2D0A0A] border-[#FCA5A5] dark:border-[#991B1B] text-[#991B1B] dark:text-[#FCA5A5] cursor-pointer hover:bg-[#FEE2E2] dark:hover:bg-[#3D0F0F]"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${p.connected ? "bg-[#22C55E]" : "bg-[#EF4444]"}`} />
                {p.label}
              </div>
            ))}
          </div>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="w-8 h-8 rounded-lg border border-black/[0.08] dark:border-white/[0.08] flex items-center justify-center text-[#71717A] dark:text-[#A1A1AA] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors"
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        {/* Refresh - hidden for admin */}
        {!isAdmin && (
          <button
            onClick={() => { showToast("Refreshing data..."); window.location.reload(); }}
            className="w-8 h-8 rounded-lg border border-black/[0.08] dark:border-white/[0.08] flex items-center justify-center text-[#71717A] dark:text-[#A1A1AA] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        )}

        {/* Bell - hidden for admin */}
        {!isAdmin && (
          <div className="relative" ref={bellRef}>
            <button
              onClick={() => {
                setShowBell(v => !v);
                // Mark notifications + data alerts read when opening
                if (!showBell) {
                  if (notifications.some(n => !n.read)) {
                    fetch("/api/notifications", { method: "PATCH" }).catch(() => {});
                    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                  }
                  setAlertsSeen(true);
                }
              }}
              className="w-8 h-8 rounded-lg border border-black/[0.08] dark:border-white/[0.08] flex items-center justify-center text-[#71717A] dark:text-[#A1A1AA] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] transition-colors relative"
            >
              <Bell size={14} />
              {(invites.length + notifications.filter(n => !n.read).length + (alertsSeen ? 0 : alerts.length)) > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] bg-[#EF4444] rounded-full text-[11px] font-bold text-white flex items-center justify-center px-0.5">
                  {invites.length + notifications.filter(n => !n.read).length + (alertsSeen ? 0 : alerts.length)}
                </span>
              )}
            </button>
            {showBell && (
              <div className="absolute top-full right-0 mt-1 bg-white dark:bg-[#1C1C1C] border border-black/[0.08] dark:border-white/[0.08] rounded-xl shadow-lg z-50 w-[320px]">
                <div className="px-3.5 py-2.5 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between">
                  <span className="text-[15px] font-bold text-[#18181B] dark:text-[#F4F4F5]">Notifications</span>
                  {(invites.length + notifications.length + alerts.length) === 0
                    ? <span className="text-[13px] text-[#A1A1AA]">All caught up</span>
                    : <span className="text-[13px] text-[#A1A1AA]">{invites.length + notifications.length + alerts.length} items</span>}
                </div>

                <div className="max-h-[380px] overflow-y-auto">
                  {/* ── Live data alerts ── */}
                  {alerts.length > 0 && (
                    <>
                      <div className="px-3.5 pt-2.5 pb-1">
                        <span className="text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider">Data Alerts</span>
                      </div>
                      {alerts.map((a, i) => (
                        <div key={i} className="px-3.5 py-2.5 border-b border-black/[0.04] dark:border-white/[0.04] flex items-start gap-2.5">
                          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${a.sev === "danger" ? "bg-[#EF4444]" : "bg-[#EAB308]"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-semibold text-[#18181B] dark:text-[#F4F4F5] leading-snug">{a.title}</div>
                            <div className="text-[12px] text-[#71717A] dark:text-[#A1A1AA] mt-0.5 leading-snug">{a.body}</div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* ── Pending invitations ── */}
                  {invites.length > 0 && (
                    <>
                      <div className="px-3.5 pt-2.5 pb-1">
                        <span className="text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider">Store Invitations</span>
                      </div>
                      {invites.map(inv => (
                        <div key={inv.shop} className="px-3.5 py-3 border-b border-black/[0.04] dark:border-white/[0.04]">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-7 h-7 bg-[#FFF7ED] dark:bg-[#2A1A0E] rounded-lg flex items-center justify-center shrink-0">
                              <Store size={13} className="text-[#F97316]" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[15px] font-semibold text-[#18181B] dark:text-[#F4F4F5] truncate">
                                {inv.shop.replace(".myshopify.com", "")}
                              </div>
                              <div className="text-[13px] text-[#A1A1AA]">
                                <span className="capitalize">{inv.role.replace("_", " ")}</span>{" · "}by {inv.inviterEmail}
                              </div>
                            </div>
                            <span className="text-[11px] font-bold bg-[#FFFBEB] dark:bg-[#2D1C00] text-[#92400E] dark:text-[#FCD34D] px-1.5 py-0.5 rounded-full uppercase">Pending</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleInvite(inv.shop, "accept")}
                              disabled={inviteLoading === inv.shop}
                              className="flex-1 py-1.5 bg-[#F97316] text-white rounded-lg text-[14px] font-bold hover:bg-[#EA580C] transition-colors disabled:opacity-50"
                            >
                              {inviteLoading === inv.shop ? "…" : "Accept"}
                            </button>
                            <button
                              onClick={() => handleInvite(inv.shop, "decline")}
                              disabled={inviteLoading === inv.shop}
                              className="flex-1 py-1.5 border border-black/[0.08] dark:border-white/[0.08] text-[#71717A] dark:text-[#A1A1AA] rounded-lg text-[14px] font-semibold hover:bg-[#F5F5F4] dark:hover:bg-[#262626] transition-colors disabled:opacity-50"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* ── Owner notifications (accept/decline history) ── */}
                  {notifications.length > 0 && (
                    <>
                      <div className="px-3.5 pt-2.5 pb-1">
                        <span className="text-[12px] font-bold text-[#A1A1AA] uppercase tracking-wider">Activity</span>
                      </div>
                      {notifications.map(notif => (
                        <div key={notif.id} className={`px-3.5 py-2.5 border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 flex items-start gap-2.5 ${!notif.read ? "bg-[#FFFBEB] dark:bg-[#1A1400]" : ""}`}>
                          <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                            notif.type === "invite_accepted" ? "bg-[#22C55E]" :
                            notif.type === "invite_declined" ? "bg-[#EF4444]" : "bg-[#A1A1AA]"
                          }`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] text-[#18181B] dark:text-[#F4F4F5] leading-snug">{notif.message}</div>
                            <div className="text-[12px] text-[#A1A1AA] mt-0.5">
                              {new Date(notif.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {invites.length === 0 && notifications.length === 0 && alerts.length === 0 && (
                    <div className="px-3.5 py-6 text-[14px] text-[#A1A1AA] text-center">No notifications yet</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Avatar + user menu */}
        <div className={embedded ? "hidden" : "relative"} ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(v => !v)}
            className="w-8 h-8 rounded-full bg-[#F97316] flex items-center justify-center text-[15px] font-bold text-white hover:bg-[#EA580C] transition-colors"
          >
            {userName}
          </button>
          {showUserMenu && (
            <div className="absolute top-full right-0 mt-1 bg-white dark:bg-[#1C1C1C] border border-black/[0.08] dark:border-white/[0.08] rounded-xl shadow-lg z-50 py-1.5 min-w-[160px]">
              {/* Admin panel shortcut - only for admin */}
              {isAdmin && (
                <>
                  <button
                    onClick={() => { setShowUserMenu(false); router.push("/dashboard/admin"); }}
                    className="w-full text-left px-3.5 py-2 text-[15px] text-[#F97316] font-semibold hover:bg-[#FFF7ED] dark:hover:bg-[#2A1A0E] flex items-center gap-2 transition-colors"
                  >
                    <ShieldCheck size={13} /> Admin Panel
                  </button>
                  <div className="border-t border-black/[0.06] dark:border-white/[0.06] my-1" />
                </>
              )}
              <button
                onClick={() => { setShowUserMenu(false); router.push("/dashboard/profile"); }}
                className="w-full text-left px-3.5 py-2 text-[15px] text-[#18181B] dark:text-[#F4F4F5] hover:bg-[#F5F5F4] dark:hover:bg-[#262626] flex items-center gap-2 transition-colors"
              >
                <User size={13} className="text-[#71717A]" /> My Profile
              </button>
              <div className="border-t border-black/[0.06] dark:border-white/[0.06] my-1" />
              <button
                onClick={handleLogout}
                className="w-full text-left px-3.5 py-2 text-[15px] text-[#EF4444] hover:bg-[#FEF2F2] dark:hover:bg-[#2D0A0A] flex items-center gap-2 transition-colors"
              >
                <LogOut size={13} /> Logout
              </button>
            </div>
          )}
        </div>
      </header>

      {toast && (
        <div className="fixed bottom-4 right-4 bg-[#18181B] dark:bg-[#F4F4F5] text-white dark:text-[#18181B] px-3.5 py-2 rounded-xl text-[15px] font-semibold z-50 flex items-center gap-2 shadow-xl">
          ✓ {toast}
        </div>
      )}
    </>
  );
}
