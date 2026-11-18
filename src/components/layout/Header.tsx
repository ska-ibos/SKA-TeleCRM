"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, LogOut, Menu } from "lucide-react";
import { Avatar, Badge, Button, StatusDot, cx, useToast } from "../common/ui";
import { NAV } from "./Sidebar";
import { useUser } from "./UserContext";
import { apiFetch } from "@/hooks/useApi";
import { ROLE_LABELS } from "@/lib/constants";
import type { AgentStatus } from "@/types";

const STATUSES: { value: AgentStatus; label: string }[] = [
  { value: "available", label: "Available" }, { value: "busy", label: "Busy" }, { value: "offline", label: "Offline" },
];

export function Header({ onMenu }: { onMenu: () => void }) {
  const { user } = useUser();
  const router = useRouter();
  const path = usePathname();
  const toast = useToast();
  const [status, setStatus] = useState<AgentStatus | "">("");
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
