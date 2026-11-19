import type { Store } from "../data/types";
import { notFound } from "../data/types";
import type { Call, CallSession, Client, ClientTag, Department, Note, Tag, TeamMember } from "@/types";
import { findStickyAgent } from "../routing/sticky-agent.service";
import { findLatestOutboundAgent } from "../routing/missed-call.service";
import { loadRoutingConfig } from "../routing/department.service";
import { canSeeCall, type Scope } from "./access.service";

/**
 * Caller context for the screen-pop and the call page (spec v1.1 §8.8): who is calling,
 * tags, latest notes, recent calls, the current sticky agent per department and who last
 * called them - everything the CRM desk needs to transfer to the right person.
 * Unknown callers get their number-based history (sticky / last outbound by phone).
 */
export async function callerContext(store: Store, callId: string, scope: Scope, at?: Date) {
  const call = await store.get<Call>("calls", callId);
  if (!call || !canSeeCall(scope, call)) throw notFound("Call");
  // simulated calls live on the simulator's clock
  const now = at ?? (call.is_simulated ? new Date(call.started_at) : new Date());
  const phone = call.direction === "inbound" ? call.from_number : call.to_number;
  const cfg = await loadRoutingConfig(store);
  const [client, team, depts] = await Promise.all([
    call.client_id ? store.get<Client>("clients", call.client_id) : null,
    store.list<TeamMember>("team_members"),
    store.list<Department>("departments", { eq: { kind: "department", is_active: true }, order: { column: "ivr_key" } }),
  ]);
  // a number shared by several clients: the CRM desk picks one (Link to client on the call page)
  const [session] = client ? [] : await store.list<CallSession>("call_sessions", { eq: { call_id: call.id }, limit: 1 });
  const candidates = await Promise.all((session?.context.candidateClientIds ?? []).slice(0, 5).map((id) => store.get<Client>("clients", id)));
  const name = (id: string | null) => team.find((m) => m.id === id)?.full_name ?? null;
  const ext = (id: string | null) => team.find((m) => m.id === id)?.extension ?? null;

  const [tags, notes, recent, stickies, lastOut] = await Promise.all([
    client ? clientTags(store, client.id) : [],
    client ? store.list<Note>("notes", { eq: { client_id: client.id }, order: { column: "created_at", ascending: false }, limit: 3 }) : [],
    store.list<Call>("calls", {
      eq: client ? { client_id: client.id } : { from_number: phone }, order: { column: "started_at", ascending: false }, limit: 6,
    }),
    Promise.all(depts.map(async (d) => {
      const s = await findStickyAgent(store, {
        clientId: client?.id ?? null, phone, departmentId: d.id, now, stickyDays: cfg.sticky_days, simulated: call.is_simulated,
      });
      return s ? { department: d.name, ivr_key: d.ivr_key, agent: s.agent.full_name, agent_id: s.agent.id, extension: s.agent.extension ?? null, expires_at: s.expiresAt } : null;
    })),
    findLatestOutboundAgent(store, { clientId: client?.id ?? null, phone, now, simulated: call.is_simulated, windowDays: cfg.missed_call_window_days }),
  ]);

  return {
    call_id: call.id,
    phone,
    client: client ? { id: client.id, name: client.name, company: client.company, status: client.status } : null,
    candidates: candidates.filter((c): c is Client => c !== null).map((c) => ({ id: c.id, name: c.name })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    notes: notes.map((n) => ({ id: n.id, body: n.body.slice(0, 300), author: name(n.author_id), created_at: n.created_at })),
    recent_calls: recent.filter((c) => c.id !== call.id).slice(0, 5).map((c) => ({
      id: c.id, direction: c.direction, status: c.status, started_at: c.started_at,
      agent: name(c.answered_agent_id ?? c.routed_agent_id ?? c.initiated_by),
      department: depts.find((d) => d.id === c.department_id)?.name ?? null,
    })),
    stickies: stickies.filter((s) => s !== null),
    last_outbound: lastOut ? { agent: lastOut.agent.full_name, agent_id: lastOut.agent.id, extension: ext(lastOut.agent.id), at: lastOut.at } : null,
  };
}
export type CallerContext = Awaited<ReturnType<typeof callerContext>>;

async function clientTags(store: Store, clientId: string): Promise<Tag[]> {
  const links = await store.list<ClientTag>("client_tags", { eq: { client_id: clientId } });
  if (!links.length) return [];
  const tags = await store.list<Tag>("tags", { in: { id: links.map((l) => l.tag_id) } });
  return tags.sort((a, b) => a.name.localeCompare(b.name));
}
