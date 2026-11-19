import type { Store } from "../data/types";
import type { Call, DepartmentMember, SessionUser } from "@/types";

/**
 * Who sees what (spec v1.1 §3, enforced in the API before any data leaves the server):
 *  - admin, CRM desk: everything;
 *  - manager: their own calls and clients + every call in the departments they belong to;
 *  - agent: their own calls (answered, rung or placed) in the call lists.
 * Every signed-in user can view every client (decision 2026-11-19: agents look clients up
 * before calling). A client page shows the client's whole history, and its calls can be
 * opened from there; recordings stay restricted (canHearRecording).
 */
export type Scope =
  | { all: true }
  | { all: false; memberId: string | null; departments: Set<string>; manager: boolean };

export async function scopeFor(store: Store, user: SessionUser): Promise<Scope> {
  if (user.role === "admin" || user.role === "crm_desk") return { all: true };
  const me = user.memberId;
  const manager = user.role === "manager";
  const departments = new Set(manager && me
    ? (await store.list<DepartmentMember>("department_members", { eq: { team_member_id: me } })).map((d) => d.department_id)
    : []);
  return { all: false, memberId: me, departments, manager };
}

export function canSeeCall(scope: Scope, call: Pick<Call, "answered_agent_id" | "routed_agent_id" | "initiated_by" | "department_id">): boolean {
  if (scope.all) return true;
  const me = scope.memberId;
  if (me && (call.answered_agent_id === me || call.routed_agent_id === me || call.initiated_by === me)) return true;
  return scope.manager && call.department_id != null && scope.departments.has(call.department_id);
}

/** All clients are visible to every signed-in user (see above). */
export const canSeeClient = (_scope: Scope, clientId: string | null | undefined) => clientId != null;

/** Opening one call: your own / your departments' calls, or any call of a client (clients are visible to all). */
export const canOpenCall = (scope: Scope, call: Parameters<typeof canSeeCall>[1] & { client_id: string | null }) =>
  canSeeCall(scope, call) || canSeeClient(scope, call.client_id);

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
