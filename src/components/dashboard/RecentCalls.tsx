"use client";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Badge, Empty, statusTone } from "../common/ui";
import { formatPhone } from "@/lib/utils/phone";
import { timeAgo } from "@/lib/utils/date";
import { Ext } from "../common/Ext";
import type { EnrichedCall } from "@/lib/services/call.service";

export function RecentCalls({ calls }: { calls: EnrichedCall[] }) {
  if (!calls.length) return <Empty title="No calls yet" hint="Try the Call Simulator to generate some traffic." />;
  return (
    <ul className="stagger -mx-2">
      {calls.slice(0, 8).map((c) => (
        <li key={c.id}>
          <Link href={`/calls/${c.id}`} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors duration-150 hover:bg-brand-50/60">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-transform duration-200 ease-soft group-hover:scale-110 ${c.direction === "inbound" ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700"}`}>
              {c.direction === "inbound" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{c.client_name ?? formatPhone(c.direction === "inbound" ? c.from_number : c.to_number)}</p>
              <p className="truncate text-xs text-slate-500">{c.department_name ?? "—"} · {c.agent_name ?? "unassigned"}<Ext value={c.agent_extension} /></p>
            </div>
            <div className="shrink-0 text-right">
              <Badge tone={statusTone(c.status)}>{c.status.replace("_", " ")}</Badge>
              <p className="mt-1 text-[11px] text-slate-500">{timeAgo(c.started_at)}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
