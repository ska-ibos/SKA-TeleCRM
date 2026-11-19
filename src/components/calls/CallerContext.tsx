"use client";
import Link from "next/link";
import { History, PhoneOutgoing, StickyNote, UserCheck } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { Badge, Skeleton, cx, statusTone } from "../common/ui";
import { Ext } from "../common/Ext";
import { fmtDateTime, timeAgo } from "@/lib/utils/date";
import type { CallerContext as Ctx } from "@/lib/services/context.service";

/**
 * Who is calling and who they dealt with (spec §8.8): tags, latest notes, current sticky agent
 * per department, last outbound agent, recent calls. Used by the screen-pop and the call page.
 */
export function CallerContext({ callId, compact = false }: { callId: string; compact?: boolean }) {
  const q = useApi<Ctx>(`/api/calls?context=${callId}`);
  if (q.error) return <p className="text-xs text-slate-500">Caller history unavailable: {q.error}</p>;
  if (!q.data) return <div className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>;
  const d = q.data;
  const none = !d.stickies.length && !d.last_outbound && !d.recent_calls.length && !d.notes.length;
  return (
    <div className={cx("space-y-3 text-sm", compact && "text-xs")}>
      {d.candidates.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          Number shared by {d.candidates.map((c, i) => <span key={c.id}>{i ? ", " : ""}<Link className="link" href={`/clients/${c.id}`}>{c.name}</Link></span>)} — confirm who is calling.
        </p>
      )}
      {d.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {d.tags.map((t) => <span key={t.id} className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: t.color }}>{t.name}</span>)}
        </div>
      )}

      <section>
        <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><UserCheck className="h-3.5 w-3.5" />Spoke with recently</h4>
        {d.stickies.length ? (
          <ul className="space-y-1">
            {d.stickies.map((s) => (
              <li key={s.department} className="flex flex-wrap items-center gap-x-1.5">
                <Badge tone="indigo">{s.ivr_key} · {s.department}</Badge><b className="font-semibold">{s.agent}</b><Ext value={s.extension} />
                <span className="text-slate-500">until {fmtDateTime(s.expires_at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-slate-500">No sticky agent in any department (none in the last days).</p>}
      </section>

      {d.last_outbound && (
        <section className="flex flex-wrap items-center gap-1.5">
          <PhoneOutgoing className="h-3.5 w-3.5 text-slate-500" /><span className="text-slate-500">Last called by</span>
          <b className="font-semibold">{d.last_outbound.agent}</b><Ext value={d.last_outbound.extension} />
          <span className="text-slate-500">{timeAgo(d.last_outbound.at)}</span>
        </section>
      )}

      {d.notes.length > 0 && (
        <section>
          <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><StickyNote className="h-3.5 w-3.5" />Latest notes</h4>
          <ul className="space-y-1.5">
            {d.notes.slice(0, compact ? 2 : 3).map((n) => (
              <li key={n.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                <p className={cx("whitespace-pre-wrap", compact && "line-clamp-2")}>{n.body}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{n.author ?? "System"} · {fmtDateTime(n.created_at)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.recent_calls.length > 0 && (
        <section>
          <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><History className="h-3.5 w-3.5" />Recent calls</h4>
          <ul className="space-y-1">
            {d.recent_calls.slice(0, compact ? 3 : 5).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-1.5">
                <Link className="link" href={`/calls/${c.id}`}>{fmtDateTime(c.started_at)}</Link>
                <span className="text-slate-500">{c.direction === "inbound" ? "in" : "out"}{c.department ? ` · ${c.department}` : ""}{c.agent ? ` · ${c.agent}` : ""}</span>
                <Badge tone={statusTone(c.status)}>{c.status.replace("_", " ")}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
      {none && !compact && <p className="text-slate-500">First contact — no history for this number yet.</p>}
    </div>
  );
}
