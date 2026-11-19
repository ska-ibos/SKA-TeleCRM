"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronRight, LogOut, Menu } from "lucide-react";
import { Avatar, Badge, Button, StatusDot, cx, useToast } from "../common/ui";
import { NAV } from "./Sidebar";
import { useUser } from "./UserContext";
import { apiFetch, useApi } from "@/hooks/useApi";
import { ROLE_LABELS } from "@/lib/constants";
import type { AgentStatus, Reminder, TeamMember } from "@/types";

const STATUSES: { value: AgentStatus; label: string }[] = [
  { value: "available", label: "Available" }, { value: "busy", label: "Busy" }, { value: "offline", label: "Offline" },
];

export function Header({ onMenu }: { onMenu: () => void }) {
  const { user } = useUser();
  const router = useRouter();
  const path = usePathname();
  const toast = useToast();
  const [status, setStatus] = useState<AgentStatus | "">("");
  // current availability, so the toggle shows the real state after a reload
  const team = useApi<TeamMember[]>(user.memberId ? "/api/team" : null);
  const myStatus = team.data?.find((m) => m.id === user.memberId)?.status;
  useEffect(() => { if (myStatus) setStatus((s) => s || myStatus); }, [myStatus]);
  // in-app reminder notification (spec §8.5): my pending reminders that are due
  const reminders = useApi<Reminder[]>(user.memberId ? "/api/reminders?status=pending&mine=1" : null, 60_000);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const due = now ? (reminders.data ?? []).filter((r) => new Date(r.due_at).getTime() <= now).length : 0;
  const page = NAV.find((n) => path === n.href || path.startsWith(`${n.href}/`));

  async function changeStatus(s: AgentStatus) {
    try {
      await apiFetch("/api/team", { method: "PATCH", body: { id: user.memberId, status: s } });
      setStatus(s);
      toast.success(`You are now ${s}`);
    } catch (e) { toast.error((e as Error).message); }
  }
  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-slate-200/80 bg-paper/85 px-4 backdrop-blur-md sm:gap-3 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-200/60 lg:hidden" onClick={onMenu} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
        {page && (
          <p className="hidden items-center gap-1.5 text-sm md:flex">
            <span className="text-slate-500">{page.group}</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-semibold text-slate-800">{page.label}</span>
          </p>
        )}
        {user.mode === "demo" && <span className="hidden xl:block"><Badge tone="amber">Demo mode — in-memory data</Badge></span>}
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {user.memberId && (
          <div role="group" aria-label="My availability" className="flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm">
            {STATUSES.map((s) => (
              <button key={s.value} type="button" aria-pressed={status === s.value} aria-label={s.label} title={s.label} onClick={() => changeStatus(s.value)}
                className={cx("flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-xs font-semibold transition duration-200 sm:px-2.5",
                  status === s.value ? "bg-brand-50 text-brand-800" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800")}>
                <StatusDot status={s.value} pulse={status === s.value} />
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            ))}
          </div>
        )}
        {user.memberId && (
          <Link href="/reminders" aria-label={due ? `${due} reminders due` : "Reminders"} title={due ? `${due} reminder${due === 1 ? "" : "s"} due` : "No reminders due"}
            className="relative rounded-lg p-2 text-slate-600 transition hover:bg-slate-200/60">
            <Bell className={cx("h-5 w-5", due > 0 && "animate-ring text-rose-600")} />
            {due > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">{due > 99 ? "99+" : due}</span>}
          </Link>
        )}
        <div className="flex items-center gap-2.5">
          <Avatar name={user.name} size="sm" />
          <div className="hidden text-left sm:block">
            <p className="text-sm font-semibold leading-tight">{user.name}</p>
            <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" /></Button>
      </div>
    </header>
  );
}
