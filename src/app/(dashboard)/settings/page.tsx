"use client";
import { useEffect, useState } from "react";
import { History, MessageSquareText, Server, SlidersHorizontal } from "lucide-react";
import { apiFetch, ApiError, useApi } from "@/hooks/useApi";
import { Badge, Button, Card, ErrorBox, Field, Loading, PageHeader, Pagination, cx, enter, useToast } from "@/components/common/ui";
import { usePagination } from "@/hooks/usePagination";
import { useUser } from "@/components/layout/UserContext";
import { routingConfigSchema } from "@/lib/validations";
import { fmtDateTime } from "@/lib/utils/date";
import { CharCount, Select, zodErrors, type Option } from "@/components/common/form";

const TIMEZONES: Option[] = (() => {
  let zones: string[] = [];
  try { zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? []; } catch { /* old browser */ }
  if (!zones.includes("Asia/Kolkata")) zones = ["Asia/Kolkata", ...zones];
  return zones.map((z) => ({ value: z, label: z.replace(/_/g, " "), keywords: z === "Asia/Kolkata" ? "india ist calcutta" : undefined }));
})();
const PROMPT_LIMITS = { known_caller: 200, recording_notice: 300, greeting: 1000, reprompt: 500, sticky_offer: 300, connecting: 300, voicemail: 500, after_hours: 1000 } as const;
const PROMPT_LABELS = { known_caller: "Known-caller welcome", recording_notice: "Recording notice", sticky_offer: "Sticky-agent offer", voicemail: "Voicemail (team busy)", greeting: "Greeting", reprompt: "Re-prompt", after_hours: "After hours", connecting: "Connecting announcement" } as const;
const PROMPT_HINTS: Partial<Record<keyof typeof PROMPT_LIMITS, string>> = { sticky_offer: "After a department key when a sticky agent exists. Use {department} and {name}; 1 = that agent, 2 = CRM desk.", voicemail: "Played before the beep when nobody could take the call.", known_caller: "Spoken first when the caller is a recognised client. {name} = client name. Leave empty to skip.", recording_notice: "Spoken at the start of every live call. Leave empty to skip.", connecting: "Played while an agent with an extension is rung. Use {name} and {extension}." };
import type { RoutingConfig } from "@/lib/constants";
import type { AuditLog } from "@/types";

