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
const PROMPT_LIMITS = { greeting: 1000, reprompt: 500, after_hours: 1000, connecting: 300 } as const;
const PROMPT_LABELS = { greeting: "Greeting", reprompt: "Re-prompt", after_hours: "After hours", connecting: "Connecting announcement" } as const;
const PROMPT_HINTS: Partial<Record<keyof typeof PROMPT_LIMITS, string>> = { connecting: "Played while an agent with an extension is rung. Use {name} and {extension}." };
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
    try { await apiFetch("/api/settings", { method: "PUT", body: r.data }); toast.success("Routing settings saved"); q.reload(); }
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
            {(["greeting", "reprompt", "after_hours", "connecting"] as const).map((k) => (
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
