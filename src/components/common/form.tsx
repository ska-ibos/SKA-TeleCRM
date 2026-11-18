"use client";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Phone, Search } from "lucide-react";
import type { ZodError, ZodType } from "zod";
import { formatPhone, normalizePhone } from "@/lib/utils/phone";
import { cx } from "./ui";

/* ======================================================================
 * Select: a searchable dropdown (combobox + listbox, WAI-ARIA pattern).
 * Same contract as a controlled <select>: string value, onChange(value).
 * - Search box appears automatically when there are more than 6 options.
 * - Matches label, hint and keywords; digit queries also match phone numbers
 *   regardless of spaces / +91 ("98765" finds "+91 98765 43210").
 * - Keyboard: ↑ ↓ Home End PageUp PageDown Enter Esc Tab; typing on the closed
 *   trigger opens it with that text already in the search.
 * - Rendered in a portal with fixed positioning so modals and scroll
 *   containers never clip it; flips above the trigger when there is no room.
 * ====================================================================== */
export type Option = { value: string; label: string; hint?: string; keywords?: string; disabled?: boolean };

const MAX_RENDERED = 150;
const digits = (s: string) => s.replace(/\D/g, "");
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

export function filterOptions(options: Option[], query: string): Option[] {
  const tokens = norm(query).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return options;
  return options.filter((o) => {
    const hay = norm(`${o.label} ${o.hint ?? ""} ${o.keywords ?? ""}`);
    const hayDigits = digits(hay);
    // phone-like tokens also match on digits only, so spacing / "+91" formatting doesn't matter
    return tokens.every((t) => hay.includes(t) || (/^[\d+\-()]+$/.test(t) && digits(t).length >= 3 && hayDigits.includes(digits(t))));
  });
}

function Highlight({ text, query }: { text: string; query: string }) {
  const t = norm(query).trim().split(/\s+/).filter(Boolean)[0];
  if (!t) return <>{text}</>;
  const i = norm(text).indexOf(t);
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="rounded-sm bg-brass-200/70 text-inherit">{text.slice(i, i + t.length)}</mark>{text.slice(i + t.length)}</>;
}

