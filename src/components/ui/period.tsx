"use client";
import { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { formatDateSpan, rangeText, useDateRange } from "@/lib/date-range-context";

// The server renders in UTC and the browser in local time, so "today" can differ between
// them for a few hours each night. Dates wait for the browser to avoid a mismatch.
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}

/** The date picker's current period, e.g. "This month (1 - 2 Nov 2026)". */
export function RangeText() {
  const { range } = useDateRange();
  const mounted = useMounted();
  return <>{mounted ? rangeText(range) : range.label}</>;
}

/** For pages that use their own window rather than the date picker: says exactly what's covered. */
export function PeriodNote({ from, to, label, note }: { from: string; to: string; label?: string; note?: string }) {
  const dates = formatDateSpan(from, to);
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap text-[14px] text-[#71717A] dark:text-[#A1A1AA]">
      <Calendar size={12} className="shrink-0" />
      <span>
        {label && <>{label} · </>}
        <b className="font-semibold text-[#52525B] dark:text-[#D4D4D8]">{dates}</b>
        {note && <> · {note}</>}
      </span>
    </span>
  );
}
