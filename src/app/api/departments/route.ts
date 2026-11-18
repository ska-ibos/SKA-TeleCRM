import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx, param } from "@/lib/api/context";
import { departmentMembersSchema, departmentSchema, uuid } from "@/lib/validations";
import { listDepartments, setDepartmentMembers } from "@/lib/services/team.service";
import { audit } from "@/lib/services/audit.service";

export const GET = api(async () => {
  const { store } = await apiCtx();
  return ok(await listDepartments(store));
});

/** IVR keys are fixed by the Operations IVR; name/description/active can be edited. */
export const PATCH = api(async (req) => {
  const { store, user } = await apiCtx("departments:write");
  const id = uuid.parse(param(req, "id"));
  const input = departmentSchema.partial().parse(await readJson(req));
  const d = await store.update("departments", id, input);
  await audit(store, user.memberId, "update", "department", id, input);
  return ok(d);
});

export const PUT = api(async (req) => {
  const { store, user } = await apiCtx("departments:write");
  const { department_id, member_ids } = departmentMembersSchema.parse(await readJson(req));
  await setDepartmentMembers(store, department_id, [...new Set(member_ids)], user.memberId);
  return ok(true);
});
