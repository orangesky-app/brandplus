"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { RefreshCw, Webhook, LogOut } from "lucide-react";
import { UNINSTALL_REASONS } from "@/lib/uninstall-reasons";

type StepKey = "account" | "plan" | "meta" | "google" | "returned";

interface FunnelRow {
  shop: string;
  owner: string | null;
  tracked: boolean;
  installedAt: string | null;
  status: "active" | "uninstalled" | "disconnected";
  uninstalledAt: string | null;
  uninstallCount: number;
  reason: string | null;
  reasonNote: string | null;
  activeDays: number;
  lastSeenDay: string | null;
  steps: Record<StepKey, boolean>;
  welcome: { questions: boolean; xray: boolean; done: boolean } | null;
}

const STEPS: { key: StepKey | "installed"; label: string }[] = [
  { key: "installed", label: "Installed app" },
  { key: "account",   label: "Skylitee account linked" },
  { key: "plan",      label: "Started trial / plan" },
  { key: "meta",      label: "Connected Meta" },
  { key: "google",    label: "Connected Google" },
  { key: "returned",  label: "Came back after day 7" },
];

const WINDOWS = [
  { key: 7,   label: "7 days" },
  { key: 30,  label: "30 days" },
  { key: 90,  label: "90 days" },
  { key: 0,   label: "All time" },
] as const;

const DAY_MS = 86_400_000;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "-";
const reasonLabel = (k: string | null) => UNINSTALL_REASONS.find(r => r.key === k)?.label ?? null;

// Furthest step a store reached (index into STEPS).
function lastStep(r: FunnelRow): number {
  let last = 0;
  STEPS.forEach((s, i) => { if (s.key !== "installed" && r.steps[s.key]) last = i; });
  return last;
}

