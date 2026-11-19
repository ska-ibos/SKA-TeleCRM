import type { Store } from "../data/types";
import type { Call, DepartmentMember, Note, Reminder, SessionUser } from "@/types";

/**
 * Who sees what (spec v1.1 §3, enforced in the API before any data leaves the server):
 *  - admin, CRM desk: everything;
 *  - manager: their own calls and clients + every call in the departments they belong to;
 *  - agent: their own calls (answered, rung or placed) and the clients they have dealt with
 *    (a call, a note they wrote, a reminder assigned to or created by them).
 * A client page shows the client's whole history once the client is visible - that context is
 * what the agent needs - but other people's calls stay out of the agent's call lists.
 */
export type Scope =
  | { all: true }
  | { all: false; memberId: string | null; departments: Set<string>; clients: Set<string>; manager: boolean };

export async function scopeFor(store: Store, user: SessionUser): Promise<Scope> {
  if (user.role === "admin" || user.role === "crm_desk") return { all: true };
  const me = user.memberId;
  if (!me) return { all: false, memberId: null, departments: new Set(), clients: new Set(), manager: false };
  const manager = user.role === "manager";
  const departments = new Set(manager
    ? (await store.list<DepartmentMember>("department_members", { eq: { team_member_id: me } })).map((d) => d.department_id)
    : []);
  const calls = await myCalls(store, me, departments);
  const [notes, assigned, created] = await Promise.all([
    store.list<Note>("notes", { eq: { author_id: me }, limit: 5000 }),
    store.list<Reminder>("reminders", { eq: { assigned_to: me }, limit: 5000 }),
    store.list<Reminder>("reminders", { eq: { created_by: me }, limit: 5000 }),
  ]);
  const clients = new Set<string>();
  for (const r of [...calls, ...notes, ...assigned, ...created]) if (r.client_id) clients.add(r.client_id);
  return { all: false, memberId: me, departments, clients, manager };
}

async function myCalls(store: Store, me: string, departments: Set<string>): Promise<Call[]> {
  const q = (eq: Record<string, unknown>) => store.list<Call>("calls", { eq, limit: 5000 });
  const lists = await Promise.all([
    q({ answered_agent_id: me }), q({ routed_agent_id: me }), q({ initiated_by: me }),
    ...[...departments].map((d) => q({ department_id: d })),
  ]);
  const byId = new Map<string, Call>();
  for (const c of lists.flat()) byId.set(c.id, c);
  return [...byId.values()];
}

export function canSeeCall(scope: Scope, call: Pick<Call, "answered_agent_id" | "routed_agent_id" | "initiated_by" | "department_id">): boolean {
  if (scope.all) return true;
  const me = scope.memberId;
  if (me && (call.answered_agent_id === me || call.routed_agent_id === me || call.initiated_by === me)) return true;
  return scope.manager && call.department_id != null && scope.departments.has(call.department_id);
}

export const canSeeClient = (scope: Scope, clientId: string | null | undefined) =>
  scope.all || (clientId != null && scope.clients.has(clientId));

/**
 * Recordings (spec §8.7, §13): admins; managers for the calls they can see (their departments);
 * otherwise only the person who handled the call. The CRM desk hears the calls it handled.
 */
export function canHearRecording(user: SessionUser, scope: Scope,
  call: Pick<Call, "answered_agent_id" | "routed_agent_id" | "initiated_by" | "department_id">): boolean {
  if (user.role === "admin") return true;
  if (user.role === "manager") return canSeeCall(scope, call);
  const me = user.memberId;
  return Boolean(me && (call.answered_agent_id === me || call.routed_agent_id === me || call.initiated_by === me));
}
