import { afterEach, describe, expect, it } from "vitest";
import * as E from "@/lib/routing/routing.engine";
import * as Flow from "@/lib/telephony/exotel.flow";
import { MemoryStore } from "@/lib/data/memory.store";
import { SimulationProvider } from "@/lib/telephony/simulation.provider";
import { assertWebhook, webhookUrl } from "@/lib/telephony/webhook";
import type { TelephonyProvider } from "@/lib/telephony/provider.interface";
import type { EngineCtx } from "@/lib/routing/routing.engine";
import type { Call, Reminder, TeamMember } from "@/types";
import { at, MON_11AM } from "../helpers";

/** Stand-in for Exotel: real-call semantics (isSimulation=false), no network. */
function liveProvider() {
  const placed: { to: string; agent: string }[] = [];
  const p: TelephonyProvider & { placed: typeof placed } = {
    name: "exotel", isSimulation: false, placed,
    isConfigured: () => true,
    dialAgent: async () => ({ providerRef: null }),
    transfer: async () => ({ providerRef: null }),
    placeOutbound: async ({ agent, to }) => { placed.push({ agent: agent.full_name, to }); return { providerCallId: `CA-out-${placed.length}` }; },
  };
  return p;
}

const PHONES: Record<string, string> = { Jinofer: "+919811100001", Hiren: "+919811100002", Shruti: "+919811100003" };

async function setupLive() {
  const store = new MemoryStore();
  const live = liveProvider();
  const team = await store.list<TeamMember>("team_members");
  const member = (n: string) => team.find((m) => m.full_name === n)!;
  for (const [n, phone] of Object.entries(PHONES)) await store.update("team_members", member(n).id, { phone });
  const client = await store.insert<{ id: string }>("clients", { name: "Tapovan Impex", status: "active" });
  await store.insert("client_phone_numbers", { client_id: client.id, phone: "+919909022001", label: "mobile", is_primary: true });
  const ctx = (now: Date): EngineCtx => ({ store, provider: live, now });
  let n = 0;
  const sid = () => `CA-${++n}`;
  /** Exotel's query params for one applet hit */
  const q = (CallSid: string, extra: Partial<Flow.ExotelParams> = {}): Flow.ExotelParams =>
    ({ CallSid, CallFrom: "09909022001", CallTo: "09513886363", ...extra });
  const callOf = async (s: string) => (await store.list<Call>("calls", { eq: { provider_call_id: s } }))[0];
  return { store, live, member, client, ctx, sid, q, callOf };
}

