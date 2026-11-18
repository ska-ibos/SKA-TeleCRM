/**
 * From/To date range rules (Reports, call filters). Shared by the browser and the API.
 *   - both dates required and real calendar dates (no 31 Feb, no 5-digit years)
 *   - not before REPORT_MIN_DATE, not in the future (there are no future calls)
 *   - To on or after From, at most MAX_RANGE_DAYS days inclusive (reports load up to 2,000 calls)
 */
export const REPORT_MIN_DATE = "2020-01-01";
export const MAX_RANGE_DAYS = 366;
const DAY = 86400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar date as YYYY-MM-DD (toISOString would give the UTC date, i.e. "yesterday" before 05:30 IST). */
export function localYmd(d = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
/** `days` days before/after `base` (default today), as YYYY-MM-DD. */
export function shiftYmd(days: number, base = localYmd()): string {
  const d = parseYmd(base) ?? new Date();
  d.setDate(d.getDate() + days);
  return localYmd(d);
}
export function parseYmd(s: string): Date | null {
  if (!YMD.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}
export const fmtYmd = (s: string) => parseYmd(s)?.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) ?? s;
/** Days covered by the range, both ends included. */
export const rangeDays = (from: string, to: string) => Math.round((parseYmd(to)!.getTime() - parseYmd(from)!.getTime()) / DAY) + 1;

export function dateRangeErrors(from: string, to: string, today = localYmd()): { from?: string; to?: string } {
  const e: { from?: string; to?: string } = {};
  const one = (v: string, which: "Start" | "End") => {
    if (!v) return `Choose ${which === "Start" ? "a start" : "an end"} date`;
    if (!parseYmd(v)) return "Enter a valid date";
    if (v < REPORT_MIN_DATE) return `${which} date cannot be before ${fmtYmd(REPORT_MIN_DATE)}`;
    if (v > today) return `${which} date cannot be in the future`;
    return undefined;
  };
  e.from = one(from, "Start");
  e.to = one(to, "End");
  if (!e.from && !e.to) {
    if (from > to) e.to = "End date must be on or after the start date";
    else if (rangeDays(from, to) > MAX_RANGE_DAYS) e.to = `Range can be at most ${MAX_RANGE_DAYS} days (this is ${rangeDays(from, to)})`;
  }
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v));
}

/** Whole local days -> ISO instants for the API: From 00:00:00.000, To 23:59:59.999. */
export function rangeToIso(from: string, to: string) {
  return { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59.999`).toISOString() };
}

/** Server-side check of ISO instants (timezone-agnostic, so it allows a day of slack). */
export function isoRangeIssues(from?: string, to?: string, now = Date.now()): { path: "from" | "to"; message: string }[] {
  const out: { path: "from" | "to"; message: string }[] = [];
  const min = Date.parse(`${REPORT_MIN_DATE}T00:00:00+14:00`); // earliest local midnight anywhere
  const f = from ? Date.parse(from) : null, t = to ? Date.parse(to) : null;
  if (f !== null && f < min) out.push({ path: "from", message: `Start date cannot be before ${fmtYmd(REPORT_MIN_DATE)}` });
  if (t !== null && t < min) out.push({ path: "to", message: `End date cannot be before ${fmtYmd(REPORT_MIN_DATE)}` });
  if (f !== null && f > now) out.push({ path: "from", message: "Start date cannot be in the future" });
  if (t !== null && t > now + DAY) out.push({ path: "to", message: "End date cannot be in the future" });
  if (f !== null && t !== null) {
    if (f > t) out.push({ path: "to", message: "End date must be on or after the start date" });
    else if (t - f > MAX_RANGE_DAYS * DAY) out.push({ path: "to", message: `Date range can be at most ${MAX_RANGE_DAYS} days` });
  }
  return out;
}
