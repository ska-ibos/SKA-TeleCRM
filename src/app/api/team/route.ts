import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx, param } from "@/lib/api/context";
import { memberDepartmentsSchema, statusSchema, teamMemberPatchSchema, teamMemberSchema, uuid } from "@/lib/validations";
import { forbidden } from "@/lib/data/types";
import { assertAssignableDepartments, createMember, deleteMember, listEmployees, listTeam, setMemberDepartments, updateMember } from "@/lib/services/team.service";

/** GET /api/team - team. GET /api/team?employees=1 - SKA OS employees available to link (admin). */
export const GET = api(async (req) => {
  if (param(req, "employees")) {
    const { store } = await apiCtx("team:write");
    return ok(await listEmployees(store));
  }
  const { store } = await apiCtx();
  return ok(await listTeam(store));
});

export const POST = api(async (req) => {
  const { store, user } = await apiCtx("team:write");
  const body = await readJson(req);
  const input = teamMemberSchema.parse(body);
  const { department_ids } = memberDepartmentsSchema.parse(body);
  if (department_ids) await assertAssignableDepartments(store, department_ids); // fail before creating the member
  const m = await createMember(store, input, user.memberId);
  if (department_ids?.length) await setMemberDepartments(store, m.id, department_ids, user.memberId);
  return ok(m, 201);
});

/** PATCH ?id=  full update (admin). PATCH {id,status} availability (self or admin/crm/manager). */
export const PATCH = api(async (req) => {
  const { store, user } = await apiCtx();
  const body = (await readJson(req)) as Record<string, unknown>;
  if (!param(req, "id")) {
    const s = statusSchema.parse(body);
    if (s.id !== user.memberId && !["admin", "crm_desk", "manager"].includes(user.role)) throw forbidden("You can only change your own availability");
    return ok(await updateMember(store, s.id, { status: s.status }, user.memberId));
  }
  if (user.role !== "admin") throw forbidden();
  const id = uuid.parse(param(req, "id"));
  const input = teamMemberPatchSchema.parse(body);
  const { department_ids } = memberDepartmentsSchema.parse(body);
  if (department_ids) await assertAssignableDepartments(store, department_ids);
  const m = await updateMember(store, id, input, user.memberId);
  if (department_ids) await setMemberDepartments(store, id, department_ids, user.memberId); // omitted = leave as is
  return ok(m);
});

/** DELETE ?id= (admin): only members with no history; others are deactivated instead. */
export const DELETE = api(async (req) => {
  const { store, user } = await apiCtx("team:write");
  await deleteMember(store, uuid.parse(param(req, "id")), user.memberId);
  return ok(true);
});
