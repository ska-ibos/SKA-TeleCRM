"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from "lucide-react";
import { PAGE_SIZES, pageWindow, type PaginationState } from "@/hooks/usePagination";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-sm shadow-brand-900/20 hover:bg-brand-700 hover:shadow-md hover:shadow-brand-900/20",
  secondary: "border border-slate-300/90 bg-white text-slate-700 hover:border-slate-400/70 hover:bg-slate-50",
  danger: "bg-rose-600 text-white shadow-sm shadow-rose-900/20 hover:bg-rose-700",
  success: "bg-emerald-600 text-white shadow-sm shadow-emerald-900/20 hover:bg-emerald-700",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
};
export function Button({ variant = "primary", loading, size = "md", className, children, disabled, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: "sm" | "md" }) {
  return (
    <button {...p} disabled={disabled || loading}
      className={cx("inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition duration-200 ease-soft active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2.5 text-sm", variants[variant], className)}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("card", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
          <h2 className="text-sm font-semibold text-slate-800 [&_svg]:text-brand-600">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const tones = {
  slate: "bg-slate-100 text-slate-700 ring-slate-500/10", green: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20", amber: "bg-brass-100 text-[#6f4f12] ring-brass-500/30",
  blue: "bg-sky-50 text-sky-800 ring-sky-600/20", indigo: "bg-brand-50 text-brand-700 ring-brand-600/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
};
export type Tone = keyof typeof tones;
/** Status values arrive lower-case ("in ivr", "no answer"). Show them in sentence case. */
const sentence = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/\bivr\b/gi, "IVR");
export function Badge({ tone = "slate", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>{typeof children === "string" ? sentence(children) : children}</span>;
}

export const statusTone = (s: string): Tone =>
  ({ answered: "green", completed: "green", available: "green", done: "green", connecting: "blue", in_ivr: "blue", ringing: "blue", queued: "amber",
     busy: "amber", pending: "amber", missed: "red", no_answer: "red", failed: "red", voicemail: "violet", offline: "slate", cancelled: "slate" } as Record<string, Tone>)[s] ?? "slate";

export function Field({ label, error, hint, children, required }: { label: string; error?: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="label">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {children}
      {error ? <span className="fade-in mt-1.5 flex items-center gap-1 text-xs text-rose-600"><AlertCircle className="h-3 w-3" />{error}</span>
        : hint ? <span className="mt-1.5 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function PageHeader({ title, subtitle, actions, leading }: { title: string; subtitle?: string; actions?: ReactNode; leading?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        {leading}
        <div className="min-w-0">
          <h1 className="font-display text-[1.75rem] font-medium leading-tight tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-brand-700">
      <ArrowLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5" />{children}
    </Link>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="fade-in flex flex-col items-center justify-center gap-2 py-12 text-center">
      <span className="mb-1 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-500"><Inbox className="h-6 w-6" /></span>
      <p className="font-semibold text-slate-700">{title}</p>
      {hint && <p className="max-w-sm text-sm text-slate-500">{hint}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

export function Loading({ label = "Loading…", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="fade-in space-y-4 py-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="shake flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{message}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  // Rendered on <body> so no animated or sticky ancestor can trap it.
  return createPortal(
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-brand-950/45 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="pop-in card w-full max-w-lg shadow-pop" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="font-display text-lg font-medium">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- theme pieces ---------------- */
const AVATAR_TINTS = ["bg-brand-100 text-brand-800", "bg-brass-200 text-[#6f4f12]", "bg-sky-100 text-sky-800", "bg-violet-100 text-violet-800", "bg-rose-100 text-rose-800", "bg-slate-200 text-slate-700"];
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/** Name-based initials tile. The same name always gets the same tint. */
export function Avatar({ name, size = "md", children, className }: { name: string; size?: "sm" | "md" | "lg"; children?: ReactNode; className?: string }) {
  const tint = AVATAR_TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TINTS.length];
  return (
    <span className={cx("relative grid shrink-0 place-items-center rounded-full font-semibold", tint,
      size === "sm" ? "h-8 w-8 text-[11px]" : size === "lg" ? "h-14 w-14 text-lg" : "h-10 w-10 text-xs", className)}>
      {initials(name)}{children}
    </span>
  );
}

const DOTS = { available: "bg-emerald-500", busy: "bg-brass-500", offline: "bg-slate-300" } as const;
export function StatusDot({ status, className, pulse }: { status: keyof typeof DOTS; className?: string; pulse?: boolean }) {
  return (
    <span className={cx("relative inline-flex h-2.5 w-2.5 shrink-0", className)}>
      {pulse && status === "available" && <span className={cx("ping-dot absolute inset-0 rounded-full", DOTS[status])} />}
      <span className={cx("relative h-full w-full rounded-full", DOTS[status])} />
    </span>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cx("relative inline-flex h-2 w-2", className)}>
      <span className="ping-dot absolute inset-0 rounded-full bg-emerald-400" />
      <span className="relative h-full w-full rounded-full bg-emerald-500" />
    </span>
  );
}

export function SearchInput({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx("group relative", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-brand-600" />
      <input {...p} className="input pl-10" />
    </div>
  );
}

export function FilterPills({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={cx("rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition duration-200",
            value === o.value ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}>{o.label}</button>
      ))}
    </div>
  );
}

/** Counts up to `value`, and from the old value when it changes on a poll. */
export function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    if (start === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const began = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - began) / 750);
      const eased = 1 - (1 - p) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <span className="tabular-nums">{shown}{suffix}</span>;
}

/** Numbered vertical trail for routing decisions. The latest step is highlighted. */
export function Trail({ items }: { items: string[] }) {
  return (
    <ol className="stagger text-sm">
      {items.map((t, i) => {
        const last = i === items.length - 1;
        return (
          <li key={i} className="relative flex gap-3 pb-3.5 last:pb-0">
            {!last && <span className="absolute bottom-0 left-[11px] top-6 w-px bg-brand-100" />}
            <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
              last ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700")}>{i + 1}</span>
            <span className={cx("pt-0.5", last ? "font-medium text-slate-900" : "text-slate-600")}>{t}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------- toasts ---------------- */
type ToastT = { id: number; kind: "success" | "error"; text: string };
const ToastCtx = createContext<{ success: (t: string) => void; error: (t: string) => void }>({ success: () => {}, error: () => {} });
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastT[]>([]);
  const push = useCallback((kind: ToastT["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  }, []);
  const api = { success: (t: string) => push("success", t), error: (t: string) => push("error", t) };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 left-4 right-4 z-[60] flex flex-col gap-2 sm:left-auto sm:w-80">
        {items.map((t) => (
          <div key={t.id} className={cx("slide-in-right flex items-start gap-2.5 rounded-xl border bg-white px-4 py-3 text-sm font-medium shadow-pop",
            t.kind === "success" ? "border-emerald-200 text-emerald-800" : "border-rose-200 text-rose-700")}>
            {t.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function ConfirmButton({ onConfirm, children, message = "Are you sure?", ...p }: Parameters<typeof Button>[0] & { onConfirm: () => Promise<void> | void; message?: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  return (
    <>
      <Button {...p} onClick={() => setOpen(true)}>{children}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Please confirm"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); setOpen(false); } finally { setBusy(false); } }}>Confirm</Button></>}>
        <p className="text-sm text-slate-600">{message}</p>
      </Modal>
    </>
  );
}

/**
 * Segmented-pill pagination: "Showing 26–50 of 542" · [‹ 1 2 (3) 4 … 22 ›] · "25 / page".
 * A highlight slides to the active page. Hidden when everything fits on the smallest page.
 * Scrolls the list's card back into view on page change so the user lands on the first row.
 */
export function Pagination({ p, noun = "rows", className }: { p: PaginationState; noun?: string; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const hidden = p.total <= PAGE_SIZES[0];
  const items = pageWindow(p.page, p.pageCount);
  const layoutKey = items.join(",");

  // measure the active button so the highlight can slide to it (before paint: no flicker)
  useLayoutEffect(() => {
    if (hidden) return;
    const el = track.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
  }, [hidden, p.page, layoutKey]);

  if (hidden) return null;
  const go = (n: number) => {
    if (n === p.page || n < 1 || n > p.pageCount) return;
    p.setPage(n);
    const card = ref.current?.closest(".card") as HTMLElement | null;
    if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const seg = "relative z-10 grid h-8 min-w-8 place-items-center rounded-full px-2.5 text-xs font-semibold tabular-nums transition-colors duration-300 ease-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500";
  const arrow = "relative z-10 grid h-8 w-8 place-items-center rounded-full text-slate-500 transition duration-200 ease-soft hover:bg-slate-100 hover:text-slate-900 active:scale-90 disabled:pointer-events-none disabled:opacity-30";

  return (
    <nav ref={ref} aria-label="Pagination"
      className={cx("fade-in mt-5 flex flex-col items-center gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-between", className)}>
      <p className="order-2 text-xs text-slate-500 sm:order-1" aria-live="polite">
        Showing <b className="font-semibold tabular-nums text-slate-800">{p.from}–{p.to}</b> of{" "}
        <b className="font-semibold tabular-nums text-slate-800">{p.total.toLocaleString("en-IN")}</b> {noun}
      </p>

      <div ref={track} className="relative order-1 inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-slate-200 bg-white p-1 shadow-sm sm:order-2">
        <span aria-hidden className={cx("pointer-events-none absolute inset-y-1 rounded-full bg-brand-600 shadow-sm shadow-brand-900/25 transition-[left,width] duration-300 ease-soft", !pill && "opacity-0")}
          style={pill ? { left: pill.left, width: pill.width } : undefined} />
        <button type="button" className={arrow} onClick={() => go(p.page - 1)} disabled={p.page <= 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span aria-hidden className="mx-0.5 h-4 w-px bg-slate-200" />
        {items.map((n, i) => n === "gap"
          ? <span key={`gap-${i}`} aria-hidden className="grid h-8 w-6 place-items-center text-xs text-slate-400">…</span>
          : <button key={n} type="button" onClick={() => go(n)} aria-current={n === p.page ? "page" : undefined} aria-label={`Page ${n}`}
              className={cx(seg, n === p.page ? "text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>{n}</button>)}
        <span aria-hidden className="mx-0.5 h-4 w-px bg-slate-200" />
        <button type="button" className={arrow} onClick={() => go(p.page + 1)} disabled={p.page >= p.pageCount} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <label className="order-3 inline-flex items-center rounded-full border border-slate-200 bg-white text-xs text-slate-500 shadow-sm transition hover:border-slate-300 focus-within:border-brand-500">
        <select aria-label="Rows per page" className="h-8 cursor-pointer appearance-none rounded-full bg-transparent pl-3 pr-1 font-semibold tabular-nums text-slate-800 outline-none"
          value={p.pageSize} onChange={(e) => p.setPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="pr-3">/ page</span>
      </label>
    </nav>
  );
}

/** Props for a list row that should rise in with a stagger (see .row-enter in globals.css). */
export const enter = (i: number) => ({ className: "row-enter", style: { "--i": i } as CSSProperties });
