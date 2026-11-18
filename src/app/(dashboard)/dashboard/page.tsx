"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, CheckCircle2, FlaskConical, PhoneCall, PhoneIncoming, PhoneMissed, Timer, UserPlus } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { useLiveCalls } from "@/hooks/useLiveCalls";
import { Badge, Card, ErrorBox, LiveDot, Loading, StatusDot } from "@/components/common/ui";
import { StatCard } from "@/components/dashboard/StatCard";
import { RecentCalls } from "@/components/dashboard/RecentCalls";
import { AgentStatus } from "@/components/dashboard/AgentStatus";
import { CallsByHour } from "@/components/dashboard/CallsByHour";
import { useUser } from "@/components/layout/UserContext";
import { fmtDateTime, fmtDuration } from "@/lib/utils/date";
import type { EnrichedCall } from "@/lib/services/call.service";
import type { Reminder, TeamMember } from "@/types";

const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const greetingFor = (h: number) => (h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");

export default function DashboardPage() {
  const { user, can } = useUser();
  const calls = useApi<EnrichedCall[]>(`/api/calls?from=${encodeURIComponent(todayStart())}`, 10000);
  const team = useApi<(TeamMember & { departments: { name: string }[] })[]>("/api/team", 15000);
  const reminders = useApi<(Reminder & { client_name: string | null })[]>(`/api/reminders?status=pending${user.memberId ? "&mine=1" : ""}`);
  const live = useLiveCalls();
  // Set after mount, because the server's clock and timezone differ from the browser's.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  if (calls.error) return <ErrorBox message={calls.error} onRetry={calls.reload} />;
  const c = calls.data ?? [];
  const answered = c.filter((x) => x.answered_at);
  const durations = answered.map((x) => x.duration_sec ?? 0).filter(Boolean);
  const active = (team.data ?? []).filter((m) => m.is_active);
  const liveCount = live.data?.length ?? 0;

  return (
    <>
      <section className="relative mb-6 overflow-hidden rounded-3xl bg-brand-950 px-6 py-7 text-white shadow-lift sm:px-8">
        <div className="bg-dots pointer-events-none absolute inset-0" />
        <div className="hero-glow pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="hero-glow pointer-events-none absolute -bottom-32 left-1/3 h-56 w-56 rounded-full bg-brass-500/10 blur-3xl [animation-delay:-6s]" />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div className="stagger min-w-0">
            <p className="h-5 text-sm text-brand-200">{now?.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
            <h1 className="mt-1 font-display text-3xl font-medium tracking-tight sm:text-4xl">
              {now ? greetingFor(now.getHours()) : "Welcome"}, <span className="name-in inline-block text-brass-300">{user.name.trim().split(/\s+/)[0]}</span>
            </h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-brand-100/85">
              {liveCount > 0 && <LiveDot />}
              {liveCount > 0 ? `${liveCount} ${liveCount === 1 ? "call" : "calls"} live on the Operations line` : "Today's Operations line at a glance"}
            </p>
          </div>
          <div className="slide-in-right flex flex-wrap gap-2 [animation-delay:0.15s]">
            <Link href="/incoming-queue" className="inline-flex items-center gap-2 rounded-xl bg-brass-300 px-4 py-2.5 text-sm font-semibold text-brand-950 transition duration-200 hover:bg-brass-200 active:scale-[0.97]"><PhoneIncoming className="h-4 w-4" />Incoming queue</Link>
            {can("clients:write") && <Link href="/clients/new" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold ring-1 ring-inset ring-white/20 transition duration-200 hover:bg-white/15 active:scale-[0.97]"><UserPlus className="h-4 w-4" />New client</Link>}
            {can("simulator:use") && <Link href="/simulator" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold ring-1 ring-inset ring-white/20 transition duration-200 hover:bg-white/15 active:scale-[0.97]"><FlaskConical className="h-4 w-4" />Simulator</Link>}
          </div>
        </div>
      </section>

      <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Calls today" value={c.length} hint={`${c.filter((x) => x.direction === "inbound").length} inbound`} icon={PhoneCall} />
        <StatCard label="Live now" value={liveCount} hint="In IVR, ringing or connected" icon={PhoneIncoming} accent="sky" />
        <StatCard label="Missed / voicemail" value={c.filter((x) => ["missed", "voicemail", "no_answer"].includes(x.status)).length} hint="Today"icon={PhoneMissed} accent="rose" />
        <StatCard label="Avg talk time" value={fmtDuration(durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0)} hint={`${answered.length} answered`} icon={Timer} accent="green" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Calls by hour">
            {calls.loading ? <Loading rows={2} /> : <CallsByHour calls={c} />}
          </Card>
          <Card title="Recent calls" actions={<Link className="link text-xs" href="/calls">View all</Link>}>
            {calls.loading ? <Loading /> : <RecentCalls calls={c} />}
          </Card>
        </div>
        <Card title={<span className="flex items-center gap-2"><Bell className="h-4 w-4" />{user.memberId ? "My pending reminders" : "Pending reminders"}</span>}
          actions={<Link className="link text-xs" href="/reminders">Open</Link>} className="self-start">
          {reminders.loading ? <Loading rows={3} /> : !reminders.data?.length ? (
            <div className="fade-in flex flex-col items-center gap-2 py-8 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-6 w-6" /></span>
              <p className="text-sm font-semibold text-slate-700">You&apos;re all caught up</p>
            </div>
          ) : (
            <ul className="stagger space-y-2">
              {reminders.data.slice(0, 6).map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-100 p-3 text-sm transition duration-200 hover:border-brand-200">
                  <p className="font-semibold">{r.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">{fmtDateTime(r.due_at)} {r.client_name && `· ${r.client_name}`} {r.source !== "manual" && <Badge tone="amber">{r.source.replace("_", " ")}</Badge>}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6" title="Team availability" actions={active.length > 0 && (
        <span className="flex items-center gap-3 text-xs text-slate-600">
          {(["available", "busy", "offline"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5 capitalize"><StatusDot status={s} />{active.filter((m) => m.status === s).length}<span className="hidden sm:inline">{s}</span></span>
          ))}
        </span>
      )}>
        {team.loading ? <Loading rows={3} /> : <AgentStatus team={team.data ?? []} />}
      </Card>
    </>
  );
}
