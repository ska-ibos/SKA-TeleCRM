"use client";
import Link from "next/link";
import { useState } from "react";
import { PhoneIncoming, X } from "lucide-react";
import { useLiveCalls } from "@/hooks/useLiveCalls";
import { useUser } from "../layout/UserContext";
import { formatPhone } from "@/lib/utils/phone";
import { Avatar, Badge } from "../common/ui";

/** Screen-pop: shows the caller's CRM record when a call is ringing for the signed-in agent. */
export function IncomingCallScreen() {
  const { user } = useUser();
  const { data } = useLiveCalls();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const ringing = (data ?? []).filter((c) => c.status === "connecting" && c.direction === "inbound" && c.routed_agent_id === user.memberId && !dismissed.includes(c.id));
  if (!user.memberId || !ringing.length) return null;
  const c = ringing[0];
  return (
    <div className="slide-in-right fixed left-4 right-4 top-20 z-50 overflow-hidden rounded-2xl bg-white shadow-pop ring-1 ring-brand-200 sm:left-auto sm:w-80">
      <div className="relative flex items-center justify-between overflow-hidden bg-brand-900 px-4 py-3 text-white">
        <span className="flex items-center gap-3 text-sm font-semibold">
          <span className="relative grid h-7 w-7 place-items-center rounded-full bg-brass-300 text-brand-950">
            <span className="ping-dot absolute inset-0 rounded-full bg-brass-300" />
            <PhoneIncoming className="animate-ring relative h-3.5 w-3.5" />
          </span>
          Incoming call
        </span>
        <button onClick={() => setDismissed((d) => [...d, c.id])} aria-label="Dismiss" className="rounded-lg p-1 transition hover:bg-white/10"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-3 p-4 text-sm">
        <div className="flex items-center gap-3">
          <Avatar name={c.client_name ?? "Unknown caller"} />
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-medium leading-tight">{c.client_name ?? "Unknown caller"}</p>
            <p className="font-mono text-xs text-slate-500">{formatPhone(c.from_number)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {c.department_name && <Badge tone="indigo">{c.department_name}</Badge>}
          {c.is_simulated && <Badge tone="amber">Simulation</Badge>}
        </div>
        <p className="text-xs text-slate-500">{c.route_reason}</p>
        <div className="flex gap-3 border-t border-slate-100 pt-3 text-sm">
          {c.client_id && <Link className="link" href={`/clients/${c.client_id}`}>Open client</Link>}
          <Link className="link" href={`/calls/${c.id}`}>Call details</Link>
        </div>
      </div>
    </div>
  );
}
