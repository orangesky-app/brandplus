"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Info, Megaphone, Minus, Search, TrendingDown, TrendingUp,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { useDateRange } from "@/lib/date-range-context";
import { cn } from "@/lib/utils";
import {
  BENCHMARK_NOTE, money,
  type Diag, type DiagSeverity, type Verdict,
} from "@/lib/gads-analysis";

/* ── Data loading ──────────────────────────────────────────────────────── */

export type GadsSection = "overview" | "ads" | "keywords" | "audience";

export interface SectionState<T> { data: T | null; loading: boolean; error: string | null; detail: string }

const LOADING: SectionState<never> = { data: null, loading: true, error: null, detail: "" };

export function useGadsSection<T>(section: GadsSection): SectionState<T> {
  const { range } = useDateRange();
  const url = `/api/google/ads/insights?section=${section}&from=${range.from}&to=${range.to}`;
  const [result, setResult] = useState<{ url: string; state: SectionState<T> } | null>(null);

  useEffect(() => {
    let stale = false;
    const finish = (state: SectionState<T>) => { if (!stale) setResult({ url, state }); };
    fetch(url)
      .then(r => r.json())
      .then((d: T & { error?: string; detail?: string }) => {
        if (d.error) finish({ data: null, loading: false, error: d.error, detail: d.detail ?? "" });
        else finish({ data: d, loading: false, error: null, detail: "" });
      })
      .catch(() => finish({ data: null, loading: false, error: "failed", detail: "" }));
    return () => { stale = true; };
  }, [url]);

  // A result for a previous date range counts as still loading, so old numbers never show under new dates.
  return result?.url === url ? result.state : LOADING;
}

function GateCard({ icon: Icon = AlertCircle, iconClass = "text-[#EAB308]", title, body, href, cta }: {
  icon?: LucideIcon; iconClass?: string; title: string; body: string; href?: string; cta?: string;
}) {
  return (
    <div className="max-w-md mx-auto mt-12">
      <Card>
        <div className="p-2 text-center">
          <Icon size={32} className={cn(iconClass, "mx-auto mb-3")} />
          <div className="text-[19px] font-semibold text-[#18181B] dark:text-[#F4F4F5] mb-1">{title}</div>
          <div className="text-[16px] text-[#71717A] dark:text-[#A1A1AA]">{body}</div>
          {href && cta && (
            <a href={href} className="inline-block mt-4 px-5 py-2.5 bg-[#34A853] text-white rounded-xl text-[16px] font-semibold hover:bg-[#2d9248] transition-colors">
              {cta}
            </a>
          )}
        </div>
      </Card>
    </div>
  );
}

