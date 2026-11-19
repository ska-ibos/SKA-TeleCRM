"use client";
import { useState } from "react";
import { Button, Field, Modal, useToast } from "../common/ui";
import { apiFetch, ApiError, useApi } from "@/hooks/useApi";
import { reminderSchema } from "@/lib/validations";
import { CharCount, Select, zodErrors, type Option } from "../common/form";
import { useUser } from "../layout/UserContext";
import type { TeamMember } from "@/types";

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export function ReminderForm({ open, onClose, clientId, callId, onSaved }: { open: boolean; onClose: () => void; clientId?: string; callId?: string; onSaved: () => void }) {
  const { user } = useUser();
  const toast = useToast();
  const team = useApi<TeamMember[]>(open ? "/api/team" : null);
  const [title, setTitle] = useState(""), [due, setDue] = useState(localInput(new Date(Date.now() + 3600_000)));
  const [assignee, setAssignee] = useState(user.memberId ?? "");
  const [notify, setNotify] = useState<"both" | "in_app" | "whatsapp">("both");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const assignees: Option[] = [{ value: "", label: "— Unassigned —" }, ...(team.data ?? []).filter((m) => m.is_active).map((m) => ({ value: m.id, label: m.full_name, hint: m.status }))];

  async function save() {
    const dueDate = new Date(due);
    const body = { title, due_at: Number.isNaN(dueDate.getTime()) ? "" : dueDate.toISOString(), client_id: clientId ?? null, call_id: callId ?? null, assigned_to: assignee || null, ...(notify !== "both" && { notify_via: notify }) };
    const r = reminderSchema.safeParse(body);
    const errs: Record<string, string> = r.success ? {} : zodErrors(r.error);
    if (!due) errs.due_at = "Choose when the reminder is due";
    else if (r.success && dueDate.getTime() < Date.now() - 60_000) errs.due_at = "Due date must be in the future";
    else if (r.success && dueDate.getTime() > Date.now() + 366 * 86400_000) errs.due_at = "Due date must be within the next year";
    if (Object.keys(errs).length) return setErrors(errs);
    setBusy(true);
    try {
      await apiFetch("/api/reminders", { body });
      toast.success("Reminder created");
      setTitle(""); setErrors({});
      onSaved(); onClose();
    } catch (e) {
      setErrors((e as ApiError).fields ?? {});
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="New reminder" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Create</Button></>}>
      <div className="space-y-4">
        <Field label="Title" error={errors.title} required><input className={`input ${errors.title ? "input-error" : ""}`} maxLength={200} placeholder="e.g. Send GST return copy" value={title}
          onChange={(e) => { setTitle(e.target.value); setErrors((x) => ({ ...x, title: "" })); }}
          onBlur={() => title && title.trim().length < 2 && setErrors((x) => ({ ...x, title: "Title must be at least 2 characters" }))} autoFocus />
          <span className="mt-1 flex justify-end"><CharCount value={title} max={200} /></span></Field>
        <Field label="Due" error={errors.due_at} required><input type="datetime-local" className={`input ${errors.due_at ? "input-error" : ""}`} value={due} min={localInput(new Date())} max={localInput(new Date(Date.now() + 365 * 86400_000))} onChange={(e) => { setDue(e.target.value); setErrors((x) => ({ ...x, due_at: "" })); }} /></Field>
        <Field label="Assign to" error={errors.assigned_to}>
          <Select value={assignee} onChange={setAssignee} options={assignees} aria-label="Assign to" searchPlaceholder="Search team…" />
        </Field>
        {user.whatsapp && (
          <Field label="Notify" hint="WhatsApp goes to the assignee's mobile (Team page) when the reminder is due">
            <Select value={notify} onChange={(v) => setNotify(v as typeof notify)} aria-label="Notify"
              options={[{ value: "both", label: "In the app and on WhatsApp" }, { value: "in_app", label: "In the app only" }, { value: "whatsapp", label: "WhatsApp only" }]} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
