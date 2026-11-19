import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx, engineCtx } from "@/lib/api/context";
import { transferSchema } from "@/lib/validations";
import { transferCall } from "@/lib/routing/routing.engine";
import { withIdempotency } from "@/lib/services/idempotency.service";
import { audit } from "@/lib/services/audit.service";
import { badRequest, forbidden, notFound } from "@/lib/data/types";
import type { Call } from "@/types";

const STAFF = ["admin", "crm_desk", "manager"];

/**
 * Transfer a connected call. An answered transfer to a department member seeds the sticky agent.
 *
 * Simulated calls: `result` is the simulated outcome and `at` the simulated clock.
 * Live calls (Exotel PSTN): Exotel has no transfer API on this plan - the agent transfers on
 * the handset, then records here whether the colleague took the call (`result` is required).
 * Only the agent on the call, or the CRM desk / a manager / an admin, may record it, and the
 * clock is always the server's (no `at`).
 */
export const POST = api(async (req) => {
  const { store, user } = await apiCtx("calls:transfer");
  const input = transferSchema.parse(await readJson(req));
  const call = await store.get<Call>("calls", input.call_id);
  if (!call) throw notFound("Call");
  if (!call.is_simulated) {
    if (!STAFF.includes(user.role) && call.answered_agent_id !== user.memberId) {
      throw forbidden("Only the agent on this call, the CRM desk, a manager or an admin can transfer it");
    }
    if (!input.result) throw badRequest("Record whether the colleague took the call", { result: "Choose the transfer outcome" });
  }
  const ctx = await engineCtx({ at: call.is_simulated ? input.at : undefined, simulation: call.is_simulated });
  const res = await withIdempotency(store, ctx.provider.name, `transfer:${user.id}:${input.idempotencyKey}`, () =>
    transferCall(ctx, { callId: input.call_id, fromMemberId: user.memberId, toMemberId: input.to_member_id, departmentId: input.department_id, result: input.result }), { payload: input });
  await audit(store, user.memberId, "transfer", "call", input.call_id, { to: input.to_member_id, status: res.transfer.status, simulated: call.is_simulated });
  return ok(res);
});
