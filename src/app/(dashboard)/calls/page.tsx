"use client";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { Button, Card, ErrorBox, Loading, PageHeader, SearchInput } from "@/components/common/ui";
import { CallTable } from "@/components/calls/CallTable";
import { Select } from "@/components/common/form";
import type { EnrichedCall } from "@/lib/services/call.service";
import type { Department, TeamMember } from "@/types";

export default function CallsPage() {
  const [f, setF] = useState({ direction: "", status: "", department: "", agent: "", q: "" });
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q: q.trim() })), 300); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  // up to 2,000 latest calls are paged in the browser (CSV export has the full filtered set)
  const calls = useApi<EnrichedCall[]>(`/api/calls?${qs}${qs ? "&" : ""}limit=2000`, 15000);
  const depts = useApi<Department[]>("/api/departments");
  const team = useApi<TeamMember[]>("/api/team");
  const sel = (k: keyof typeof f, label: string, opts: [string, string][]) => (
    <Select className="w-full sm:w-44" aria-label={label} value={f[k]} onChange={(v) => setF((x) => ({ ...x, [k]: v }))}
      options={[{ value: "", label }, ...opts.map(([value, l]) => ({ value, label: l }))]} placeholder={label} searchPlaceholder={`Search ${label.replace(/^All /, "")}…`} />
  );
  return (
    <>
      <PageHeader title="Call history" subtitle="All inbound and outbound Operations calls"
        actions={<a href={`/api/calls?${qs}&format=csv`}><Button variant="secondary"><Download className="h-4 w-4" />Export CSV</Button></a>} />
      <Card>
        <div className="mb-5 flex flex-wrap gap-2">
          <SearchInput className="min-w-52 flex-1" placeholder="Search number, client, agent" maxLength={50} value={q} onChange={(e) => setQ(e.target.value)} />
          {sel("direction", "All directions", [["inbound", "Inbound"], ["outbound", "Outbound"]])}
          {sel("status", "All statuses", ["answered", "completed", "connecting", "missed", "voicemail", "no_answer", "busy", "failed", "in_ivr"].map((s) => [s, s.replace("_", " ")]))}
          {sel("department", "All departments", (depts.data ?? []).map((d) => [d.id, `${d.ivr_key} · ${d.name}`]))}
          {sel("agent", "All agents", (team.data ?? []).map((m) => [m.id, m.full_name]))}
        </div>
        {calls.error ? <ErrorBox message={calls.error} onRetry={calls.reload} /> : calls.loading ? <Loading rows={6} /> : <CallTable calls={calls.data ?? []} resetKey={qs} />}
      </Card>
    </>
  );
}
