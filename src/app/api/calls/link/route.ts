import { z } from "zod";
import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx } from "@/lib/api/context";
import { uuid } from "@/lib/validations";
import { linkCallToClient } from "@/lib/services/client.service";

/** Link an unknown caller's number to a client (CRM desk / manager / admin). */
export const POST = api(async (req) => {
  const { store, user } = await apiCtx("clients:write");
  const { call_id, client_id } = z.object({ call_id: uuid, client_id: uuid }).parse(await readJson(req));
  return ok(await linkCallToClient(store, call_id, client_id, user.memberId));
});
