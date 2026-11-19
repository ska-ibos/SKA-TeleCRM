"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { Avatar, Badge, Button, Card, Field, Trail, statusTone, useToast } from "../common/ui";
import { apiFetch, newKey, useApi } from "@/hooks/useApi";
import { formatPhone } from "@/lib/utils/phone";
import { fmtDateTime, fmtDuration } from "@/lib/utils/date";
import { Ext } from "../common/Ext";
import type { getCallDetail } from "@/lib/services/call.service";
import type { Department, DialResult, TeamMember } from "@/types";
import { CharCount, Select, type Option } from "../common/form";
import { agentChoices, deptChoices, membersOf, pickAgent, pickDept } from "@/lib/utils/agent-dept";
import { CallerContext } from "./CallerContext";
import { LinkClient } from "./LinkClient";
import { useUser } from "../layout/UserContext";

type MemberRow = TeamMember & { departments?: { id: string; name: string; ivr_key: number }[] };

const RESULTS: Option[] = [{ value: "answered", label: "Answered" }, { value: "busy", label: "Busy" }, { value: "no_answer", label: "No answer" }];

type Detail = Awaited<ReturnType<typeof getCallDetail>>;

export function CallDetails({ d, reload }: { d: Detail; reload: () => void }) {
  const toast = useToast();
  const { can } = useUser();
  const c = d.call;
  const team = useApi<MemberRow[]>("/api/team");
  const depts = useApi<Department[]>("/api/departments");
  const [to, setTo] = useState(""), [dept, setDept] = useState(c.department_id ?? ""), [result, setResult] = useState<DialResult>("answered");
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  const connected = d.session?.state === "connected";
  const [toErr, setToErr] = useState("");
  // agent and department pickers narrow each other (see lib/utils/agent-dept.ts)
  const available = (team.data ?? []).filter((m) => m.is_active && m.id !== c.answered_agent_id);
  const deptList = (depts.data ?? []).filter((x) => x.kind === "department");
  const agents: Option[] = agentChoices(available, dept).map((m) => ({ value: m.id, label: m.full_name, hint: [m.status, m.departments?.map((d) => d.name).join(", ")].filter(Boolean).join(" · ") }));
  const deptOpts: Option[] = [{ value: "", label: "— none —" }, ...deptChoices(available, deptList, to).map((x) => ({ value: x.id, label: `${x.ivr_key} · ${x.name}` }))];
  const chooseAgent = (a: string) => { const r = pickAgent(available, deptList, a, dept); setTo(r.agent); setDept(r.dept); setToErr(""); };
  const chooseDept = (d: string) => { const r = pickDept(available, d, to); setTo(r.agent); setDept(r.dept); if (r.agent) setToErr(""); };
  const deptName = deptList.find((x) => x.id === dept)?.name;
  const narrowedAgents = !!dept && membersOf(dept, available).length > 0;
  const narrowedDepts = !!to && deptOpts.length - 1 < deptList.length;

  async function transfer() {
    if (!to) return setToErr("Choose an agent to transfer to");
    setBusy(true);
    try {
      const r = await apiFetch<{ transfer: { status: string } }>("/api/call/transfer", {
        body: { call_id: c.id, to_member_id: to, department_id: dept || null, result, idempotencyKey: newKey() },
      });
      toast.success(`Transfer ${r.transfer.status}`);
      reload();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function addNote() {
    if (!c.client_id) return toast.error("Link this caller to a client before adding notes");
    if (!note.trim()) return toast.error("Write the note first");
    try { await apiFetch("/api/notes", { body: { client_id: c.client_id, call_id: c.id, body: note } }); setNote(""); toast.success("Note saved"); reload(); }
    catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Call" className="self-start lg:col-span-1">
        <div className="mb-4 flex flex-wrap gap-1.5">
          <Badge tone={statusTone(c.status)}>{c.status.replace("_", " ")}</Badge>
          {c.after_hours && <Badge tone="indigo">after hours</Badge>}
          {c.is_simulated && <Badge tone="amber">Simulation</Badge>}
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5 text-sm">
          {([
            ["Direction", <span key="d" className="capitalize">{c.direction}</span>], ["From", <span key="f" className="font-mono text-[13px]">{formatPhone(c.from_number)}</span>], ["To", <span key="t" className="font-mono text-[13px]">{formatPhone(c.to_number)}</span>],
            ["Client", c.client_id ? <Link key="c" className="link" href={`/clients/${c.client_id}`}>{c.client_name}</Link> : "Unknown caller"],
            ["IVR input", c.ivr_input ?? "—"], ["Department", c.department_name ?? "—"], ["Agent", c.agent_name ? <span key="a">{c.agent_name}<Ext value={c.agent_extension} /></span> : "—"],
            ["Started", fmtDateTime(c.started_at)], ["Answered", fmtDateTime(c.answered_at)], ["Ended", fmtDateTime(c.ended_at)],
            ["Duration", fmtDuration(c.duration_sec)], ["Provider", c.provider],
          ] as [string, React.ReactNode][]).map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}
        </dl>
      </Card>

      <div className="space-y-6 lg:col-span-2">
        <Card title={c.client_name ? `${c.client_name} — history & who to transfer to` : "Caller history"}>
          {!c.client_id && can("clients:write") && <LinkClient callId={c.id} phone={c.direction === "inbound" ? c.from_number : c.to_number} onLinked={reload} />}
          <CallerContext key={`${c.id}-${c.client_id ?? ""}`} callId={c.id} />
        </Card>

        {d.recordings.length > 0 && (
          <Card title="Recordings">
            <ul className="space-y-3">
              {d.recordings.map((r) => (
                <li key={r.id} className="space-y-1">
                  <p className="text-xs text-slate-500">{r.kind === "voicemail" ? "Voicemail" : "Call recording"} · {fmtDateTime(r.created_at)}{r.archived ? " · archived" : ""}</p>
                  <audio controls preload="none" className="w-full" src={`/api/recordings?id=${r.id}`} />
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Routing trail">
          <p className="mb-4 rounded-xl bg-brand-50/70 px-3.5 py-2.5 text-sm font-medium text-brand-800">{c.route_reason ?? "—"}</p>
          <Trail items={d.session?.context.trail ?? []} />
        </Card>

        {connected && (
          <Card title={<span className="flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" />Transfer call</span>}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="To agent" error={toErr} required hint={narrowedAgents ? `Showing ${deptName} members — clear the department to see everyone` : undefined}><Select value={to} onChange={chooseAgent} options={[{ value: "", label: "— choose —" }, ...agents]} placeholder="— choose —" invalid={!!toErr} aria-label="To agent" searchPlaceholder="Search team…" /></Field>
              <Field label="Department" hint={narrowedDepts ? "Showing this agent's departments only" : "Answered transfer to a member seeds sticky"}><Select value={dept} onChange={chooseDept} options={deptOpts} aria-label="Department" /></Field>
              <Field label={c.is_simulated ? "Simulated result" : "Did they take the call?"} hint={c.is_simulated ? undefined : "Transfer on your phone first, then record the outcome"}><Select value={result} onChange={(r) => setResult(r as DialResult)} options={RESULTS} aria-label="Transfer result" /></Field>
            </div>
            <Button className="mt-3" loading={busy} onClick={transfer}>Transfer</Button>
          </Card>
        )}

        {d.transfers.length > 0 && (
          <Card title="Transfers">
            <ul className="space-y-2 text-sm">{d.transfers.map((t) => <li key={t.id} className="flex flex-wrap items-center gap-2"><span className="text-xs text-slate-500">{fmtDateTime(t.created_at)}</span> {t.from_name ?? "IVR"} → <b className="font-semibold">{t.to_name}</b><Ext value={t.to_extension} /> <Badge tone={statusTone(t.status)}>{t.status}</Badge></li>)}</ul>
          </Card>
        )}

        <Card title="Call notes">
          {d.notes.map((n) => (
            <div key={n.id} className="mb-3 flex gap-3 text-sm">
              <Avatar name={n.author_name ?? "System"} size="sm" />
              <p><b className="font-semibold">{n.author_name ?? "System"}</b> <span className="text-xs text-slate-500">{fmtDateTime(n.created_at)}</span><br />{n.body}</p>
            </div>
          ))}
          <textarea className="input mt-1 min-h-20" maxLength={5000} placeholder={c.client_id ? "Add a note for this call" : "Unknown caller - create the client first"} disabled={!c.client_id} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="mt-2 flex items-center justify-between"><CharCount value={note} max={5000} /><Button disabled={!note.trim()} onClick={addNote}>Save note</Button></div>
        </Card>
      </div>
    </div>
  );
}
