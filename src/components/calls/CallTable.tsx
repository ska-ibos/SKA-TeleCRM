"use client";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Badge, Empty, Pagination, enter, statusTone } from "../common/ui";
import { usePagination } from "@/hooks/usePagination";
import { formatPhone } from "@/lib/utils/phone";
import { fmtDateTime, fmtDuration } from "@/lib/utils/date";
import { Ext } from "../common/Ext";
import type { EnrichedCall } from "@/lib/services/call.service";

/** `resetKey`: current filters, so changing them starts at page 1. Live polling keeps the page. */
export function CallTable({ calls, resetKey, pageSize }: { calls: EnrichedCall[]; resetKey?: string; pageSize?: number }) {
  const pg = usePagination(calls, { resetKey, pageSize });
  if (!calls.length) return <Empty title="No calls match" hint="Adjust filters or generate calls in the simulator." />;
  return (
    <div className="table-bleed">
      <table className="table">
        <thead><tr><th>When</th><th>Caller / Client</th><th>Input</th><th>Department</th><th>Agent</th><th>Status</th><th>Duration</th></tr></thead>
        <tbody key={`${pg.page}-${pg.pageSize}`}>
          {pg.rows.map((c, i) => (
            <tr key={c.id} {...enter(i)}>
              <td className="whitespace-nowrap text-slate-600">
                <Link href={`/calls/${c.id}`} className="group flex items-center gap-2.5 transition-colors hover:text-brand-600">
                  <span className={`grid h-7 w-7 place-items-center rounded-full transition-transform duration-200 ease-soft group-hover:scale-110 ${c.direction === "inbound" ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700"}`} title={c.direction}>
                    {c.direction === "inbound" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                  </span>
                  {fmtDateTime(c.started_at)}
                </Link>
              </td>
              <td className="whitespace-nowrap">
                <Link href={`/calls/${c.id}`} className="font-semibold transition-colors hover:text-brand-600">{c.client_name ?? "Unknown"}</Link>
                <p className="font-mono text-xs text-slate-500">{formatPhone(c.direction === "inbound" ? c.from_number : c.to_number)}</p>
              </td>
              <td>{c.ivr_input ? <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{c.ivr_input}</code> : "—"}</td>
              <td className="whitespace-nowrap">{c.department_name ?? "—"}</td>
              <td className="whitespace-nowrap">{c.agent_name ? <>{c.agent_name}<Ext value={c.agent_extension} /></> : c.initiated_by_name ? <>{c.initiated_by_name}<Ext value={c.initiated_by_extension} /></> : "—"}</td>
              <td className="space-x-1 whitespace-nowrap">
                <Badge tone={statusTone(c.status)}>{c.status.replace("_", " ")}</Badge>
                {c.after_hours && <Badge tone="indigo">after hours</Badge>}
                {c.is_simulated && <Badge tone="amber">sim</Badge>}
              </td>
              <td className="whitespace-nowrap tabular-nums text-slate-600">{fmtDuration(c.duration_sec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination p={pg} noun="calls" />
    </div>
  );
}
