import type { Store } from "../data/types";
import type { Department, DepartmentMember, TeamMember } from "@/types";
import { DEFAULT_ROUTING_CONFIG, type RoutingConfig } from "../constants";

export async function getDepartmentByKey(store: Store, key: number) {
  const [d] = await store.list<Department>("departments", { eq: { ivr_key: key, is_active: true } });
  return d ?? null;
}

export async function getDepartmentMemberIds(store: Store, departmentId: string) {
  const rows = await store.list<DepartmentMember>("department_members", { eq: { department_id: departmentId } });
  return rows.map((r) => r.team_member_id);
}

export async function isDepartmentMember(store: Store, departmentId: string, memberId: string) {
  return (await store.list("department_members", { eq: { department_id: departmentId, team_member_id: memberId }, limit: 1 })).length > 0;
}

/** CRM desk = active members of the key-1 (crm) department, plus anyone flagged is_crm_desk. Available first. */
export async function getCrmDeskMembers(store: Store): Promise<TeamMember[]> {
  const [crm] = await store.list<Department>("departments", { eq: { kind: "crm" } });
  const ids = new Set(crm ? await getDepartmentMemberIds(store, crm.id) : []);
  const members = (await store.list<TeamMember>("team_members", { eq: { is_active: true } }))
    .filter((m) => ids.has(m.id) || m.is_crm_desk);
  return members.sort((a, b) => Number(b.status === "available") - Number(a.status === "available"));
}

export async function loadRoutingConfig(store: Store): Promise<RoutingConfig> {
  const rows = await store.list<{ key: string; value: unknown }>("routing_config");
  const cfg = structuredClone(DEFAULT_ROUTING_CONFIG) as Record<string, unknown>;
  for (const r of rows) {
    const v = typeof r.value === "string" ? safeParse(r.value) : r.value;
    if (!(r.key in cfg) || v == null) continue;
    // object settings (prompts, office hours) are merged over the defaults, so a value saved
    // before a new field existed (e.g. prompts.connecting) still gets that field's default
    const def = cfg[r.key];
    cfg[r.key] = def && typeof def === "object" && !Array.isArray(def) && typeof v === "object" && !Array.isArray(v)
      ? { ...def, ...(v as object) } : v;
  }
  return cfg as RoutingConfig;
}
const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return s; } };
