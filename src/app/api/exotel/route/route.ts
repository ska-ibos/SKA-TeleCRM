import { api, ok, readJson } from "@/lib/utils/response";
import { telephonyEventSchema } from "@/lib/validations";
import { assertWebhook } from "@/lib/telephony/webhook";
import { getStore } from "@/lib/data/store";
import { withIdempotency } from "@/lib/services/idempotency.service";
import { withProviderEventLog } from "@/lib/services/provider-event.service";
import * as Engine from "@/lib/routing/routing.engine";
import { notFound, badRequest } from "@/lib/data/types";
import type { Call } from "@/types";

/**
 * Live IVR routing webhook (placeholder until official Exotel details arrive).
 * Accepts the provider-neutral event shape; the Exotel adapter's `toTelephonyEvent`
 * will map official fields into it. Returns the engine's RouteStep.
 *  - every authenticated payload is logged raw to tc_provider_events first;
 *  - duplicate eventIds replay the stored response, never re-execute;
 *  - the same eventId with a different payload is rejected (422).
 */
export const POST = api(async (req) => {
  const provider = assertWebhook(req);
  const raw = await readJson(req);
  const store = await getStore();
  const meta = raw as { eventId?: string; providerCallId?: string };
  const step = await withProviderEventLog(store,
    { provider: provider.name, endpoint: "route", payload: raw, eventId: meta?.eventId, providerCallId: meta?.providerCallId },
    async () => {
      const ev = telephonyEventSchema.parse(raw);
      const ctx = { store, provider, now: new Date() };
      const result = await withIdempotency(store, provider.name, ev.eventId, async () => {
        if (ev.type === "incoming") {
          if (!ev.from) throw badRequest("from is required for incoming calls");
          return Engine.startInbound(ctx, { from: ev.from, providerCallId: ev.providerCallId });
        }
        const [call] = await store.list<Call>("calls", { eq: { provider: provider.name, provider_call_id: ev.providerCallId }, limit: 1 });
        if (!call) throw notFound("Call");
        switch (ev.type) {
          case "input": return Engine.handleInput(ctx, call.id, ev.digits ?? "");
          case "sticky": return Engine.handleStickyChoice(ctx, call.id, ev.digits ?? "");
          case "voicemail": return Engine.leaveVoicemail(ctx, call.id);
          default: return Engine.currentStep(ctx, call.id);
        }
      }, { payload: ev });
      return { result };
    });
  return ok(step);
}, { limit: 600 });
