"use client";
import { Avatar, StatusDot } from "../common/ui";
import type { TeamMember } from "@/types";

export function AgentStatus({ team }: { team: (TeamMember & { departments: { name: string }[] })[] }) {
  return (
    <ul className="stagger grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {team.filter((m) => m.is_active).map((m) => (
        <li key={m.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5 transition duration-200 hover:border-brand-200 hover:bg-brand-50/40">
          <Avatar name={m.full_name} size="sm">
            <StatusDot status={m.status} pulse className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white" />
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{m.full_name}{m.extension && <span className="ml-1.5 font-mono text-xs font-normal text-slate-500">#{m.extension}</span>}</p>
            <p className="truncate text-xs text-slate-500">{m.departments.map((d) => d.name).join(", ") || "—"}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
