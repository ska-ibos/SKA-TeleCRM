"use client";
import Link from "next/link";
import { useState } from "react";
import { Clock, FlaskConical, PhoneCall, PhoneOutgoing, RotateCcw, Users } from "lucide-react";
import { Badge, Button, Card, ConfirmButton, Field, StatusDot, statusTone, useToast } from "../common/ui";
import { apiFetch, newKey, useApi } from "@/hooks/useApi";
import { useUser } from "../layout/UserContext";
import { IVRMenu } from "./IVRMenu";
import { RoutingResult } from "./RoutingResult";
import { formatPhone, normalizePhone } from "@/lib/utils/phone";
import { fmtDateTime } from "@/lib/utils/date";
import type { ClientRow } from "../clients/ClientTable";
import type { EnrichedCall } from "@/lib/services/call.service";
import type { AgentStatus, Department, DialResult, RouteStep, TeamMember } from "@/types";
import { PhoneInput, Select, phoneError, phoneHint, type Option } from "../common/form";
import { agentChoices, deptChoices, membersOf, pickAgent, pickDept } from "@/lib/utils/agent-dept";

type MemberRow = TeamMember & { departments?: { id: string; name: string; ivr_key: number }[] };

const AVAIL: Option[] = [{ value: "available", label: "Available" }, { value: "busy", label: "Busy" }, { value: "offline", label: "Unavailable" }];
const OUT_RESULTS: Option[] = [{ value: "no_answer", label: "Client misses the call" }, { value: "answered", label: "Client answers" }, { value: "busy", label: "Client busy" }];
const XFER_RESULTS: Option[] = [{ value: "answered", label: "Agent answers" }, { value: "busy", label: "Agent busy" }, { value: "no_answer", label: "No answer" }];

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
/** Next weekday (1=Mon) at hh:mm IST, as a Date */
function istAt(weekday: number, hh: number, mm = 0) {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const diff = (weekday - ist.getUTCDay() + 7) % 7 || 7;
  const target = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + diff, hh, mm) - 5.5 * 3600_000;
  return new Date(target);
}

