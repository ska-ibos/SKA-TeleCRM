"use client";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, StickyNote } from "lucide-react";
import { Badge, Empty, Pagination, cx, enter, statusTone } from "../common/ui";
import { usePagination } from "@/hooks/usePagination";
import { fmtDateTime, fmtDuration } from "@/lib/utils/date";
import type { Call, Note } from "@/types";
import { Ext } from "../common/Ext";

type Item = { at: string; kind: "call"; call: Call & { agent_name: string | null; agent_extension?: string | null } } | { at: string; kind: "note"; note: Note & { author_name: string | null } };

export function ClientTimeline({ calls, notes }: { calls: (Call & { agent_name: string | null; agent_extension?: string | null })[]; notes: (Note & { author_name: string | null })[] }) {
  const items: Item[] = [
    ...calls.map((c) => ({ at: c.started_at, kind: "call" as const, call: c })),
    ...notes.map((n) => ({ at: n.created_at, kind: "note" as const, note: n })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  const pg = usePagination(items, { pageSize: 15 });
  if (!items.length) return <Empty title="No activity yet" />;
  return (
    <>
    <ol key={`${pg.page}-${pg.pageSize}`}>
      {pg.rows.map((i, idx) => (
        <li key={i.kind === "call" ? i.call.id : i.note.id} {...enter(idx)} className="row-enter relative flex gap-3 pb-5 last:pb-0">
          {idx < pg.rows.length - 1 && <span className="absolute bottom-0 left-[15px] top-8 w-px bg-slate-200" />}
          <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full",
            i.kind === "note" ? "bg-brass-100 text-brass-600" : i.call.direction === "inbound" ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700")}>
            {i.kind === "note" ? <StickyNote className="h-3.5 w-3.5" /> : i.call.direction === "inbound" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-xs text-slate-500">{fmtDateTime(i.at)}</p>
            {i.kind === "note" ? (
              <p className="mt-0.5 whitespace-pre-wrap text-sm"><b className="font-semibold">{i.note.author_name ?? "System"}:</b> {i.note.body}</p>
            ) : (
              <Link href={`/calls/${i.call.id}`} className="group mt-0.5 block text-sm">
                <span className="font-medium transition-colors group-hover:text-brand-600">{i.call.direction === "inbound" ? "Inbound" : "Outbound"} call · {i.call.agent_name ?? "unassigned"}<Ext value={i.call.agent_extension} /></span> <Badge tone={statusTone(i.call.status)}>{i.call.status.replace("_", " ")}</Badge>
                {i.call.duration_sec != null && <span className="ml-1 text-xs text-slate-500">{fmtDuration(i.call.duration_sec)}</span>}
                {i.call.route_reason && <span className="mt-0.5 block text-xs text-slate-500">{i.call.route_reason}</span>}
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
    <Pagination p={pg} noun="activities" />
    </>
  );
}
