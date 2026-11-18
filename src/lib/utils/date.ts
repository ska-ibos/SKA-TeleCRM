import type { OfficeHours } from "../constants";

const DAY = 86_400_000;

/** Wall-clock parts of `d` in the given IANA timezone. weekday: 0=Sun..6=Sat */
export function zonedParts(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function isWithinOfficeHours(d: Date, oh: OfficeHours): boolean {
  const p = zonedParts(d, oh.timezone);
  return oh.days.includes(p.weekday) && p.minutes >= toMin(oh.start) && p.minutes < toMin(oh.end);
}

/** Next instant the office opens (scans minute-accurate per day, up to 8 days). */
export function nextOfficeOpening(d: Date, oh: OfficeHours): Date {
  if (isWithinOfficeHours(d, oh)) return d;
  const p = zonedParts(d, oh.timezone);
  const startMin = toMin(oh.start);
  for (let i = 0; i < 8; i++) {
    // candidate = today's local start time + i days
    const candidate = new Date(d.getTime() + i * DAY + (startMin - p.minutes) * 60_000);
    candidate.setUTCSeconds(0, 0);
    if (candidate > d && isWithinOfficeHours(candidate, oh)) return candidate;
  }
  return new Date(d.getTime() + DAY);
}

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
export const daysBetween = (a: Date, b: Date) => Math.abs(b.getTime() - a.getTime()) / DAY;

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}
export function fmtDuration(sec: number | null | undefined) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now"; // also covers simulated calls dated ahead of the real clock
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
