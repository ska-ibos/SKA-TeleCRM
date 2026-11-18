import { describe, expect, it } from "vitest";
import * as E from "@/lib/routing/routing.engine";
import { withIdempotency } from "@/lib/services/idempotency.service";
import { addPhone, createClient, deleteClient, removePhone, updateClient } from "@/lib/services/client.service";
import { createCallbackReminder } from "@/lib/routing/fallback.service";
import { AppError } from "@/lib/data/types";
import { DEFAULT_ROUTING_CONFIG } from "@/lib/constants";
import { at, MON_11AM, setup } from "../helpers";
import type { Call, CallSession, Reminder } from "@/types";

const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : String(e)));

describe("race conditions", () => {
  it("two concurrent DTMF events on one call: exactly one transition wins", async () => {
    const t = await setup();
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    const results = await Promise.all([
      code(E.handleInput(t.ctx(MON_11AM), s.callId, "1")),
      code(E.handleInput(t.ctx(MON_11AM), s.callId, "6")),
    ]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "concurrent_update" || r === "invalid_state")).toHaveLength(1);
    const [session] = await t.store.list<CallSession>("call_sessions", { eq: { call_id: s.callId } });
    expect(session.state).toBe("dialing");
  });

  it("session version increases on every transition", async () => {
    const t = await setup();
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    const v0 = (await t.store.list<CallSession>("call_sessions", { eq: { call_id: s.callId } }))[0].version;
    await E.handleInput(t.ctx(MON_11AM), s.callId, "1");
    const v1 = (await t.store.list<CallSession>("call_sessions", { eq: { call_id: s.callId } }))[0].version;
    expect(v1).toBeGreaterThan(v0);
  });

  it("duplicate concurrent 'incoming' events for one provider call create one call", async () => {
    const t = await setup();
    const steps = await Promise.all([
      E.startInbound(t.ctx(MON_11AM), { from: t.phone, providerCallId: "CA-RACE" }),
      E.startInbound(t.ctx(MON_11AM), { from: t.phone, providerCallId: "CA-RACE" }),
    ]);
    expect(steps[0].callId).toBe(steps[1].callId);
    expect(await t.store.list<Call>("calls", { eq: { provider_call_id: "CA-RACE" } })).toHaveLength(1);
    expect(await t.store.list<CallSession>("call_sessions", { eq: { call_id: steps[0].callId } })).toHaveLength(1);
  });

  it("concurrent missed + voicemail callbacks create one reminder", async () => {
    const t = await setup();
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    const call = (await t.store.get<Call>("calls", s.callId))!;
    const p = { now: MON_11AM, officeHours: DEFAULT_ROUTING_CONFIG.office_hours };
    const [a, b] = await Promise.all([
      createCallbackReminder(t.store, call, { ...p, source: "missed" }),
      createCallbackReminder(t.store, call, { ...p, source: "voicemail" }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await t.store.list<Reminder>("reminders", { eq: { call_id: call.id } })).toHaveLength(1);
  });

  it("a manual reminder on the call does not block the automatic callback", async () => {
    const t = await setup();
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    const call = (await t.store.get<Call>("calls", s.callId))!;
    await t.store.insert("reminders", { call_id: call.id, title: "Send GST docs", due_at: MON_11AM.toISOString(), status: "pending", source: "manual" });
    const r = await createCallbackReminder(t.store, call, { now: MON_11AM, officeHours: DEFAULT_ROUTING_CONFIG.office_hours, source: "missed" });
    expect(r.source).toBe("missed");
  });

  it("only one in-flight transfer per call", async () => {
    const t = await setup();
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    await E.handleInput(t.ctx(MON_11AM), s.callId, "1");
    await E.handleDialResult(t.ctx(MON_11AM), s.callId, "answered");
    await E.transferCall(t.ctx(MON_11AM), { callId: s.callId, fromMemberId: null, toMemberId: t.member("Hiren").id });
    await expect(E.transferCall(t.ctx(MON_11AM), { callId: s.callId, fromMemberId: null, toMemberId: t.member("Shruti").id }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("duplicate outbound status callbacks keep the first outcome", async () => {
    const t = await setup();
    const call = await E.placeOutbound(t.ctx(MON_11AM), { agentId: t.member("Hiren").id, to: t.phone });
    const [a, b] = await Promise.all([
      E.completeOutbound(t.ctx(MON_11AM), call.id, "answered"),
      E.completeOutbound(t.ctx(MON_11AM), call.id, "busy"),
    ]);
    expect(a.status).toBe(b.status);
  });

  it("outbound hangup closes an answered call with duration (once)", async () => {
    const t = await setup();
    const call = await E.placeOutbound(t.ctx(MON_11AM), { agentId: t.member("Hiren").id, to: t.phone, result: "answered" });
    const ended = await E.endOutbound(t.ctx(at(MON_11AM, 0.05)), call.id);
    expect(ended).toMatchObject({ status: "completed", duration_sec: 180 });
    const again = await E.endOutbound(t.ctx(at(MON_11AM, 1)), call.id);
    expect(again.ended_at).toBe(ended.ended_at);
  });
});

describe("idempotency", () => {
  it("replays a completed key without re-running", async () => {
    const t = await setup();
    let runs = 0;
    const fn = async () => ({ n: ++runs });
    expect(await withIdempotency(t.store, "test", "k1", fn, { payload: { a: 1 } })).toEqual({ n: 1 });
    expect(await withIdempotency(t.store, "test", "k1", fn, { payload: { a: 1 } })).toEqual({ n: 1 });
    expect(runs).toBe(1);
  });

  it("payload key order does not change the hash", async () => {
    const t = await setup();
    await withIdempotency(t.store, "test", "k-order", async () => 1, { payload: { a: 1, b: 2 } });
    expect(await withIdempotency(t.store, "test", "k-order", async () => 2, { payload: { b: 2, a: 1 } })).toBe(1);
  });

  it("rejects the same key with a different payload", async () => {
    const t = await setup();
    await withIdempotency(t.store, "test", "k2", async () => 1, { payload: { to: "+919800000001" } });
    expect(await code(withIdempotency(t.store, "test", "k2", async () => 2, { payload: { to: "+919800000002" } })))
      .toBe("idempotency_key_reused");
  });

  it("concurrent duplicates: one runs, the other is told it is in progress", async () => {
    const t = await setup();
    let runs = 0;
    const slow = async () => { runs++; await new Promise((r) => setTimeout(r, 20)); return "done"; };
    const res = await Promise.all([code(withIdempotency(t.store, "test", "k3", slow)), code(withIdempotency(t.store, "test", "k3", slow))]);
    expect(res.sort()).toEqual(["in_progress", "ok"]);
    expect(runs).toBe(1);
  });

  it("a failed attempt releases the lock (row kept) so a retry runs", async () => {
    const t = await setup();
    await expect(withIdempotency(t.store, "test", "k4", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await withIdempotency(t.store, "test", "k4", async () => "second")).toBe("second");
    expect(await t.store.list("webhook_events", { eq: { event_key: "k4" } })).toHaveLength(1);
  });

  it("an expired lock from a crashed worker is taken over", async () => {
    const t = await setup();
    await t.store.insert("webhook_events", { provider: "test", event_key: "k5", status: "processing", response: null, locked_until: "2000-01-01T00:00:00.000Z" });
    expect(await withIdempotency(t.store, "test", "k5", async () => "recovered")).toBe("recovered");
  });
});

describe("SKA OS client master (read-only in Supabase mode)", () => {
  const readOnly = async () => {
    const t = await setup();
    Object.assign(t.store.capabilities, { mode: "supabase", clientsReadOnly: true, bulkDeleteAllowed: false });
    return t;
  };

  it("blocks create / update / delete of clients", async () => {
    const t = await readOnly();
    expect(await code(createClient(t.store, { name: "New Co", status: "active", company: null, email: null, pan: null, gstin: null, city: null, phones: [{ phone: "+919811111111", label: "mobile" }] }, null))).toBe("managed_externally");
    expect(await code(updateClient(t.store, t.client.id, { name: "Renamed", status: "active", company: null, email: null, pan: null, gstin: null, city: null }, null))).toBe("managed_externally");
    expect(await code(deleteClient(t.store, t.client.id, null))).toBe("managed_externally");
  });

  it("still lets the CRM desk add caller-ID numbers, but not remove SKA OS numbers", async () => {
    const t = await readOnly();
    const master = await t.store.insert<{ id: string }>("client_phone_numbers", { client_id: t.client.id, phone: "+919822222222", label: "mobile", is_primary: false, source: "client_master" });
    await addPhone(t.store, { client_id: t.client.id, phone: "+919833333333", label: "office", is_primary: false }, null);
    expect(await code(removePhone(t.store, master.id, null))).toBe("conflict");
  });

  it("a number shared by several clients is treated as ambiguous, not guessed", async () => {
    const t = await setup();
    t.store.matchClientByPhone = async () => ({ clientId: null, source: "client_master", candidates: ["a", "b", "c"] });
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    expect(s.trail[0]).toContain("matches 3 clients");
    expect((await t.store.get<Call>("calls", s.callId))!.client_id).toBeNull();
    const [session] = await t.store.list<CallSession>("call_sessions", { eq: { call_id: s.callId } });
    expect(session.context.candidateClientIds).toEqual(["a", "b", "c"]);
  });
});
