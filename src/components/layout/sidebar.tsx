"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import {
  LayoutDashboard, Radar, Brain, MessageSquareText,
  ShoppingCart, Target, Package,
  Users, BarChart2, MapPin,
  Share2, Layout, Palette, Clock,
  Search, LineChart, Megaphone,
  GitMerge, Receipt, Trophy, CalendarDays,
  Plug, ChevronDown, UserCircle,
  X, CreditCard, Plus,
  FileText, TrendingUp, BarChart3, DollarSign, HelpCircle, FilePlus, Binoculars,
  KeyRound, ListChecks,
} from "lucide-react";
import { SkyLiteeLogo } from "@/components/ui/skylitee-logo";
import { isEmbedded } from "@/lib/embedded-client";

interface NavItem {
  href: string; label: string; icon: React.ElementType;
  badge: { text: string; color: string } | null; dot: string | null;
}
interface NavSection { label: string; tooltip: string; items: NavItem[]; }

const navSections: NavSection[] = [
  {
    label: "Overview",
    tooltip: "Your daily command center - real-time alerts, AI-generated insights, and an AI assistant to answer brand questions.",
    items: [
      { href: "/dashboard", label: "Command Center", icon: LayoutDashboard, badge: null, dot: null },
      { href: "/dashboard/anomaly", label: "Anomaly Feed", icon: Radar, badge: { text: "5", color: "red" }, dot: null },
      { href: "/dashboard/insights", label: "AI Insights", icon: Brain, badge: { text: "11", color: "amber" }, dot: null },
      { href: "/dashboard/chat", label: "AI Assistant", icon: MessageSquareText, badge: { text: "New", color: "orange" }, dot: null },
    ],
  },
  {
    label: "Shopify",
    tooltip: "Live data from your Shopify store - orders, revenue, monthly goals, and which products are performing.",
    items: [
      { href: "/dashboard/sales", label: "Sales Report", icon: ShoppingCart, badge: null, dot: "on" },
      { href: "/dashboard/goals", label: "Monthly Goals", icon: Target, badge: null, dot: "on" },
      { href: "/dashboard/products", label: "Product Analytics", icon: Package, badge: null, dot: "on" },
    ],
  },
  {
    label: "Customers",
    tooltip: "Who your customers are, how often they come back (cohort retention), and which cities/states drive the most sales.",
    items: [
      { href: "/dashboard/customers", label: "Customer Intel", icon: Users, badge: null, dot: "on" },
      { href: "/dashboard/cohort", label: "Cohort Analysis", icon: BarChart2, badge: null, dot: "on" },
      { href: "/dashboard/geo", label: "Geo Performance", icon: MapPin, badge: null, dot: "on" },
    ],
  },
  {
    label: "Meta Ads",
    tooltip: "Facebook & Instagram ad data - ROAS, CTR, ad spend, creative performance, and funnel diagnostics.",
    items: [
      { href: "/dashboard/meta", label: "Meta Campaigns", icon: Share2, badge: null, dot: "meta" },
      { href: "/dashboard/placement", label: "Ads Placement", icon: Layout, badge: null, dot: "meta" },
      { href: "/dashboard/creative", label: "Creative Studio", icon: Palette, badge: null, dot: "meta" },
      { href: "/dashboard/timing", label: "Time Intelligence", icon: Clock, badge: null, dot: "meta" },
    ],
  },
  {
    label: "Google Ads",
    tooltip: "Google Ads analytics - every KPI against industry benchmarks, ad-wise results and copy, keywords, audiences, and ranked recommendations.",
    items: [
      { href: "/dashboard/gads", label: "Overview", icon: Megaphone, badge: null, dot: "google_gads" },
      { href: "/dashboard/gads/ads", label: "Ads & Ad Copy", icon: FileText, badge: { text: "New", color: "orange" }, dot: "google_gads" },
      { href: "/dashboard/gads/keywords", label: "Keywords & Searches", icon: KeyRound, badge: { text: "New", color: "orange" }, dot: "google_gads" },
      { href: "/dashboard/gads/audience", label: "Audience & Timing", icon: Users, badge: { text: "New", color: "orange" }, dot: "google_gads" },
      { href: "/dashboard/gads/actions", label: "Recommendations", icon: ListChecks, badge: { text: "New", color: "orange" }, dot: "google_gads" },
    ],
  },
  {
    label: "Google",
    tooltip: "Google Search Console (SEO, keywords, sitemaps) and GA4 (website traffic, ecommerce, user behavior).",
    items: [
      { href: "/dashboard/gsc", label: "Search Console", icon: Search, badge: null, dot: "google_gsc" },
      { href: "/dashboard/ga4", label: "Analytics GA4", icon: LineChart, badge: null, dot: "google_ga4" },
    ],
  },
  {
    label: "Analytics",
    tooltip: "Cross-platform analysis - where revenue comes from (attribution), Profit & Loss, industry benchmarks, and weekly summaries.",
    items: [
      { href: "/dashboard/sales-analysis", label: "Sales Analysis", icon: BarChart3, badge: { text: "New", color: "orange" }, dot: null },
      { href: "/dashboard/attribution", label: "Attribution", icon: GitMerge, badge: null, dot: null },
      { href: "/dashboard/financial", label: "Financial P&L", icon: Receipt, badge: null, dot: null },
      { href: "/dashboard/competitors", label: "Competitor Intel", icon: Binoculars, badge: { text: "New", color: "orange" }, dot: null },
      { href: "/dashboard/benchmarking", label: "Benchmarking", icon: Trophy, badge: null, dot: null },
      { href: "/dashboard/weekly", label: "Weekly Digest", icon: CalendarDays, badge: null, dot: null },
    ],
  },
  {
    label: "Reports",
    tooltip: "Full business reports - Custom Report, SEO, Performance Marketing, and Financial P&L.",
    items: [
      { href: "/dashboard/reports/builder", label: "Custom Report", icon: FilePlus, badge: { text: "New", color: "orange" }, dot: null },
      { href: "/dashboard/reports/seo", label: "SEO Report", icon: FileText, badge: null, dot: "google_gsc" },
      { href: "/dashboard/reports/performance", label: "Performance Marketing", icon: TrendingUp, badge: null, dot: null },
      { href: "/dashboard/reports/financial", label: "Financial P&L", icon: DollarSign, badge: null, dot: null },
    ],
  },
  {
    label: "Settings",
    tooltip: "Connect your Shopify, Meta, and Google accounts. Manage your profile and team access.",
    items: [
      { href: "/dashboard/connections", label: "Connections", icon: Plug, badge: null, dot: null },
      { href: "/dashboard/pricing", label: "Plan & Billing", icon: CreditCard, badge: null, dot: null },
      { href: "/dashboard/profile", label: "Profile & Account", icon: UserCircle, badge: null, dot: null },
    ],
  },
];

