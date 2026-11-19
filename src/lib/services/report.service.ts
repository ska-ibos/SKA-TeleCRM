import type { Store } from "../data/types";
import { listCalls } from "./call.service";
import type { Scope } from "./access.service";

/** `excludeSimulated`: with live telephony, simulator test calls must not skew the real numbers. */
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export async function buildReport(store: Store, range: { from?: string; to?: string }, opts: { excludeSimulated?: boolean; scope?: Scope } = {}) {
  const all = await listCalls(store, { ...range, limit: 2000 }, opts.scope);
  const calls = opts.excludeSimulated ? all.filter((c) => !c.is_simulated) : all;
  const inbound = calls.filter((c) => c.direction === "inbound");
  const answered = calls.filter((c) => c.answered_at);
  const missed = calls.filter((c) => ["missed", "voicemail", "no_answer", "busy", "failed"].includes(c.status));
  const durations = answered.map((c) => c.duration_sec).filter((d): d is number => d != null);
  const group = (key: (c: (typeof calls)[number]) => string | null) => {
    const m = new Map<string, { name: string; total: number; answered: number; missed: number }>();
    for (const c of calls) {
      const k = key(c) ?? "—";
      const g = m.get(k) ?? { name: k, total: 0, answered: 0, missed: 0 };
      g.total++;
      if (c.answered_at) g.answered++;
      if (missed.includes(c)) g.missed++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  return {
    totals: {
      total: calls.length, inbound: inbound.length, outbound: calls.length - inbound.length,
      answered: answered.length, missed: missed.length, afterHours: calls.filter((c) => c.after_hours).length,
      answerRate: calls.length ? Math.round((answered.length / calls.length) * 100) : 0,
      avgDurationSec: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      stickyRouted: inbound.filter((c) => /accepted sticky/.test(c.route_reason ?? "")).length,
      // department keys 3-9 pressed, and how many of those found a valid sticky agent (spec §8.9 "sticky-hit rate")
      departmentPresses: inbound.filter((c) => /^[3-9]$/.test(c.ivr_input ?? "")).length,
      stickyHitRate: pct(inbound.filter((c) => /^[3-9]$/.test(c.ivr_input ?? "") && /sticky/i.test(c.route_reason ?? "") && !/no valid sticky/.test(c.route_reason ?? "")).length,
        inbound.filter((c) => /^[3-9]$/.test(c.ivr_input ?? "")).length),
      voicemails: calls.filter((c) => c.status === "voicemail").length,
      missedCallRouted: inbound.filter((c) => c.route_reason?.includes("Key 2 -> latest outbound")).length,
    },
    byDepartment: group((c) => c.department_name),
    byAgent: group((c) => c.agent_name),
    byIvrInput: group((c) => (c.direction === "inbound" ? (c.ivr_input ?? "none") : null)).filter((g) => g.name !== "—"),
    calls,
    /** rows read before filtering (the 2,000 cap applies to this) */
    scanned: all.length,
  };
}
