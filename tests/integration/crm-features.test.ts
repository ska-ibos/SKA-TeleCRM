import { describe, expect, it } from "vitest";
import * as E from "@/lib/routing/routing.engine";
import { canHearRecording, canSeeCall, scopeFor } from "@/lib/services/access.service";
import { callerContext } from "@/lib/services/context.service";
import { getCallDetail, listCalls } from "@/lib/services/call.service";
import { getClientDetail, linkCallToClient, listClients } from "@/lib/services/client.service";
import { buildReport } from "@/lib/services/report.service";
import type { Call, SessionUser } from "@/types";
import { at, MON_11AM, setup } from "../helpers";

const userOf = (t: Awaited<ReturnType<typeof setup>>, name: string, role: SessionUser["role"]): SessionUser => {
  const m = t.member(name);
  return { id: m.id, name, email: null, role, memberId: m.id, mode: "demo" };
};

/** Client calls GST (6), CRM desk answers and transfers to `agent`. */
async function gstCall(t: Awaited<ReturnType<typeof setup>>, agent: string, now = MON_11AM, from = t.phone) {
  const s = await E.startInbound(t.ctx(now), { from });
  await E.handleInput(t.ctx(now), s.callId, "6");
  await E.handleDialResult(t.ctx(now), s.callId, "answered");
  await E.transferCall(t.ctx(now), { callId: s.callId, fromMemberId: null, toMemberId: t.member(agent).id, result: "answered" });
  await E.hangup(t.ctx(at(now, 0.1)), s.callId);
  return s.callId;
}

describe("who sees what", () => {
  it("agents see only the clients and calls they dealt with", async () => {
    const t = await setup();
    const other = await t.store.insert<{ id: string }>("clients", { name: "Other Client", status: "active" });
    const callId = await gstCall(t, "Hiren");

    const hiren = await scopeFor(t.store, userOf(t, "Hiren", "agent"));
    expect((await listClients(t.store, {}, hiren)).map((c) => c.name)).toEqual(["Rahul Client"]);
    await expect(getClientDetail(t.store, other.id, hiren)).rejects.toThrow(/not found/);
    expect((await listCalls(t.store, {}, hiren)).map((c) => c.id)).toEqual([callId]);

    const sneha = await scopeFor(t.store, userOf(t, "Sneha", "agent"));
    expect(await listClients(t.store, {}, sneha)).toEqual([]);
    await expect(getCallDetail(t.store, callId, { scope: sneha })).rejects.toThrow(/not found/);

    const desk = await scopeFor(t.store, userOf(t, "Jinofer", "crm_desk"));
    expect(await listClients(t.store, {}, desk)).toHaveLength(2);
  });

  it("managers also see every call in their departments", async () => {
    const t = await setup();
    const callId = await gstCall(t, "Hiren");
    const komal = await scopeFor(t.store, userOf(t, "Komal", "manager")); // Komal is in GST
    const call = (await t.store.get<Call>("calls", callId))!;
    expect(canSeeCall(komal, call)).toBe(true);
    const rahul = await scopeFor(t.store, userOf(t, "Rahul", "manager")); // ROC only
    expect(canSeeCall(rahul, call)).toBe(false);
  });

  it("recordings: admin, the department's manager, or whoever handled the call", async () => {
    const t = await setup();
    const callId = await gstCall(t, "Hiren");
    const call = (await t.store.get<Call>("calls", callId))!;
    const check = async (name: string, role: SessionUser["role"]) => {
      const u = userOf(t, name, role);
      return canHearRecording(u, await scopeFor(t.store, u), call);
    };
    expect(await check("Hiren", "agent")).toBe(true);
    expect(await check("Sneha", "agent")).toBe(false);
    expect(await check("Komal", "manager")).toBe(true);
    expect(await check("Rahul", "manager")).toBe(false);
    expect(await check("Urja", "admin")).toBe(true);

    await t.store.insert("recordings", { call_id: callId, provider_url: "https://recordings.exotel.com/a.mp3", kind: "call" });
    const hiren = userOf(t, "Hiren", "agent");
    expect((await getCallDetail(t.store, callId, { scope: await scopeFor(t.store, hiren), user: hiren })).recordings).toHaveLength(1);
    const desk = userOf(t, "Jinofer", "crm_desk");
    // after the transfer the call is Hiren's: the CRM desk sees the call but not its recording
    expect((await getCallDetail(t.store, callId, { scope: await scopeFor(t.store, desk), user: desk })).recordings).toEqual([]);
    // and the recording URL itself is never sent to the browser
    const admin = userOf(t, "Urja", "admin");
    expect((await getCallDetail(t.store, callId, { scope: { all: true }, user: admin })).recordings[0]).not.toHaveProperty("provider_url");
  });
});

