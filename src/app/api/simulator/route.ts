import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx, engineCtx } from "@/lib/api/context";
import { simulatorSchema } from "@/lib/validations";
import * as Engine from "@/lib/routing/routing.engine";
import { withIdempotency } from "@/lib/services/idempotency.service";
import { listCalls } from "@/lib/services/call.service";
import { listClients } from "@/lib/services/client.service";
import { getSimulationProvider } from "@/lib/telephony/provider.factory";
import { SimulationProvider } from "@/lib/telephony/simulation.provider";
import { forbidden } from "@/lib/data/types";
import type { Call } from "@/types";

/** SIMULATION — NO REAL PHONE CALL. Uses the exact same routing engine as live telephony. */
export const GET = api(async (req) => {
  const { store } = await apiCtx("simulator:use");
  // Caller picker: every client number, whoever tests (the Clients pages stay scoped by role).
  // Only what the picker needs: id, name and phone numbers.
  if (new URL(req.url).searchParams.get("callers")) {
    const clients = await listClients(store, {});
    return ok(clients.filter((c) => c.phones.length).map((c) => ({
      id: c.id, name: c.name, phones: c.phones.map((p) => ({ phone: p.phone, is_primary: p.is_primary })),
    })));
  }
  const calls = (await listCalls(store, { limit: 50 })).filter((c) => c.is_simulated);
  const log = (getSimulationProvider() as SimulationProvider).log.slice(-30).reverse();
  return ok({ calls, log });
});

export const POST = api(async (req) => {
  const { store, user } = await apiCtx("simulator:use");
  const input = simulatorSchema.parse(await readJson(req));

  if (input.action === "reset") {
    if (user.role !== "admin") throw forbidden("Only admins can clear simulated calls");
    if (!store.capabilities.bulkDeleteAllowed) {
      throw forbidden("Clearing simulated calls is disabled on the shared SKA OS database (records are never deleted). Simulated calls stay flagged as SIMULATED.");
    }
    const sims = await store.list<Call>("calls", { eq: { is_simulated: true } });
    for (const c of sims) await store.remove("calls", c.id);
    return ok({ removed: sims.length });
  }

  const ctx = await engineCtx({ at: input.at, simulation: true });
  const run = () => {
    switch (input.action) {
      case "start": return Engine.startInbound(ctx, { from: input.from });
      case "input": return Engine.handleInput(ctx, input.callId, input.digits);
      case "sticky": return Engine.handleStickyChoice(ctx, input.callId, input.digit);
      case "dial_result": return Engine.handleDialResult(ctx, input.callId, input.result);
      case "voicemail": return Engine.leaveVoicemail(ctx, input.callId, input.message);
      case "hangup": return Engine.hangup(ctx, input.callId);
    }
  };
  return ok(await withIdempotency(store, "simulation", `${user.id}:${input.idempotencyKey}`, run, { payload: input }));
}, { limit: 300 });
