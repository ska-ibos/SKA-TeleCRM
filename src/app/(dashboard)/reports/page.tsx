"use client";
import { useState } from "react";
import { CalendarRange, Download, PhoneCall, PhoneMissed, Repeat, Timer } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { Button, Card, ErrorBox, Field, Loading, PageHeader } from "@/components/common/ui";
import { StatCard } from "@/components/dashboard/StatCard";
import { CallTable } from "@/components/calls/CallTable";
import { useUser } from "@/components/layout/UserContext";
import { fmtDuration } from "@/lib/utils/date";
import { MAX_RANGE_DAYS, REPORT_MIN_DATE, dateRangeErrors, fmtYmd, localYmd, rangeDays, rangeToIso, shiftYmd } from "@/lib/utils/date-range";
import type { buildReport } from "@/lib/services/report.service";

type Report = Awaited<ReturnType<typeof buildReport>> & { truncated?: boolean };
const PRESETS: { label: string; range: (today: string) => [string, string] }[] = [
  { label: "Today", range: (t) => [t, t] },
  { label: "Last 7 days", range: (t) => [shiftYmd(-6, t), t] },
  { label: "Last 30 days", range: (t) => [shiftYmd(-29, t), t] },
  { label: "This month", range: (t) => [`${t.slice(0, 8)}01`, t] },
  { label: "Last 90 days", range: (t) => [shiftYmd(-89, t), t] },
];

function Legend() {
  return (
    <span className="flex items-center gap-3 text-xs font-medium text-slate-600">
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-chart-good" />Answered</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-chart-bad" />Missed</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />Other</span>
    </span>
  );
}