export function CallSimulator() {
  const toast = useToast();
  const { user, can } = useUser();
  const clients = useApi<ClientRow[]>("/api/clients");
  const team = useApi<MemberRow[]>("/api/team");
  const depts = useApi<Department[]>("/api/departments");
  const sim = useApi<{ calls: EnrichedCall[]; log: string[] }>("/api/simulator");

  const [clock, setClock] = useState(toLocalInput(istAt(1, 11)));
  const [caller, setCaller] = useState(""), [unknown, setUnknown] = useState("");
  const [pickedKey, setPickedKey] = useState("");
  const [step, setStep] = useState<RouteStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [xfer, setXfer] = useState({ to: "", dept: "", result: "answered" as DialResult });
  const [out, setOut] = useState({ agent: "", to: "", result: "no_answer" as DialResult });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const clearErr = (k: string) => setErrs((x) => ({ ...x, [k]: "" }));

  const at = () => new Date(clock).toISOString();
  const shift = (hours: number) => setClock(toLocalInput(new Date(new Date(clock).getTime() + hours * 3600_000)));
  const refresh = () => { sim.reload(); team.reload(); };

  async function send(action: string, extra: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    try {
      const body = action === "start" ? { action, from: extra.from, at: at(), idempotencyKey: newKey() } : { action, callId: step!.callId, at: at(), idempotencyKey: newKey(), ...extra };
      setStep(await apiFetch<RouteStep>("/api/simulator", { body }));
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  function start() {
    const from = unknown.trim() || caller;
    if (!from) return setErrs((x) => ({ ...x, unknown: "Pick a client number or enter an unknown number" }));
    const err = phoneError(from, true);
    if (err) return setErrs((x) => ({ ...x, unknown: err }));
    send("start", { from });
  }
  async function transfer() {
    if (!step || !xfer.to) return setErrs((x) => ({ ...x, xfer: "Choose an agent to transfer to" }));
    setBusy(true);
    try {
      const r = await apiFetch<{ transfer: { status: string }; step: RouteStep }>("/api/call/transfer", {
        body: { call_id: step.callId, to_member_id: xfer.to, department_id: xfer.dept || null, result: xfer.result, at: at(), idempotencyKey: newKey() },
      });
      setStep(r.step);
      toast.success(`Transfer ${r.transfer.status}`);
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function outbound() {
    const to = out.to || caller;
    const e2: Record<string, string> = {};
    if (!out.agent) e2.outAgent = "Choose the agent who calls";
    if (!to) e2.outTo = "Pick a client number above or enter one here";
    else if (phoneError(to, true)) e2.outTo = phoneError(to, true);
    if (Object.keys(e2).length) return setErrs((x) => ({ ...x, ...e2 }));
    setBusy(true);
    try {
      await apiFetch("/api/call/outbound", { body: { agent_id: out.agent, to, result: out.result, at: at(), idempotencyKey: newKey() } });
      toast.success("Outbound call saved — the client can now press 2 to reach this agent");
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function setStatus(id: string, status: AgentStatus) {
    try { await apiFetch("/api/team", { method: "PATCH", body: { id, status } }); team.reload(); } catch (e) { toast.error((e as Error).message); }
  }

  // One option per (client, number). In SKA OS data the same number can belong to several clients
  // (group companies), so the key must include the client, and such numbers are flagged: calling
  // from them is treated as an ambiguous caller (CRM desk confirms the client).
  const owners = new Map<string, number>();
  for (const c of clients.data ?? []) for (const p of c.phones) owners.set(p.phone, (owners.get(p.phone) ?? 0) + 1);
  const phones = (clients.data ?? []).flatMap((c) => c.phones.map((p) => {
    const shared = owners.get(p.phone)! > 1;
    return { key: `${c.id}:${p.phone}`, phone: p.phone, label: `${c.name} — ${formatPhone(p.phone)}${shared ? ` (shared by ${owners.get(p.phone)} clients)` : ""}` };
  }));
  const callerOpts: Option[] = [{ value: "", label: "— choose a client —" }, ...phones.map((p) => ({ value: p.key, label: p.label.split(" — ")[0], hint: p.label.split(" — ").slice(1).join(" — "), keywords: p.phone }))];
  const callerKey = (pickedKey && phones.find((p) => p.key === pickedKey && p.phone === caller)?.key) || phones.find((p) => p.phone === caller)?.key || "";
  const agentOpts: Option[] = (team.data ?? []).filter((m) => m.is_active).map((m) => ({ value: m.id, label: m.full_name, hint: m.status }));
  // transfer: agent and department pickers narrow each other (see lib/utils/agent-dept.ts)
  const xferAgents = (team.data ?? []).filter((m) => m.is_active && m.id !== step?.agent?.id);
  const deptList = (depts.data ?? []).filter((d) => d.kind === "department");
  const xferAgentOpts: Option[] = [{ value: "", label: "— to agent —" }, ...agentChoices(xferAgents, xfer.dept).map((m) => ({ value: m.id, label: m.full_name, hint: [m.status, m.departments?.map((d) => d.name).join(", ")].filter(Boolean).join(" · ") }))];
  const deptOpts: Option[] = [{ value: "", label: "— department (default: caller's choice) —" }, ...deptChoices(xferAgents, deptList, xfer.to).map((d) => ({ value: d.id, label: `${d.ivr_key} · ${d.name}` }))];
  const chooseXferAgent = (a: string) => { const r = pickAgent(xferAgents, deptList, a, xfer.dept); setXfer({ ...xfer, to: r.agent, dept: r.dept }); clearErr("xfer"); };
  const chooseXferDept = (d: string) => { const r = pickDept(xferAgents, d, xfer.to); setXfer({ ...xfer, to: r.agent, dept: r.dept }); if (r.agent) clearErr("xfer"); };
  const xferNote = xfer.dept && membersOf(xfer.dept, xferAgents).length ? `Showing ${deptList.find((d) => d.id === xfer.dept)?.name} members — clear the department to see everyone`
    : xfer.to && deptOpts.length - 1 < deptList.length ? "Department list narrowed to this agent's departments" : "";
  const canSetOthers = ["admin", "crm_desk", "manager"].includes(user.role);

  return (
    <div className="space-y-6">
      <div className="bg-hazard flex items-center justify-center gap-2 rounded-2xl border border-brass-300/70 px-4 py-2.5 text-center text-xs font-bold uppercase tracking-wider text-[#6f4f12]">
        <FlaskConical className="h-4 w-4 shrink-0" />SIMULATION — NO REAL PHONE CALL
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* ---- setup ---- */}
        <div className="space-y-6">
          <Card title={<span className="flex items-center gap-2"><Clock className="h-4 w-4" />Simulated clock</span>}>
            <input type="datetime-local" className="input" value={clock} onChange={(e) => e.target.value && setClock(e.target.value)} />
            <p className="mt-1 text-xs text-slate-500">IST: {fmtDateTime(at())}. Office hours Mon–Sat 10:00–19:00 IST.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setClock(toLocalInput(istAt(1, 11)))}>Mon 11:00</Button>
              <Button size="sm" variant="secondary" onClick={() => setClock(toLocalInput(istAt(0, 11)))}>Sun (closed)</Button>
              <Button size="sm" variant="secondary" onClick={() => setClock(toLocalInput(istAt(2, 20)))}>Tue 20:00</Button>
              <Button size="sm" variant="secondary" onClick={() => shift(1)}>+1 h</Button>
              <Button size="sm" variant="secondary" onClick={() => shift(24)}>+1 day</Button>
              <Button size="sm" variant="secondary" onClick={() => shift(71)}>+71 h</Button>
              <Button size="sm" variant="secondary" onClick={() => shift(73)}>+73 h (sticky expired)</Button>
            </div>
          </Card>

          <Card title={<span className="flex items-center gap-2"><PhoneCall className="h-4 w-4" />Inbound Operations call</span>}>
            <div className="space-y-3">
              <Field label="Known client number">
                <Select value={callerKey} options={callerOpts} placeholder="— choose a client —" aria-label="Known client number" searchPlaceholder="Search client name or number…"
                  onChange={(k) => { setPickedKey(k); setCaller(phones.find((p) => p.key === k)?.phone ?? ""); setUnknown(""); clearErr("unknown"); }} />
              </Field>
              <Field label="…or unknown number" error={errs.unknown} hint={phoneHint(unknown)}><PhoneInput value={unknown} invalid={!!errs.unknown} placeholder="98xxxxxxxx" onChange={(v) => { setUnknown(v); clearErr("unknown"); }} onBlur={() => unknown && setErrs((x) => ({ ...x, unknown: phoneError(unknown) }))} /></Field>
              {!phones.length && <p className="text-xs text-slate-500">No clients yet. <Link className="link" href="/clients/new">Create one</Link> to test caller identification.</p>}
              <Button className="w-full" loading={busy && !step} onClick={start}><PhoneCall className="h-4 w-4" />Start inbound call</Button>
            </div>
          </Card>

          <Card title={<span className="flex items-center gap-2"><PhoneOutgoing className="h-4 w-4" />Outbound call (missed-call test)</span>}>
            <div className="space-y-3">
              <Field label="Agent calling" error={errs.outAgent} required><Select value={out.agent} onChange={(a) => { setOut({ ...out, agent: a }); clearErr("outAgent"); }} options={agentOpts} placeholder="— choose —" invalid={!!errs.outAgent} aria-label="Agent calling" searchPlaceholder="Search team…" /></Field>
              <Field label="To" error={errs.outTo} hint={phoneHint(out.to) ?? "Defaults to the selected client number"}><PhoneInput value={out.to} invalid={!!errs.outTo} placeholder={caller ? formatPhone(caller) : "number"} onChange={(v) => { setOut({ ...out, to: v }); clearErr("outTo"); }} onBlur={() => out.to && setErrs((x) => ({ ...x, outTo: phoneError(out.to) }))} /></Field>
              <Field label="Outcome"><Select value={out.result} onChange={(r) => setOut({ ...out, result: r as DialResult })} options={OUT_RESULTS} aria-label="Outcome" /></Field>
              <Button variant="secondary" className="w-full" disabled={busy} onClick={outbound}>Place simulated outbound</Button>
            </div>
          </Card>
        </div>

        {/* ---- phone ---- */}
        <Card title="Caller's phone" className="self-start" actions={step && <Button size="sm" variant="ghost" onClick={() => setStep(null)}>New call</Button>}>
          {/* Handset frame */}
          <div className="mx-auto max-w-sm rounded-[2.25rem] bg-brand-950 p-2 shadow-lift">
            <div className="min-h-[26rem] rounded-[1.8rem] bg-white p-4">
              <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-slate-200" />
              {!step ? (
                <div className="fade-in flex flex-col items-center gap-3 py-20 text-center">
                  <span className="animate-float grid h-16 w-16 place-items-center rounded-full bg-brand-50 text-brand-600"><PhoneCall className="h-7 w-7" /></span>
                  <p className="max-w-52 text-sm text-slate-500">Start an inbound call to hear the greeting.</p>
                </div>
              ) : <IVRMenu key={step.callId} step={step} busy={busy} send={send} />}
            </div>
          </div>
          {step?.action === "connected" && (
            <div className="pop-in mt-4 space-y-2 rounded-2xl border border-slate-200 p-3">
              <p className="text-sm font-semibold">Transfer (seeds sticky)</p>
              <Select value={xfer.to} onChange={chooseXferAgent} options={xferAgentOpts} placeholder="— to agent —" invalid={!!errs.xfer} aria-label="Transfer to agent" searchPlaceholder="Search team…" />
              {errs.xfer && <p className="fade-in text-xs text-rose-600">{errs.xfer}</p>}
              {xferNote && <p className="fade-in text-xs text-slate-500">{xferNote}</p>}
              <Select value={xfer.dept} onChange={chooseXferDept} options={deptOpts} aria-label="Department" />
              <Select value={xfer.result} onChange={(r) => setXfer({ ...xfer, result: r as DialResult })} options={XFER_RESULTS} aria-label="Transfer result" />
              <Button className="w-full" disabled={busy} onClick={transfer}>Transfer</Button>
            </div>
          )}
        </Card>

        {/* ---- results ---- */}
        <div className="space-y-6">
          <Card title="Routing decision"><RoutingResult step={step} /></Card>
          <Card title={<span className="flex items-center gap-2"><Users className="h-4 w-4" />Agent availability</span>}>
            <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {team.data?.filter((m) => m.is_active).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><StatusDot status={m.status} /><span className="truncate">{m.full_name}</span>{m.extension && <span className="font-mono text-xs text-slate-500">#{m.extension}</span>}</span>
                  <Select size="sm" className="w-32" aria-label={`Availability for ${m.full_name}`} value={m.status} disabled={!canSetOthers && m.id !== user.memberId} onChange={(st) => setStatus(m.id, st as AgentStatus)} options={AVAIL} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card title="Simulated call history" actions={can("settings:write") && (
        <ConfirmButton size="sm" variant="ghost" message="Delete all simulated calls? This also clears learned sticky agents and missed-call history from simulations."
          onConfirm={async () => { try { await apiFetch("/api/simulator", { body: { action: "reset" } }); setStep(null); refresh(); toast.success("Simulated calls cleared"); } catch (e) { toast.error((e as Error).message); } }}>
          <RotateCcw className="h-3 w-3" />Reset
        </ConfirmButton>)}>
        {!sim.data?.calls.length ? <p className="text-sm text-slate-500">No simulated calls yet.</p> : (
          <div className="table-bleed">
            <table className="table">
              <thead><tr><th>Sim time</th><th>Dir</th><th>Number</th><th>Input</th><th>Dept</th><th>Agent</th><th>Status</th><th>Reason</th></tr></thead>
              <tbody>{sim.data.calls.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap"><Link className="hover:text-brand-600" href={`/calls/${c.id}`}>{fmtDateTime(c.started_at)}</Link></td>
                  <td>{c.direction}</td><td>{c.client_name ?? formatPhone(c.direction === "inbound" ? c.from_number : c.to_number)}</td>
                  <td>{c.ivr_input ?? "—"}</td><td>{c.department_name ?? "—"}</td><td>{c.agent_name ?? c.initiated_by_name ?? "—"}</td>
                  <td><Badge tone={statusTone(c.status)}>{c.status.replace("_", " ")}</Badge></td>
                  <td className="max-w-xs truncate text-xs text-slate-500" title={c.route_reason ?? ""}>{c.route_reason}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
        {!!sim.data?.log.length && <details className="mt-4 text-xs text-slate-500"><summary className="cursor-pointer">Provider log</summary><pre className="mt-2 whitespace-pre-wrap">{sim.data.log.join("\n")}</pre></details>}
      </Card>
    </div>
  );
}
