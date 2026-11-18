"use client";
import { useState } from "react";
import { Button, Field, Modal, useToast } from "../common/ui";
import { apiFetch, newKey, useApi } from "@/hooks/useApi";
import { useUser } from "../layout/UserContext";
import { formatPhone, normalizePhone } from "@/lib/utils/phone";
import { Select, type Option } from "../common/form";
import type { DialResult, TeamMember } from "@/types";

/** Click-to-call through the CRM. In simulation mode the outcome is chosen here. */
export function OutboundDialog({ open, onClose, phones, onDone, at }: { open: boolean; onClose: () => void; phones: string[]; onDone?: () => void; at?: string }) {
  const { user } = useUser();
  const toast = useToast();
  const team = useApi<TeamMember[]>(open ? "/api/team" : null);
  const [agent, setAgent] = useState(user.memberId ?? "");
  const [to, setTo] = useState(phones[0] ?? "");
  const [result, setResult] = useState<DialResult>("no_answer");
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const agents: Option[] = (team.data ?? []).filter((m) => m.is_active).map((m) => ({ value: m.id, label: m.full_name, hint: m.status }));
  const numbers: Option[] = [...new Set(phones)].map((p) => ({ value: p, label: formatPhone(p) }));
  const OUTCOMES: Option[] = [{ value: "no_answer", label: "Client did not answer (missed call)" }, { value: "answered", label: "Client answered" }, { value: "busy", label: "Client busy" }, { value: "failed", label: "Failed" }];

  async function call() {
    const errs: Record<string, string> = {};
    if (!agent) errs.agent = "Choose the agent placing the call";
    if (!normalizePhone(to || phones[0])) errs.to = "This client has no valid phone number";
    if (Object.keys(errs).length) return setErrors(errs);
    setBusy(true);
    try {
      await apiFetch("/api/call/outbound", { body: { agent_id: agent, to: to || phones[0], result, at, idempotencyKey: `${key}-${agent}-${to}-${result}` } });
      toast.success("Outbound call saved to history");
      onDone?.(); onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Call client" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={call}>Place call</Button></>}>
      <div className="space-y-4">
        <p className="rounded-xl bg-brass-100 px-3 py-2 text-xs font-semibold text-[#6f4f12]">SIMULATION — NO REAL PHONE CALL (until Exotel is configured)</p>
        <Field label="Agent" error={errors.agent} required>
          <Select value={agent} onChange={(a) => { setAgent(a); setErrors((x) => ({ ...x, agent: "" })); }} options={agents} placeholder="— choose —" disabled={user.role === "agent"} invalid={!!errors.agent} aria-label="Agent" searchPlaceholder="Search team…" />
        </Field>
        {(phones.length > 1 || errors.to) && (
          <Field label="Number" error={errors.to}><Select value={to} onChange={setTo} options={numbers} invalid={!!errors.to} aria-label="Number" /></Field>
        )}
        <Field label="Simulated outcome">
          <Select value={result} onChange={(r) => setResult(r as DialResult)} options={OUTCOMES} aria-label="Simulated outcome" />
        </Field>
      </div>
    </Modal>
  );
}
