import type { Call, CallSession, Client, DialResult, RouteStep, TeamMember } from "@/types";
import { AppError, isConflict } from "../data/types";
import { normalizePhone } from "../utils/phone";
import { loadRoutingConfig } from "../routing/department.service";
import * as Engine from "../routing/routing.engine";
import type { EngineCtx } from "../routing/routing.engine";

/**
 * Exotel call-flow steps (App Bazaar), each answered from the routing engine.
 * The flow to build in Exotel is documented in docs/exotel-integration.md:
 *
 *   Passthru  start   -> Switchcase  {"select": "menu" | "voicemail"}
 *   Gather    gather  -> menu prompt (or sticky sub-prompt), digits collected by Exotel
 *   Passthru  input   -> Switchcase  {"select": "menu" | "sticky" | "dial" | "voicemail"}
 *   Greeting  prompt  -> "Connecting you to Hiren, extension 1 3" / voicemail / after-hours text
 *   Connect   connect -> {"destination": {"numbers": ["+91..."]}, ...} (re-fetched after a failed ring)
 *   Passthru  end     -> after the conversation: who answered + duration (seeds the sticky agent)
 *   Passthru  voicemail -> after the Voicemail applet: recording + callback reminder
 *
 * Exotel retries and parallel callbacks are safe: every step re-reads the call's state and,
 * when the state already moved on (409 from the engine), answers from the current state
 * instead of failing the call.
 */

/** Switchcase keywords. Create one case per keyword in the Exotel Switchcase applet. */
export type Select = "menu" | "sticky" | "dial" | "voicemail" | "ended";

/** Query/form parameters Exotel sends to applet URLs (names as documented by Exotel). */
export interface ExotelParams {
  CallSid?: string; From?: string; CallFrom?: string; To?: string; CallTo?: string;
  digits?: string; DialCallStatus?: string; DialWhomNumber?: string; DialCallDuration?: string;
  RecordingUrl?: string; CustomField?: string;
}

export function readParams(source: URLSearchParams): ExotelParams {
  const out: Record<string, string> = {};
  for (const [k, v] of source) if (v != null && out[k] === undefined) out[k] = v;
  return out as ExotelParams;
}

/**
 * Talk time of the answered leg. Exotel's DialCallDuration includes ringing, so prefer the
 * last leg's OnCallDuration (sent as Legs[i][OnCallDuration]) when present.
 */
export function talkSeconds(p: ExotelParams): number {
  const legs = Object.entries(p as Record<string, string>)
    .map(([k, v]) => [/^Legs\[(\d+)\]\[OnCallDuration\]$/.exec(k)?.[1], v] as const)
    .filter(([i]) => i !== undefined)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  const last = legs.length ? Number(legs[legs.length - 1][1]) : NaN;
  const secs = Number.isFinite(last) ? last : Number(p.DialCallDuration);
  return Number.isFinite(secs) && secs > 0 ? Math.round(secs) : 0;
}

/** Exotel wraps Gather digits in double quotes ("\"6\""); keep digits only. */
export const cleanDigits = (raw: string | undefined) => (raw ?? "").replace(/[^0-9]/g, "");

/** Gather settings (Exotel's documented defaults are used for anything not set). */
export const GATHER = {
  /** extensions are 2-6 digits followed by #; a single menu key ends after this pause */
  inputTimeoutSec: 4,
  maxDigits: 7, // 6-digit extension + "#" margin
  repeatMenu: 1,
} as const;

const DIAL_FAILURES: Record<string, DialResult> = { busy: "busy", "no-answer": "no_answer", failed: "failed", canceled: "no_answer" };

async function findCall(ctx: EngineCtx, sid: string): Promise<Call | null> {
  const [call] = await ctx.store.list<Call>("calls", { eq: { provider: ctx.provider.name, provider_call_id: sid }, limit: 1 });
  return call ?? null;
}
async function sessionOf(ctx: EngineCtx, callId: string): Promise<CallSession | null> {
  const [s] = await ctx.store.list<CallSession>("call_sessions", { eq: { call_id: callId }, limit: 1 });
  return s ?? null;
}
const requireSid = (p: ExotelParams) => {
  if (!p.CallSid) throw new AppError(400, "bad_request", "CallSid is missing");
  return p.CallSid;
};

