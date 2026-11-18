"use client";
import Link from "next/link";
import { BellRing, PhoneIncoming } from "lucide-react";
import { useLiveCalls } from "@/hooks/useLiveCalls";
import { useApi } from "@/hooks/useApi";
import { Avatar, Badge, Card, Empty, ErrorBox, LiveDot, Loading, PageHeader, Pagination, enter, statusTone } from "@/components/common/ui";
import { usePagination } from "@/hooks/usePagination";
import { formatPhone } from "@/lib/utils/phone";
import { fmtDateTime, timeAgo } from "@/lib/utils/date";
import type { Reminder } from "@/types";
import { Ext } from "@/components/common/Ext";

export default function IncomingQueuePage() {
  const live = useLiveCalls();
  const callbacks = useApi<(Reminder & { client_name: string | null; assigned_name: string | null })[]>("/api/reminders?status=pending", 10000);
  const pendingCallbacks = (callbacks.data ?? []).filter((r) => r.source !== "manual");
  const pg = usePagination(pendingCallbacks, { pageSize: 10 });
  return (
    <>
      <PageHeader title="Incoming queue" subtitle="Live Operations calls and callbacks waiting for the CRM desk"
        actions={<Badge tone="green"><LiveDot className="mr-1" />Live</Badge>} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><PhoneIncoming className="h-4 w-4" />Live calls ({live.data?.length ?? 0})</span>}>
          {live.error ? <ErrorBox message={live.error} /> : live.loading ? <Loading rows={3} /> : !live.data?.length ? <Empty title="No live calls" hint="Calls appear here instantly while in IVR, ringing or connected." /> : (
            <ul className="stagger space-y-3">
              {live.data.map((c) => (
                <li key={c.id}>
                  <Link href={`/calls/${c.id}`} className="card-lift flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
                    <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-700">
                      {c.status === "connecting" && <span className="ping-dot absolute inset-0 rounded-full bg-sky-200" />}
                      <PhoneIncoming className={`relative h-5 w-5 ${c.status === "connecting" ? "animate-ring" : ""}`} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{c.client_name ?? "Unknown caller"} <span className="font-mono text-xs font-normal text-slate-500">{formatPhone(c.from_number)}</span></p>
                      <p className="truncate text-xs text-slate-500">{c.route_reason ?? "In IVR menu"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge tone={statusTone(c.status)}>{c.status === "connecting" ? `ringing ${c.agent_name}` : c.status === "answered" ? `with ${c.agent_name}` : c.status.replace("_", " ")}</Badge>
                      {(c.status === "connecting" || c.status === "answered") && <Ext value={c.agent_extension} />}
                      <p className="mt-1 text-[11px] text-slate-500">{timeAgo(c.started_at)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><BellRing className="h-4 w-4" />Callbacks pending ({pendingCallbacks.length})</span>} actions={<Link className="link text-xs" href="/reminders">All reminders</Link>}>
          {!pendingCallbacks.length ? <Empty title="No callbacks pending" /> : (
            <>
            <ul key={`${pg.page}-${pg.pageSize}`} className="space-y-2">
              {pg.rows.map((r, i) => (
                <li key={r.id} {...enter(i)} className="row-enter flex items-start gap-3 rounded-xl border border-slate-100 p-3 text-sm transition duration-200 hover:border-brand-200">
                  <Avatar name={r.client_name ?? r.title} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{r.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">Due {fmtDateTime(r.due_at)} · {r.assigned_name ?? "Unassigned"} <Badge tone="amber">{r.source.replace("_", " ")}</Badge></p>
                    {r.client_id && <Link className="link mt-1 inline-block text-xs" href={`/clients/${r.client_id}`}>Open {r.client_name}</Link>}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination p={pg} noun="callbacks" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
