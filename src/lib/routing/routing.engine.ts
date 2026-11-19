import type { Store } from "../data/types";
import { AppError, badRequest, conflict, isConflict, isStaleWrite, notFound } from "../data/types";
import type { Call, CallSession, CallTransfer, DialResult, RouteStep, SessionState, TeamMember } from "@/types";
import type { TelephonyProvider } from "../telephony/provider.interface";
import { normalizePhone } from "../utils/phone";
import { isWithinOfficeHours } from "../utils/date";
import { DEFAULT_CONNECTING_PROMPT, OPERATIONS_LINE } from "../constants";
import { getDepartmentByKey, isDepartmentMember, loadRoutingConfig } from "./department.service";
import { findAgentByExtension, looksLikeExtension } from "./extension.service";
import { findStickyAgent } from "./sticky-agent.service";
import { findLatestOutboundAgent } from "./missed-call.service";
import { createCallbackReminder, pickCrmDesk } from "./fallback.service";
import { findClientByPhone, identifyCaller } from "../services/client.service";

/**
 * Operations IVR routing engine. Shared by the simulator and real telephony webhooks:
 * the provider only rings phones; every routing decision is made here from CRM data.
 */
export interface EngineCtx { store: Store; provider: TelephonyProvider; now: Date }

interface Loaded { call: Call; session: CallSession }

async function load(ctx: EngineCtx, callId: string): Promise<Loaded> {
  const call = await ctx.store.get<Call>("calls", callId);
  if (!call) throw notFound("Call");
  const [session] = await ctx.store.list<CallSession>("call_sessions", { eq: { call_id: callId } });
  if (!session) throw notFound("Call session");
  return { call, session };
}

function expect(s: CallSession, ...states: SessionState[]) {
  if (!states.includes(s.state)) {
    throw new AppError(409, "invalid_state", `This action is not allowed while the call is in "${s.state}" state`);
  }
}

/**
 * Apply one state transition. The session row is claimed FIRST with compare-and-set on
 * `version`: if another webhook for the same call moved the state machine since we read
 * it, this transition is rejected (409 concurrent_update) and nothing is written - the
 * provider retries against the new state. Only the winner then updates the call row.
 */
async function save(ctx: EngineCtx, l: Loaded, call: Partial<Call>, session: Partial<CallSession>, trail?: string) {
  const context = { ...l.session.context, ...(session.context ?? {}) };
  if (trail) context.trail = [...(l.session.context.trail ?? []), trail].slice(-100);
  try {
    l.session = await ctx.store.update<CallSession>("call_sessions", l.session.id, { ...session, context },
      { expect: { version: l.session.version } });
  } catch (e) {
    if (isStaleWrite(e)) throw new AppError(409, "concurrent_update", "This call was updated by another event at the same time. Please retry.");
    throw e;
  }
  if (Object.keys(call).length) l.call = await ctx.store.update<Call>("calls", l.call.id, call);
}

async function agentOf(ctx: EngineCtx, id: string | null) {
  return id ? ctx.store.get<TeamMember>("team_members", id) : null;
}

/** Re-derive the current step for a call (used for idempotent replays). */
export async function currentStep(ctx: EngineCtx, callId: string): Promise<RouteStep> {
  const l = await load(ctx, callId);
  const cfg = await loadRoutingConfig(ctx.store);
  const s = l.session;
  const target = await agentOf(ctx, s.target_agent_id ?? s.offered_agent_id);
  const agent = target ? { id: target.id, name: target.full_name, extension: target.extension ?? null } : null;
  const base = { callId, state: s.state, trail: s.context.trail ?? [], reason: l.call.route_reason ?? "", agent };
  switch (s.state) {
    case "greeting": return { ...base, action: "gather", prompt: cfg.prompts.greeting };
    case "sticky_offer": return { ...base, action: "gather_sticky", prompt: stickyPrompt(target!.full_name) };
    // tell the caller the agent's extension while they are rung, so they can dial it next time
    case "dialing": return { ...base, action: "dial", prompt: connectingPrompt(cfg.prompts.connecting, target) };
    case "connected": return { ...base, action: "connected" };
    case "voicemail": return { ...base, action: "voicemail", prompt: l.call.after_hours ? cfg.prompts.after_hours : "All our team members are busy. Please leave a message after the tone and we will call you back." };
    default: return { ...base, action: "hangup" };
  }
}

