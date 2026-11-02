"use client";
import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SetupProgress } from "@/components/layout/setup-progress";
import { DateRangeProvider } from "@/lib/date-range-context";
import { Eye, X } from "lucide-react";

interface ImpersonateData { id: string; name: string; brand: string; }

// Pages a gated (unsubscribed / expired) user may still reach - to subscribe or connect.
function isExemptPath(pathname: string): boolean {
  return pathname.startsWith("/dashboard/pricing") || pathname.startsWith("/dashboard/connections");
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [impersonate, setImpersonate] = useState<ImpersonateData | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [hasAccess, setHasAccess] = useState(true);
  const [accessChecked, setAccessChecked] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const raw = localStorage.getItem("skylitee-impersonate");
    if (raw) setImpersonate(JSON.parse(raw));

    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => { if (d.isAdmin) setIsAdmin(true); })
      .catch(() => {})
      .finally(() => setAdminChecked(true));

    fetch("/api/billing/status")
      .then(r => r.json())
      .then(d => setHasAccess(!!d.hasAccess))
      .catch(() => setHasAccess(true)) // never lock someone out on a network blip
      .finally(() => setAccessChecked(true));
  }, []);

  // Access gate: send subscribers-only pages to the plans screen when access has lapsed.
  // The owner's account and impersonation sessions bypass entirely.
  const exempt = isExemptPath(pathname);
  const gated = adminChecked && accessChecked && !isAdmin && !impersonate && !exempt && !hasAccess;

  useEffect(() => {
    if (gated) router.replace("/dashboard/pricing");
  }, [gated, router]);

  const exitImpersonate = () => {
    localStorage.removeItem("skylitee-impersonate");
    setImpersonate(null);
    router.push("/admin");
  };

  return (
    <DateRangeProvider>
      <div className="flex h-screen overflow-hidden bg-[#F5F5F4] dark:bg-[#0C0C0C]">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Topbar onMenuClick={() => setSidebarOpen(v => !v)} />

          {/* Admin impersonation banner */}
          {impersonate && (
            <div className="bg-[#1877F2] text-white text-[15px] font-semibold px-4 py-2 flex items-center gap-2 shrink-0 flex-wrap">
              <Eye size={13} className="shrink-0" />
              <span>
                Admin view - <strong>{impersonate.brand}</strong> ({impersonate.name}).
                Data shown is your own connected store.
              </span>
              <button onClick={exitImpersonate}
                className="ml-auto flex items-center gap-1 bg-white/20 hover:bg-white/30 px-2.5 py-0.5 rounded-lg text-[14px] font-bold transition-colors">
                <X size={10} /> Exit Admin View
              </button>
            </div>
          )}

          <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-5">
            {gated ? (
              <div className="h-full flex items-center justify-center text-[15px] text-[#71717A] dark:text-[#A1A1AA]">
                Redirecting to plans…
              </div>
            ) : (
              <>
                {accessChecked && !isAdmin && !impersonate && <SetupProgress hasAccess={hasAccess} />}
                {children}
              </>
            )}
          </main>
        </div>
      </div>
    </DateRangeProvider>
  );
}