export function Select({
  value, onChange, options, placeholder = "Select…", searchable, searchPlaceholder = "Search…", disabled, invalid,
  className, size = "md", id, "aria-label": ariaLabel, emptyText = "No matches",
}: {
  value: string; onChange: (value: string) => void; options: Option[]; placeholder?: string;
  searchable?: boolean; searchPlaceholder?: string; disabled?: boolean; invalid?: boolean;
  className?: string; size?: "sm" | "md"; id?: string; "aria-label"?: string; emptyText?: string;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const withSearch = searchable ?? options.length > 6;

  const selected = options.find((o) => o.value === value);
  const matches = useMemo(() => filterOptions(options, query), [options, query]);
  const shown = matches.slice(0, MAX_RENDERED);

  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    const up = below < 260 && above > below;
    const width = Math.min(Math.max(r.width, 240), window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPos(up ? { left, width, bottom: window.innerHeight - r.top + 6, maxH: Math.min(340, above) } : { left, width, top: r.bottom + 6, maxH: Math.min(340, below) });
  };

  const openWith = (q = "") => {
    if (disabled) return;
    setQuery(q);
    const list0 = filterOptions(options, q);
    const idx = q ? 0 : Math.max(0, list0.findIndex((o) => o.value === value));
    setActive(idx);
    place();
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false); setQuery("");
    if (refocus) trigger.current?.focus();
  };
  const choose = (o: Option | undefined) => {
    if (!o || o.disabled) return;
    if (o.value !== value) onChange(o.value);
    close();
  };

  // focus the search (or the list) once open; keep the popover pinned to the trigger
  useLayoutEffect(() => {
    if (!open) return;
    (withSearch ? search.current : list.current)?.focus({ preventScroll: true });
  }, [open, withSearch]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !pop.current?.contains(t)) close(false);
    };
    const onMove = (e: Event) => { if (!pop.current?.contains(e.target as Node)) place(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", onMove); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < shown.length; i += dir) if (!shown[i].disabled) return i;
    return from;
  };
  const onListKey = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowDown") { e.preventDefault(); setActive((a) => step(a, 1)); }
    else if (k === "ArrowUp") { e.preventDefault(); setActive((a) => step(a, -1)); }
    else if (k === "PageDown") { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 8)); }
    else if (k === "PageUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 8)); }
    else if (k === "Home" && !withSearch) { e.preventDefault(); setActive(step(-1, 1)); }
    else if (k === "End" && !withSearch) { e.preventDefault(); setActive(step(shown.length, -1)); }
    else if (k === "Enter") { e.preventDefault(); choose(shown[active]); }
    else if (k === "Escape") { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); close(); }
    else if (k === "Tab") close(false);
  };
  const onTriggerKey = (e: KeyboardEvent) => {
    if (open) return;
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openWith(); }
    else if (withSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openWith(e.key); }
  };

  return (
    <>
      <button ref={trigger} id={id} type="button" disabled={disabled} role="combobox" aria-label={ariaLabel} aria-haspopup="listbox"
        aria-expanded={open} aria-controls={open ? listId : undefined} aria-invalid={invalid || undefined}
        onClick={() => (open ? close() : openWith())} onKeyDown={onTriggerKey}
        className={cx("input flex items-center justify-between gap-2 text-left", size === "sm" && "py-1.5 text-xs", invalid && "input-error", open && "border-brand-500 ring-4 ring-brand-100", className)}>
        <span className={cx("min-w-0 truncate", !selected && "text-slate-400")}>
          {selected ? selected.label : placeholder}
          {selected?.hint && size !== "sm" && <span className="ml-1.5 text-xs text-slate-500">{selected.hint}</span>}
        </span>
        <ChevronDown className={cx("h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && pos && createPortal(
        <div ref={pop} className="pop-in fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}>
          {withSearch && (
            <div className="relative border-b border-slate-100 p-2">
              <Search className="pointer-events-none absolute left-4.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input ref={search} type="text" className="w-full rounded-lg bg-slate-50 py-2 pl-8 pr-3 text-sm outline-none ring-brand-100 transition focus:bg-white focus:ring-2"
                placeholder={searchPlaceholder} value={query} maxLength={80} autoComplete="off" spellCheck={false}
                role="searchbox" aria-controls={listId} aria-activedescendant={shown[active] ? `${uid}-o${active}` : undefined}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onListKey} />
            </div>
          )}
          <ul ref={list} id={listId} role="listbox" tabIndex={-1} aria-label={ariaLabel} onKeyDown={withSearch ? undefined : onListKey}
            aria-activedescendant={!withSearch && shown[active] ? `${uid}-o${active}` : undefined}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 outline-none">
            {shown.map((o, i) => {
              const isSel = o.value === value;
              return (
                <li key={`${o.value}:${i}`} id={`${uid}-o${i}`} data-idx={i} role="option" aria-selected={isSel} aria-disabled={o.disabled || undefined}
                  onMouseMove={() => !o.disabled && active !== i && setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}
                  className={cx("flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100",
                    o.disabled ? "cursor-not-allowed text-slate-400" : i === active ? "bg-brand-50 text-brand-900" : "text-slate-700",
                    isSel && "font-semibold")}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate"><Highlight text={o.label} query={query} /></span>
                    {o.hint && <span className="block truncate text-xs font-normal text-slate-500"><Highlight text={o.hint} query={query} /></span>}
                  </span>
                  {isSel && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
                </li>
              );
            })}
            {!shown.length && <li className="px-3 py-6 text-center text-sm text-slate-500">{emptyText}{query && <> for “{query}”</>}</li>}
            {matches.length > shown.length && (
              <li className="px-3 py-2 text-center text-xs text-slate-500">Showing {shown.length} of {matches.length.toLocaleString("en-IN")} — type to narrow down</li>
            )}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}

/* ======================================================================
 * Phone input: only accepts characters a phone number can contain, and
 * reports whether the number is valid (Indian 10-digit mobiles, 0-prefixed
 * landlines, +country numbers). Pair with `phoneError` / `phoneHint`.
 * ====================================================================== */
export const sanitizePhone = (v: string) => v.replace(/[^\d+\-() ]/g, "").replace(/(?!^)\+/g, "").slice(0, 20);

/** Error text for a phone field, or "" when fine. Empty is OK unless `required`. */
export function phoneError(v: string, required = false): string {
  const s = v.trim();
  if (!s) return required ? "Phone number is required" : "";
  const d = digits(s);
  if (d.length < 10) return "Phone number is too short — enter 10 digits (e.g. 98765 43210)";
  if (d.length > 15) return "Phone number is too long";
  if (!s.startsWith("+") && d.length === 10 && !/^[6-9]/.test(d)) return "Indian mobile numbers start with 6, 7, 8 or 9";
  return normalizePhone(s) ? "" : "Enter a valid phone number (e.g. 98765 43210 or +91 98765 43210)";
}
/** "Saved as +91 98765 43210" once the number is valid. */
export const phoneHint = (v: string) => { const n = normalizePhone(v); return n ? `Saved as ${formatPhone(n)}` : undefined; };

export function PhoneInput({ value, onChange, invalid, className, ...p }:
  Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  return (
    <div className={cx("relative", className)}>
      <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input {...p} type="tel" inputMode="tel" autoComplete={p.autoComplete ?? "tel"} maxLength={20} placeholder={p.placeholder ?? "98765 43210"}
        aria-invalid={invalid || undefined} value={value} onChange={(e) => onChange(sanitizePhone(e.target.value))}
        className={cx("input pl-10 font-mono", invalid && "input-error")} />
    </div>
  );
}

/* ======================================================================
 * Validation helpers shared by forms (the API re-validates with the same
 * Zod schemas, so these only give earlier, field-level feedback).
 * ====================================================================== */
export const zodErrors = (e: ZodError): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const i of e.issues) { const k = i.path.join("."); if (!out[k]) out[k] = i.message; }
  return out;
};
/** Error for one field (dot path) after validating the whole object; "" when the field is fine. */
export function fieldError(schema: ZodType, data: unknown, key: string): string {
  const r = schema.safeParse(data);
  return r.success ? "" : zodErrors(r.error)[key] ?? "";
}
/** Upper-case and strip everything but letters/digits (PAN, GSTIN). */
export const alnumUpper = (v: string, max: number) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, max);

/** Small "n / max" counter for long text fields. */
export function CharCount({ value, max }: { value: string; max: number }): ReactNode {
  const n = value.length;
  return <span className={cx("text-xs tabular-nums", n > max * 0.9 ? "text-amber-700" : "text-slate-500")}>{n.toLocaleString("en-IN")}/{max.toLocaleString("en-IN")}</span>;
}
