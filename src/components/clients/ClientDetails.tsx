"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Hash, Pencil, Phone, Plus, Star, Trash2, X } from "lucide-react";
import { Badge, Button, Card, ConfirmButton, Modal, statusTone, useToast } from "../common/ui";
import { apiFetch } from "@/hooks/useApi";
import { useUser } from "../layout/UserContext";
import { ClientForm } from "./ClientForm";
import { Ext } from "../common/Ext";
import { ClientTimeline } from "./ClientTimeline";
import { ReminderForm } from "../reminders/ReminderForm";
import { OutboundDialog } from "../calls/OutboundDialog";
import { formatPhone, normalizePhone } from "@/lib/utils/phone";
import { CharCount, PhoneInput, phoneError, phoneHint } from "../common/form";
import { tagSchema } from "@/lib/validations";
import { fmtDateTime } from "@/lib/utils/date";
import type { getClientDetail } from "@/lib/services/client.service";

type Detail = Awaited<ReturnType<typeof getClientDetail>>;

export function ClientDetails({ d, reload }: { d: Detail; reload: () => void }) {
  const { can, user } = useUser();
  const toast = useToast();
  const router = useRouter();
  const masterOwned = Boolean(user.clientsManagedExternally);
  const [edit, setEdit] = useState(false), [remind, setRemind] = useState(false), [dial, setDial] = useState(false);
  const [phone, setPhone] = useState(""), [phoneErr, setPhoneErr] = useState("");
  const [note, setNote] = useState(""), [noteBusy, setNoteBusy] = useState(false);
  const [newTag, setNewTag] = useState(""), [tagErr, setTagErr] = useState("");
  const write = can("clients:write");

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast.success(msg); reload(); } catch (e) { toast.error((e as Error).message); }
  };
  async function addPhone() {
    const err = phoneError(phone, true);
    if (err) return setPhoneErr(err);
    const n = normalizePhone(phone);
    if (d.phones.some((p) => p.phone === n)) return setPhoneErr("This client already has that number");
    setPhoneErr("");
    await run(() => apiFetch("/api/clients/phones", { body: { client_id: d.client.id, phone, label: "mobile" } }), "Phone added");
    setPhone("");
  }
  async function addNote() {
    if (!note.trim()) return;
    setNoteBusy(true);
    await run(() => apiFetch("/api/notes", { body: { client_id: d.client.id, body: note } }), "Note added");
    setNote(""); setNoteBusy(false);
  }
  async function addTag() {
    const name = newTag.trim().replace(/\s+/g, " ");
    if (!name) return setTagErr("Type a tag name");
    const existing = d.allTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      const r = tagSchema.shape.name.safeParse(name);
      if (!r.success) return setTagErr(r.error.issues[0].message);
    }
    if (existing && d.tags.some((t) => t.id === existing.id)) return setTagErr("This client already has that tag");
    setTagErr("");
    await run(async () => {
      const tag = existing ?? await apiFetch<{ id: string }>("/api/tags", { body: { name, color: ["#1f6a5d", "#0369a1", "#a67a28", "#b45309", "#be123c", "#6d28d9"][d.allTags.length % 6] } });
      await apiFetch("/api/tags", { body: { client_id: d.client.id, tag_id: tag.id } });
    }, "Tag added");
    setNewTag("");
  }

  const c = d.client;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6">
        <Card title="Client" actions={write && !masterOwned && <>
          <Button size="sm" variant="secondary" onClick={() => setEdit(true)}><Pencil className="h-3 w-3" />Edit</Button>
          {can("clients:delete") && <ConfirmButton size="sm" variant="ghost" message={`Delete ${c.name}? Phones, notes, tags and reminders will be removed. Call history is kept.`}
            onConfirm={async () => { try { await apiFetch(`/api/clients?id=${c.id}`, { method: "DELETE" }); toast.success("Client deleted"); router.push("/clients"); } catch (e) { toast.error((e as Error).message); } }}><Trash2 className="h-3 w-3" /></ConfirmButton>}
        </>}>
          <dl className="grid grid-cols-3 gap-y-2.5 text-sm">
            {[["Company", c.company], ["Email", c.email], ["City", c.city], ["PAN", c.pan], ["GSTIN", c.gstin], ["Added", fmtDateTime(c.created_at)]].map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="col-span-2 break-all font-medium">{v || "—"}</dd></div>
            ))}
            <dt className="text-slate-500">Status</dt><dd className="col-span-2"><Badge tone={statusTone(c.status === "active" ? "answered" : "pending")}>{c.status}</Badge></dd>
          </dl>
          {masterOwned && <p className="mt-3 text-xs text-slate-500">Client details are managed in SKA OS.</p>}
          <Button className="mt-4 w-full" onClick={() => setDial(true)}><Phone className="h-4 w-4" />Call client</Button>
        </Card>

        <Card title="Phone numbers">
          <ul className="space-y-2">
            {d.phones.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5 text-sm transition duration-200 hover:border-brand-200">
                <span className="flex items-center gap-2">{p.is_primary && <Star className="h-3.5 w-3.5 fill-brass-400 text-brass-400" />}<span className="font-mono text-[13px]">{formatPhone(p.phone)}</span> <span className="text-xs capitalize text-slate-500">{p.label}</span>{p.source && p.source !== "telecrm" && <Badge className="ml-1">SKA OS</Badge>}</span>
                {write && d.phones.length > 1 && (p.source ?? "telecrm") === "telecrm" && <button className="rounded-md p-0.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" aria-label="Remove phone" onClick={() => run(() => apiFetch(`/api/clients/phones?id=${p.id}`, { method: "DELETE" }), "Phone removed")}><X className="h-4 w-4" /></button>}
              </li>
            ))}
          </ul>
          {write && (
            <div className="mt-3 flex gap-2">
              <div className="flex-1"><PhoneInput placeholder="Add number" value={phone} invalid={!!phoneErr} aria-label="Add phone number" onChange={(v) => { setPhone(v); setPhoneErr(""); }} onKeyDown={(e) => e.key === "Enter" && addPhone()} onBlur={() => phone && setPhoneErr(phoneError(phone))} />
                {phoneErr ? <p className="fade-in mt-1 text-xs text-rose-600">{phoneErr}</p> : phoneHint(phone) && <p className="mt-1 text-xs text-slate-500">{phoneHint(phone)}</p>}</div>
              <Button variant="secondary" onClick={addPhone}><Plus className="h-4 w-4" /></Button>
            </div>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2"><Hash className="h-4 w-4" />Direct extensions</span>}>
          {!d.contacts.length ? <p className="text-sm text-slate-500">No conversations yet. People who answer or call this client will appear here with their extension.</p> : (
            <ul className="space-y-2">
              {d.contacts.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-slate-500">{p.departments.length ? p.departments.join(", ") + " · " : ""}{p.last_direction === "outbound" ? "called them" : "spoke"} {fmtDateTime(p.last_at)}</p>
                  </div>
                  {p.extension ? <Ext value={p.extension} className="shrink-0 text-xs" /> : <span className="shrink-0 text-xs text-slate-400">no ext.</span>}
                </li>
              ))}
            </ul>
          )}
          {d.contacts.some((p) => p.extension) && <p className="mt-3 text-xs text-slate-500">Share these with the client: they can enter the extension at the greeting to reach that person directly.</p>}
        </Card>

        <Card title="Tags">
          <div className="flex flex-wrap gap-1.5">
            {d.tags.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white" style={{ background: t.color }}>
                {t.name}{can("tags:write") && <button aria-label={`Remove ${t.name}`} onClick={() => run(() => apiFetch(`/api/tags?client_id=${c.id}&tag_id=${t.id}`, { method: "DELETE" }), "Tag removed")}><X className="h-3 w-3" /></button>}
              </span>
            ))}
            {!d.tags.length && <p className="text-sm text-slate-500">No tags</p>}
          </div>
          {can("tags:write") && (
            <div className="mt-3 flex gap-2">
              <div className="flex-1"><input className={`input ${tagErr ? "input-error" : ""}`} list="tag-list" placeholder="Add tag (e.g. GST, VIP)" maxLength={40} aria-label="Add tag" value={newTag} onChange={(e) => { setNewTag(e.target.value.replace(/[^\p{L}0-9 _-]/gu, "")); setTagErr(""); }} onKeyDown={(e) => e.key === "Enter" && addTag()} />
                {tagErr && <p className="fade-in mt-1 text-xs text-rose-600">{tagErr}</p>}</div>
              <datalist id="tag-list">{d.allTags.map((t) => <option key={t.id} value={t.name} />)}</datalist>
              <Button variant="secondary" onClick={addTag}><Plus className="h-4 w-4" /></Button>
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-6 lg:col-span-2">
        <Card title="Add note">
          <textarea className="input min-h-24" maxLength={5000} placeholder="What was discussed? Next steps?" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="mt-2 flex items-center justify-between">
            <CharCount value={note} max={5000} />
            <Button loading={noteBusy} disabled={!note.trim()} onClick={addNote}>Save note</Button>
          </div>
        </Card>

        <Card title="Reminders" actions={<Button size="sm" variant="secondary" onClick={() => setRemind(true)}><Bell className="h-3 w-3" />New</Button>}>
          {!d.reminders.length ? <p className="text-sm text-slate-500">No reminders</p> : (
            <ul className="space-y-2">
              {d.reminders.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5 text-sm transition duration-200 hover:border-brand-200">
                  <div><p className={r.status === "done" ? "text-slate-500 line-through" : "font-semibold"}>{r.title}</p>
                    <p className="text-xs text-slate-500">{fmtDateTime(r.due_at)} · {r.assigned_name ?? "Unassigned"}</p></div>
                  {r.status === "pending" ? <Button size="sm" variant="secondary" onClick={() => run(() => apiFetch("/api/reminders", { method: "PATCH", body: { id: r.id, status: "done" } }), "Marked done")}><Check className="h-3 w-3" />Done</Button>
                    : <Badge tone={statusTone(r.status)}>{r.status}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Activity timeline"><ClientTimeline calls={d.calls} notes={d.notes} /></Card>
      </div>

      <Modal open={edit} onClose={() => setEdit(false)} title="Edit client">
        <ClientForm initial={c} onCancel={() => setEdit(false)} onSaved={() => { setEdit(false); toast.success("Client updated"); reload(); }} />
      </Modal>
      <ReminderForm open={remind} onClose={() => setRemind(false)} clientId={c.id} onSaved={reload} />
      <OutboundDialog open={dial} onClose={() => setDial(false)} phones={d.phones.map((p) => p.phone)} onDone={reload} />
    </div>
  );
}
