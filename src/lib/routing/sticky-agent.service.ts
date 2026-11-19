import type { Store } from "../data/types";
import type { Call, TeamMember } from "@/types";
import { getDepartmentMemberIds } from "./department.service";
import { addDays } from "../utils/date";

export interface StickyMatch { agent: TeamMember; answeredAt: string; expiresAt: string; callId: string }

/**
 * Sticky agent for (client, department):
 * the agent of the LATEST qualifying conversation = answered INBOUND call for this
 * client + department, answered by an active member of that department.
 * Valid for `stickyDays` from that answer; a fresh qualifying call naturally resets expiry.
 * Exotel native sticky is never used - this is computed from CRM history only.
 */
export async function findStickyAgent(
  store: Store,
  p: { clientId: string | null; phone: string; departmentId: string; now: Date; stickyDays: number; excludeCallId?: string; simulated: boolean },
): Promise<StickyMatch | null> {
  const key = p.clientId ? { client_id: p.clientId } : { from_number: p.phone };
  const calls = await store.list<Call>("calls", {
    // simulated and real calls never influence each other (simulator on the live database)
    eq: { ...key, direction: "inbound", department_id: p.departmentId, is_simulated: p.simulated },
    notNull: ["answered_agent_id", "answered_at"],
    lte: { answered_at: p.now.toISOString() },
    order: { column: "answered_at", ascending: false },
    limit: 25,
  });
  const memberIds = new Set(await getDepartmentMemberIds(store, p.departmentId));
  const latest = calls.find((c) => c.id !== p.excludeCallId && memberIds.has(c.answered_agent_id!));
  if (!latest) return null;
  const expiresAt = addDays(new Date(latest.answered_at!), p.stickyDays);
  if (p.now > expiresAt) return null;
  const agent = await store.get<TeamMember>("team_members", latest.answered_agent_id!);
  if (!agent || !agent.is_active) return null;
  return { agent, answeredAt: latest.answered_at!, expiresAt: expiresAt.toISOString(), callId: latest.id };
}