/** The call for this CallSid, registering it if Exotel reached a later applet first (start passthru skipped/failed). */
async function ensureCall(ctx: EngineCtx, p: ExotelParams): Promise<Call> {
  const sid = requireSid(p);
  const existing = await findCall(ctx, sid);
  if (existing) return existing;
  const from = p.CallFrom ?? p.From;
  if (!from) throw new AppError(400, "bad_request", "Caller number (CallFrom/From) is missing");
  const step = await Engine.startInbound(ctx, { from, providerCallId: sid });
  return (await ctx.store.get<Call>("calls", step.callId))!;
}

/** Run an engine transition; if a duplicate/racing callback already moved the call on, answer from the current state. */
async function transition(ctx: EngineCtx, callId: string, fn: () => Promise<RouteStep>): Promise<RouteStep> {
  try {
    return await fn();
  } catch (e) {
    if (isConflict(e)) return Engine.currentStep(ctx, callId);
    throw e;
  }
}

export function selectFor(step: Pick<RouteStep, "state">): Select {
  switch (step.state) {
    case "greeting": return "menu";
    case "sticky_offer": return "sticky";
    case "dialing": case "connected": return "dial";
    case "voicemail": return "voicemail";
    default: return "ended";
  }
}

/* ------------------------------------------------------------------ */

/** Passthru at the top of the flow: registers the call; after hours goes straight to voicemail. */
export async function start(ctx: EngineCtx, p: ExotelParams): Promise<{ select: Select; step: RouteStep }> {
  const call = await ensureCall(ctx, p);
  const step = await Engine.currentStep(ctx, call.id);
  return { select: selectFor(step), step };
}

export interface GatherResponse {
  gather_prompt: { text: string };
  max_input_digits: number;
  finish_on_key: string;
  input_timeout: number;
  repeat_menu: number;
  repeat_gather_prompt: { text: string };
}

/** Gather applet (dynamic URL): the main menu, or the sticky sub-menu when one was offered. */
export async function gather(ctx: EngineCtx, p: ExotelParams): Promise<GatherResponse> {
  const call = await ensureCall(ctx, p);
  const session = await sessionOf(ctx, call.id);
  const step = await Engine.currentStep(ctx, call.id);
  const cfg = await loadRoutingConfig(ctx.store);
  if (session?.state === "sticky_offer") {
    const text = step.prompt ?? "Press 1 to connect to the person who assisted you, or press 2 for the CRM desk.";
    return { gather_prompt: { text }, max_input_digits: 1, finish_on_key: "", input_timeout: 6, repeat_menu: GATHER.repeatMenu, repeat_gather_prompt: { text } };
  }
  const menu = cfg.prompts.greeting;
  let text: string;
  if (session && session.attempts > 0) {
    text = `${cfg.prompts.reprompt} ${menu}`; // after an invalid key: no welcome / recording notice again
  } else {
    const client = call.client_id ? await ctx.store.get<Client>("clients", call.client_id) : null;
    const welcome = client && cfg.prompts.known_caller ? cfg.prompts.known_caller.replaceAll("{name}", client.name) : "";
    text = [welcome, cfg.prompts.recording_notice, menu].map((s) => s?.trim()).filter(Boolean).join(" ");
  }
  return {
    gather_prompt: { text },
    max_input_digits: GATHER.maxDigits, finish_on_key: "#", input_timeout: GATHER.inputTimeoutSec,
    repeat_menu: GATHER.repeatMenu, repeat_gather_prompt: { text: `${cfg.prompts.reprompt} ${menu}` },
  };
}

/** Passthru after each Gather: apply the keypress (menu key / extension / sticky choice). */
export async function input(ctx: EngineCtx, p: ExotelParams): Promise<{ select: Select; step: RouteStep }> {
  const call = await ensureCall(ctx, p);
  const session = await sessionOf(ctx, call.id);
  const digits = cleanDigits(p.digits);
  let step: RouteStep;
  if (session?.state === "greeting") step = await transition(ctx, call.id, () => Engine.handleInput(ctx, call.id, digits));
  else if (session?.state === "sticky_offer") step = await transition(ctx, call.id, () => Engine.handleStickyChoice(ctx, call.id, digits.slice(0, 1)));
  else step = await Engine.currentStep(ctx, call.id); // duplicate passthru: replay
  return { select: selectFor(step), step };
}

