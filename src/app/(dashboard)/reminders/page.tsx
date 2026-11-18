"use client";
import Link from "next/link";
import { useState } from "react";
import { AlarmClock, Bell, Check, Plus, X } from "lucide-react";
import { apiFetch, useApi } from "@/hooks/useApi";
import { Badge, Button, Card, Empty, ErrorBox, FilterPills, Loading, PageHeader, Pagination, cx, enter, statusTone, useToast } from "@/components/common/ui";
import { usePagination } from "@/hooks/usePagination";
import { ReminderForm } from "@/components/reminders/ReminderForm";
import { useUser } from "@/components/layout/UserContext";
import { fmtDateTime } from "@/lib/utils/date";
import type { Reminder } from "@/types";

type Row = Reminder & { assigned_name: string | null; client_name: string | null };

export default function RemindersPage() {
  const { user } = useUser();
  const toast = useToast();
  const [status, setStatus] = useState("pending"), [mine, setMine] = useState(Boolean(user.memberId));
  const [open, setOpen] = useState(false);
  const qs = new URLSearchParams({ ...(status && { status }), ...(mine && { mine: "1" }) }).toString();
  const q = useApi<Row[]>(`/api/reminders?${qs}`);
  const pg = usePagination(q.data, { resetKey: qs, pageSize: 25 });
  const update = async (id: string, s: string) => {
    try { await apiFetch("/api/reminders", { method: "PATCH", body: { id, status: s } }); toast.success(`Reminder ${s}`); q.reload(); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <>
      <PageHeader title="Reminders" subtitle="Follow-ups, missed-call and after-hours callbacks"
        actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New reminder</Button>} />
      <Card>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <FilterPills value={status} onChange={setStatus} options={["pending", "done", "cancelled", ""].map((s) => ({ value: s, label: s || "all" }))} />
          {user.memberId && <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only mine</label>}
        </div>
        {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : q.loading ? <Loading /> : !q.data?.length ? <Empty title="Nothing here" hint="No reminders match this filter." /> : (
          <>
          <ul key={`${pg.page}-${pg.pageSize}`} className="space-y-2">
            {pg.rows.map((r, i) => {
              const overdue = r.status === "pending" && new Date(r.due_at) < new Date();
              return (
                <li key={r.id} {...enter(i)} className={cx("row-enter flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 transition duration-200", overdue ? "border-rose-200 bg-rose-50/40" : "border-slate-100 hover:border-brand-200")}>
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", overdue ? "bg-rose-100 text-rose-600" : "bg-brand-50 text-brand-600")}>
                      {overdue ? <AlarmClock className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">{r.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        <span className={overdue ? "font-semibold text-rose-600" : ""}>{overdue ? "Overdue · " : ""}{fmtDateTime(r.due_at)}</span>
                        {" · "}{r.assigned_name ?? "Unassigned"}
                        {r.client_id && <> · <Link className="link" href={`/clients/${r.client_id}`}>{r.client_name}</Link></>}
                        {r.call_id && <> · <Link className="link" href={`/calls/${r.call_id}`}>call</Link></>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.source !== "manual" && <Badge tone="amber">{r.source.replace("_", " ")}</Badge>}
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    {r.status === "pending" && <>
                      <Button size="sm" variant="success" onClick={() => update(r.id, "done")}><Check className="h-3 w-3" />Done</Button>
                      <Button size="sm" variant="ghost" onClick={() => update(r.id, "cancelled")} aria-label="Cancel reminder"><X className="h-3 w-3" /></Button>
                    </>}
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination p={pg} noun="reminders" />
          </>
        )}
      </Card>
      <ReminderForm open={open} onClose={() => setOpen(false)} onSaved={q.reload} />
    </>
  );
}
