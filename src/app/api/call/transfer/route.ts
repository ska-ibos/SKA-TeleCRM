import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx, engineCtx } from "@/lib/api/context";
import { transferSchema } from "@/lib/validations";
import { transferCall } from "@/lib/routing/routing.engine";
import { withIdempotency } from "@/lib/services/idempotency.service";
import { audit } from "@/lib/services/audit.service";

/** Transfer a connected call. An answered transfer to a department member seeds the sticky agent. */
export const POST = api(async (req) => {
  const { store, user } = await apiCtx("calls:transfer");
  const input = transferSchema.parse(await readJson(req));
  const ctx = await engineCtx({ at: input.at, simulation: input.result !== undefined });
  const res = await withIdempotency(store, ctx.provider.name, `transfer:${user.id}:${input.idempotencyKey}`, () =>
    transferCall(ctx, { callId: input.call_id, fromMemberId: user.memberId, toMemberId: input.to_member_id, departmentId: input.department_id, result: input.result }), { payload: input });
  await audit(store, user.memberId, "transfer", "call", input.call_id, { to: input.to_member_id, status: res.transfer.status });
  return ok(res);
});
