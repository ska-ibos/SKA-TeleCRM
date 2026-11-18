"use client";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Badge, Button, Card, ErrorBox, Field, Loading, Modal, statusTone, useToast } from "../common/ui";
import { apiFetch, useApi } from "@/hooks/useApi";
import { useUser } from "../layout/UserContext";
import type { Department, TeamMember } from "@/types";
import { departmentSchema } from "@/lib/validations";

type Row = Department & { members: { id: string; full_name: string; status: string }[] };

export function DepartmentManager() {
  const { can } = useUser();
  const toast = useToast();
  const q = useApi<Row[]>("/api/departments");
  const team = useApi<TeamMember[]>("/api/team");
  const [edit, setEdit] = useState<Row | null>(null);
  const [name, setName] = useState(""), [active, setActive] = useState(true), [members, setMembers] = useState<string[]>([]);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);

  const open = (d: Row) => { setEdit(d); setName(d.name); setActive(d.is_active); setMembers(d.members.map((m) => m.id)); setErr(""); };
  async function save() {
    if (!edit) return;
    const r = departmentSchema.shape.name.safeParse(name);
    if (!r.success) return setErr(r.error.issues[0].message);
    const clash = q.data?.find((x) => x.id !== edit.id && x.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (clash) return setErr(`Key ${clash.ivr_key} already uses this name`);
    setBusy(true);
    try {
      await apiFetch(`/api/departments?id=${edit.id}`, { method: "PATCH", body: { name: name.trim(), is_active: active } });
      if (edit.kind !== "missed_call") await apiFetch("/api/departments", { method: "PUT", body: { department_id: edit.id, member_ids: members } });
      toast.success("Department saved"); setEdit(null); q.reload();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (q.loading) return <Loading rows={6} />;
  return (
    <>
      <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {q.data?.map((d) => (
          <Card key={d.id} className="card-lift" title={<span className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-900 font-display text-lg font-medium text-brass-300">{d.ivr_key}</span><span className="text-[15px]">{d.name}</span></span>}
            actions={can("departments:write") && <Button size="sm" variant="ghost" onClick={() => open(d)} aria-label={`Edit ${d.name}`}><Pencil className="h-3 w-3" /></Button>}>
            <p className="mb-3 text-xs text-slate-500">
              {d.kind === "crm" ? "Press 1 → CRM desk queue" : d.kind === "missed_call" ? "Press 2 → most recent outbound agent for the caller, else CRM desk" : `Press ${d.ivr_key} → sticky agent (3 days), else CRM desk`}
            </p>
            {!d.is_active && <Badge tone="red" className="mb-2">Inactive — key treated as invalid</Badge>}
            <div className="flex flex-wrap gap-1.5">
              {d.kind === "missed_call" ? <Badge tone="indigo">Dynamic: latest outbound agent</Badge>
                : d.members.length ? d.members.map((m) => <Badge key={m.id} tone={statusTone(m.status)}>{m.full_name}</Badge>) : <span className="text-sm text-slate-500">No members</span>}
            </div>
          </Card>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Edit key ${edit?.ivr_key} — ${edit?.name}`}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Name" error={err} required><input className={`input ${err ? "input-error" : ""}`} maxLength={60} value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>
          {edit?.kind !== "missed_call" && (
            <div>
              <span className="label">Members</span>
              <div className="grid grid-cols-2 gap-1.5">
                {team.data?.filter((m) => m.is_active).map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200/80 px-2.5 py-2 text-sm transition duration-200 hover:border-brand-200 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/70">
                    <input type="checkbox" checked={members.includes(m.id)} onChange={(e) => setMembers((x) => (e.target.checked ? [...x, m.id] : x.filter((i) => i !== m.id)))} />{m.full_name}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
