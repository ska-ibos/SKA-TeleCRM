"use client";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Field, Loading, Modal, Pagination, StatusDot, enter, statusTone, useToast } from "../common/ui";
import { usePagination } from "@/hooks/usePagination";
import { apiFetch, ApiError, useApi } from "@/hooks/useApi";
import { useUser } from "../layout/UserContext";
import { teamMemberSchema } from "@/lib/validations";
import { PhoneInput, Select, fieldError, phoneError, phoneHint, zodErrors, type Option } from "../common/form";
import { ROLE_LABELS } from "@/lib/constants";
import { formatPhone } from "@/lib/utils/phone";
import type { Department, EmployeeDirectoryEntry, TeamMember } from "@/types";

type Row = TeamMember & { departments: { id: string; name: string; ivr_key: number }[] };
const STATUS_OPTS: Option[] = [{ value: "available", label: "Available" }, { value: "busy", label: "Busy" }, { value: "offline", label: "Offline" }];
const ROLE_OPTS: Option[] = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));
const blank = { employee_id: "", full_name: "", email: "", phone: "", role: "agent", status: "offline", is_crm_desk: false, is_active: true };

export function TeamManager() {
  const { can, user } = useUser();
  const toast = useToast();
  const q = useApi<Row[]>("/api/team");
  const pg = usePagination(q.data, { pageSize: 25 });
  const linkable = can("team:write") && user.mode === "supabase";
  const employees = useApi<EmployeeDirectoryEntry[]>(linkable ? "/api/team?employees=1" : null);
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const [v, setV] = useState<typeof blank>(blank);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  // departments a member can belong to (key 2 "missed call" has no fixed members)
  const depts = useApi<Department[]>(edit ? "/api/departments" : null);
  const assignable = (depts.data ?? []).filter((d) => d.kind !== "missed_call");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const admin = can("team:write");

  const open = (r: Row | "new") => {
    setEdit(r); setErrors({});
    setDeptIds(r === "new" ? [] : r.departments.map((d) => d.id));
    setV(r === "new" ? blank : { employee_id: r.employee_id ?? "", full_name: r.full_name, email: r.email ?? "", phone: r.phone ?? "", role: r.role, status: r.status, is_crm_desk: r.is_crm_desk, is_active: r.is_active });
  };
  const pickEmployee = (id: string) => {
    const e = employees.data?.find((x) => x.id === id);
    setV({ ...v, employee_id: id, ...(e && { full_name: e.name, email: e.email ?? "", phone: e.phone ?? v.phone }) });
  };
  async function save() {
    const body = { ...v, employee_id: v.employee_id || null, department_ids: deptIds };
    const parsed = teamMemberSchema.safeParse(body);
    if (!parsed.success) return setErrors(zodErrors(parsed.error));
    // the same person / number must not be on the team twice
    const others = (q.data ?? []).filter((m) => edit === "new" || m.id !== (edit as Row).id);
    const email = parsed.data.email, phone = parsed.data.phone;
    const dupEmail = email && others.find((m) => m.email?.toLowerCase() === email);
    const dupPhone = phone && others.find((m) => m.phone === phone);
    if (dupEmail || dupPhone) return setErrors({
      ...(dupEmail && { email: `Already used by ${dupEmail.full_name}` }),
      ...(dupPhone && { phone: `Already used by ${dupPhone.full_name}` }),
    });
    setBusy(true);
    try {
      await apiFetch(edit === "new" ? "/api/team" : `/api/team?id=${(edit as Row).id}`, { method: edit === "new" ? "POST" : "PATCH", body });
      toast.success(edit === "new" ? "Team member added" : "Team member updated");
      depts.reload();
      setEdit(null); q.reload();
    } catch (e) { setErrors((e as ApiError).fields); toast.error((e as Error).message); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV({ ...v, [k]: e.target.type === "checkbox" ? e.target.checked : k === "email" ? e.target.value.replace(/\s/g, "") : e.target.value });
    setErrors((x) => ({ ...x, [k]: "" }));
  };
  const put = (k: keyof typeof blank, value: string) => { setV({ ...v, [k]: value }); setErrors((x) => ({ ...x, [k]: "" })); };
  const blur = (k: keyof typeof blank) => setErrors((x) => ({ ...x, [k]: k === "phone" ? phoneError(v.phone) : fieldError(teamMemberSchema, { ...v, employee_id: v.employee_id || null }, k) }));
  const employeeOptions: Option[] = [{ value: "", label: "Not linked" }, ...(employees.data ?? [])
    .filter((e) => e.status === "Active" && (!e.team_member_id || e.id === v.employee_id))
    .map((e) => ({ value: e.id, label: `${e.name}${e.auth_user_id ? "" : " (no login)"}`, hint: [e.departments.slice(0, 2).join(", "), e.email].filter(Boolean).join(" · "), keywords: `${e.email ?? ""} ${e.phone ?? ""}` }))];

  return (
    <Card title={`Team (${q.data?.length ?? 0})`} actions={admin && <Button size="sm" onClick={() => open("new")}><Plus className="h-3 w-3" />Add member</Button>}>
      {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : q.loading ? <Loading rows={6} /> : !q.data?.length ? <Empty title="No team members" /> : (
        <div className="table-bleed">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Departments</th><th>Ext.</th><th>Phone</th><th>Status</th><th /></tr></thead>
            <tbody key={`${pg.page}-${pg.pageSize}`}>{pg.rows.map((m, i) => (
              <tr key={m.id} {...enter(i)} className={`row-enter ${m.is_active ? "" : "opacity-50"}`}>
                <td>
                  <div className="flex items-center gap-3">
                    <Avatar name={m.full_name} size="sm">
                      <StatusDot status={m.status} className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white" />
                    </Avatar>
                    <div className="min-w-0">
                      <p className="whitespace-nowrap font-semibold">{m.full_name}{m.is_crm_desk && <Badge tone="indigo" className="ml-2">CRM desk</Badge>}{!m.is_active && <Badge className="ml-2">inactive</Badge>}</p>
                      <p className="text-xs text-slate-500">{m.email ?? ""}</p>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap">{ROLE_LABELS[m.role]}</td>
                <td className="min-w-48"><div className="flex flex-wrap gap-1">{m.departments.map((d) => <Badge key={d.id} tone="blue">{d.ivr_key} · {d.name}</Badge>)}</div></td>
                <td className="font-mono text-[13px]">{m.extension ?? "—"}</td>
                <td className="whitespace-nowrap font-mono text-[13px]">{formatPhone(m.phone)}</td>
                <td><Badge tone={statusTone(m.status)}>{m.status}</Badge></td>
                <td>{admin && <Button size="sm" variant="ghost" onClick={() => open(m)} aria-label={`Edit ${m.full_name}`}><Pencil className="h-3 w-3" /></Button>}</td>
              </tr>))}
            </tbody>
          </table>
          <Pagination p={pg} noun="members" />
        </div>
      )}
      <Modal open={edit !== null} onClose={() => setEdit(null)} title={edit === "new" ? "Add team member" : "Edit team member"}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {linkable && (
            <div className="sm:col-span-2">
              <Field label="SKA OS employee" error={errors.employee_id} hint="Links the TeleCRM profile to the employee login. Unlinked members can be dialled but cannot sign in.">
                <Select value={v.employee_id} onChange={pickEmployee} options={employeeOptions} placeholder="Not linked" searchPlaceholder="Search name, department, email…" aria-label="SKA OS employee" />
              </Field>
            </div>
          )}
          <Field label="Full name" error={errors.full_name} required><input className={`input ${errors.full_name ? "input-error" : ""}`} maxLength={80} autoComplete="name" value={v.full_name} onChange={set("full_name")} onBlur={() => blur("full_name")} /></Field>
          <Field label="Email" error={errors.email}><input className={`input ${errors.email ? "input-error" : ""}`} type="email" maxLength={254} autoComplete="email" placeholder="name@singlekeyadvisory.com" value={v.email} onChange={set("email")} onBlur={() => v.email && blur("email")} /></Field>
          <Field label="Phone (for routing)" error={errors.phone} hint={phoneHint(v.phone) ?? "Number the telephony provider rings"}><PhoneInput value={v.phone} invalid={!!errors.phone} onChange={(p) => put("phone", p)} onBlur={() => blur("phone")} /></Field>
          <Field label="Role" error={errors.role}><Select value={v.role} onChange={(r) => put("role", r)} options={ROLE_OPTS} invalid={!!errors.role} aria-label="Role" /></Field>
          <Field label="Availability"><Select value={v.status} onChange={(st) => put("status", st)} options={STATUS_OPTS} aria-label="Availability" /></Field>
          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.is_crm_desk} onChange={set("is_crm_desk")} />CRM desk fallback</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.is_active} onChange={set("is_active")} />Active</label>
          </div>
          <div className="sm:col-span-2">
            <span className="label">Departments <span className="font-normal text-slate-500">— callers pressing these IVR keys can reach this member</span></span>
            {depts.loading && !depts.data ? <p className="text-xs text-slate-500">Loading departments…</p> : (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {assignable.map((d) => (
                  <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200/80 px-2.5 py-2 text-sm transition duration-200 hover:border-brand-200 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/70">
                    <input type="checkbox" checked={deptIds.includes(d.id)} onChange={(e) => setDeptIds((x) => (e.target.checked ? [...x, d.id] : x.filter((i) => i !== d.id)))} />
                    <span className="font-mono text-xs text-slate-500">{d.ivr_key}</span><span className="truncate">{d.name}</span>{!d.is_active && <span className="text-[10px] text-slate-400">(off)</span>}
                  </label>
                ))}
              </div>
            )}
            {errors.department_ids && <p className="fade-in mt-1 text-xs text-rose-600">{errors.department_ids}</p>}
            {!v.is_active && deptIds.length > 0 && <p className="mt-1 text-xs text-amber-700">Inactive members stay listed in their departments but are never rung.</p>}
          </div>
        </div>
      </Modal>
    </Card>
  );
}
