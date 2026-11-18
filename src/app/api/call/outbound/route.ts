import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx, engineCtx } from "@/lib/api/context";
import { outboundSchema } from "@/lib/validations";
import { placeOutbound } from "@/lib/routing/routing.engine";
import { withIdempotency } from "@/lib/services/idempotency.service";
import { audit } from "@/lib/services/audit.service";
import { forbidden } from "@/lib/data/types";

/**
 * Click-to-call. Saves outbound history (used by key-2 missed-call routing).
 * In simulation mode `result` sets the outcome; with a real provider the outcome
 * arrives later on /api/exotel/status.
 */
export const POST = api(async (req) => {
  const { store, user } = await apiCtx("calls:outbound");
  const input = outboundSchema.parse(await readJson(req));
  if (user.role === "agent" && input.agent_id !== user.memberId) throw forbidden("Agents can only place calls as themselves");
  const ctx = await engineCtx({ at: input.at });
  const call = await withIdempotency(store, ctx.provider.name, `outbound:${user.id}:${input.idempotencyKey}`, () =>
    placeOutbound(ctx, { agentId: input.agent_id, to: input.to, result: ctx.provider.isSimulation ? input.result : undefined }), { payload: input });
  await audit(store, user.memberId, "outbound_call", "call", call.id, { to: input.to, simulated: ctx.provider.isSimulation });
  return ok(call, 201);
}, { limit: 30 });