describe("Exotel call flow", () => {
  it("greets a known caller by name, routes key 1 to the CRM desk's mobile and logs who answered", async () => {
    const t = await setupLive();
    const s = t.sid();
    expect((await Flow.start(t.ctx(MON_11AM), t.q(s))).select).toBe("menu");
    const g = await Flow.gather(t.ctx(MON_11AM), t.q(s));
    expect(g.gather_prompt.text).toMatch(/^Namaste Tapovan Impex ji! Yeh call record ki ja rahi hai\. Single Key Advisory mein aapka swagat hai/);
    expect(g).toMatchObject({ finish_on_key: "#", max_input_digits: 7 });

    expect((await Flow.input(t.ctx(MON_11AM), t.q(s, { digits: '"1"' }))).select).toBe("dial");
    expect((await Flow.connect(t.ctx(MON_11AM), t.q(s))).destination.numbers).toEqual([PHONES.Jinofer]);

    const r = await Flow.end(t.ctx(at(MON_11AM, 0.1)), t.q(s, { DialCallStatus: "completed", DialCallDuration: "120", DialWhomNumber: "09811100001" }));
    expect(r.select).toBe("ended");
    const call = await t.callOf(s);
    expect(call).toMatchObject({ status: "completed", answered_agent_id: t.member("Jinofer").id, is_simulated: false, provider: "exotel" });
    expect(call.duration_sec).toBe(120);
  });

  it("learns a sticky agent from a recorded transfer and offers it by name on the next call", async () => {
    const t = await setupLive();
    const first = t.sid();
    await Flow.start(t.ctx(MON_11AM), t.q(first));
    await Flow.input(t.ctx(MON_11AM), t.q(first, { digits: '"6"' })); // GST, no sticky yet -> CRM desk
    const call = await t.callOf(first);
    await E.handleDialResult(t.ctx(MON_11AM), call.id, "answered");
    await E.transferCall(t.ctx(MON_11AM), { callId: call.id, fromMemberId: t.member("Jinofer").id, toMemberId: t.member("Hiren").id, result: "answered" });
    await Flow.end(t.ctx(at(MON_11AM, 0.2)), t.q(first));

    const next = t.sid();
    await Flow.start(t.ctx(at(MON_11AM, 24)), t.q(next));
    expect((await Flow.input(t.ctx(at(MON_11AM, 24)), t.q(next, { digits: '"6"' }))).select).toBe("sticky");
    const g = await Flow.gather(t.ctx(at(MON_11AM, 24)), t.q(next));
    expect(g.gather_prompt.text).toBe("GST ke liye aapki pichhli baat Hiren se hui thi. Hiren se baat karne ke liye 1 dabaiye, nahi toh 2 dabaiye.");
    expect(g.max_input_digits).toBe(1);
    expect((await Flow.input(t.ctx(at(MON_11AM, 24)), t.q(next, { digits: '"1"' }))).select).toBe("dial");
    expect((await Flow.connect(t.ctx(at(MON_11AM, 24)), t.q(next))).destination.numbers).toEqual([PHONES.Hiren]);
  });

  it("falls back from a missed agent to the CRM desk, then to voicemail with a callback reminder and the recording", async () => {
    const t = await setupLive();
    await t.store.update("team_members", t.member("Hiren").id, { extension: "205" });
    const s = t.sid();
    await Flow.start(t.ctx(MON_11AM), t.q(s));
    expect((await Flow.input(t.ctx(MON_11AM), t.q(s, { digits: '"205#"' }))).select).toBe("dial");
    expect(await Flow.prompt(t.ctx(MON_11AM), t.q(s))).toContain("extension 2 0 5");
    expect((await Flow.connect(t.ctx(MON_11AM), t.q(s))).destination.numbers).toEqual([PHONES.Hiren]);

    // Hiren does not pick up -> Exotel re-fetches -> CRM desk
    const c2 = await Flow.connect(t.ctx(MON_11AM), t.q(s, { DialCallStatus: "no-answer", DialWhomNumber: "09811100002" }));
    expect(c2.destination.numbers).toEqual([PHONES.Jinofer]);
    // CRM desk busy too -> same number again, so Exotel stops and takes "nobody answered" -> Voicemail
    const c3 = await Flow.connect(t.ctx(MON_11AM), t.q(s, { DialCallStatus: "busy", DialWhomNumber: "09811100001" }));
    expect(c3.destination.numbers).toEqual([PHONES.Jinofer]);
    expect(await Flow.prompt(t.ctx(MON_11AM), t.q(s))).toMatch(/team vyast hai/);

    await Flow.voicemail(t.ctx(MON_11AM), t.q(s, { RecordingUrl: "https://recordings.exotel.com/vm1.mp3" }));
    const call = await t.callOf(s);
    expect(call.status).toBe("voicemail");
    expect(await t.store.list<Reminder>("reminders", { eq: { call_id: call.id } })).toHaveLength(1);
    expect(await t.store.list("recordings", { eq: { call_id: call.id } })).toMatchObject([{ kind: "voicemail", provider_url: "https://recordings.exotel.com/vm1.mp3" }]);
  });

  it("skips agents without a mobile number on live calls", async () => {
    const t = await setupLive();
    await t.store.update("team_members", t.member("Komal").id, { extension: "301" }); // Komal has no phone
    const s = t.sid();
    await Flow.start(t.ctx(MON_11AM), t.q(s));
    const r = await Flow.input(t.ctx(MON_11AM), t.q(s, { digits: "301" }));
    expect(r.step.agent?.name).toBe("Jinofer");
    expect(r.step.reason).toContain("Komal has no phone number");
  });

  it("after hours goes straight to the voicemail branch", async () => {
    const t = await setupLive();
    const s = t.sid();
    const sunday = new Date("2026-11-08T05:30:00Z");
    expect((await Flow.start(t.ctx(sunday), t.q(s))).select).toBe("voicemail");
    expect(await Flow.prompt(t.ctx(sunday), t.q(s))).toMatch(/Somvaar se Shanivaar/);
  });

  it("duplicate or late callbacks replay instead of failing the call", async () => {
    const t = await setupLive();
    const s = t.sid();
    // Gather reached before the start passthru: the call is registered there
    await Flow.gather(t.ctx(MON_11AM), t.q(s));
    expect(await t.store.list("calls")).toHaveLength(1);
    expect((await Flow.input(t.ctx(MON_11AM), t.q(s, { digits: "1" }))).select).toBe("dial");
    expect((await Flow.input(t.ctx(MON_11AM), t.q(s, { digits: "1" }))).select).toBe("dial");
    await Flow.end(t.ctx(MON_11AM), t.q(s, { DialCallStatus: "completed", DialCallDuration: "5" }));
    await Flow.end(t.ctx(MON_11AM), t.q(s, { DialCallStatus: "completed", DialCallDuration: "5" }));
    expect((await t.callOf(s)).status).toBe("completed");
  });

  it("re-prompts after an invalid key without repeating the welcome", async () => {
    const t = await setupLive();
    const s = t.sid();
    await Flow.start(t.ctx(MON_11AM), t.q(s));
    expect((await Flow.input(t.ctx(MON_11AM), t.q(s, { digits: '"0"' }))).select).toBe("menu");
    const g = await Flow.gather(t.ctx(MON_11AM), t.q(s));
    expect(g.gather_prompt.text).toMatch(/^Maaf kijiye, humein sahi input nahi mila/);
    expect(g.gather_prompt.text).not.toContain("Namaste");
  });
});

