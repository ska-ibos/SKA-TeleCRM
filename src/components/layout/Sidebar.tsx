"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bell, Building2, FlaskConical, Hash, LayoutDashboard, PhoneCall, PhoneIncoming, Settings, StickyNote, Users, UserSquare2, X } from "lucide-react";
import { cx } from "../common/ui";
import { Logo } from "../common/Logo";
import { useUser } from "./UserContext";
import type { Permission } from "@/lib/constants";

export const NAV: { href: string; label: string; icon: typeof Users; perm?: Permission; group: string }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { href: "/incoming-queue", label: "Incoming Queue", icon: PhoneIncoming, group: "Overview" },
  { href: "/clients", label: "Clients", icon: UserSquare2, group: "CRM" },
  { href: "/calls", label: "Call History", icon: PhoneCall, group: "CRM" },
  { href: "/notes", label: "Notes", icon: StickyNote, group: "CRM" },
  { href: "/reminders", label: "Reminders", icon: Bell, group: "CRM" },
  { href: "/simulator", label: "Call Simulator", icon: FlaskConical, group: "Telephony", perm: "simulator:use" },
  { href: "/team", label: "Team", icon: Users, group: "Admin" },
  { href: "/departments", label: "Departments", icon: Building2, group: "Admin" },
  { href: "/extensions", label: "Extensions", icon: Hash, group: "Admin" },
  { href: "/reports", label: "Reports", icon: BarChart3, group: "Admin", perm: "reports:read" },
  { href: "/settings", label: "Settings", icon: Settings, group: "Admin" },
];

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const path = usePathname();
  const { can } = useUser();
  const groups = [...new Set(NAV.filter((n) => !n.perm || can(n.perm)).map((n) => n.group))];
  return (
    <aside className={cx("fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col bg-brand-950 text-white transition-transform duration-300 ease-soft lg:translate-x-0", open ? "translate-x-0 shadow-pop" : "-translate-x-full")}>
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative flex h-16 shrink-0 items-center gap-3 px-5">
        <Logo tile="#16453e" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-medium leading-tight">SKA TeleCRM</p>
          <p className="text-[11px] tracking-wide text-brand-200/80">Operations</p>
        </div>
        <button onClick={onNavigate} className="rounded-lg p-1.5 text-brand-200 transition hover:bg-white/10 lg:hidden" aria-label="Close menu"><X className="h-5 w-5" /></button>
      </div>
      <nav className="relative flex-1 overflow-y-auto px-3 py-3 [scrollbar-color:rgb(255_255_255/0.2)_transparent]">
        {groups.map((g) => (
          <div key={g} className="mb-5">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-200/60">{g}</p>
            {NAV.filter((n) => n.group === g && (!n.perm || can(n.perm))).map((n) => {
              const active = path === n.href || path.startsWith(`${n.href}/`);
              return (
                <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
                  className={cx("group relative mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition duration-200",
                    active ? "bg-white/10 text-white" : "text-brand-100/80 hover:bg-white/5 hover:text-white")}>
                  <span className={cx("absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-brass-400 transition-all duration-300 ease-soft", active ? "h-5" : "h-0")} />
                  <n.icon className={cx("h-[18px] w-[18px] shrink-0 transition duration-200 group-hover:scale-110", active && "text-brass-300")} />{n.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <p className="relative shrink-0 border-t border-white/10 px-5 py-3.5 text-[11px] text-brand-200/70">Single Key Advisory Pvt. Ltd.</p>
    </aside>
  );
}