export function FunnelTab({ onToast }: { onToast: (msg: string) => void }) {
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [windowDays, setWindowDays] = useState<number>(30);
  const [registering, setRegistering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/funnel");
      if (res.ok) setRows(((await res.json()) as { rows: FunnelRow[] }).rows ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const registerWebhooks = async () => {
    setRegistering(true);
    try {
      const res = await fetch("/api/admin/register-webhooks", { method: "POST" });
      const d = await res.json() as { scanned?: number; summary?: Record<string, number>; error?: string };
      if (!res.ok) onToast(d.error ?? "Failed");
      else onToast(`Uninstall tracking: ${d.summary?.ok ?? 0} of ${d.scanned ?? 0} stores enabled${d.summary?.error ? `, ${d.summary.error} failed` : ""}.`);
    } catch { onToast("Failed"); }
    setRegistering(false);
  };

  const inWindow = useMemo(() => {
    if (windowDays === 0) return rows;
    const cutoff = Date.now() - windowDays * DAY_MS;
    return rows.filter(r => r.installedAt && new Date(r.installedAt).getTime() >= cutoff);
  }, [rows, windowDays]);

  const total = inWindow.length;
  // "Came back after day 7" only makes sense for stores installed 7+ days ago.
  const d7Eligible = inWindow.filter(r => r.installedAt && Date.now() - new Date(r.installedAt).getTime() >= 7 * DAY_MS);
  const stepCounts = STEPS.map(s => {
    if (s.key === "installed") return { ...s, count: total, base: total };
    if (s.key === "returned") return { ...s, count: d7Eligible.filter(r => r.steps.returned).length, base: d7Eligible.length };
    const k = s.key;
    return { ...s, count: inWindow.filter(r => r.steps[k]).length, base: total };
  });

  const uninstalled = inWindow.filter(r => r.status === "uninstalled");
  const uninstallPct = total ? Math.round((uninstalled.length / total) * 100) : 0;

  const leftAt = STEPS.map((s, i) => ({ label: s.label, count: uninstalled.filter(r => lastStep(r) === i).length }))
    .filter(x => x.count > 0);
  const reasons = UNINSTALL_REASONS.map(r => ({ label: r.label, count: uninstalled.filter(u => u.reason === r.key).length }))
    .filter(x => x.count > 0);
  const answered = uninstalled.filter(r => r.reason).length;

  const welcomeRows = inWindow.filter(r => r.welcome);
  const welcomeSteps = [
    { label: "Reached /welcome",      count: welcomeRows.filter(r => r.steps.account).length },
    { label: "Answered 3 questions",  count: welcomeRows.filter(r => r.welcome?.questions).length },
    { label: "Saw Store X-Ray",       count: welcomeRows.filter(r => r.welcome?.xray).length },
    { label: "Went to dashboard",     count: welcomeRows.filter(r => r.welcome?.done).length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-[17px] font-bold dark:text-[#F4F4F5]">Onboarding Funnel</h3>
          <p className="text-[15px] text-[#A1A1AA]">How far each installed store gets, and where uninstalls happen.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-xl border border-black/[0.06] dark:border-white/[0.06] overflow-hidden">
            {WINDOWS.map(w => (
              <button key={w.key} onClick={() => setWindowDays(w.key)}
                className={cn("px-3 py-1.5 text-[14px] font-semibold transition-colors",
                  windowDays === w.key ? "bg-[#F97316] text-white" : "text-[#71717A] dark:text-[#A1A1AA] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C]")}>
                {w.label}
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[14px] font-semibold text-[#71717A] dark:text-[#A1A1AA] border border-black/[0.06] dark:border-white/[0.06] hover:bg-[#F5F5F4] dark:hover:bg-[#1C1C1C] disabled:opacity-50">
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={registerWebhooks} disabled={registering}
            title="Subscribe stores that installed before tracking existed. Safe to run again."
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[14px] font-semibold text-[#F97316] border border-[#F97316]/30 hover:bg-[#FFF7ED] dark:hover:bg-[#F97316]/10 disabled:opacity-50">
            <Webhook size={11} className={registering ? "animate-pulse" : ""} /> Enable uninstall tracking
          </button>
        </div>
      </div>

      {/* Funnel */}
      <Card>
        <CardHeader title="Install → Active user" right={`${total} store${total === 1 ? "" : "s"} installed`} />
        <div className="space-y-3 mt-3">
          {stepCounts.map((s, i) => {
            const pct = s.base ? Math.round((s.count / s.base) * 100) : 0;
            const prev = i > 0 && s.key !== "returned" ? stepCounts[i - 1].count : null;
            const drop = prev !== null && prev > 0 ? prev - s.count : 0;
            return (
              <div key={s.key}>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <span className="text-[15px] font-semibold dark:text-[#F4F4F5]">{i + 1}. {s.label}</span>
                  <span className="text-[15px] shrink-0">
                    {drop > 0 && <span className="text-[#EF4444] font-semibold mr-2">−{drop} dropped</span>}
                    <span className="font-bold dark:text-[#F4F4F5]">{s.count}</span>
                    <span className="text-[#A1A1AA]"> / {s.base}{s.key === "returned" ? " eligible" : ""} · {pct}%</span>
                  </span>
                </div>
                <div className="w-full h-2.5 bg-[#F5F5F4] dark:bg-[#262626] rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-[#F97316]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Welcome flow (new installs only) */}
      <Card>
        <CardHeader title="Welcome flow" right={`${welcomeRows.length} new install${welcomeRows.length === 1 ? "" : "s"} went through it`} />
        {welcomeRows.length === 0 ? (
          <div className="text-[14px] text-[#A1A1AA] py-2 mt-1">No new installs through the welcome flow in this period yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-3">
            {welcomeSteps.map(s => {
              const pct = welcomeRows.length ? Math.round((s.count / welcomeRows.length) * 100) : 0;
              return (
                <div key={s.label} className="rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-3">
                  <div className="text-[13px] text-[#A1A1AA]">{s.label}</div>
                  <div className="text-[22px] font-black dark:text-[#F4F4F5]">{s.count}<span className="text-[14px] font-semibold text-[#A1A1AA]"> · {pct}%</span></div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Uninstalls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <div className="text-[14px] font-bold text-[#A1A1AA] uppercase tracking-wide">Uninstalled</div>
          <div className={cn("text-[30px] font-black mt-1", uninstalled.length ? "text-[#EF4444]" : "text-[#22C55E]")}>{uninstalled.length}</div>
          <div className="text-[14px] text-[#A1A1AA] mt-0.5">{uninstallPct}% of installs in this period</div>
          <div className="text-[13px] text-[#A1A1AA] mt-2">{answered} of {uninstalled.length} told us why</div>
        </Card>
        <Card>
          <CardHeader title="Where they left" right="last step reached" />
          <div className="mt-2 space-y-1.5">
            {leftAt.length === 0
              ? <div className="text-[14px] text-[#A1A1AA] py-2">No uninstalls in this period.</div>
              : leftAt.map(x => (
                <div key={x.label} className="flex justify-between text-[14px]">
                  <span className="dark:text-[#F4F4F5]">{x.label}</span>
                  <span className="font-bold text-[#EF4444]">{x.count}</span>
                </div>
              ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Why they left" right="from feedback email" />
          <div className="mt-2 space-y-1.5">
            {reasons.length === 0
              ? <div className="text-[14px] text-[#A1A1AA] py-2">No answers yet.</div>
              : reasons.map(x => (
                <div key={x.label} className="flex justify-between gap-2 text-[14px]">
                  <span className="dark:text-[#F4F4F5]">{x.label}</span>
                  <span className="font-bold dark:text-[#F4F4F5]">{x.count}</span>
                </div>
              ))}
          </div>
        </Card>
      </div>

      {/* Per-store table */}
      <Card>
        <CardHeader title="Stores" right={`${total} in period`} />
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[14px] min-w-[760px]">
            <thead>
              <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
                {["Store", "Installed", "Steps", "Visits", "Status"].map(h => (
                  <th key={h} className="text-left text-[13px] font-bold text-[#A1A1AA] uppercase tracking-wide py-2 pr-4 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inWindow.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-[#A1A1AA]">{loading ? "Loading…" : "No installs in this period."}</td></tr>
              )}
              {inWindow.map(r => (
                <tr key={r.shop} className="border-b border-black/[0.04] dark:border-white/[0.04] last:border-0 align-top">
                  <td className="py-2.5 pr-4">
                    <div className="font-mono font-semibold dark:text-[#F4F4F5]">{r.shop.replace(".myshopify.com", "")}</div>
                    <div className="text-[13px] text-[#A1A1AA] truncate max-w-[220px]">{r.owner ?? "no account yet"}</div>
                  </td>
                  <td className="py-2.5 pr-4 whitespace-nowrap text-[#71717A] dark:text-[#A1A1AA]">
                    {fmtDate(r.installedAt)}
                    {!r.tracked && <div className="text-[12px] text-[#A1A1AA]">before tracking</div>}
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-1">
                      {STEPS.map(s => {
                        const on = s.key === "installed" || r.steps[s.key];
                        return (
                          <span key={s.key} title={`${s.label}: ${on ? "yes" : "no"}`}
                            className={cn("w-2.5 h-2.5 rounded-full", on ? "bg-[#22C55E]" : "bg-[#E4E4E7] dark:bg-[#3F3F46]")} />
                        );
                      })}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 text-[#71717A] dark:text-[#A1A1AA] whitespace-nowrap">
                    {r.activeDays ? `${r.activeDays} day${r.activeDays === 1 ? "" : "s"}` : "-"}
                  </td>
                  <td className="py-2.5">
                    {r.status === "uninstalled" ? (
                      <div>
                        <span className="inline-flex items-center gap-1 text-[#EF4444] font-bold"><LogOut size={11} /> Uninstalled {fmtDate(r.uninstalledAt)}</span>
                        {r.reason && <div className="text-[13px] text-[#52525B] dark:text-[#A1A1AA]">“{reasonLabel(r.reason)}”</div>}
                        {r.reasonNote && <div className="text-[13px] text-[#A1A1AA] italic max-w-[260px]">{r.reasonNote}</div>}
                      </div>
                    ) : r.status === "active" ? (
                      <span className="text-[#22C55E] font-bold">Active</span>
                    ) : (
                      <span className="text-[#A1A1AA] font-semibold" title="No Shopify token - disconnected, or uninstalled before tracking existed">Disconnected</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