/** "Connecting you to Prachi … extension 13". Nothing is said for agents without an extension. */
export function connectingPrompt(template: string | undefined, agent: Pick<TeamMember, "full_name" | "extension"> | null): string | undefined {
  if (!agent?.extension) return undefined;
  const spoken = agent.extension.split("").join(" "); // "1 3", so TTS reads digits, not "thirteen"
  return (template || DEFAULT_CONNECTING_PROMPT).replaceAll("{name}", agent.full_name).replaceAll("{extension}", spoken);
}

const stickyPrompt = (name: string) =>
  `${name} assisted you recently. Press 1 to connect to ${name}, or press 2 for the CRM desk.`;

/* ------------------------------------------------------------------ */

export async function startInbound(ctx: EngineCtx, p: { from: string; providerCallId?: string | null }): Promise<RouteStep> {
  const phone = normalizePhone(p.from);
  if (!phone) throw badRequest("Caller number is not a valid phone number");
  const findDup = async () => p.providerCallId
    ? (await ctx.store.list<Call>("calls", { eq: { provider: ctx.provider.name, provider_call_id: p.providerCallId }, limit: 1 }))[0]
    : undefined;
  const dup = await findDup();
  if (dup) return resumeExisting(ctx, dup);

  const cfg = await loadRoutingConfig(ctx.store);
  const { client, candidates } = await identifyCaller(ctx.store, phone);
  const afterHours = !isWithinOfficeHours(ctx.now, cfg.office_hours);
  let call: Call;
  try {
    call = await ctx.store.insert<Call>("calls", {
    direction: "inbound", client_id: client?.id ?? null, from_number: phone,
    to_number: process.env.EXOTEL_OPERATIONS_NUMBER || OPERATIONS_LINE,
    status: afterHours ? "missed" : "in_ivr", after_hours: afterHours,
    is_simulated: ctx.provider.isSimulation, provider: ctx.provider.name,
    provider_call_id: p.providerCallId ?? null, started_at: ctx.now.toISOString(),
    route_reason: afterHours ? "Outside office hours" : null,
    });
  } catch (e) {
    // Two "incoming" events for the same provider call raced: the unique index let one win.
    const winner = isConflict(e) ? await findDup() : undefined;
    if (winner) return resumeExisting(ctx, winner);
    throw e;
  }
  const who = client ? `Identified client: ${client.name}`
    : candidates.length > 1 ? `Number matches ${candidates.length} clients - CRM desk to confirm` : "Unknown caller";
  await ensureSession(ctx, call, {
    state: afterHours ? "voicemail" : "greeting",
    context: { trail: [who, afterHours ? "After hours -> after-hours message + voicemail" : "Greeting played"], ...(candidates.length > 1 && { candidateClientIds: candidates }) },
  });
  if (afterHours) {
    await createCallbackReminder(ctx.store, call, { now: ctx.now, officeHours: cfg.office_hours, source: "after_hours" });
  }
  return currentStep(ctx, call.id);
}

/** Create the IVR session for a call unless it exists (unique call_id makes this race-safe). */
async function ensureSession(ctx: EngineCtx, call: Call, init: { state: SessionState; context: CallSession["context"] }) {
  try {
    await ctx.store.insert<CallSession>("call_sessions", {
      call_id: call.id, state: init.state, attempts: 0, offered_agent_id: null, target_agent_id: null, context: init.context,
    });
  } catch (e) {
    if (!isConflict(e)) throw e;
  }
}

