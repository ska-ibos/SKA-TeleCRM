import { describe, expect, it } from "vitest";
import * as E from "@/lib/routing/routing.engine";
import { at, MON_11AM, setup } from "../helpers";
import type { Call, Reminder } from "@/types";

/** Drive a department call that gets answered by `agent` via CRM transfer (seeds sticky). */
async function seedStickyViaTransfer(t: Awaited<ReturnType<typeof setup>>, key: string, agent: string, now: Date) {
  const s = await E.startInbound(t.ctx(now), { from: t.phone });
  let r = await E.handleInput(t.ctx(now), s.callId, key);
  if (r.action === "gather_sticky") r = await E.handleStickyChoice(t.ctx(now), s.callId, "2");
  expect(r.agent?.name).toBe("Jinofer");
  await E.handleDialResult(t.ctx(now), s.callId, "answered");
  const { transfer } = await E.transferCall(t.ctx(now), { callId: s.callId, fromMemberId: null, toMemberId: t.member(agent).id, result: "answered" });
  expect(transfer.status).toBe("answered");
  await E.hangup(t.ctx(at(now, 0.1)), s.callId);
  return s.callId;
}

describe("IVR keys", () => {
  it("key 1 routes to CRM desk (Jinofer)", async () => {
    const t = await setup();
    const s = await E.startInbound(t.ctx(MON_11AM), { from: "98000 00001" });
    expect(s.action).toBe("gather");
    expect(s.trail[0]).toContain("Rahul Client");
    const r = await E.handleInput(t.ctx(MON_11AM), s.callId, "1");
    expect(r).toMatchObject({ action: "dial", agent: { name: "Jinofer" } });
  });

  it.each(["3", "4", "5", "6", "7", "8", "9"])("key %s without sticky goes to CRM desk", async (k) => {
    const t = await setup();
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    const r = await E.handleInput(t.ctx(MON_11AM), s.callId, k);
    expect(r.agent?.name).toBe("Jinofer");
    expect(r.reason).toContain("no valid sticky");
  });

  it("invalid input re-prompts once, then CRM", async () => {
    const t = await setup();
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    const r1 = await E.handleInput(t.ctx(MON_11AM), s.callId, "0");
    expect(r1.action).toBe("gather");
    expect(r1.prompt).toMatch(/did not receive/);
    const r2 = await E.handleInput(t.ctx(MON_11AM), s.callId, "");
    expect(r2).toMatchObject({ action: "dial", agent: { name: "Jinofer" } });
  });

  it("extension connects to mapped agent; unknown extension re-prompts", async () => {
    const t = await setup();
    await t.store.update("team_members", t.member("Komal").id, { extension: "205" });
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    expect((await E.handleInput(t.ctx(MON_11AM), s.callId, "205")).agent?.name).toBe("Komal");
    const s2 = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    expect((await E.handleInput(t.ctx(MON_11AM), s2.callId, "999")).action).toBe("gather");
  });
});

describe("missed-call routing (key 2)", () => {
  it("routes to the latest outbound agent (Hiren calls Rahul)", async () => {
    const t = await setup();
    await E.placeOutbound(t.ctx(at(MON_11AM, -5)), { agentId: t.member("Shruti").id, to: t.phone, result: "no_answer" });
    await E.placeOutbound(t.ctx(at(MON_11AM, -1)), { agentId: t.member("Hiren").id, to: "+91 98000 00001", result: "no_answer" });
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    const r = await E.handleInput(t.ctx(MON_11AM), s.callId, "2");
    expect(r.agent?.name).toBe("Hiren");
    const done = await E.handleDialResult(t.ctx(MON_11AM), s.callId, "answered");
    expect(done.action).toBe("connected");
  });

  it("falls back to CRM when outbound agent busy / no history", async () => {
    const t = await setup();
    await E.placeOutbound(t.ctx(at(MON_11AM, -1)), { agentId: t.member("Hiren").id, to: t.phone, result: "no_answer" });
    await t.setStatus("Hiren", "busy");
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    expect((await E.handleInput(t.ctx(MON_11AM), s.callId, "2")).agent?.name).toBe("Jinofer");
    const s2 = await E.startInbound(t.ctx(MON_11AM), { from: "+919800000099" });
    expect((await E.handleInput(t.ctx(MON_11AM), s2.callId, "2")).reason).toContain("no outbound history");
  });
});

