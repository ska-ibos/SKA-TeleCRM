import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx } from "@/lib/api/context";
import { extensionSchema } from "@/lib/validations";
import { setExtension } from "@/lib/services/team.service";

export const PUT = api(async (req) => {
  const { store, user } = await apiCtx("extensions:write");
  const { team_member_id, extension } = extensionSchema.parse(await readJson(req));
  return ok(await setExtension(store, team_member_id, extension, user.memberId));
});
