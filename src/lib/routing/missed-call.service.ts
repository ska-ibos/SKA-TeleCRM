import type { Store } from "../data/types";
import type { Call, TeamMember } from "@/types";

/**
 * Press 2: the agent who most recently called this client through the CRM.
 * e.g. Hiren calls Rahul -> Rahul calls back, presses 2 -> Hiren.
 */
export async function findLatestOutboundAgent(
  store: Store, p: { clientId: string | null; phone: string; now: Date; simulated: boolean },
): Promise<{ agent: TeamMember; callId: string; at: string } | null> {
  const byPhone = await store.list<Call>("calls", {
    eq: { direction: "outbound", to_number: p.phone, is_simulated: p.simulated }, notNull: ["initiated_by"],
    lte: { started_at: p.now.toISOString() }, order: { column: "started_at", ascending: false }, limit: 1,
  });
  const byClient = p.clientId
    ? await store.list<Call>("calls", {
        eq: { direction: "outbound", client_id: p.clientId, is_simulated: p.simulated }, notNull: ["initiated_by"],
        lte: { started_at: p.now.toISOString() }, order: { column: "started_at", ascending: false }, limit: 1,
      })
    : [];
  const latest = [...byPhone, ...byClient].sort((a, b) => (a.started_at < b.started_at ? 1 : -1))[0];
  if (!latest) return null;
  const agent = await store.get<TeamMember>("team_members", latest.initiated_by!);
  return agent && agent.is_active ? { agent, callId: latest.id, at: latest.started_at } : null;
}