/** Duplicate "incoming" for a known call: replay its current step (repairing a missing session). */
async function resumeExisting(ctx: EngineCtx, call: Call): Promise<RouteStep> {
  const [session] = await ctx.store.list<CallSession>("call_sessions", { eq: { call_id: call.id }, limit: 1 });
  if (!session) await ensureSession(ctx, call, { state: call.after_hours ? "voicemail" : "greeting", context: { trail: ["Session recovered"] } });
  return currentStep(ctx, call.id);
}

export async function handleInput(ctx: EngineCtx, callId: string, rawDigits: string): Promise<RouteStep> {
  const l = await load(ctx, callId);
  expect(l.session, "greeting");
  const cfg = await loadRoutingConfig(ctx.store);
  const digits = (rawDigits ?? "").replace(/[^0-9]/g, "");
  await save(ctx, l, { ivr_input: digits || null }, {}, `Input: ${digits || "(none)"}`);

  // Extension (2+ digits)
  if (looksLikeExtension(digits)) {
    const agent = await findAgentByExtension(ctx.store, digits);
    if (agent) return dial(ctx, l, agent, `Extension ${digits} -> ${agent.full_name}`, "crm");
    return invalidInput(ctx, l, cfg.max_reprompts, `Unknown extension ${digits}`);
  }

  if (/^[1-9]$/.test(digits)) {
    const key = Number(digits);
    const dept = await getDepartmentByKey(ctx.store, key);
    if (!dept) return invalidInput(ctx, l, cfg.max_reprompts, `Key ${key} is not mapped`);
    await save(ctx, l, { department_id: dept.id }, {});

    if (dept.kind === "crm") return routeToCrm(ctx, l, "Key 1 -> CRM desk");

    if (dept.kind === "missed_call") {
      const hit = await findLatestOutboundAgent(ctx.store, { clientId: l.call.client_id, phone: l.call.from_number, now: ctx.now, simulated: l.call.is_simulated });
      if (!hit) return routeToCrm(ctx, l, "Key 2 -> no outbound history, CRM desk");
      return dial(ctx, l, hit.agent, `Key 2 -> latest outbound agent ${hit.agent.full_name}`, "crm");
    }

    const sticky = await findStickyAgent(ctx.store, {
      clientId: l.call.client_id, phone: l.call.from_number, departmentId: dept.id,
      now: ctx.now, stickyDays: cfg.sticky_days, excludeCallId: l.call.id, simulated: l.call.is_simulated,
    });
    if (!sticky) return routeToCrm(ctx, l, `Key ${key} (${dept.name}) -> no valid sticky agent, CRM desk`);
    await save(ctx, l, { route_reason: `Key ${key} (${dept.name}) -> sticky ${sticky.agent.full_name}` },
      { state: "sticky_offer", offered_agent_id: sticky.agent.id },
      `Sticky ${sticky.agent.full_name} valid until ${sticky.expiresAt}`);
    return currentStep(ctx, callId);
  }

  return invalidInput(ctx, l, cfg.max_reprompts, digits ? `Invalid input ${digits}` : "No input");
}

async function invalidInput(ctx: EngineCtx, l: Loaded, maxReprompts: number, why: string): Promise<RouteStep> {
  if (l.session.attempts < maxReprompts) {
    const cfg = await loadRoutingConfig(ctx.store);
    await save(ctx, l, {}, { attempts: l.session.attempts + 1 }, `${why} -> re-prompt`);
    const step = await currentStep(ctx, l.call.id);
    return { ...step, prompt: `${cfg.prompts.reprompt} ${cfg.prompts.greeting}` };
  }
  return routeToCrm(ctx, l, `${why} after re-prompt -> CRM desk`);
}

