import type { Store } from "../data/types";
import { conflict, isConflict, notFound } from "../data/types";
import type { Department, DepartmentMember, EmployeeDirectoryEntry, TeamMember } from "@/types";
import type { z } from "zod";
import type { teamMemberSchema } from "../validations";
import { audit } from "./audit.service";

export async function listTeam(store: Store) {
  const [team, links, depts] = await Promise.all([
    store.list<TeamMember>("team_members", { order: { column: "full_name" } }),
    store.list<DepartmentMember>("department_members"),
    store.list<Department>("departments", { order: { column: "ivr_key" } }),
  ]);
  return team.map((m) => ({
    ...m,
    departments: depts.filter((d) => links.some((l) => l.team_member_id === m.id && l.department_id === d.id)).map((d) => ({ id: d.id, name: d.name, ivr_key: d.ivr_key })),
  }));
}

/** SKA OS employees, flagged with whether they are already TeleCRM team members (read-only). */
export async function listEmployees(store: Store) {
  return store.list<EmployeeDirectoryEntry>("employees", { order: { column: "name" } });
}

async function assertEmployeeLinkable(store: Store, employeeId: string, exceptMember?: string) {
  const e = await store.get<EmployeeDirectoryEntry>("employees", employeeId);
  if (!e) throw notFound("Employee");
  if (e.team_member_id && e.team_member_id !== exceptMember) throw conflict(`${e.name} is already a TeleCRM team member`);
  if (e.status !== "Active") throw conflict(`${e.name} is not an active employee in SKA OS`);
  return e;
}

export async function createMember(store: Store, input: z.infer<typeof teamMemberSchema>, actorId: string | null) {
  const row: Record<string, unknown> = { ...input };
  if (input.employee_id) {
    const e = await assertEmployeeLinkable(store, input.employee_id);
    row.email ??= e.email;
    row.phone ??= e.phone;
  } else {
    delete row.employee_id; // unlinked member: cannot sign in, but can still be dialled
  }
  const m = await store.insert<TeamMember>("team_members", row);
  await audit(store, actorId, "create", "team_member", m.id, { name: m.full_name, employee_id: input.employee_id });
  return m;
}

export async function updateMember(store: Store, id: string, input: Partial<z.infer<typeof teamMemberSchema>>, actorId: string | null) {
  if (!(await store.get("team_members", id))) throw notFound("Team member");
  if (input.employee_id) await assertEmployeeLinkable(store, input.employee_id, id);
  const m = await store.update<TeamMember>("team_members", id, input);
  await audit(store, actorId, "update", "team_member", id, input);
  return m;
}

export async function setExtension(store: Store, memberId: string, extension: string | null, actorId: string | null) {
  const m = await store.get<TeamMember>("team_members", memberId);
  if (!m) throw notFound("Team member");
  if (extension) {
    const [taken] = await store.list<TeamMember>("team_members", { eq: { extension } });
    if (taken && taken.id !== memberId) throw conflict(`Extension ${extension} is already assigned to ${taken.full_name}`);
  }
  const updated = await store.update<TeamMember>("team_members", memberId, { extension });
  await audit(store, actorId, "set_extension", "team_member", memberId, { from: m.extension, to: extension });
  return updated;
}

export async function setDepartmentMembers(store: Store, departmentId: string, memberIds: string[], actorId: string | null) {
  const dept = await store.get<Department>("departments", departmentId);
  if (!dept) throw notFound("Department");
  if (dept.kind === "missed_call" && memberIds.length) throw conflict("Missed-call callback routes to the latest outbound agent and has no fixed members");
  for (const id of memberIds) if (!(await store.get("team_members", id))) throw notFound("Team member");
  const current = await store.list<DepartmentMember>("department_members", { eq: { department_id: departmentId } });
  for (const c of current) if (!memberIds.includes(c.team_member_id)) await store.remove("department_members", c.id);
  for (const id of memberIds) {
    if (!current.some((c) => c.team_member_id === id)) await store.insert("department_members", { department_id: departmentId, team_member_id: id });
  }
  await audit(store, actorId, "set_members", "department", departmentId, { members: memberIds.length });
}

/** Departments a member can be placed in (IVR keys 3-9). Throws before anything is written. */
export async function assertAssignableDepartments(store: Store, departmentIds: string[]) {
  const all = await store.list<Department>("departments");
  for (const id of departmentIds) {
    const d = all.find((x) => x.id === id);
    if (!d) throw notFound("Department");
    if (d.kind === "missed_call") throw conflict("Missed-call callback (key 2) routes to the latest outbound agent and has no fixed members");
  }
}

/**
 * Member-centric view of tc_department_members: make the member belong to exactly these departments.
 * Same rows the Departments & IVR keys page edits, so both screens always agree.
 * Idempotent: re-sending the same list changes nothing; a concurrent duplicate insert is ignored.
 */
export async function setMemberDepartments(store: Store, memberId: string, departmentIds: string[], actorId: string | null) {
  const ids = [...new Set(departmentIds)];
  if (!(await store.get("team_members", memberId))) throw notFound("Team member");
  await assertAssignableDepartments(store, ids);
  const current = await store.list<DepartmentMember>("department_members", { eq: { team_member_id: memberId } });
  const added: string[] = [], removed: string[] = [];
  for (const id of ids) {
    if (current.some((c) => c.department_id === id)) continue;
    try { await store.insert("department_members", { department_id: id, team_member_id: memberId }); added.push(id); }
    catch (e) { if (!isConflict(e)) throw e; } // already linked by a parallel save
  }
  for (const c of current) if (!ids.includes(c.department_id)) { await store.remove("department_members", c.id); removed.push(c.department_id); }
  if (added.length || removed.length) await audit(store, actorId, "set_departments", "team_member", memberId, { added, removed });
}

export async function listDepartments(store: Store) {
  const [depts, links, team] = await Promise.all([
    store.list<Department>("departments", { order: { column: "ivr_key" } }),
    store.list<DepartmentMember>("department_members"),
    store.list<TeamMember>("team_members"),
  ]);
  return depts.map((d) => ({
    ...d,
    members: team.filter((m) => links.some((l) => l.department_id === d.id && l.team_member_id === m.id))
      .map((m) => ({ id: m.id, full_name: m.full_name, status: m.status })),
  }));
}