describe("sticky agent", () => {
  it("learns from a CRM transfer and offers the agent next time", async () => {
    const t = await setup();
    await seedStickyViaTransfer(t, "6", "Hiren", MON_11AM);
    const s = await E.startInbound(t.ctx(at(MON_11AM, 2)), { from: t.phone });
    const offer = await E.handleInput(t.ctx(at(MON_11AM, 2)), s.callId, "6");
    expect(offer).toMatchObject({ action: "gather_sticky", agent: { name: "Hiren" } });
    const r = await E.handleStickyChoice(t.ctx(at(MON_11AM, 2)), s.callId, "1");
    expect(r).toMatchObject({ action: "dial", agent: { name: "Hiren" } });
  });

  it("is per department", async () => {
    const t = await setup();
    await seedStickyViaTransfer(t, "6", "Hiren", MON_11AM);
    const s = await E.startInbound(t.ctx(at(MON_11AM, 1)), { from: t.phone });
    expect((await E.handleInput(t.ctx(at(MON_11AM, 1)), s.callId, "7")).action).toBe("dial"); // no sticky for Income Tax
  });

  it("declining (press 2) goes to CRM", async () => {
    const t = await setup();
    await seedStickyViaTransfer(t, "6", "Hiren", MON_11AM);
    const s = await E.startInbound(t.ctx(at(MON_11AM, 1)), { from: t.phone });
    await E.handleInput(t.ctx(at(MON_11AM, 1)), s.callId, "6");
    expect((await E.handleStickyChoice(t.ctx(at(MON_11AM, 1)), s.callId, "2")).agent?.name).toBe("Jinofer");
  });

  it("expires after three days", async () => {
    const t = await setup();
    await seedStickyViaTransfer(t, "6", "Hiren", MON_11AM);
    const later = at(MON_11AM, 72 + 1); // Thursday 12:00 IST
    const s = await E.startInbound(t.ctx(later), { from: t.phone });
    expect((await E.handleInput(t.ctx(later), s.callId, "6")).reason).toContain("no valid sticky");
    const within = at(MON_11AM, 71);
    const s2 = await E.startInbound(t.ctx(within), { from: t.phone });
    expect((await E.handleInput(t.ctx(within), s2.callId, "6")).action).toBe("gather_sticky");
  });

  it("fresh qualifying conversation resets expiry", async () => {
    const t = await setup();
    await seedStickyViaTransfer(t, "6", "Hiren", MON_11AM);
    const day2 = at(MON_11AM, 48);
    const s = await E.startInbound(t.ctx(day2), { from: t.phone });
    await E.handleInput(t.ctx(day2), s.callId, "6");
    await E.handleStickyChoice(t.ctx(day2), s.callId, "1");
    await E.handleDialResult(t.ctx(day2), s.callId, "answered");
    const day4 = at(MON_11AM, 96); // 4 days after first, 2 after fresh
    const s2 = await E.startInbound(t.ctx(day4), { from: t.phone });
    expect((await E.handleInput(t.ctx(day4), s2.callId, "6")).agent?.name).toBe("Hiren");
  });

  it("latest qualifying conversation wins", async () => {
    const t = await setup();
    await seedStickyViaTransfer(t, "6", "Hiren", MON_11AM);
    await seedStickyViaTransfer(t, "6", "Sneha", at(MON_11AM, 1));
    const s = await E.startInbound(t.ctx(at(MON_11AM, 2)), { from: t.phone });
    expect((await E.handleInput(t.ctx(at(MON_11AM, 2)), s.callId, "6")).agent?.name).toBe("Sneha");
  });

  it("CRM desk answering does not create sticky (not a department member)", async () => {
    const t = await setup();
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    await E.handleInput(t.ctx(MON_11AM), s.callId, "6");
    await E.handleDialResult(t.ctx(MON_11AM), s.callId, "answered");
    const s2 = await E.startInbound(t.ctx(at(MON_11AM, 1)), { from: t.phone });
    expect((await E.handleInput(t.ctx(at(MON_11AM, 1)), s2.callId, "6")).reason).toContain("no valid sticky");
  });

  it("busy / no-answer sticky agent falls back to CRM", async () => {
    const t = await setup();
    await seedStickyViaTransfer(t, "6", "Hiren", MON_11AM);
    const s = await E.startInbound(t.ctx(at(MON_11AM, 1)), { from: t.phone });
    await E.handleInput(t.ctx(at(MON_11AM, 1)), s.callId, "6");
    await E.handleStickyChoice(t.ctx(at(MON_11AM, 1)), s.callId, "1");
    const r = await E.handleDialResult(t.ctx(at(MON_11AM, 1)), s.callId, "no_answer");
    expect(r.agent?.name).toBe("Jinofer");

    await t.setStatus("Hiren", "busy");
    const s2 = await E.startInbound(t.ctx(at(MON_11AM, 2)), { from: t.phone });
    await E.handleInput(t.ctx(at(MON_11AM, 2)), s2.callId, "6");
    expect((await E.handleStickyChoice(t.ctx(at(MON_11AM, 2)), s2.callId, "1")).agent?.name).toBe("Jinofer");
  });
});

