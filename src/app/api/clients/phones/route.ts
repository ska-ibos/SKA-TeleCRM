import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx, param } from "@/lib/api/context";
import { phoneCreateSchema, uuid } from "@/lib/validations";
import { addPhone, removePhone } from "@/lib/services/client.service";

export const POST = api(async (req) => {
  const { store, user } = await apiCtx("clients:write");
  return ok(await addPhone(store, phoneCreateSchema.parse(await readJson(req)), user.memberId), 201);
});

export const DELETE = api(async (req) => {
  const { store, user } = await apiCtx("clients:write");
  await removePhone(store, uuid.parse(param(req, "id")), user.memberId);
  return ok(true);
});
