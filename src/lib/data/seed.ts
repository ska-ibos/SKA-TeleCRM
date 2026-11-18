import { randomUUID } from "node:crypto";
import { DEPARTMENT_SEED, CRM_DESK_NAME, DEFAULT_ROUTING_CONFIG } from "../constants";

/** In-memory equivalent of supabase/seed.sql (no phones, extensions or passwords). */
export function buildSeed() {
  const now = new Date().toISOString();
  const names = [...new Set(DEPARTMENT_SEED.flatMap((d) => d.members))];
  const team_members = names.map((full_name) => ({
    id: randomUUID(), full_name, email: null, phone: null, extension: null,
    role: full_name === CRM_DESK_NAME ? "crm_desk" : "agent", status: "available",
    is_crm_desk: full_name === CRM_DESK_NAME, is_active: true, created_at: now, updated_at: now,
  }));
  const departments = DEPARTMENT_SEED.map((d) => ({
    id: randomUUID(), ivr_key: d.key, name: d.name, kind: d.kind, description: null,
    is_active: true, created_at: now, updated_at: now,
  }));
  const department_members = DEPARTMENT_SEED.flatMap((d, i) =>
    d.members.map((n) => ({
      id: randomUUID(), department_id: departments[i].id,
      team_member_id: team_members.find((m) => m.full_name === n)!.id, created_at: now,
    })),
  );
  const routing_config = Object.entries(DEFAULT_ROUTING_CONFIG).map(([key, value]) => ({ id: key, key, value, updated_at: now }));
  return { team_members, departments, department_members, routing_config };
}