describe("fallbacks, after hours, transfers, state guards", () => {
  it("CRM desk unavailable -> voicemail + callback reminder", async () => {
    const t = await setup();
    await t.setStatus("Jinofer", "offline");
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    const r = await E.handleInput(t.ctx(MON_11AM), s.callId, "1");
    expect(r.action).toBe("voicemail");
    const rem = await t.store.list<Reminder>("reminders", { eq: { call_id: s.callId } });
    expect(rem).toHaveLength(1);
    await E.leaveVoicemail(t.ctx(MON_11AM), s.callId, "Please call back about GST");
    expect((await t.store.get<Call>("calls", s.callId))!.status).toBe("voicemail");
    expect((await t.store.list<Reminder>("reminders", { eq: { call_id: s.callId } }))[0].title).toContain("GST");
  });

  it("CRM desk no-answer -> voicemail", async () => {
    const t = await setup();
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    await E.handleInput(t.ctx(MON_11AM), s.callId, "1");
    expect((await E.handleDialResult(t.ctx(MON_11AM), s.callId, "busy")).action).toBe("voicemail");
  });

  it.each([
    ["Sunday 11:00 IST", "2026-11-01T05:30:00Z"],
    ["Monday 09:59 IST", "2026-11-02T04:29:00Z"],
    ["Monday 19:00 IST", "2026-11-02T13:30:00Z"],
  ])("after hours (%s) plays message and creates reminder for next opening", async (_l, iso) => {
    const t = await setup();
    const s = await E.startInbound(t.ctx(new Date(iso)), { from: t.phone });
    expect(s.action).toBe("voicemail");
    expect(s.prompt).toMatch(/office hours/);
    const [r] = await t.store.list<Reminder>("reminders", { eq: { call_id: s.callId } });
    expect(r.source).toBe("after_hours");
    expect(new Date(r.due_at).getTime()).toBeGreaterThan(new Date(iso).getTime());
    await expect(E.handleInput(t.ctx(new Date(iso)), s.callId, "1")).rejects.toMatchObject({ status: 409 });
  });

  it("Saturday 18:59 IST is within office hours", async () => {
    const t = await setup();
    expect((await E.startInbound(t.ctx(new Date("2026-11-07T13:29:00Z")), { from: t.phone })).action).toBe("gather");
  });

  it("transfer to busy agent keeps caller with current agent", async () => {
    const t = await setup();
    await t.setStatus("Hiren", "busy");
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    await E.handleInput(t.ctx(MON_11AM), s.callId, "6");
    await E.handleDialResult(t.ctx(MON_11AM), s.callId, "answered");
    const { transfer } = await E.transferCall(t.ctx(MON_11AM), { callId: s.callId, fromMemberId: null, toMemberId: t.member("Hiren").id });
    expect(transfer.status).toBe("busy");
    expect((await t.store.get<Call>("calls", s.callId))!.answered_agent_id).toBe(t.member("Jinofer").id);
  });

  it("duplicate provider callback returns same call (idempotent)", async () => {
    const t = await setup();
    const a = await E.startInbound(t.ctx(MON_11AM), { from: t.phone, providerCallId: "X1" });
    const b = await E.startInbound(t.ctx(MON_11AM), { from: t.phone, providerCallId: "X1" });
    expect(b.callId).toBe(a.callId);
    expect(await t.store.list("calls")).toHaveLength(1);
  });

  it("hangup while connected completes call with duration", async () => {
    const t = await setup();
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    await E.handleInput(t.ctx(MON_11AM), s.callId, "1");
    await E.handleDialResult(t.ctx(MON_11AM), s.callId, "answered");
    await E.hangup(t.ctx(at(MON_11AM, 0.05)), s.callId);
    const c = (await t.store.get<Call>("calls", s.callId))!;
    expect(c.status).toBe("completed");
    expect(c.duration_sec).toBe(180);
    expect((await E.hangup(t.ctx(MON_11AM), s.callId)).state).toBe("ended"); // repeat is harmless
  });
});