export async function handleStickyChoice(ctx: EngineCtx, callId: string, digit: string): Promise<RouteStep> {
  const l = await load(ctx, callId);
  expect(l.session, "sticky_offer");
  const offered = await agentOf(ctx, l.session.offered_agent_id);
  if (digit === "1" && offered) return dial(ctx, l, offered, `Caller accepted sticky agent ${offered.full_name}`, "crm");
  return routeToCrm(ctx, l, digit === "2" ? "Caller chose CRM desk" : "Invalid sticky choice -> CRM desk");
}

/** Live telephony rings the agent's mobile: without a number the agent cannot be reached. */
const unreachable = (ctx: EngineCtx, agent: TeamMember) => !ctx.provider.isSimulation && !agent.phone;

async function dial(ctx: EngineCtx, l: Loaded, agent: TeamMember, reason: string, fallback: "crm" | "voicemail"): Promise<RouteStep> {
  if (!agent.is_active || agent.status !== "available" || unreachable(ctx, agent)) {
    const why = !agent.is_active ? `${agent.full_name} is inactive`
      : agent.status !== "available" ? `${agent.full_name} is ${agent.status}` : `${agent.full_name} has no phone number in TeleCRM`;
    if (fallback === "crm") return routeToCrm(ctx, l, `${reason}; ${why} -> CRM desk`, [agent.id]);
    return toVoicemail(ctx, l, `${reason}; ${why}`);
  }
  await ctx.provider.dialAgent({ callId: l.call.id, agent, reason });
  await save(ctx, l, { routed_agent_id: agent.id, status: "connecting", route_reason: reason },
    { state: "dialing", target_agent_id: agent.id, context: { fallback } },
    `${reason} (ringing${agent.extension ? `; caller told extension ${agent.extension}` : ""})`);
  return currentStep(ctx, l.call.id);
}

async function routeToCrm(ctx: EngineCtx, l: Loaded, reason: string, exclude: string[] = []): Promise<RouteStep> {
  const desk = await pickCrmDesk(ctx.store, exclude, { requirePhone: !ctx.provider.isSimulation });
  if (!desk) return toVoicemail(ctx, l, `${reason}; CRM desk unavailable`);
  return dial(ctx, l, desk, reason.includes("CRM") ? reason : `${reason} -> CRM desk`, "voicemail");
}

async function toVoicemail(ctx: EngineCtx, l: Loaded, reason: string): Promise<RouteStep> {
  const cfg = await loadRoutingConfig(ctx.store);
  await save(ctx, l, { status: "missed", route_reason: `${reason} -> voicemail` },
    { state: "voicemail", target_agent_id: null }, `${reason} -> voicemail + callback reminder`);
  await createCallbackReminder(ctx.store, l.call, { now: ctx.now, officeHours: cfg.office_hours, source: "missed" });
  return currentStep(ctx, l.call.id);
}

export async function handleDialResult(ctx: EngineCtx, callId: string, result: DialResult): Promise<RouteStep> {
  const l = await load(ctx, callId);
  expect(l.session, "dialing");
  const agent = await agentOf(ctx, l.session.target_agent_id);
  if (!agent) throw notFound("Target agent");
  if (result === "answered") {
    await save(ctx, l, { status: "answered", answered_agent_id: agent.id, answered_at: ctx.now.toISOString() },
      { state: "connected" }, `${agent.full_name} answered`);
    return currentStep(ctx, callId);
  }
  const why = `${agent.full_name}: ${result.replace("_", " ")}`;
  if (l.session.context.fallback === "crm") return routeToCrm(ctx, l, `${why} -> CRM desk`, [agent.id]);
  return toVoicemail(ctx, l, why);
}

export async function leaveVoicemail(ctx: EngineCtx, callId: string, message?: string | null): Promise<RouteStep> {
  const l = await load(ctx, callId);
  expect(l.session, "voicemail");
  const cfg = await loadRoutingConfig(ctx.store);
  const r = await createCallbackReminder(ctx.store, l.call, {
    now: ctx.now, officeHours: cfg.office_hours, source: l.call.after_hours ? "after_hours" : "voicemail", message,
  }) as { id: string; title: string };
  if (message && !r.title.includes("Message:")) {
    await ctx.store.update("reminders", r.id, { title: `${r.title}. Message: ${message.slice(0, 120)}` });
  }
  await save(ctx, l, { status: "voicemail", ended_at: ctx.now.toISOString() }, { state: "ended" }, "Voicemail recorded, call ended");
  return currentStep(ctx, callId);
}