describe("Exotel click-to-call status callbacks", () => {
  it("answered + terminal events close the call with talk time and feed key 2", async () => {
    const t = await setupLive();
    const call = await E.placeOutbound(t.ctx(MON_11AM), { agentId: t.member("Shruti").id, to: "99090 22001" });
    expect(call).toMatchObject({ status: "connecting", provider_call_id: "CA-out-1", is_simulated: false });
    expect(t.live.placed).toEqual([{ agent: "Shruti", to: "+919909022001" }]);

    await Flow.outboundStatus(t.ctx(at(MON_11AM, 0.01)), { CallSid: "CA-out-1", EventType: "answered", Status: "in-progress", CustomField: call.id });
    const done = await Flow.outboundStatus(t.ctx(at(MON_11AM, 0.02)), {
      CallSid: "CA-out-1", EventType: "terminal", Status: "completed", ConversationDuration: "30", CustomField: call.id,
      RecordingUrl: "https://recordings.exotel.com/out1.mp3",
    });
    expect(done.status).toBe("completed");
    expect(done.duration_sec).toBeGreaterThan(0);

    // client calls back and presses 2 -> Shruti
    const s = t.sid();
    await Flow.start(t.ctx(at(MON_11AM, 2)), t.q(s));
    await Flow.input(t.ctx(at(MON_11AM, 2)), t.q(s, { digits: "2" }));
    expect((await Flow.connect(t.ctx(at(MON_11AM, 2)), t.q(s))).destination.numbers).toEqual([PHONES.Shruti]);
  });

  it("a missed outbound call is closed as no_answer", async () => {
    const t = await setupLive();
    const call = await E.placeOutbound(t.ctx(MON_11AM), { agentId: t.member("Hiren").id, to: "+919909022001" });
    const done = await Flow.outboundStatus(t.ctx(MON_11AM), { CallSid: "CA-out-1", Status: "no-answer", EventType: "terminal" });
    expect(done).toMatchObject({ id: call.id, status: "no_answer" });
    expect(done.ended_at).not.toBeNull();
    expect(done.answered_at ?? null).toBeNull();
  });

  it("refuses to call when the agent has no mobile number", async () => {
    const t = await setupLive();
    await expect(E.placeOutbound(t.ctx(MON_11AM), { agentId: t.member("Komal").id, to: "+919909022001" })).rejects.toThrow(/mobile number for Komal/);
  });

  it("a provider error leaves the call closed as failed", async () => {
    const t = await setupLive();
    t.live.placeOutbound = async () => { throw new Error("Your account is not yet KYC compliant"); };
    await expect(E.placeOutbound(t.ctx(MON_11AM), { agentId: t.member("Hiren").id, to: "+919909022001" })).rejects.toThrow(/KYC/);
    const [call] = await t.store.list<Call>("calls");
    expect(call).toMatchObject({ status: "failed" });
    expect(call.ended_at).not.toBeNull();
  });
});

