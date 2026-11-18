"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field } from "../common/ui";
import { PhoneInput, Select, alnumUpper, fieldError, phoneError, phoneHint, zodErrors, type Option } from "../common/form";
import { apiFetch, ApiError } from "@/hooks/useApi";
import { clientCreateSchema, clientSchema } from "@/lib/validations";
import { normalizePhone } from "@/lib/utils/phone";
import type { Client } from "@/types";

type Phone = { phone: string; label: string };
const empty = { name: "", company: "", email: "", pan: "", gstin: "", city: "", status: "active" };
const STATUS: Option[] = [{ value: "active", label: "Active" }, { value: "prospect", label: "Prospect" }, { value: "inactive", label: "Inactive" }];
const LABELS: Option[] = [{ value: "mobile", label: "Mobile" }, { value: "office", label: "Office" }, { value: "home", label: "Home" }, { value: "other", label: "Other" }];
/** Characters stripped as you type; the schema still has the final say. */
const CLEAN: Partial<Record<string, (v: string) => string>> = {
  pan: (v) => alnumUpper(v, 10),
  gstin: (v) => alnumUpper(v, 15),
  email: (v) => v.replace(/\s/g, ""),
};

export function ClientForm({ initial, onSaved, onCancel }: { initial?: Client; onSaved: (c: Client) => void; onCancel?: () => void }) {
  const [v, setV] = useState<Record<string, string>>(initial ? Object.fromEntries(Object.entries(empty).map(([k]) => [k, String(initial[k as keyof Client] ?? "")])) : empty);
  const [phones, setPhones] = useState<Phone[]>([{ phone: "", label: "mobile" }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const schema = initial ? clientSchema : clientCreateSchema;
  const payload = () => (initial ? v : { ...v, phones });

  const change = (k: string, value: string) => {
    setV((x) => ({ ...x, [k]: CLEAN[k]?.(value) ?? value }));
    setErrors((x) => ({ ...x, [k]: "" }));
  };
  // validate a field when the user leaves it (only if they typed something, so the form doesn't start red)
  const blur = (k: string) => { if (v[k]?.trim() || k === "name") setErrors((x) => ({ ...x, [k]: fieldError(schema, payload(), k) })); };

  const setPhone = (i: number, patch: Partial<Phone>) => {
    setPhones((x) => x.map((y, j) => (j === i ? { ...y, ...patch } : y)));
    setErrors((x) => ({ ...x, [`phones.${i}.phone`]: "", phones: "" }));
  };
  const blurPhone = (i: number) => {
    const p = phones[i].phone;
    let err = phoneError(p, phones.length === 1);
    const n = normalizePhone(p);
    if (!err && n && phones.some((o, j) => j !== i && normalizePhone(o.phone) === n)) err = "This number is already in the list";
    setErrors((x) => ({ ...x, [`phones.${i}.phone`]: err }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    const parsed = schema.safeParse(payload());
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error));
      setFormError("Please fix the highlighted fields.");
      return;
    }
    setBusy(true);
    try {
      const saved = await apiFetch<Client>(initial ? `/api/clients?id=${initial.id}` : "/api/clients", { method: initial ? "PATCH" : "POST", body: payload() });
      onSaved(saved);
    } catch (err) {
      const e2 = err as ApiError;
      setErrors(e2.fields ?? {});
      setFormError(e2.message);
    } finally {
      setBusy(false);
    }
  }
  const input = (k: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className={`input ${errors[k] ? "input-error" : ""}`} aria-invalid={!!errors[k] || undefined} value={v[k]}
      onChange={(e) => change(k, e.target.value)} onBlur={() => blur(k)} {...props} />
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {formError && <p role="alert" className="fade-in rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client name" error={errors.name} required>{input("name", { maxLength: 120, autoFocus: true, autoComplete: "name" })}</Field>
        <Field label="Company" error={errors.company}>{input("company", { maxLength: 120, autoComplete: "organization" })}</Field>
        <Field label="Email" error={errors.email}>{input("email", { type: "email", maxLength: 254, autoComplete: "email", placeholder: "name@company.com" })}</Field>
        <Field label="City" error={errors.city}>{input("city", { maxLength: 80, autoComplete: "address-level2" })}</Field>
        <Field label="PAN" error={errors.pan} hint="10 characters, e.g. ABCDE1234F">{input("pan", { maxLength: 10, placeholder: "ABCDE1234F", className: `input font-mono uppercase ${errors.pan ? "input-error" : ""}` })}</Field>
        <Field label="GSTIN" error={errors.gstin} hint="15 characters, e.g. 27ABCDE1234F1Z5">{input("gstin", { maxLength: 15, placeholder: "27ABCDE1234F1Z5", className: `input font-mono uppercase ${errors.gstin ? "input-error" : ""}` })}</Field>
        <Field label="Status" error={errors.status}>
          <Select value={v.status} onChange={(s) => change("status", s)} options={STATUS} aria-label="Status" />
        </Field>
      </div>
      {!initial && (
        <div className="space-y-2">
          <span className="label">Phone numbers <span className="text-rose-500">*</span></span>
          {phones.map((p, i) => {
            const err = errors[`phones.${i}.phone`];
            return (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <PhoneInput value={p.phone} invalid={!!err} aria-label={`Phone ${i + 1}`} onChange={(phone) => setPhone(i, { phone })} onBlur={() => blurPhone(i)} />
                  {err ? <p className="fade-in mt-1 text-xs text-rose-600">{err}</p> : phoneHint(p.phone) && <p className="mt-1 text-xs text-slate-500">{phoneHint(p.phone)}</p>}
                </div>
                <Select className="w-28" value={p.label} onChange={(label) => setPhone(i, { label })} options={LABELS} aria-label={`Type of phone ${i + 1}`} />
                <Button type="button" variant="ghost" disabled={phones.length === 1} onClick={() => { setPhones((x) => x.filter((_, j) => j !== i)); setErrors({}); }} aria-label="Remove phone"><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
          {errors.phones && <p className="text-xs text-rose-600">{errors.phones}</p>}
          {phones.length < 10 && <Button type="button" size="sm" variant="secondary" onClick={() => setPhones((x) => [...x, { phone: "", label: "mobile" }])}><Plus className="h-3 w-3" />Add phone</Button>}
          <p className="text-xs text-slate-500">The first number is primary. Numbers are used to identify the caller on incoming calls.</p>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" loading={busy}>{initial ? "Save changes" : "Create client"}</Button>
      </div>
    </form>
  );
}