describe("caller context (screen-pop)", () => {
  it("shows tags, notes, recent calls, sticky agent per department and the last outbound agent", async () => {
    const t = await setup();
    await gstCall(t, "Hiren");
    await E.placeOutbound(t.ctx(at(MON_11AM, 1)), { agentId: t.member("Shruti").id, to: t.phone, result: "no_answer" });
    const tag = await t.store.insert<{ id: string }>("tags", { name: "VIP", color: "#be123c" });
    await t.store.insert("client_tags", { client_id: t.client.id, tag_id: tag.id });
    await t.store.insert("notes", { client_id: t.client.id, author_id: t.member("Hiren").id, body: "GSTR-3B pending" });

    const s = await E.startInbound(t.ctx(at(MON_11AM, 2)), { from: t.phone });
    const ctx = await callerContext(t.store, s.callId, { all: true }, at(MON_11AM, 2));
    expect(ctx.client?.name).toBe("Rahul Client");
    expect(ctx.tags.map((x) => x.name)).toEqual(["VIP"]);
    expect(ctx.notes[0].body).toBe("GSTR-3B pending");
    expect(ctx.stickies).toMatchObject([{ department: "GST", agent: "Hiren" }]);
    expect(ctx.last_outbound?.agent).toBe("Shruti");
    expect(ctx.recent_calls.length).toBe(2);
  });
});

describe("linking an unknown caller", () => {
  it("pins the number to the client and attaches earlier calls, so history and stickies follow", async () => {
    const t = await setup();
    const newNumber = "+919811122233";
    const first = await gstCall(t, "Hiren", MON_11AM, newNumber); // unknown caller: sticky by phone
    expect((await t.store.get<Call>("calls", first))!.client_id).toBeNull();

    const s = await E.startInbound(t.ctx(at(MON_11AM, 1)), { from: newNumber });
    const r = await linkCallToClient(t.store, s.callId, t.client.id, null);
    expect(r.calls).toBe(2);
    expect((await t.store.get<Call>("calls", first))!.client_id).toBe(t.client.id);

    // next call from that number is identified, and the GST sticky counts for the client
    const s2 = await E.startInbound(t.ctx(at(MON_11AM, 2)), { from: newNumber });
    expect(s2.trail[0]).toContain("Rahul Client");
    expect((await E.handleInput(t.ctx(at(MON_11AM, 2)), s2.callId, "6")).agent?.name).toBe("Hiren");
  });
});

describe("reports", () => {
  it("sticky-hit rate counts department presses that found a recent agent, accepted or not", async () => {
    const t = await setup();
    await gstCall(t, "Hiren"); // no sticky yet
    const s = await E.startInbound(t.ctx(at(MON_11AM, 1)), { from: t.phone });
    await E.handleInput(t.ctx(at(MON_11AM, 1)), s.callId, "6");
    await E.handleStickyChoice(t.ctx(at(MON_11AM, 1)), s.callId, "2"); // offered Hiren, declined
    const r = await buildReport(t.store, {});
    expect(r.totals.departmentPresses).toBe(2);
    expect(r.totals.stickyHitRate).toBe(50);
  });
});
