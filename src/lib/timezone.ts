// Date helpers that respect a specific IANA timezone (a store's local tz, an ad account's
// tz, Pacific for GSC, …) so our date ranges line up with the source dashboards instead of
// the server's UTC clock. Vercel runs in UTC, so `new Date()`-based ranges drift by a day
// at the boundaries for any non-UTC store.

// "YYYY-MM-DD" for the given instant, as seen in `timeZone`.
export function ymdInTz(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function todayInTz(timeZone: string): string {
  return ymdInTz(new Date(), timeZone);
}

export function daysAgoInTz(timeZone: string, n: number): string {
  return ymdInTz(new Date(Date.now() - n * 86_400_000), timeZone);
}

// First day of the current month, in `timeZone`.
export function startOfMonthInTz(timeZone: string): string {
  return `${todayInTz(timeZone).slice(0, 7)}-01`;
}

// Offset (ms) of `timeZone` from UTC at the given instant (+ve east of UTC). Computed at the
// instant so it stays correct across DST transitions.
function tzOffsetMs(timeZone: string, at: Date): number {
  const utc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  const local = new Date(at.toLocaleString("en-US", { timeZone }));
  return local.getTime() - utc.getTime();
}

// Absolute ISO instant of local midnight (00:00:00.000) of `dateStr` (YYYY-MM-DD) in `timeZone`.
export function zonedDayStartISO(dateStr: string, timeZone: string): string {
  const naiveUtc = new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(naiveUtc.getTime() - tzOffsetMs(timeZone, naiveUtc)).toISOString();
}

// Absolute ISO instant of local end-of-day (23:59:59.999) of `dateStr` in `timeZone`.
export function zonedDayEndISO(dateStr: string, timeZone: string): string {
  const naiveUtc = new Date(`${dateStr}T23:59:59.999Z`);
  return new Date(naiveUtc.getTime() - tzOffsetMs(timeZone, naiveUtc)).toISOString();
}

/** Real dates for a span, as compact as they can be without being ambiguous:
 *  "2 Nov 2026" · "1 - 2 Nov 2026" · "28 Oct - 2 Nov 2026" · "28 Dec 2025 - 2 Jan 2026".
 *  Lives here so emails and API routes can use it too, not just client components. */
export function formatDateSpan(from: string, to: string): string {
  const d1 = new Date(from + "T00:00:00");
  const d2 = new Date(to + "T00:00:00");
  const dayMonthYear = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (from === to) return dayMonthYear(d1);
  if (d1.getFullYear() !== d2.getFullYear()) return `${dayMonthYear(d1)} - ${dayMonthYear(d2)}`;
  if (d1.getMonth() !== d2.getMonth()) return `${d1.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} - ${dayMonthYear(d2)}`;
  return `${d1.getDate()} - ${dayMonthYear(d2)}`;
}

// Inclusive whole-day count between two YYYY-MM-DD strings.
export function dayCount(startYmd: string, endYmd: string): number {
  return Math.max(1, Math.round((Date.parse(endYmd) - Date.parse(startYmd)) / 86_400_000) + 1);
}
