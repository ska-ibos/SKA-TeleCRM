import { describe, expect, it } from "vitest";
import * as E from "@/lib/routing/routing.engine";
import { loadRoutingConfig } from "@/lib/routing/department.service";
import { clientContacts, getClientDetail } from "@/lib/services/client.service";
import { listCalls } from "@/lib/services/call.service";
import { routingConfigSchema } from "@/lib/validations";
import { DEFAULT_CONNECTING_PROMPT, DEFAULT_ROUTING_CONFIG } from "@/lib/constants";
import { at, MON_11AM, setup } from "../helpers";
import type { Department, TeamMember } from "@/types";

describe("connecting announcement", () => {
  it("fills name and extension, spelled out digit by digit", () => {
    expect(E.connectingPrompt(DEFAULT_CONNECTING_PROMPT, { full_name: "Prachi", extension: "13" }))
      .toBe("Aapko Prachi se connect kiya ja raha hai. Agli baar seedha Prachi se baat karne ke liye extension 1 3 ke baad hash dabaiye.");
  });
  it("says nothing for agents without an extension", () => {
    expect(E.connectingPrompt(DEFAULT_CONNECTING_PROMPT, { full_name: "Prachi", extension: null })).toBeUndefined();
    expect(E.connectingPrompt(DEFAULT_CONNECTING_PROMPT, null)).toBeUndefined();
  });

  it("is played when the CRM desk is rung, with the extension in the step and trail", async () => {
    const t = await setup();
    await t.store.update("team_members", t.member("Jinofer").id, { extension: "14" });
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    const r = await E.handleInput(t.ctx(MON_11AM), s.callId, "1");
    expect(r).toMatchObject({ action: "dial", agent: { name: "Jinofer", extension: "14" } });
    expect(r.prompt).toContain("extension 1 4");
    expect(r.trail.at(-1)).toContain("caller told extension 14");
  });

  it("is played for extension and sticky connections, not for agents without one", async () => {
    const t = await setup();
    await t.store.update("team_members", t.member("Komal").id, { extension: "205" });
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    expect((await E.handleInput(t.ctx(MON_11AM), s.callId, "205")).prompt).toContain("Aapko Komal se connect");
    const s2 = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    const r2 = await E.handleInput(t.ctx(MON_11AM), s2.callId, "1"); // Jinofer has no extension here
    expect(r2.action).toBe("dial");
    expect(r2.prompt).toBeUndefined();
  });

  it("uses an edited template from settings", async () => {
    const t = await setup();
    await t.store.update("team_members", t.member("Jinofer").id, { extension: "14" });
    await t.store.insert("routing_config", { key: "prompts", value: { ...DEFAULT_ROUTING_CONFIG.prompts, connecting: "{name} ka extension {extension} hai." } });
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    expect((await E.handleInput(t.ctx(MON_11AM), s.callId, "1")).prompt).toBe("Jinofer ka extension 1 4 hai.");
  });
});

describe("routing settings", () => {
  it("prompts saved before the announcement existed still get the default", async () => {
    const t = await setup();
    const { connecting: _c, ...old } = DEFAULT_ROUTING_CONFIG.prompts;
    await t.store.insert("routing_config", { key: "prompts", value: { ...old, greeting: "Custom greeting for testing" } });
    const cfg = await loadRoutingConfig(t.store);
    expect(cfg.prompts.greeting).toBe("Custom greeting for testing");
    expect(cfg.prompts.connecting).toBe(DEFAULT_CONNECTING_PROMPT);
  });
  it("validates the announcement template", () => {
    const withPrompt = (connecting: string) => routingConfigSchema.safeParse({ ...DEFAULT_ROUTING_CONFIG, prompts: { ...DEFAULT_ROUTING_CONFIG.prompts, connecting } }).success;
    expect(withPrompt("Dial {extension} to reach {name} directly.")).toBe(true);
    expect(withPrompt("Connecting you to {name} now.")).toBe(false); // no {extension}
    expect(withPrompt("Dial {extension} for {agent} directly.")).toBe(false); // unknown placeholder
    const { connecting: _c, ...old } = DEFAULT_ROUTING_CONFIG.prompts;
    expect(routingConfigSchema.parse({ ...DEFAULT_ROUTING_CONFIG, prompts: old }).prompts.connecting).toBe(DEFAULT_CONNECTING_PROMPT);
  });
});

describe("extensions on call and client screens", () => {
  it("call lists carry the agent's extension", async () => {
    const t = await setup();
    await t.store.update("team_members", t.member("Shruti").id, { extension: "21" });
    await E.placeOutbound(t.ctx(MON_11AM), { agentId: t.member("Shruti").id, to: t.phone, result: "answered" });
    const [row] = await listCalls(t.store);
    expect(row).toMatchObject({ agent_name: "Shruti", agent_extension: "21", initiated_by_extension: "21" });
  });

  it("client page lists the people they dealt with, newest first, with extensions", async () => {
    const t = await setup();
    await t.store.update("team_members", t.member("Shruti").id, { extension: "21" });
    // Shruti calls the client (unanswered), then Jinofer answers a GST call from them
    await E.placeOutbound(t.ctx(at(MON_11AM, -2)), { agentId: t.member("Shruti").id, to: t.phone, result: "no_answer" });
    const s = await E.startInbound(t.ctx(MON_11AM), { from: t.phone });
    await E.handleInput(t.ctx(MON_11AM), s.callId, "6");
    await E.handleDialResult(t.ctx(MON_11AM), s.callId, "answered");
    const d = await getClientDetail(t.store, t.client.id);
    expect(d.contacts.map((c) => [c.name, c.extension, c.last_direction])).toEqual([["Jinofer", null, "inbound"], ["Shruti", "21", "outbound"]]);
    expect(d.contacts[0].departments).toEqual(["GST"]);
    expect(d.calls.find((c) => c.direction === "outbound")?.agent_extension).toBe("21");
  });

  it("ignores missed inbound calls and inactive members", async () => {
    const t = await setup();
    const team = await t.store.list<TeamMember>("team_members");
    const depts = await t.store.list<Department>("departments");
    const m = team[0];
    const base = { client_id: t.client.id, started_at: MON_11AM.toISOString() } as const;
    const calls = [
      { ...base, id: "a", direction: "inbound", answered_agent_id: null, routed_agent_id: m.id, initiated_by: null, department_id: null, answered_at: null },
      { ...base, id: "b", direction: "outbound", answered_agent_id: null, routed_agent_id: team[1].id, initiated_by: team[1].id, department_id: null, answered_at: null },
    ] as never[];
    expect(clientContacts(calls, team, depts).map((c) => c.id)).toEqual([team[1].id]);
    expect(clientContacts(calls, team.map((x) => ({ ...x, is_active: false })), depts)).toEqual([]);
  });
});