/** Greeting applet (dynamic text): what to say before ringing, before voicemail, or after hours. */
export async function prompt(ctx: EngineCtx, p: ExotelParams): Promise<string> {
  const call = await findCall(ctx, requireSid(p));
  if (!call) return "Please hold while we connect your call.";
  const step = await Engine.currentStep(ctx, call.id);
  if (step.state === "dialing") return step.prompt || "Please hold while we connect your call.";
  if (step.state === "voicemail") return step.prompt || "Please leave a message after the tone and we will call you back.";
  return "Please hold.";
}

export interface ConnectResponse {
  fetch_after_attempt: boolean;
  destination: { numbers: string[] };
  record: boolean;
  recording_channels: "single" | "dual";
  max_ringing_duration: number;
  max_conversation_duration: number;
  parallel_ringing?: { activate: boolean; max_parallel_attempts: number };
}

/** The members rung in this attempt (target first; more than one only with parallel ringing). */
async function currentGroup(ctx: EngineCtx, callId: string): Promise<TeamMember[]> {
  const cfg = await loadRoutingConfig(ctx.store);
  return (await Engine.ringGroup(ctx, callId, cfg.parallel_ring_max)).filter((m) => m.phone);
}

/**
 * Connect applet (dynamic URL). First fetch: the target agent's mobile. With
 * fetch_after_attempt=true Exotel fetches again after a failed ring (DialCallStatus =
 * busy / no-answer / failed / canceled): the engine falls back to the CRM desk and we return
 * that number. When the engine ends in voicemail we return the SAME number again - Exotel
 * stops when two fetches return identical numbers and takes the "nobody answered" path - or
 * an empty list on the first fetch ("we didn't dial anyone"). Wire both paths to voicemail.
 */
export async function connect(ctx: EngineCtx, p: ExotelParams): Promise<ConnectResponse> {
  const call = await ensureCall(ctx, p);
  const failure = p.DialCallStatus ? DIAL_FAILURES[p.DialCallStatus] : undefined;
  let session = await sessionOf(ctx, call.id);
  if (failure && session?.state === "dialing") {
    const rung = (await currentGroup(ctx, call.id)).map((m) => m.id); // everyone rung last time failed
    await transition(ctx, call.id, () => Engine.handleDialResult(ctx, call.id, failure, { rung }));
    session = await sessionOf(ctx, call.id);
  }
  let numbers: string[] = [];
  if (session?.state === "dialing") {
    numbers = (await currentGroup(ctx, call.id)).map((m) => m.phone!);
  } else if (session?.state === "connected") {
    const agent = session.target_agent_id ? await ctx.store.get<TeamMember>("team_members", session.target_agent_id) : null;
    if (agent?.phone) numbers = [agent.phone];
  } else if (p.DialWhomNumber) {
    const last = normalizePhone(p.DialWhomNumber);
    if (last) numbers = [last]; // same as the previous fetch -> Exotel stops trying
  }
  return {
    fetch_after_attempt: true,
    destination: { numbers },
    record: true, recording_channels: "dual",
    max_ringing_duration: 30, max_conversation_duration: 3600,
    ...(numbers.length > 1 && { parallel_ringing: { activate: true, max_parallel_attempts: numbers.length } }),
  };
}

/**
 * Passthru after the conversation ends ("After the call conversation ends" transition).
 * The answered agent becomes the sticky agent through the normal engine path.
 */