function Breakdown({ rows }: { rows: Report["byAgent"] }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  if (!rows.length) return <p className="py-6 text-center text-sm text-slate-500">No data</p>;
  return (
    <div className="table-bleed">
      <table className="table table-compact">
        <thead><tr><th>Name</th><th className="w-full min-w-24">Volume</th><th className="text-right">Total</th><th className="text-right">Answered</th><th className="text-right">Missed</th></tr></thead>
        <tbody>{rows.map((r, i) => {
          const other = Math.max(0, r.total - r.answered - r.missed);
          return (
            <tr key={r.name}>
              <td className="whitespace-nowrap font-semibold">{r.name}</td>
              <td>
                <div className="bar-x flex h-2.5 gap-0.5" style={{ width: `${(r.total / max) * 100}%`, animationDelay: `${i * 50}ms` }}
                  title={`${r.answered} answered, ${r.missed} missed, ${other} other`}>
                  {r.answered > 0 && <span className="rounded-[3px] bg-chart-good" style={{ flexGrow: r.answered }} />}
                  {r.missed > 0 && <span className="rounded-[3px] bg-chart-bad" style={{ flexGrow: r.missed }} />}
                  {other > 0 && <span className="rounded-[3px] bg-slate-300" style={{ flexGrow: other }} />}
                </div>
              </td>
              <td className="text-right font-semibold tabular-nums">{r.total}</td>
              <td className="text-right tabular-nums text-slate-600">{r.answered}</td>
              <td className="text-right tabular-nums text-slate-600">{r.missed}</td>
            </tr>
          );
        })}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const { can } = useUser();
  const today = localYmd();
  const [from, setFrom] = useState(() => shiftYmd(-29)), [to, setTo] = useState(today);
  const errs = dateRangeErrors(from, to, today);
  const valid = !errs.from && !errs.to;
  const qs = valid ? new URLSearchParams(rangeToIso(from, to)).toString() : "";
  const q = useApi<Report>(can("reports:read") && valid ? `/api/reports?${qs}` : null);
  if (!can("reports:read")) return <ErrorBox message="Reports are available to admins, managers and the CRM desk." />;
  const csv = (f: string) => `/api/reports?${qs}&format=${f}`;
  const t = q.data?.totals;
  const download = (f: string, label: string) => valid
    ? <a href={csv(f)}><Button variant="secondary"><Download className="h-4 w-4" />{label}</Button></a>
    : <Button variant="secondary" disabled title="Fix the date range first"><Download className="h-4 w-4" />{label}</Button>;
  // native pickers: From can't pass To (or today); To can't precede From or pass today
  const fromMax = to && to >= REPORT_MIN_DATE && to <= today ? to : today;
  const toMin = from && from >= REPORT_MIN_DATE && from <= today ? from : REPORT_MIN_DATE;

  return (
    <>
      <PageHeader title="Reports" subtitle="Operations call performance" actions={<>
        {download("calls", "Calls CSV")}
        {download("agents", "Agents CSV")}
        {download("departments", "Departments CSV")}
      </>} />
      <Card className="mb-6">
        <div className="flex flex-wrap items-start gap-4">
          <span className="mt-6 hidden h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 sm:grid"><CalendarRange className="h-5 w-5" /></span>
          <Field label="From" required error={errs.from}>
            <input type="date" required aria-invalid={!!errs.from} className={`input ${errs.from ? "input-error" : ""}`} value={from} min={REPORT_MIN_DATE} max={fromMax} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" required error={errs.to} hint={valid ? `${rangeDays(from, to)} ${rangeDays(from, to) === 1 ? "day" : "days"} · max ${MAX_RANGE_DAYS}` : undefined}>
            <input type="date" required aria-invalid={!!errs.to} className={`input ${errs.to ? "input-error" : ""}`} value={to} min={toMin} max={today} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="mt-6 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const [f, tt] = p.range(today);
              const on = f === from && tt === to;
              return <Button key={p.label} size="sm" variant={on ? "primary" : "ghost"} aria-pressed={on} onClick={() => { setFrom(f); setTo(tt); }}>{p.label}</Button>;
            })}
          </div>
        </div>
      </Card>
      {!valid ? <Card><p className="py-6 text-center text-sm text-slate-500">Choose a valid date range above to see the report.</p></Card>
      : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !t ? <Card><Loading rows={5} /></Card> : (
        <>
          {q.data!.truncated && <p className="fade-in mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">This range has more than 2,000 calls, so the figures cover the latest 2,000 only ({fmtYmd(from)} – {fmtYmd(to)}). Narrow the dates for exact totals.</p>}
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total calls" value={t.total} hint={`${t.inbound} in · ${t.outbound} out`} icon={PhoneCall} />
            <StatCard label="Answer rate" value={t.answerRate} suffix="%" hint={`${t.answered} answered`} icon={Repeat} accent="green" />
            <StatCard label="Missed / voicemail" value={t.missed} hint={`${t.afterHours} after hours`} icon={PhoneMissed} accent="rose" />
            <StatCard label="Avg talk time" value={fmtDuration(t.avgDurationSec)} hint={`${t.stickyRouted} sticky · ${t.missedCallRouted} missed-call routed`} icon={Timer} accent="amber" />
          </div>
          <div className="stagger mt-4 grid gap-4 sm:grid-cols-3">
            <StatCard label="Sticky-hit rate" value={t.stickyHitRate} suffix="%" hint={`of ${t.departmentPresses} department key presses had a recent agent`} icon={Repeat} accent="green" />
            <StatCard label="Voicemails" value={t.voicemails} hint="callers who left a message" icon={PhoneMissed} accent="rose" />
            <StatCard label="After-hours calls" value={t.afterHours} hint="outside office hours" icon={Timer} accent="amber" />
          </div>
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
            <Card title="By agent" actions={<Legend />}><Breakdown rows={q.data!.byAgent} /></Card>
            <Card title="By department" actions={<Legend />}><Breakdown rows={q.data!.byDepartment} /></Card>
            <Card title="IVR key usage" className="lg:col-span-2" actions={<Legend />}><Breakdown rows={q.data!.byIvrInput} /></Card>
          </div>
          <Card title="Latest calls in range" className="mt-6"><CallTable calls={q.data!.calls} pageSize={10} /></Card>
        </>
      )}
    </>
  );
}
