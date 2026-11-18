import { api, ok, readJson } from "@/lib/utils/response";
import { telephonyEventSchema } from "@/lib/validations";
import { assertWebhook } from "@/lib/telephony/webhook";
import { getStore } from "@/lib/data/store";
import { withIdempotency } from "@/lib/services/idempotency.service";
import { withProviderEventLog } from "@/lib/services/provider-event.service";
import * as Engine from "@/lib/routing/routing.engine";
import { badRequest, notFound } from "@/lib/data/types";
import type { Call, CallSession } from "@/types";

/** Status callbacks (dial outcome / hangup): raw-logged, idempotent per eventId, race-safe per call. */
export const POST = api(async (req) => {
  const provider = assertWebhook(req);
  const raw = await readJson(req);
  const store = await getStore();
  const meta = raw as { eventId?: string; providerCallId?: string };
  return ok(await withProviderEventLog(store,
    { provider: provider.name, endpoint: "status", payload: raw, eventId: meta?.eventId, providerCallId: meta?.providerCallId },
    async () => {
      const ev = telephonyEventSchema.parse(raw);
      const ctx = { store, provider, now: new Date() };
      const result = await withIdempotency(store, provider.name, ev.eventId, async () => {
        const [call] = await store.list<Call>("calls", { eq: { provider: provider.name, provider_call_id: ev.providerCallId }, limit: 1 });
        if (!call) throw notFound("Call");
        if (ev.type === "hangup") return call.direction === "outbound" ? Engine.endOutbound(ctx, call.id) : Engine.hangup(ctx, call.id);
        if (ev.type !== "dial_result" || !ev.result) throw badRequest("Unsupported status event");
        if (call.direction === "outbound") return Engine.completeOutbound(ctx, call.id, ev.result);
        const [session] = await store.list<CallSession>("call_sessions", { eq: { call_id: call.id }, limit: 1 });
        return session?.state === "dialing" ? Engine.handleDialResult(ctx, call.id, ev.result) : Engine.currentStep(ctx, call.id);
      }, { payload: ev });
      return { result };
    }));
}, { limit: 600 });
