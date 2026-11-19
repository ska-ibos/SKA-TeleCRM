import { describe, expect, it } from "vitest";
import * as E from "@/lib/routing/routing.engine";
import * as Flow from "@/lib/telephony/exotel.flow";
import type { TelephonyProvider } from "@/lib/telephony/provider.interface";
import type { EngineCtx } from "@/lib/routing/routing.engine";
import type { Call, Department, TeamMember } from "@/types";
import { at, MON_11AM, setup } from "../helpers";

async function setConfig(store: Awaited<ReturnType<typeof setup>>["store"], key: string, value: unknown) {
  if (await store.get("routing_config", key)) await store.update("routing_config", key, { value });
  else await store.insert("routing_config", { key, value });
}
const gst = async (t: Awaited<ReturnType<typeof setup>>) =>
  (await t.store.list<Department>("departments", { eq: { ivr_key: 6 } }))[0];

describe("CRM desk queue", () => {
  it("tries the next free desk member before voicemail", async () => {
    const t = await setup();
    await t.store.update("team_members", t.member("Komal").id, { is_crm_desk: true });
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    expect((await E.handleInput(t.ctx(MON_11AM), s.callId, "1")).agent?.name).toBe("Jinofer");
    const r = await E.handleDialResult(t.ctx(MON_11AM), s.callId, "no_answer");
    expect(r).toMatchObject({ action: "dial", agent: { name: "Komal" } });
    const v = await E.handleDialResult(t.ctx(MON_11AM), s.callId, "busy");
    expect(v.action).toBe("voicemail"); // nobody left - never rings Jinofer again
  });

  it("a missed sticky / extension agent goes to the desk and never back to the agent", async () => {
    const t = await setup();
    await t.store.update("team_members", t.member("Hiren").id, { extension: "205", is_crm_desk: true });
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    await E.handleInput(t.ctx(MON_11AM), s.callId, "205");
    const r = await E.handleDialResult(t.ctx(MON_11AM), s.callId, "no_answer");
    expect(r.agent?.name).toBe("Jinofer"); // Hiren is on the desk too, but already tried
  });
});

describe("dept_miss_behavior = ring_department_group", () => {
  it("rings the department's free members one by one, then the CRM desk", async () => {
    const t = await setup();
    await setConfig(t.store, "dept_miss_behavior", "ring_department_group");
    await t.setStatus("Sneha", "offline");
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    const r1 = await E.handleInput(t.ctx(MON_11AM), s.callId, "6"); // GST: Hiren, Komal, Rajat, Shruti (Sneha offline)
    expect(r1.agent?.name).toBe("Hiren");
    expect(r1.reason).toContain("ringing GST team");
    const names: string[] = [];
    let r = r1;
    while (r.action === "dial" && r.agent?.name !== "Jinofer") {
      names.push(r.agent!.name);
      r = await E.handleDialResult(t.ctx(MON_11AM), s.callId, "no_answer");
    }
    expect(names).toEqual(["Hiren", "Komal", "Rajat", "Shruti"]);
    expect(r.agent?.name).toBe("Jinofer");
  });

  it("an answered department-group call seeds the sticky agent", async () => {
    const t = await setup();
    await setConfig(t.store, "dept_miss_behavior", "ring_department_group");
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    await E.handleInput(t.ctx(MON_11AM), s.callId, "6");
    await E.handleDialResult(t.ctx(MON_11AM), s.callId, "answered");
    await E.hangup(t.ctx(at(MON_11AM, 0.1)), s.callId);
    const s2 = await E.startInbound(t.ctx(at(MON_11AM, 2)), { from: t.phone });
    expect(await E.handleInput(t.ctx(at(MON_11AM, 2)), s2.callId, "6")).toMatchObject({ action: "gather_sticky", agent: { name: "Hiren" } });
  });
});

describe("missed_call_window_days", () => {
  it("ignores outbound calls older than the window", async () => {
    const t = await setup();
    await setConfig(t.store, "missed_call_window_days", 7);
    await E.placeOutbound(t.ctx(at(MON_11AM, -24 * 10)), { agentId: t.member("Shruti").id, to: t.phone, result: "no_answer" });
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    expect((await E.handleInput(t.ctx(MON_11AM), s.callId, "2")).agent?.name).toBe("Jinofer");
    await E.placeOutbound(t.ctx(at(MON_11AM, -24 * 3)), { agentId: t.member("Shruti").id, to: t.phone, result: "no_answer" });
    const s2 = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    expect((await E.handleInput(t.ctx(MON_11AM), s2.callId, "2")).agent?.name).toBe("Shruti");
  });
});

