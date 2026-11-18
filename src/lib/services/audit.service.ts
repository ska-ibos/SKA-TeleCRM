import type { Store } from "../data/types";
import type { AuditLog, TeamMember } from "@/types";

export async function audit(store: Store, actorId: string | null, action: string, entity: string, entityId: string | null, details: Record<string, unknown> = {}) {
  try {
    await store.insert("audit_logs", { actor_id: actorId, action, entity, entity_id: entityId, details });
  } catch (e) {
    console.error("[audit] failed to write audit log", e); // never block the business action
  }
}

export async function listAudit(store: Store, limit = 200) {
  const [logs, team] = await Promise.all([
    store.list<AuditLog>("audit_logs", { order: { column: "created_at", ascending: false }, limit }),
    store.list<TeamMember>("team_members"),
  ]);
  return logs.map((l) => ({ ...l, actor_name: team.find((m) => m.id === l.actor_id)?.full_name ?? "System" }));
}
