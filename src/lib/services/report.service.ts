import type { Store } from "../data/types";
import { listCalls } from "./call.service";

export async function buildReport(store: Store, range: { from?: string; to?: string }) {
  const calls = await listCalls(store, { ...range, limit: 2000 });
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
      stickyRouted: inbound.filter((c) => c.route_reason?.includes("sticky")).length,
      missedCallRouted: inbound.filter((c) => c.route_reason?.includes("Key 2 -> latest outbound")).length,
    },
    byDepartment: group((c) => c.department_name),
    byAgent: group((c) => c.agent_name),
    byIvrInput: group((c) => (c.direction === "inbound" ? (c.ivr_input ?? "none") : null)).filter((g) => g.name !== "—"),
    calls,
  };
}