describe("parallel ringing (Exotel)", () => {
  const live: TelephonyProvider = {
    name: "exotel", isSimulation: false, isConfigured: () => true,
    dialAgent: async () => ({ providerRef: null }), transfer: async () => ({ providerRef: null }),
    placeOutbound: async () => ({ providerCallId: "x" }),
  };
  it("rings the whole desk at once and records who picked up", async () => {
    const t = await setup();
    const ctx = (now: Date): EngineCtx => ({ store: t.store, provider: live, now });
    for (const [n, phone] of [["Jinofer", "+919811100001"], ["Komal", "+919811100002"], ["Rahul", "+919811100003"]] as const) {
      await t.store.update("team_members", t.member(n).id, { phone, is_crm_desk: true });
    }
    await setConfig(t.store, "parallel_ring_max", 5);
    const q = { CallSid: "CA-p1", CallFrom: "09800000001" };
    await Flow.start(ctx(MON_11AM), q);
    await Flow.input(ctx(MON_11AM), { ...q, digits: "1" });
    const c = await Flow.connect(ctx(MON_11AM), q);
    expect(c.destination.numbers).toHaveLength(3);
    expect(c.destination.numbers[0]).toBe("+919811100001");
    expect(c.parallel_ringing).toEqual({ activate: true, max_parallel_attempts: 3 });

    await Flow.end(ctx(at(MON_11AM, 0.1)), { ...q, DialCallStatus: "completed", DialCallDuration: "30", DialWhomNumber: "09811100003" });
    const [call] = await t.store.list<Call>("calls", { eq: { provider_call_id: "CA-p1" } });
    expect(call.answered_agent_id).toBe(t.member("Rahul").id);
  });

  it("a single agent (extension) is always rung alone", async () => {
    const t = await setup();
    const ctx = (now: Date): EngineCtx => ({ store: t.store, provider: live, now });
    await t.store.update("team_members", t.member("Hiren").id, { phone: "+919811100009", extension: "205" });
    await setConfig(t.store, "parallel_ring_max", 5);
    const q = { CallSid: "CA-p2", CallFrom: "09800000001" };
    await Flow.start(ctx(MON_11AM), q);
    await Flow.input(ctx(MON_11AM), { ...q, digits: "205#" });
    const c = await Flow.connect(ctx(MON_11AM), q);
    expect(c.destination.numbers).toEqual(["+919811100009"]);
    expect(c.parallel_ringing).toBeUndefined();
  });
});

describe("sticky prompt", () => {
  it("names the department and the agent, and follows the template", () => {
    expect(E.stickyPrompt("{department}: press 1 for {name}", "Hiren", "GST")).toBe("GST: press 1 for Hiren");
    expect(E.stickyPrompt(undefined, "Hiren", "GST")).toMatch(/^GST ke liye aapki pichhli baat Hiren se hui thi/);
  });
  it("is used in the sticky offer step", async () => {
    const t = await setup();
    const dept = await gst(t);
    expect(dept.name).toBe("GST");
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    await E.handleInput(t.ctx(MON_11AM), s.callId, "6");
    await E.handleDialResult(t.ctx(MON_11AM), s.callId, "answered");
    await E.transferCall(t.ctx(MON_11AM), { callId: s.callId, fromMemberId: null, toMemberId: t.member("Komal").id, result: "answered" });
    await E.hangup(t.ctx(at(MON_11AM, 0.1)), s.callId);
    const s2 = await E.startInbound(t.ctx(at(MON_11AM, 1)), { from: t.phone });
    const r = await E.handleInput(t.ctx(at(MON_11AM, 1)), s2.callId, "6");
    expect(r.prompt).toContain("GST ke liye aapki pichhli baat Komal se hui thi");
    const members = await t.store.list<TeamMember>("team_members");
    expect(members.length).toBeGreaterThan(0);
  });
});