describe("simulator on the live database", () => {
  it("simulated history never sets a real caller's sticky or missed-call agent", async () => {
    const t = await setupLive();
    const sim = new SimulationProvider();
    const simCtx = (now: Date): EngineCtx => ({ store: t.store, provider: sim, now });
    // simulated: Hiren calls the client, and Hiren answers a simulated GST call
    await E.placeOutbound(simCtx(MON_11AM), { agentId: t.member("Hiren").id, to: "+919909022001", result: "no_answer" });
    const st = await E.startInbound(simCtx(MON_11AM), { from: "+919909022001" });
    await E.handleInput(simCtx(MON_11AM), st.callId, "6");
    await E.handleDialResult(simCtx(MON_11AM), st.callId, "answered");
    await E.transferCall(simCtx(MON_11AM), { callId: st.callId, fromMemberId: null, toMemberId: t.member("Hiren").id, result: "answered" });

    // real call: neither key 2 nor key 6 may use the simulated history
    const s1 = t.sid();
    await Flow.start(t.ctx(at(MON_11AM, 1)), t.q(s1));
    expect((await Flow.input(t.ctx(at(MON_11AM, 1)), t.q(s1, { digits: "2" }))).step.agent?.name).toBe("Jinofer");
    const s2 = t.sid();
    await Flow.start(t.ctx(at(MON_11AM, 1)), t.q(s2));
    expect((await Flow.input(t.ctx(at(MON_11AM, 1)), t.q(s2, { digits: "6" }))).select).toBe("dial"); // no sticky offer
  });
});

describe("webhook authentication", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it("accepts the token in the URL, rejects a wrong one, and refuses when no secret is configured", () => {
    process.env.TELEPHONY_WEBHOOK_SECRET = "s3cret-value";
    expect(() => assertWebhook(new Request("https://app.test/api/exotel/flow/start?token=s3cret-value"))).not.toThrow();
    expect(() => assertWebhook(new Request("https://app.test/api/exotel/flow/start?token=nope"))).toThrow(/authentication failed/);
    expect(() => assertWebhook(new Request("https://app.test/x", { headers: { "x-webhook-secret": "s3cret-value" } }))).not.toThrow();
    delete process.env.TELEPHONY_WEBHOOK_SECRET;
    expect(() => assertWebhook(new Request("https://app.test/x?token=s3cret-value"))).toThrow(/not set/);
  });

  it("builds callback URLs only for an https base", () => {
    process.env.TELEPHONY_WEBHOOK_SECRET = "a b";
    process.env.APP_BASE_URL = "https://telecrm.example.com/";
    expect(webhookUrl("/api/exotel/status")).toBe("https://telecrm.example.com/api/exotel/status?token=a%20b");
    process.env.APP_BASE_URL = "http://insecure.example.com";
    expect(() => webhookUrl("/api/exotel/status")).toThrow(/https/);
  });
});

describe("Exotel parameters", () => {
  it("uses the answered leg's talk time, not the ring-inclusive dial duration", () => {
    const legs = { DialCallDuration: "50", "Legs[0][OnCallDuration]": "0", "Legs[1][OnCallDuration]": "41" } as Flow.ExotelParams;
    expect(Flow.talkSeconds(legs)).toBe(41);
    expect(Flow.talkSeconds({ DialCallDuration: "50" })).toBe(50);
    expect(Flow.talkSeconds({})).toBe(0);
  });

  it("strips Exotel's quotes and the # key from digits", () => {
    expect(Flow.cleanDigits('"6"')).toBe("6");
    expect(Flow.cleanDigits('"205#"')).toBe("205");
    expect(Flow.cleanDigits(undefined)).toBe("");
  });
});
