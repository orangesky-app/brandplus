"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { formatDateSpan } from "@/lib/timezone";

export { formatDateSpan };

export type DatePreset = "today" | "yesterday" | "7d" | "28d" | "this_month" | "last_month" | "custom";

export interface DateRange {
  preset: DatePreset;
  from: string;
  to: string;
  label: string;
}

/** YYYY-MM-DD in the browser's own timezone. Use this instead of toISOString(),
 *  which is UTC and lands on the previous day before 05:30 in India. */
export function toLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const fmt = toLocalYMD;

function sub(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - n);
  return r;
}

export function getPresetRange(preset: DatePreset): Omit<DateRange, "preset"> {
  const today = new Date();
  switch (preset) {
    case "today":
      return { from: fmt(today), to: fmt(today), label: "Today" };
    case "yesterday": {
      const y = sub(today, 1);
      return { from: fmt(y), to: fmt(y), label: "Yesterday" };
    }
    case "7d":
      return { from: fmt(sub(today, 6)), to: fmt(today), label: "Last 7 days" };
    case "28d":
      return { from: fmt(sub(today, 27)), to: fmt(today), label: "Last 28 days" };
    case "this_month": {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: fmt(first), to: fmt(today), label: "This month" };
    }
    case "last_month": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: fmt(first), to: fmt(last), label: "Last month" };
    }
    default:
      return { from: fmt(sub(today, 27)), to: fmt(today), label: "Last 28 days" };
  }
}

interface DateRangeContextType {
  range: DateRange;
  setPreset: (preset: DatePreset) => void;
  setCustomRange: (from: string, to: string) => void;
  compareWith: string;
  setCompareWith: (v: string) => void;
}

const DateRangeContext = createContext<DateRangeContextType | null>(null);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const initial = getPresetRange("this_month");
  const [range, setRange] = useState<DateRange>({ preset: "this_month", ...initial });
  const [compareWith, setCompareWith] = useState("prev_period");

  // A tab left open overnight must not keep calling yesterday "Today": re-resolve
  // the preset when the owner comes back to the tab, and once a minute while they stay.
  useEffect(() => {
    const refresh = () => {
      setRange(r => {
        if (r.preset === "custom") return r;
        const next = getPresetRange(r.preset);
        return next.from === r.from && next.to === r.to ? r : { preset: r.preset, ...next };
      });
    };
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const setPreset = (preset: DatePreset) => {
    if (preset === "custom") {
      setRange(r => ({ ...r, preset: "custom" }));
      return;
    }
    const r = getPresetRange(preset);
    setRange({ preset, ...r });
  };

  const setCustomRange = (a: string, b: string) => {
    if (!a || !b) return;
    // Picked backwards? Read it the way it was meant rather than fetching an empty range.
    const [from, to] = a <= b ? [a, b] : [b, a];
    setRange({ preset: "custom", from, to, label: formatDateSpan(from, to) });
  };

  return (
    <DateRangeContext.Provider value={{ range, setPreset, setCustomRange, compareWith, setCompareWith }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error("useDateRange must be used within DateRangeProvider");
  return ctx;
}

/** Report-friendly period label. A complete calendar month reads as its name
 *  ("June 2026"); anything else shows the real dates, because a month name on a
 *  part-month range ("November 2026" for 1 - 2 Nov) would overstate what's covered. */
export function formatReportPeriod(range: DateRange): string {
  const d1 = new Date(range.from + "T00:00:00");
  const lastOfMonth = new Date(d1.getFullYear(), d1.getMonth() + 1, 0);
  if (d1.getDate() === 1 && toLocalYMD(lastOfMonth) === range.to) {
    return d1.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }
  return formatDateSpan(range.from, range.to);
}

/** Real dates only, e.g. "1 - 2 Nov 2026", so figures can be reconciled against Shopify / Meta. */
export function formatRangeDates(range: Pick<DateRange, "from" | "to">): string {
  return formatDateSpan(range.from, range.to);
}

/** Preset word plus the real dates, e.g. "This month (1 - 2 Nov 2026)". For headings, exports and PDFs. */
export function rangeText(range: DateRange): string {
  const dates = formatDateSpan(range.from, range.to);
  return range.label === dates ? dates : `${range.label} (${dates})`;
}

/** Number of calendar days a range covers, counting both ends. */
export function rangeDays(range: Pick<DateRange, "from" | "to">): number {
  const ms = new Date(range.to + "T00:00:00").getTime() - new Date(range.from + "T00:00:00").getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function getComparisonRange(range: DateRange, compareWith: string): { from: string; to: string; label: string } | null {
  const from = new Date(range.from + "T00:00:00");
  const to = new Date(range.to + "T00:00:00");
  const days = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const subDate = (d: Date, n: number): Date => { const r = new Date(d); r.setDate(r.getDate() - n); return r; };

  switch (compareWith) {
    case "prev_period": {
      const compTo = subDate(from, 1);
      const compFrom = subDate(compTo, days - 1);
      return { from: fmt(compFrom), to: fmt(compTo), label: "prev period" };
    }
    case "last_week":
      return { from: fmt(subDate(from, 7)), to: fmt(subDate(to, 7)), label: "last week" };
    case "last_month": {
      const cf = new Date(from); cf.setMonth(cf.getMonth() - 1);
      const ct = new Date(to); ct.setMonth(ct.getMonth() - 1);
      return { from: fmt(cf), to: fmt(ct), label: "last month" };
    }
    case "last_year": {
      const cf = new Date(from); cf.setFullYear(cf.getFullYear() - 1);
      const ct = new Date(to); ct.setFullYear(ct.getFullYear() - 1);
      return { from: fmt(cf), to: fmt(ct), label: "last year" };
    }
    default:
      return null;
  }
}
