/**
 * Linked "agent" + "department" pickers (call transfer).
 *
 * Picking an AGENT:
 *   - agent belongs to 1 department      -> that department is selected automatically
 *   - agent belongs to several            -> department list shows only those; current choice kept if it is one of them
 *   - agent belongs to none               -> every department stays available, current choice kept
 * Picking a DEPARTMENT works the same way in reverse for its members.
 * Clearing either picker ("" value) lifts the restriction on the other one.
 */
export interface LinkMember { id: string; departments?: { id: string }[] }
export interface LinkDept { id: string }

export function deptsOf<D extends LinkDept>(member: LinkMember | undefined, depts: D[]): D[] {
  if (!member?.departments?.length) return [];
  const ids = new Set(member.departments.map((d) => d.id));
  return depts.filter((d) => ids.has(d.id));
}
export function membersOf<M extends LinkMember>(deptId: string, members: M[]): M[] {
  return deptId ? members.filter((m) => m.departments?.some((d) => d.id === deptId)) : [];
}

/** Agents to offer: the selected department's members, or everyone if none selected / it has no available members. */
export function agentChoices<M extends LinkMember>(members: M[], deptId: string): M[] {
  const inDept = membersOf(deptId, members);
  return inDept.length ? inDept : members;
}
/** Departments to offer: the selected agent's departments, or all if no agent / the agent has none. */
export function deptChoices<M extends LinkMember, D extends LinkDept>(members: M[], depts: D[], agentId: string): D[] {
  const mine = deptsOf(members.find((m) => m.id === agentId), depts);
  return mine.length ? mine : depts;
}

export function pickAgent<M extends LinkMember, D extends LinkDept>(members: M[], depts: D[], agentId: string, currentDept: string) {
  if (!agentId) return { agent: "", dept: currentDept };
  const mine = deptsOf(members.find((m) => m.id === agentId), depts);
  if (mine.length === 1) return { agent: agentId, dept: mine[0].id };
  if (mine.length > 1) return { agent: agentId, dept: mine.some((d) => d.id === currentDept) ? currentDept : "" };
  return { agent: agentId, dept: currentDept };
}

export function pickDept<M extends LinkMember>(members: M[], deptId: string, currentAgent: string) {
  if (!deptId) return { agent: currentAgent, dept: "" };
  const inDept = membersOf(deptId, members);
  if (inDept.length === 1) return { agent: inDept[0].id, dept: deptId };
  if (inDept.length > 1) return { agent: inDept.some((m) => m.id === currentAgent) ? currentAgent : "", dept: deptId };
  return { agent: currentAgent, dept: deptId };
}