export async function end(ctx: EngineCtx, p: ExotelParams): Promise<{ select: Select; step: RouteStep }> {
  const call = await findCall(ctx, requireSid(p));
  if (!call) throw new AppError(404, "not_found", "Call not found");
  const session = await sessionOf(ctx, call.id);
  if (session?.state === "dialing" && p.DialCallStatus === "completed") {
    const talk = talkSeconds(p);
    const answeredAt = new Date(Math.max(new Date(call.started_at).getTime(), ctx.now.getTime() - talk * 1000));
    // with parallel ringing, DialWhomNumber tells who actually picked up
    const whom = normalizePhone(p.DialWhomNumber);
    const answeredBy = whom ? (await currentGroup(ctx, call.id)).find((m) => m.phone === whom)?.id ?? null : null;
    await transition(ctx, call.id, () => Engine.handleDialResult({ ...ctx, now: answeredAt }, call.id, "answered", { answeredBy }));
  }
  const step = await transition(ctx, call.id, () => Engine.hangup(ctx, call.id));
  await saveRecording(ctx, call.id, p.RecordingUrl, "call");
  return { select: "ended", step };
}

/** Passthru after the Voicemail applet: callback reminder + the recording link. */
export async function voicemail(ctx: EngineCtx, p: ExotelParams): Promise<{ select: Select; step: RouteStep }> {
  const call = await findCall(ctx, requireSid(p));
  if (!call) throw new AppError(404, "not_found", "Call not found");
  const session = await sessionOf(ctx, call.id);
  let step: RouteStep;
  if (session?.state === "voicemail") step = await transition(ctx, call.id, () => Engine.leaveVoicemail(ctx, call.id, null));
  else step = await transition(ctx, call.id, () => Engine.hangup(ctx, call.id));
  await saveRecording(ctx, call.id, p.RecordingUrl, "voicemail");
  return { select: "ended", step };
}

/** Store an Exotel recording link once per (call, url). Only https links are kept. */
export async function saveRecording(ctx: EngineCtx, callId: string, url: string | undefined, kind: "call" | "voicemail") {
  if (!url || !/^https:\/\//.test(url)) return;
  const existing = await ctx.store.list<{ provider_url: string }>("recordings", { eq: { call_id: callId } });
  if (existing.some((r) => r.provider_url === url)) return;
  try {
    await ctx.store.insert("recordings", { call_id: callId, provider_url: url.slice(0, 2000), kind });
  } catch (e) {
    if (!isConflict(e)) throw e; // a parallel callback stored it first
  }
}

/* ---------------- outbound click-to-call status callback ---------------- */

/** StatusCallback body (JSON or form) for calls placed with Calls/connect. */
export interface ExotelStatus {
  CallSid?: string; Status?: string; EventType?: string; ConversationDuration?: string | number;
  RecordingUrl?: string; CustomField?: string; DateUpdated?: string;
}

const OUT_FAILURES: Record<string, DialResult> = { busy: "busy", "no-answer": "no_answer", failed: "failed", canceled: "no_answer" };

/**
 * `answered` event -> the client picked up (the agent leg is dialled first).
 * `terminal` event -> close the call; `completed` with talk time counts as answered.
 * Matched by CustomField (our call id, known before Exotel's Sid is saved) or by CallSid.
 */
export async function outboundStatus(ctx: EngineCtx, b: ExotelStatus): Promise<Call> {
  let call = b.CustomField ? await ctx.store.get<Call>("calls", b.CustomField).catch(() => null) : null;
  if (call && b.CallSid && call.provider_call_id && call.provider_call_id !== b.CallSid) call = null;
  if (!call && b.CallSid) call = await findCall(ctx, b.CallSid);
  if (!call || call.direction !== "outbound") throw new AppError(404, "not_found", "Outbound call not found");

  const status = (b.Status ?? "").toLowerCase();
  const event = (b.EventType ?? "terminal").toLowerCase();
  const talk = Math.max(0, Number(b.ConversationDuration) || 0);
  if (event === "answered") {
    call = await Engine.completeOutbound(ctx, call.id, "answered");
  } else {
    if (status === "completed" && talk > 0) {
      const answeredAt = new Date(Math.max(new Date(call.started_at).getTime(), ctx.now.getTime() - talk * 1000));
      await Engine.completeOutbound({ ...ctx, now: answeredAt }, call.id, "answered");
    } else {
      await Engine.completeOutbound(ctx, call.id, OUT_FAILURES[status] ?? "no_answer");
    }
    call = await Engine.endOutbound(ctx, call.id);
  }
  await saveRecording(ctx, call.id, b.RecordingUrl, "call");
  return call;
}