function getActiveSectionLabel(pathname: string): string {
  for (const s of navSections) {
    if (s.items.some(item => pathname === item.href)) return s.label;
  }
  return "Overview";
}

const badgeStyles: Record<string, string> = {
  red: "bg-[#FEF2F2] text-[#991B1B] dark:bg-[#2D0A0A] dark:text-[#FCA5A5]",
  amber: "bg-[#FFFBEB] text-[#92400E] dark:bg-[#2D1C00] dark:text-[#FCD34D]",
  orange: "bg-[#FFF7ED] text-[#EA580C] dark:bg-[#2A1A0E] dark:text-[#FB923C]",
};
const dotStyles = { on: "bg-[#22C55E]", off: "bg-[#EF4444]", warn: "bg-[#EAB308]" };

export interface SidebarProps { open: boolean; onClose: () => void; }

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set([getActiveSectionLabel(pathname)])
  );
  const [shopName, setShopName] = useState("My Store");
  const [allShops, setAllShops] = useState<string[]>([]);
  const [showShopMenu, setShowShopMenu] = useState(false);
  const shopMenuRef = useRef<HTMLDivElement>(null);
  const [gscConnected, setGscConnected]   = useState<boolean | null>(null);
  const [ga4Connected, setGa4Connected]   = useState<boolean | null>(null);
  const [gadsConnected, setGadsConnected] = useState<boolean | null>(null);
  const [metaConnected, setMetaConnected] = useState<boolean | null>(null);
  // Inside the Shopify admin the app is for that one store - no adding/switching stores.
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => { setEmbedded(isEmbedded()); }, []);

  useEffect(() => {
    const active = getActiveSectionLabel(pathname);
    setOpenSections(prev => prev.has(active) ? prev : new Set([...prev, active]));
  }, [pathname]);

  useEffect(() => {
    fetch("/api/shopify/dashboard")
      .then(r => r.json())
      .then(d => { if (d.shop) setShopName(d.shop.replace(".myshopify.com", "")); })
      .catch(() => {});
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => { if (d.shops) setAllShops(d.shops); })
      .catch(() => {});
    fetch("/api/google/sites")
      .then(r => r.json())
      .then(d => {
        setGscConnected(!!d.gscConnected);
        setGa4Connected(!!d.ga4Connected);
        setGadsConnected(!!d.gadsConnected);
      })
      .catch(() => { setGscConnected(false); setGa4Connected(false); setGadsConnected(false); });
    fetch("/api/meta/accounts")
      .then(r => r.json())
      .then(d => setMetaConnected(!d.error))
      .catch(() => setMetaConnected(false));
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (shopMenuRef.current && !shopMenuRef.current.contains(e.target as Node)) {
        setShowShopMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = (label: string) => setOpenSections(prev => {
    const next = new Set(prev);
    next.has(label) ? next.delete(label) : next.add(label);
    return next;
  });

  function resolveDot(dot: string | null): string | null {
    if (dot === "google_gsc")  return gscConnected  == null ? null : gscConnected  ? "on" : "off";
    if (dot === "google_ga4")  return ga4Connected  == null ? null : ga4Connected  ? "on" : "off";
    if (dot === "google_gads") return gadsConnected == null ? null : gadsConnected ? "on" : "off";
    if (dot === "meta")        return metaConnected == null ? null : metaConnected ? "on" : "off";
    return dot;
  }

  const liveCount = 1
    + (gscConnected  ? 1 : 0)
    + (ga4Connected  ? 1 : 0)
    + (gadsConnected ? 1 : 0)
    + (metaConnected ? 1 : 0);

  const inner = (
    <aside className="w-[218px] min-w-[218px] bg-white dark:bg-[#111111] border-r border-black/[0.06] dark:border-white/[0.06] flex flex-col h-full">
      {/* Logo */}
      <div className="px-3 py-3.5 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center gap-2.5">
        <SkyLiteeLogo size={28} />
        <div className="flex-1 min-w-0">
          <div className="text-[17px] font-bold text-[#18181B] dark:text-[#F4F4F5]">Skylitee</div>
          <div className="text-[13px] text-[#A1A1AA] tracking-wide">Analytics Platform</div>
        </div>
        <button onClick={onClose} className="md:hidden p-1 rounded-lg hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] shrink-0">
          <X size={16} className="text-[#71717A]" />
        </button>
      </div>

      {/* Store switcher */}
      <div className="mx-2 mt-2.5">
        <div className="flex items-center gap-1.5" ref={shopMenuRef}>
          {/* Store name / switcher */}
          <div className="flex-1 relative">
            <button
              onClick={() => allShops.length > 1 && setShowShopMenu(v => !v)}
              className={cn(
                "w-full bg-[#F5F5F4] dark:bg-[#1C1C1C] rounded-xl px-2.5 py-1.5 flex items-center justify-between border border-black/[0.06] dark:border-white/[0.06] transition-colors",
                allShops.length > 1 ? "hover:bg-[#EBEBEB] dark:hover:bg-[#262626] cursor-pointer" : "cursor-default"
              )}
            >
              <span className="text-[15px] font-semibold text-[#18181B] dark:text-[#F4F4F5] truncate">{shopName}</span>
              {allShops.length > 1 && (
                <ChevronDown size={10} className={cn("text-[#A1A1AA] shrink-0 transition-transform", showShopMenu ? "rotate-180" : "")} />
              )}
            </button>
            {showShopMenu && allShops.length > 1 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#1C1C1C] border border-black/[0.08] dark:border-white/[0.08] rounded-xl shadow-lg z-50 py-1.5">
                {allShops.map(s => (
                  <button
                    key={s}
                    onClick={async () => {
                      await fetch("/api/auth/switch-store", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: s }) });
                      setShowShopMenu(false);
                      window.location.reload();
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-[15px] transition-colors",
                      s.replace(".myshopify.com", "") === shopName
                        ? "font-semibold text-[#F97316] bg-[#FFF7ED] dark:bg-[#2A1A0E]"
                        : "text-[#18181B] dark:text-[#F4F4F5] hover:bg-[#F5F5F4] dark:hover:bg-[#262626]"
                    )}
                  >
                    {s.replace(".myshopify.com", "")}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Add Store button (website only) */}
          <button
            onClick={() => { window.location.href = "/connect"; }}
            title="Add another store"
            className={cn(embedded && "!hidden", "flex items-center justify-center w-[30px] h-[30px] shrink-0 rounded-xl bg-[#F5F5F4] dark:bg-[#1C1C1C] border border-black/[0.06] dark:border-white/[0.06] text-[#A1A1AA] hover:bg-[#FFF7ED] dark:hover:bg-[#2A1A0E] hover:border-[#F97316]/30 hover:text-[#F97316] transition-colors")}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {navSections.map((section) => {
          const isOpen = openSections.has(section.label);
          return (
            <div key={section.label}>
              {/* Section header */}
              <button
                onClick={() => toggle(section.label)}
                className="w-full flex items-center justify-between px-3 pt-3 pb-1 group"
              >
                <div className="flex items-center gap-1">
                  <span className="text-[12px] font-bold text-[#A1A1AA] dark:text-[#525252] uppercase tracking-[0.1em] group-hover:text-[#71717A] dark:group-hover:text-[#71717A] transition-colors">
                    {section.label}
                  </span>
                  <Tooltip content={section.tooltip} side="right" maxWidth={220}>
                    <HelpCircle size={9} className="text-[#D4D4D4] dark:text-[#404040] group-hover:text-[#A1A1AA] transition-colors" />
                  </Tooltip>
                </div>
                <ChevronDown
                  size={10}
                  className={cn(
                    "text-[#C4C4C4] dark:text-[#404040] transition-transform duration-200 shrink-0",
                    isOpen ? "rotate-0" : "-rotate-90"
                  )}
                />
              </button>

              {/* Items */}
              <div className={cn(
                "overflow-hidden transition-all duration-200 ease-in-out",
                isOpen ? "max-h-[400px] opacity-100" : "max-h-0 opacity-0"
              )}>
                {section.items.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;
                  const dot = resolveDot(item.dot);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 text-[15px] transition-all relative cursor-pointer mx-1 rounded-lg",
                        isActive
                          ? "bg-[#FFF7ED] dark:bg-[#2A1A0E] text-[#EA580C] dark:text-[#FB923C] font-semibold"
                          : "text-[#71717A] dark:text-[#A1A1AA] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] hover:text-[#18181B] dark:hover:text-[#F4F4F5]"
                      )}
                    >
                      {isActive && <span className="absolute left-0 top-1 bottom-1 w-[3px] bg-[#F97316] rounded-r-full" />}
                      <Icon size={13} className="shrink-0" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge && (
                        <span className={cn("text-[13px] px-1.5 py-px rounded-full font-semibold", badgeStyles[item.badge.color])}>
                          {item.badge.text}
                        </span>
                      )}
                      {dot && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotStyles[dot as keyof typeof dotStyles])} />}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-2.5 border-t border-black/[0.06] dark:border-white/[0.06] text-[14px] text-[#A1A1AA]">
        <div className="dark:text-[#71717A]">Shopify live sync</div>
        <div className="flex items-center gap-1 mt-0.5 text-[#EA580C] dark:text-[#FB923C] font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-[#F97316]" />
          {liveCount} of 5 platforms live
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop - sticky */}
      <div className="hidden md:block h-screen sticky top-0 shrink-0">
        {inner}
      </div>

      {/* Mobile - slide-in drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
          <div className="relative z-10 h-full overflow-y-auto shadow-2xl">
            {inner}
          </div>
        </div>
      )}
    </>
  );
}