export async function hangup(ctx: EngineCtx, callId: string): Promise<RouteStep> {
  const l = await load(ctx, callId);
  if (l.session.state === "ended") return currentStep(ctx, callId);
  const end = ctx.now.toISOString();
  if (l.session.state === "connected") {
    const dur = Math.max(0, Math.round((ctx.now.getTime() - new Date(l.call.answered_at!).getTime()) / 1000));
    await save(ctx, l, { status: "completed", ended_at: end, duration_sec: dur }, { state: "ended" }, "Call completed");
  } else {
    if (l.session.state !== "voicemail") {
      const cfg = await loadRoutingConfig(ctx.store);
      await createCallbackReminder(ctx.store, l.call, { now: ctx.now, officeHours: cfg.office_hours, source: "missed" });
    }
    await save(ctx, l, { status: l.call.status === "voicemail" ? "voicemail" : "missed", ended_at: end }, { state: "ended" }, "Caller hung up");
  }
  return currentStep(ctx, callId);
}

/* ---------------- transfers (seed sticky) ---------------- */

export async function transferCall(
  ctx: EngineCtx, p: { callId: string; fromMemberId: string | null; toMemberId: string; departmentId?: string | null; result?: DialResult },
) {
  const l = await load(ctx, p.callId);
  expect(l.session, "connected");
  if (l.call.answered_agent_id === p.toMemberId) throw conflict("Call is already with this agent");
  const to = await agentOf(ctx, p.toMemberId);
  if (!to || !to.is_active) throw notFound("Target agent");
  const from = await agentOf(ctx, p.fromMemberId ?? l.call.answered_agent_id);
  const departmentId = p.departmentId ?? l.call.department_id;
  const transfer = await ctx.store.insert<CallTransfer>("call_transfers", {
    call_id: l.call.id, from_member_id: from?.id ?? null, to_member_id: to.id, department_id: departmentId, status: "initiated",
  });
  if (to.status !== "available") return completeTransfer(ctx, transfer.id, "busy");
  await ctx.provider.transfer({ callId: l.call.id, from, to });
  await save(ctx, l, {}, {}, `Transfer ${from?.full_name ?? "?"} -> ${to.full_name} initiated`);
  return p.result ? completeTransfer(ctx, transfer.id, p.result) : { transfer, step: await currentStep(ctx, l.call.id) };
}

export async function completeTransfer(ctx: EngineCtx, transferId: string, result: DialResult) {
  const t = await ctx.store.get<CallTransfer>("call_transfers", transferId);
  if (!t) throw notFound("Transfer");
  if (t.status !== "initiated") return { transfer: t, step: await currentStep(ctx, t.call_id) };
  const l = await load(ctx, t.call_id);
  const to = (await agentOf(ctx, t.to_member_id))!;
  let transfer: CallTransfer;
  try {
    transfer = await ctx.store.update<CallTransfer>("call_transfers", t.id, { status: result }, { expect: { status: "initiated" } });
  } catch (e) {
    if (!isStaleWrite(e)) throw e; // a duplicate callback already completed it
    return { transfer: (await ctx.store.get<CallTransfer>("call_transfers", t.id))!, step: await currentStep(ctx, t.call_id) };
  }
  if (result === "answered") {
    const seeds = t.department_id ? await isDepartmentMember(ctx.store, t.department_id, to.id) : false;
    await save(ctx, l,
      { answered_agent_id: to.id, routed_agent_id: to.id, answered_at: ctx.now.toISOString(), department_id: t.department_id },
      {}, `Transfer answered by ${to.full_name}${seeds ? " (sticky seeded)" : ""}`);
  } else {
    await save(ctx, l, {}, {}, `Transfer to ${to.full_name} failed (${result}); caller stays with current agent`);
  }
  return { transfer, step: await currentStep(ctx, t.call_id) };
}

