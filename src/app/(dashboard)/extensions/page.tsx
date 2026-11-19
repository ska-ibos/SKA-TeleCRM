"use client";
import { useState } from "react";
import { Hash, Save } from "lucide-react";
import { apiFetch, useApi } from "@/hooks/useApi";
import { Avatar, Button, Card, ErrorBox, Loading, PageHeader, Pagination, enter, useToast } from "@/components/common/ui";
import { usePagination } from "@/hooks/usePagination";
import { useUser } from "@/components/layout/UserContext";
import type { TeamMember } from "@/types";

export default function ExtensionsPage() {
  const { can } = useUser();
  const toast = useToast();
  const q = useApi<TeamMember[]>("/api/team");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const admin = can("extensions:write");
  const pg = usePagination(q.data?.filter((m) => m.is_active), { pageSize: 25 });

  async function save(m: TeamMember) {
    const ext = (draft[m.id] ?? m.extension ?? "").trim();
    if (ext && !/^[0-9]{2,6}$/.test(ext)) return setErrors({ ...errors, [m.id]: "2–6 digits" });
    const dup = q.data?.find((x) => x.id !== m.id && x.extension === ext);
    if (ext && dup) return setErrors({ ...errors, [m.id]: `Used by ${dup.full_name}` });
    setSaving(m.id);
    try {
      await apiFetch("/api/extensions", { method: "PUT", body: { team_member_id: m.id, extension: ext || null } });
      toast.success(ext ? `Extension ${ext} → ${m.full_name}` : `Extension cleared for ${m.full_name}`);
      setErrors({ ...errors, [m.id]: "" }); q.reload();
    } catch (e) { setErrors({ ...errors, [m.id]: (e as Error).message }); } finally { setSaving(null); }
  }

  return (
    <>
      <PageHeader title="Extensions" subtitle="Give each agent a direct number that callers can dial at the greeting." />
      {!admin && <p className="mb-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">Only TeleCRM admins can change extensions.</p>}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : q.loading ? <Loading rows={6} /> : (
            <div className="table-bleed">
              <table className="table">
                <thead><tr><th>Agent</th><th>Extension</th><th /></tr></thead>
                <tbody key={`${pg.page}-${pg.pageSize}`}>{pg.rows.map((m, i) => (
                  <tr key={m.id} {...enter(i)}>
                    <td><span className="flex items-center gap-3 whitespace-nowrap font-semibold"><Avatar name={m.full_name} size="sm" />{m.full_name}</span></td>
                    <td>
                      <input className={`input w-32 font-mono ${errors[m.id] ? "input-error" : ""}`} inputMode="numeric" maxLength={6} placeholder="not set" disabled={!admin} aria-label={`Extension for ${m.full_name}`}
                        value={draft[m.id] ?? m.extension ?? ""} onChange={(e) => { setDraft({ ...draft, [m.id]: e.target.value.replace(/\D/g, "") }); setErrors({ ...errors, [m.id]: "" }); }} />
                      {errors[m.id] && <p className="fade-in mt-1 text-xs text-rose-600">{errors[m.id]}</p>}
                    </td>
                    <td className="text-right">{admin && <Button size="sm" variant="secondary" loading={saving === m.id} disabled={(draft[m.id] ?? m.extension ?? "") === (m.extension ?? "")} onClick={() => save(m)}><Save className="h-3 w-3" />Save</Button>}</td>
                  </tr>))}
                </tbody>
              </table>
              <Pagination p={pg} noun="agents" />
            </div>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><Hash className="h-4 w-4" />How extensions work</span>}>
          <ul className="space-y-3 text-sm text-slate-600">
            <li>Callers enter the extension at the greeting to ring that agent directly.</li>
            <li>Extensions are <b className="font-semibold text-slate-800">2–6 digits</b>. Single digits are reserved for IVR keys.</li>
            <li>If the agent is busy or doesn&apos;t answer, the call moves to the CRM desk.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
