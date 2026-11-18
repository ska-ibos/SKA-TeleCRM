import type { Store } from "../data/types";
import { notFound } from "../data/types";
import type { Call, CallSession, CallTransfer, Client, Department, Note, TeamMember } from "@/types";

export interface CallFilters { status?: string; direction?: string; agentId?: string; departmentId?: string; from?: string; to?: string; q?: string; limit?: number }

export async function enrichCalls(store: Store, calls: Call[]) {
  const [team, clients, depts] = await Promise.all([
    store.list<TeamMember>("team_members"), store.list<Client>("clients"), store.list<Department>("departments"),
  ]);
  const n = (id: string | null) => team.find((m) => m.id === id)?.full_name ?? null;
  const ext = (id: string | null) => team.find((m) => m.id === id)?.extension ?? null;
  return calls.map((c) => ({
    ...c,
    client_name: clients.find((x) => x.id === c.client_id)?.name ?? null,
    department_name: depts.find((d) => d.id === c.department_id)?.name ?? null,
    agent_name: n(c.answered_agent_id ?? c.routed_agent_id),
    agent_extension: ext(c.answered_agent_id ?? c.routed_agent_id),
    initiated_by_name: n(c.initiated_by),
    initiated_by_extension: ext(c.initiated_by),
  }));
}
export type EnrichedCall = Awaited<ReturnType<typeof enrichCalls>>[number];

export async function listCalls(store: Store, f: CallFilters = {}) {
  const eq: Record<string, unknown> = {};
  if (f.status) eq.status = f.status;
  if (f.direction) eq.direction = f.direction;
  if (f.departmentId) eq.department_id = f.departmentId;
  const calls = await store.list<Call>("calls", {
    eq, gte: f.from ? { started_at: f.from } : undefined, lte: f.to ? { started_at: f.to } : undefined,
    order: { column: "started_at", ascending: false }, limit: Math.min(f.limit ?? 500, 2000),
  });
  let rows = await enrichCalls(store, calls);
  if (f.agentId) rows = rows.filter((c) => [c.answered_agent_id, c.routed_agent_id, c.initiated_by].includes(f.agentId!));
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((c) => [c.from_number, c.to_number, c.client_name, c.agent_name].some((v) => v?.toLowerCase().includes(q)));
  }
  return rows;
}

export async function getCallDetail(store: Store, id: string) {
  const call = await store.get<Call>("calls", id);
  if (!call) throw notFound("Call");
  const [[enriched], [session], transfers, notes, team] = await Promise.all([
    enrichCalls(store, [call]),
    store.list<CallSession>("call_sessions", { eq: { call_id: id } }),
    store.list<CallTransfer>("call_transfers", { eq: { call_id: id }, order: { column: "created_at" } }),
    store.list<Note>("notes", { eq: { call_id: id }, order: { column: "created_at", ascending: false } }),
    store.list<TeamMember>("team_members"),
  ]);
  const n = (mid: string | null) => team.find((m) => m.id === mid)?.full_name ?? null;
  const ext = (mid: string | null) => team.find((m) => m.id === mid)?.extension ?? null;
  return {
    call: enriched, session: session ?? null,
    transfers: transfers.map((t) => ({ ...t, from_name: n(t.from_member_id), to_name: n(t.to_member_id), to_extension: ext(t.to_member_id) })),
    notes: notes.map((x) => ({ ...x, author_name: n(x.author_id) })),
  };
}

/** Live calls (IVR / ringing / connected) for the incoming queue & screen-pop. */
export async function liveCalls(store: Store) {
  const calls = await store.list<Call>("calls", {
    in: { status: ["ringing", "in_ivr", "queued", "connecting", "answered"] },
    order: { column: "started_at", ascending: false }, limit: 100,
  });
  return enrichCalls(store, calls.filter((c) => !c.ended_at));
}