type AuditRow = AuditLog & { actor_name: string };
type Data = { config: RoutingConfig; audit: AuditRow[]; system: { dataMode: string; telephony: string; telephonyConfigured: boolean } };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function SettingsPage() {
  const { can } = useUser();
  const toast = useToast();
  const q = useApi<Data>("/api/settings");
  const [cfg, setCfg] = useState<RoutingConfig | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setCfg(q.data.config); }, [q.data]);
  const admin = can("settings:write");

  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (!q.data || !cfg) return <Loading rows={6} />;

  async function save() {
    const r = routingConfigSchema.safeParse(cfg);
    if (!r.success) { setErrors(zodErrors(r.error)); toast.error("Please fix the highlighted settings"); return; }
    setErrors({}); setBusy(true);
    try {
      const saved = await apiFetch<{ skipped?: string[] }>("/api/settings", { method: "PUT", body: r.data });
      if (saved.skipped?.length) toast.error(`Saved, except ${saved.skipped.join(", ")}: the database needs the latest TeleCRM migration first`);
      else toast.success("Routing settings saved");
      q.reload();
    }
    catch (e) { setErrors((e as ApiError).fields); toast.error((e as Error).message); } finally { setBusy(false); }
  }
  const oh = cfg.office_hours;
  const setOh = (p: Partial<typeof oh>) => setCfg({ ...cfg, office_hours: { ...oh, ...p } });

  return (
    <>
      <PageHeader title="Settings" subtitle="Routing configuration, IVR prompts and audit history" actions={admin && <Button loading={busy} onClick={save}>Save settings</Button>} />
      <div className="stagger grid gap-6 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><Server className="h-4 w-4" />System</span>}>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Data</dt><dd><Badge tone={q.data.system.dataMode === "supabase" ? "green" : "amber"}>{q.data.system.dataMode}</Badge></dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Telephony</dt><dd><Badge tone="indigo">{q.data.system.telephony}</Badge></dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Exotel credentials</dt><dd><Badge tone={q.data.system.telephonyConfigured && q.data.system.telephony === "exotel" ? "green" : "slate"}>{q.data.system.telephony === "exotel" && q.data.system.telephonyConfigured ? "configured" : "not configured"}</Badge></dd></div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">Exotel native sticky is never used — sticky routing is computed by the CRM.</p>
        </Card>

        <Card title={<span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" />Routing rules</span>} className="lg:col-span-2">
          <fieldset disabled={!admin} className="grid gap-4 sm:grid-cols-2">
            <Field label="Sticky validity (days)" error={errors.sticky_days}><input type="number" inputMode="numeric" min={1} max={30} step={1} className={cx("input", errors.sticky_days && "input-error")} value={Number.isNaN(cfg.sticky_days) ? "" : cfg.sticky_days} onChange={(e) => { setCfg({ ...cfg, sticky_days: e.target.value === "" ? NaN : Math.trunc(Number(e.target.value)) }); setErrors((x) => ({ ...x, sticky_days: "" })); }} /></Field>
            <Field label="Re-prompts on invalid input" error={errors.max_reprompts}><input type="number" inputMode="numeric" min={0} max={3} step={1} className={cx("input", errors.max_reprompts && "input-error")} value={Number.isNaN(cfg.max_reprompts) ? "" : cfg.max_reprompts} onChange={(e) => { setCfg({ ...cfg, max_reprompts: e.target.value === "" ? NaN : Math.trunc(Number(e.target.value)) }); setErrors((x) => ({ ...x, max_reprompts: "" })); }} /></Field>
            <Field label="No sticky for a department" error={errors.dept_miss_behavior} hint={cfg.dept_miss_behavior === "crm" ? "CRM desk takes the call and transfers it, which teaches the sticky agent" : "Ring the department's free members, then the CRM desk"}>
              <Select value={cfg.dept_miss_behavior} onChange={(v) => setCfg({ ...cfg, dept_miss_behavior: v as typeof cfg.dept_miss_behavior })} disabled={!admin} aria-label="No sticky for a department"
                options={[{ value: "crm", label: "Send to CRM desk" }, { value: "ring_department_group", label: "Ring the department team" }]} />
            </Field>
            <Field label="People rung at once (CRM desk / team)" error={errors.parallel_ring_max} hint="1 = one after another. More than 1 needs Exotel parallel ringing (paid add-on)"><input type="number" inputMode="numeric" min={1} max={10} step={1} className={cx("input", errors.parallel_ring_max && "input-error")} value={Number.isNaN(cfg.parallel_ring_max) ? "" : cfg.parallel_ring_max} onChange={(e) => { setCfg({ ...cfg, parallel_ring_max: e.target.value === "" ? NaN : Math.trunc(Number(e.target.value)) }); setErrors((x) => ({ ...x, parallel_ring_max: "" })); }} /></Field>
            <Field label="Key 2: follow outbound calls of the last … days" error={errors.missed_call_window_days} hint="0 = no limit"><input type="number" inputMode="numeric" min={0} max={365} step={1} className={cx("input", errors.missed_call_window_days && "input-error")} value={Number.isNaN(cfg.missed_call_window_days) ? "" : cfg.missed_call_window_days} onChange={(e) => { setCfg({ ...cfg, missed_call_window_days: e.target.value === "" ? NaN : Math.trunc(Number(e.target.value)) }); setErrors((x) => ({ ...x, missed_call_window_days: "" })); }} /></Field>
            <Field label="Opens" error={errors["office_hours.start"]}><input type="time" className={cx("input", errors["office_hours.start"] && "input-error")} value={oh.start} onChange={(e) => setOh({ start: e.target.value })} /></Field>
            <Field label="Closes" error={errors["office_hours.end"]}><input type="time" className={cx("input", errors["office_hours.end"] && "input-error")} value={oh.end} onChange={(e) => setOh({ end: e.target.value })} /></Field>
            <Field label="Timezone" error={errors["office_hours.timezone"]}><Select value={oh.timezone} onChange={(tz) => setOh({ timezone: tz })} options={TIMEZONES.some((o) => o.value === oh.timezone) ? TIMEZONES : [{ value: oh.timezone, label: oh.timezone }, ...TIMEZONES]} invalid={!!errors["office_hours.timezone"]} disabled={!admin} aria-label="Timezone" searchPlaceholder="Search city or region…" /></Field>
            <div>
              <span className="label">Working days</span>
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d, i) => (
                  <button type="button" key={d} aria-pressed={oh.days.includes(i)} onClick={() => setOh({ days: oh.days.includes(i) ? oh.days.filter((x) => x !== i) : [...oh.days, i].sort() })}
                    className={cx("rounded-lg px-3 py-2 text-xs font-semibold transition duration-200 active:scale-95", oh.days.includes(i) ? "bg-brand-600 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200")}>{d}</button>
                ))}
              </div>
              {errors["office_hours.days"] && <p className="mt-1 text-xs text-rose-600">{errors["office_hours.days"]}</p>}
            </div>
          </fieldset>
        </Card>

        <Card title={<span className="flex items-center gap-2"><MessageSquareText className="h-4 w-4" />IVR prompts</span>} className="lg:col-span-3">
          <fieldset disabled={!admin} className="grid gap-4 lg:grid-cols-2">
            {(["known_caller", "recording_notice", "greeting", "reprompt", "sticky_offer", "connecting", "voicemail", "after_hours"] as const).map((k) => (
              <Field key={k} label={PROMPT_LABELS[k]} error={errors[`prompts.${k}`]} hint={PROMPT_HINTS[k]}>
                <textarea className={cx("input min-h-28", errors[`prompts.${k}`] && "input-error")} maxLength={PROMPT_LIMITS[k]} value={cfg.prompts[k]} onChange={(e) => { setCfg({ ...cfg, prompts: { ...cfg.prompts, [k]: e.target.value } }); setErrors((x) => ({ ...x, [`prompts.${k}`]: "" })); }} />
                <span className="mt-1 flex justify-end"><CharCount value={cfg.prompts[k]} max={PROMPT_LIMITS[k]} /></span>
              </Field>
            ))}
          </fieldset>
        </Card>

        {can("audit:read") && (
          <Card title={<span className="flex items-center gap-2"><History className="h-4 w-4" />Audit history</span>} className="lg:col-span-3">
            <AuditTable rows={q.data.audit} />
          </Card>
        )}
      </div>
    </>
  );
}

function AuditTable({ rows }: { rows: AuditRow[] }) {
  const pg = usePagination(rows, { pageSize: 25 });
  if (!rows.length) return <p className="text-sm text-slate-500">No audit entries yet.</p>;
  return (
    <div className="table-bleed">
      <table className="table">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
        <tbody key={`${pg.page}-${pg.pageSize}`}>{pg.rows.map((a, i) => (
          <tr key={a.id} {...enter(i)}><td className="whitespace-nowrap">{fmtDateTime(a.created_at)}</td><td>{a.actor_name}</td><td><Badge>{a.action}</Badge></td><td>{a.entity}</td>
            <td className="max-w-md truncate font-mono text-xs text-slate-500" title={JSON.stringify(a.details)}>{JSON.stringify(a.details)}</td></tr>))}
        </tbody>
      </table>
      <Pagination p={pg} noun="entries" />
    </div>
  );
}