/* ---------------- outbound (feeds missed-call routing) ---------------- */

export async function placeOutbound(ctx: EngineCtx, p: { agentId: string; to: string; result?: DialResult }) {
  const agent = await agentOf(ctx, p.agentId);
  if (!agent || !agent.is_active) throw notFound("Agent");
  if (unreachable(ctx, agent)) throw badRequest(`Add a mobile number for ${agent.full_name} under Team first - Exotel rings the agent before the client`);
  const phone = normalizePhone(p.to);
  if (!phone) throw badRequest("Destination is not a valid phone number");
  const client = await findClientByPhone(ctx.store, phone);
  let call = await ctx.store.insert<Call>("calls", {
    direction: "outbound", client_id: client?.id ?? null,
    from_number: process.env.EXOTEL_OPERATIONS_NUMBER || OPERATIONS_LINE, to_number: phone,
    status: "connecting", initiated_by: agent.id, routed_agent_id: agent.id,
    is_simulated: ctx.provider.isSimulation, provider: ctx.provider.name, started_at: ctx.now.toISOString(),
    route_reason: `Outbound by ${agent.full_name}`,
  });
  let providerCallId: string | null;
  try {
    ({ providerCallId } = await ctx.provider.placeOutbound({ callId: call.id, agent, to: phone }));
  } catch (e) {
    // the provider refused the call (credentials, trial limits, KYC...): keep the row, but closed as failed
    await ctx.store.update<Call>("calls", call.id, {
      status: "failed", ended_at: ctx.now.toISOString(),
      route_reason: `Outbound by ${agent.full_name}; provider error: ${(e as Error).message}`.slice(0, 1000),
    });
    throw e instanceof AppError ? e : new AppError(502, "provider_error", `The call could not be placed: ${(e as Error).message}`);
  }
  call = await ctx.store.update<Call>("calls", call.id, { provider_call_id: providerCallId });
  if (p.result) call = await completeOutbound(ctx, call.id, p.result);
  return call;
}

export async function completeOutbound(ctx: EngineCtx, callId: string, result: DialResult) {
  const call = await ctx.store.get<Call>("calls", callId);
  if (!call) throw notFound("Call");
  if (call.status !== "connecting") return call;
  const now = ctx.now.toISOString();
  try {
    return await ctx.store.update<Call>("calls", callId, result === "answered"
      ? { status: "answered", answered_agent_id: call.initiated_by, answered_at: now }
      : { status: result, ended_at: now }, { expect: { status: "connecting" } });
  } catch (e) {
    if (!isStaleWrite(e)) throw e; // duplicate/late callback: keep the first outcome
    return (await ctx.store.get<Call>("calls", callId))!;
  }
}

/** Outbound hangup: close the call once (answered -> completed with duration; else keep the failure status). */
export async function endOutbound(ctx: EngineCtx, callId: string) {
  const call = await ctx.store.get<Call>("calls", callId);
  if (!call) throw notFound("Call");
  if (call.ended_at) return call;
  const end = ctx.now.getTime() < new Date(call.started_at).getTime() ? call.started_at : ctx.now.toISOString();
  const answered = call.answered_at != null;
  const patch: Partial<Call> = {
    ended_at: end,
    status: answered ? "completed" : call.status === "connecting" ? "no_answer" : call.status,
    duration_sec: answered ? Math.max(0, Math.round((new Date(end).getTime() - new Date(call.answered_at!).getTime()) / 1000)) : null,
  };
  try {
    return await ctx.store.update<Call>("calls", callId, patch, { expect: { ended_at: null } });
  } catch (e) {
    if (!isStaleWrite(e)) throw e;
    return (await ctx.store.get<Call>("calls", callId))!;
  }
}