// Loading + every "can't show data" state in one place, so the pages only deal with real data.
export function GadsGate<T>({ state, children }: { state: SectionState<T>; children: (data: T) => React.ReactNode }) {
  if (state.loading) {
    return (
      <div className="flex items-center justify-center py-24 text-[17px] text-[#71717A] dark:text-[#A1A1AA]">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-[#34A853] border-t-transparent rounded-full animate-spin" />
          Loading Google Ads data...
        </div>
      </div>
    );
  }
  switch (state.error) {
    case null: break;
    case "not_connected":
      return <GateCard icon={Megaphone} iconClass="text-[#34A853]" title="Google Ads not connected" body="Connect your Google Ads account to see campaigns, ads, ad copy, keywords and recommendations." href="/api/auth/google?service=gads" cta="Connect Google Ads" />;
    case "no_customer_selected":
      return <GateCard title="Select your Google Ads account" body="Connected, but no account is selected yet. Pick one in Connections." href="/dashboard/connections" cta="Go to Connections" />;
    case "google_ads_dev_token_missing":
      return <GateCard iconClass="text-[#EF4444]" title="Google Ads API not configured" body="The GOOGLE_ADS_DEVELOPER_TOKEN setting is missing on Skylitee's side." />;
    case "test_token":
      return <GateCard title="Google Ads data isn't available yet" body="Your account is connected, but Google hasn't granted Skylitee full API access yet. There's nothing to do on your account: the data will load here automatically once it does." />;
    case "api_disabled":
      return <GateCard title="Google Ads API is switched off" body="The Google Ads API is disabled in Skylitee's Google Cloud project. This is on Skylitee's side, not your account." />;
    case "no_account_access":
      return <GateCard title="This Google login can't read that ad account" body="Reconnect Google Ads with a login that has access to this account, or choose a different account." href="/dashboard/connections" cta="Go to Connections" />;
    default:
      return <GateCard iconClass="text-[#EF4444]" title="Could not load Google Ads data" body={state.detail ? `Google said: ${state.detail}` : "Check your connection in Settings > Connections."} />;
  }
  return state.data ? <>{children(state.data)}</> : null;
}

/* ── Page furniture ────────────────────────────────────────────────────── */

export function GadsHeader({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold flex items-center gap-2 text-[#18181B] dark:text-[#F4F4F5]">
        <Icon size={18} className="text-[#F97316]" /> {title}
      </h2>
      <p className="text-[16px] text-[#71717A] dark:text-[#A1A1AA] mt-0.5">{subtitle}</p>
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-[16px] text-[#71717A] dark:text-[#A1A1AA]">{children}</div>;
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[14px] text-[#71717A] dark:text-[#A1A1AA]">
      <Info size={14} className="shrink-0 mt-0.5" /> <span>{children}</span>
    </p>
  );
}

export function BenchmarkNote() {
  return <Note>{BENCHMARK_NOTE}</Note>;
}

// The Overview counts only the goal matching each objective. Ad, keyword and audience data can't
// all be split the same way yet, so those pages say whose count they show.
export function GoogleCountNote({ mixed }: { mixed?: boolean }) {
  return (
    <Note>
      {mixed
        ? "Campaign findings here count only the goal matching each objective. Ad, keyword and audience findings use Google's own count, which can include actions like Add to cart."
        : "Conversions on this page are Google's own count, which can include actions like Add to cart. The Overview page counts only the goal matching each campaign's objective."}
    </Note>
  );
}

// One Google query can be refused while the others work. Say what's missing instead of showing a
// blank table that reads as "you have no data".
export function PartialNotice({ errors, labels }: { errors?: Record<string, string>; labels: Record<string, string> }) {
  const list = Object.entries(errors ?? {});
  if (list.length === 0) return null;
  return (
    <div className="border-l-[3px] border-l-[#EAB308] bg-[#FFFBEB] dark:bg-[#2D1C00] rounded-r-xl p-3 text-[15px] text-[#92400E] dark:text-[#FCD34D]">
      <div className="font-semibold mb-1 flex items-center gap-1.5"><AlertTriangle size={14} /> Some data couldn&apos;t load, so these parts are incomplete</div>
      {list.map(([k, v]) => <div key={k}><span className="font-medium">{labels[k] ?? k}</span> - Google said: {v}</div>)}
    </div>
  );
}

/* ── Verdicts ──────────────────────────────────────────────────────────── */

const VERDICT_STYLE: Record<Verdict, { icon: LucideIcon; label: string; text: string; pill: string }> = {
  good:  { icon: CheckCircle2, label: "Good",  text: "text-[#15803D] dark:text-[#86EFAC]", pill: "bg-[#F0FDF4] dark:bg-[#052E16]" },
  watch: { icon: AlertTriangle, label: "Watch", text: "text-[#92400E] dark:text-[#FCD34D]", pill: "bg-[#FFFBEB] dark:bg-[#2D1C00]" },
  bad:   { icon: AlertCircle, label: "Below", text: "text-[#DC2626] dark:text-[#FCA5A5]", pill: "bg-[#FEF2F2] dark:bg-[#2D0A0A]" },
  na:    { icon: Minus, label: "No verdict", text: "text-[#71717A] dark:text-[#A1A1AA]", pill: "bg-[#F4F4F5] dark:bg-white/[0.06]" },
};

export function VerdictBadge({ verdict, label }: { verdict: Verdict; label?: string }) {
  const s = VERDICT_STYLE[verdict];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[14px] font-semibold whitespace-nowrap", s.text, s.pill)}>
      <Icon size={12} /> {label ?? s.label}
    </span>
  );
}

// A number with its verdict, for table cells where a full badge would be too wide.
export function Judged({ verdict, children }: { verdict: Verdict; children: React.ReactNode }) {
  const s = VERDICT_STYLE[verdict];
  const Icon = s.icon;
  if (verdict === "na") return <span className="tabular-nums">{children}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums whitespace-nowrap", s.text)}>
      <Icon size={12} className="shrink-0" /> {children}
    </span>
  );
}

const DIAG_STYLE: Record<DiagSeverity, { box: string; label: string; labelClass: string }> = {
  issue:    { box: "border-l-[#EF4444] bg-[#FEF2F2] dark:bg-[#2D0A0A]", label: "ISSUE", labelClass: "text-[#DC2626] dark:text-[#FCA5A5]" },
  warning:  { box: "border-l-[#EAB308] bg-[#FFFBEB] dark:bg-[#2D1C00]", label: "WATCH", labelClass: "text-[#92400E] dark:text-[#FCD34D]" },
  strength: { box: "border-l-[#22C55E] bg-[#F0FDF4] dark:bg-[#052E16]", label: "GOOD", labelClass: "text-[#15803D] dark:text-[#86EFAC]" },
};

export function DiagCard({ diag, currency }: { diag: Diag; currency: string }) {
  const s = DIAG_STYLE[diag.severity];
  return (
    <div className={cn("border-l-[3px] rounded-r-xl p-3", s.box)}>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className={cn("text-[13px] font-bold tracking-wide", s.labelClass)}>{s.label}</span>
        <span className="text-[13px] text-[#71717A] dark:text-[#A1A1AA]">{diag.area}</span>
        {diag.impact !== undefined && diag.impact > 0 && (
          <span className="text-[14px] font-semibold text-[#18181B] dark:text-[#F4F4F5] ml-auto tabular-nums">
            {money(currency, diag.impact)} <span className="font-normal text-[#71717A] dark:text-[#A1A1AA]">{diag.impactLabel}</span>
          </span>
        )}
      </div>
      <div className="text-[16px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">{diag.title}</div>
      <div className="text-[15px] text-[#52525B] dark:text-[#A1A1AA] mt-0.5">{diag.body}</div>
    </div>
  );
}

// Ranked list of findings: what needs fixing first, then what to keep doing.
export function DiagPanel({ diags, currency, title = "What's Working & What's Not", right, limit }: {
  diags: Diag[]; currency: string; title?: string; right?: React.ReactNode; limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const bad = diags.filter(d => d.severity !== "strength");
  const good = diags.filter(d => d.severity === "strength");
  const cap = (list: Diag[]) => (limit && !showAll ? list.slice(0, limit) : list);
  const hidden = limit && !showAll ? Math.max(0, bad.length - limit) + Math.max(0, good.length - limit) : 0;
  if (diags.length === 0) return null;

  return (
    <Card>
      <CardHeader title={title} right={right} />
      <div className="space-y-4">
        {bad.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">
              <AlertTriangle size={14} className="text-[#EF4444]" /> Needs attention
              <span className="px-1.5 rounded-full bg-[#FEF2F2] dark:bg-[#2D0A0A] text-[#DC2626] dark:text-[#FCA5A5] text-[14px]">{bad.length}</span>
            </div>
            {cap(bad).map((d, i) => <DiagCard key={i} diag={d} currency={currency} />)}
          </div>
        )}
        {good.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">
              <CheckCircle2 size={14} className="text-[#22C55E]" /> What&apos;s working
              <span className="px-1.5 rounded-full bg-[#F0FDF4] dark:bg-[#052E16] text-[#15803D] dark:text-[#86EFAC] text-[14px]">{good.length}</span>
            </div>
            {cap(good).map((d, i) => <DiagCard key={i} diag={d} currency={currency} />)}
          </div>
        )}
        {hidden > 0 && (
          <button onClick={() => setShowAll(true)} className="text-[15px] font-semibold text-[#EA580C] dark:text-[#FB923C] hover:underline">
            Show {hidden} more
          </button>
        )}
      </div>
    </Card>
  );
}

/* ── KPI tile ──────────────────────────────────────────────────────────── */

export function KpiTile({ label, value, delta, lowerIsBetter, verdict, hint, sub }: {
  label: string; value: string; delta?: number | null; lowerIsBetter?: boolean; verdict?: Verdict; hint?: string; sub?: string;
}) {
  const hasDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const flat = hasDelta && Math.abs(delta) < 0.5;
  const better = hasDelta && (lowerIsBetter ? delta < 0 : delta > 0);
  const DeltaIcon = flat ? Minus : hasDelta && delta > 0 ? TrendingUp : TrendingDown;
  return (
    <div className="bg-white dark:bg-[#171717] border border-black/[0.06] dark:border-white/[0.06] rounded-xl p-3">
      <div className="flex items-center gap-1 text-[14px] text-[#71717A] dark:text-[#A1A1AA]">
        {hint ? <Tooltip content={hint} side="top" maxWidth={240}><span className="flex items-center gap-1 cursor-help">{label} <Info size={11} /></span></Tooltip> : label}
      </div>
      <div className="text-[19px] font-bold text-[#18181B] dark:text-[#F4F4F5] tabular-nums mt-0.5">{value}</div>
      {hasDelta && (
        <div className={cn("flex items-center gap-1 text-[14px] mt-0.5 tabular-nums",
          flat ? "text-[#71717A] dark:text-[#A1A1AA]" : better ? "text-[#15803D] dark:text-[#86EFAC]" : "text-[#DC2626] dark:text-[#FCA5A5]")}>
          <DeltaIcon size={12} /> {Math.abs(delta).toFixed(1)}% <span className="text-[#71717A] dark:text-[#A1A1AA]">vs previous</span>
        </div>
      )}
      {sub && <div className="text-[14px] text-[#71717A] dark:text-[#A1A1AA] mt-0.5">{sub}</div>}
      {verdict && verdict !== "na" && <div className="mt-1.5"><VerdictBadge verdict={verdict} /></div>}
    </div>
  );
}

export function pctChange(now: number, before: number | null | undefined) {
  if (before === null || before === undefined || before <= 0) return null;
  return ((now - before) / before) * 100;
}

/* ── Sortable table ────────────────────────────────────────────────────── */

export interface Column<T> {
  key: string; label: string; hint?: string; align?: "left" | "right";
  sort?: (row: T) => number | string; render: (row: T) => React.ReactNode;
}

export function DataTable<T>({ rows, columns, rowKey, initialSort, searchOf, searchPlaceholder, pageSize = 25, expand, empty = "Nothing to show for this date range." }: {
  rows: T[]; columns: Column<T>[]; rowKey: (row: T, i: number) => string; initialSort?: string;
  searchOf?: (row: T) => string; searchPlaceholder?: string; pageSize?: number;
  expand?: (row: T) => React.ReactNode; empty?: string;
}) {
  const [sortKey, setSortKey] = useState(initialSort ?? "");
  const [asc, setAsc] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(pageSize);
  const [open, setOpen] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q && searchOf ? rows.filter(r => searchOf(r).toLowerCase().includes(q)) : rows;
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sort) return list;
    const by = col.sort;
    return [...list].sort((a, b) => {
      const x = by(a);
      const y = by(b);
      const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return asc ? order : -order;
    });
  }, [rows, columns, sortKey, asc, query, searchOf]);

  const toggleSort = (c: Column<T>) => {
    if (!c.sort) return;
    if (sortKey === c.key) setAsc(!asc);
    else { setSortKey(c.key); setAsc(false); }
  };

  return (
    <div>
      {searchOf && (
        <div className="relative mb-2 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA]" />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setShown(pageSize); }}
            placeholder={searchPlaceholder ?? "Search"}
            className="w-full pl-8 pr-2.5 py-1.5 text-[15px] rounded-lg border border-black/[0.12] dark:border-white/[0.12] bg-white dark:bg-[#171717] text-[#18181B] dark:text-[#F4F4F5]"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-black/[0.06] dark:border-white/[0.06]">
              {expand && <th className="w-6" />}
              {columns.map(c => {
                const head = (
                  <button
                    onClick={() => toggleSort(c)}
                    disabled={!c.sort}
                    className={cn("inline-flex items-center gap-1 font-semibold whitespace-nowrap", c.sort && "hover:text-[#18181B] dark:hover:text-[#F4F4F5]", sortKey === c.key && "text-[#18181B] dark:text-[#F4F4F5]")}
                  >
                    {c.label}{sortKey === c.key && <span aria-hidden>{asc ? "▲" : "▼"}</span>}
                  </button>
                );
                return (
                  <th key={c.key} className={cn("py-2 px-2 text-[14px] text-[#71717A] dark:text-[#A1A1AA]", c.align === "right" ? "text-right" : "text-left")}>
                    {c.hint ? <Tooltip content={c.hint} side="top" maxWidth={240}>{head}</Tooltip> : head}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, shown).map((r, i) => {
              const key = rowKey(r, i);
              const isOpen = open === key;
              return (
                <Fragment key={key}>
                  <tr
                    onClick={expand ? () => setOpen(isOpen ? null : key) : undefined}
                    className={cn("border-b border-black/[0.04] dark:border-white/[0.04] hover:bg-[#FAFAFA] dark:hover:bg-white/[0.03]", expand && "cursor-pointer")}
                  >
                    {expand && (
                      <td className="pl-1 text-[#A1A1AA]">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    )}
                    {columns.map(c => (
                      <td key={c.key} className={cn("py-2 px-2 text-[#18181B] dark:text-[#F4F4F5]", c.align === "right" && "text-right tabular-nums whitespace-nowrap")}>
                        {c.render(r)}
                      </td>
                    ))}
                  </tr>
                  {expand && isOpen && (
                    <tr className="border-b border-black/[0.06] dark:border-white/[0.06] bg-[#FAFAFA] dark:bg-white/[0.02]">
                      <td colSpan={columns.length + 1} className="p-3">{expand(r)}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && <EmptyNote>{empty}</EmptyNote>}
      {visible.length > shown && (
        <button onClick={() => setShown(shown + pageSize)} className="mt-2 text-[15px] font-semibold text-[#EA580C] dark:text-[#FB923C] hover:underline">
          Show more ({visible.length - shown} left)
        </button>
      )}
    </div>
  );
}

// Filter or tab pills. Scrolls sideways on phones instead of wrapping into a tall block.
export function Pills<K extends string>({ options, value, onChange }: {
  options: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "px-3 py-1.5 rounded-full text-[15px] font-medium whitespace-nowrap border transition-colors",
            value === o.key
              ? "bg-[#18181B] text-white border-[#18181B] dark:bg-[#F4F4F5] dark:text-[#18181B] dark:border-[#F4F4F5]"
              : "border-black/[0.12] dark:border-white/[0.12] text-[#52525B] dark:text-[#A1A1AA] hover:bg-[#F4F4F5] dark:hover:bg-white/[0.06]",
          )}
        >
          {o.label}{o.count !== undefined && <span className="opacity-70"> {o.count}</span>}
        </button>
      ))}
    </div>
  );
}
