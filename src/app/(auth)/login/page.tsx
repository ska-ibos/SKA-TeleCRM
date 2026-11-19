"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, FlaskConical, Lock, PhoneCall, Repeat, ShieldCheck, User } from "lucide-react";
import { apiFetch } from "@/hooks/useApi";
import { loginSchema } from "@/lib/validations";
import { Avatar, Button, ErrorBox, Field, Skeleton, cx } from "@/components/common/ui";
import { Logo } from "@/components/common/Logo";
import { RoutingDiagram } from "@/components/auth/RoutingDiagram";
import { ROLE_LABELS } from "@/lib/constants";
import type { AppRole } from "@/types";

const inputIcon = "pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-brand-600";

function LoginInner() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const reason = useSearchParams().get("reason");
  const [mode, setMode] = useState<{ mode: "supabase" | "demo" | "misconfigured"; missing: string[]; problem?: string } | null>(null);
  const [identifier, setIdentifier] = useState(""), [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ id: string; name: string; role: AppRole }[]>([]);
  const [demoId, setDemoId] = useState("demo-admin");

  useEffect(() => {
    apiFetch<NonNullable<typeof mode>>("/api/auth/config").then((m) => {
      setMode(m);
      if (m.mode === "demo") apiFetch<{ accounts: typeof demo }>("/api/auth/demo").then((d) => setDemo(d.accounts)).catch((e) => setError(e.message));
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    // the dashboard sends signed-in users without TeleCRM access here with a reason
    if (!reason) return;
    const msg: Record<string, string> = {
      not_member: "This login is not a member of the Single Key Advisory workspace.",
      not_provisioned: "Your SKA OS login is correct, but TeleCRM access has not been set up for you yet. Ask a TeleCRM admin to add you under Team.",
      inactive: "Your TeleCRM access has been deactivated. Contact a TeleCRM admin.",
    };
    setError(msg[reason] ?? "You do not have access to TeleCRM.");
    fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  }, [reason]);

  async function passwordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const r = loginSchema.safeParse({ identifier, password });
    if (!r.success) return setErrors(Object.fromEntries(r.error.issues.map((i) => [i.path[0], i.message])));
    setErrors({});
    setBusy(true);
    try {
      await apiFetch("/api/auth/login", { body: r.data });
      router.replace(dest);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  async function demoLogin() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/auth/demo", { body: { accountId: demoId } });
      router.replace(dest);
      router.refresh();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* ---- brand panel ---- */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-950 p-10 text-white lg:flex xl:p-14">
        <div className="bg-dots pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-brand-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-48 -left-24 h-[26rem] w-[26rem] rounded-full bg-brass-500/15 blur-3xl" />

        <div className="fade-in relative flex items-center gap-3">
          <Logo tile="#16453e" className="h-11 w-11" />
          <div>
            <p className="font-display text-lg font-medium leading-tight">SKA TeleCRM</p>
            <p className="text-xs text-brand-200/80">Single Key Advisory Pvt. Ltd.</p>
          </div>
        </div>

        <div className="relative space-y-8">
          <div className="stagger">
            <h1 className="font-display text-4xl font-medium leading-[1.12] tracking-tight xl:text-[3.25rem]">
              Every client call,<br /><span className="text-brass-300">routed to the right person.</span>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-brand-100/85">Operations IVR, sticky-agent routing, missed-call callbacks and a complete client history, all in one place.</p>
          </div>
          <div className="animate-float"><RoutingDiagram /></div>
        </div>

        <ul className="fade-in relative flex flex-wrap gap-x-6 gap-y-2 text-sm text-brand-100/85">
          <li className="flex items-center gap-2"><PhoneCall className="h-4 w-4 text-brass-300" />Smart routing</li>
          <li className="flex items-center gap-2"><Repeat className="h-4 w-4 text-brass-300" />Missed-call callbacks</li>
          <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brass-300" />Role-based access</li>
        </ul>
      </aside>

      {/* ---- sign in ---- */}
      <main className="relative flex items-center justify-center overflow-hidden p-5 sm:p-8">
        <div className="bg-dots-ink pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_55%)]" />
        <div className="relative w-full max-w-md">
          <div className="pop-in card p-6 shadow-lift sm:p-8">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <Logo />
              <div>
                <p className="font-display font-medium leading-tight">SKA TeleCRM</p>
                <p className="text-xs text-slate-500">Single Key Advisory Pvt. Ltd.</p>
              </div>
            </div>
            <h2 className="font-display text-[1.75rem] font-medium leading-tight tracking-tight">Welcome back</h2>
            <p className="mb-6 mt-1 text-sm text-slate-500">Sign in to your Operations workspace.</p>

            {error && <div className="mb-4"><ErrorBox key={error} message={error} /></div>}

            {!mode ? <div className="space-y-3"><Skeleton className="h-11 rounded-xl" /><Skeleton className="h-11 rounded-xl" /></div>
            : mode.mode === "misconfigured" ? (
              <ErrorBox message={mode.missing.length
                ? `Sign-in is unavailable: the server is missing ${mode.missing.join(", ")}. Add it to the server environment (.env) and restart.`
                : `Sign-in is unavailable: ${mode.problem}. Copy all three values from the same project (Supabase → Project Settings → API Keys) into .env and restart.`} />
            ) : mode.mode === "supabase" ? (
              <form onSubmit={passwordLogin} className="space-y-4" noValidate>
                <Field label="Username or email" error={errors.identifier} required>
                  <div className="group relative">
                    <User className={inputIcon} />
                    <input className={cx("input pl-10", errors.identifier && "input-error")} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Your SKA OS username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
                  </div>
                </Field>
                <Field label="Password" error={errors.password} required>
                  <div className="group relative">
                    <Lock className={inputIcon} />
                    <input className={cx("input px-10", errors.password && "input-error")} type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} />
                    <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>
                <Button className="group w-full" loading={busy} type="submit">Sign in{!busy && <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />}</Button>
                <p className="text-center text-xs text-slate-500">Use your SKA OS username and password.</p>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-2.5 rounded-xl border border-brass-300/70 bg-brass-100/70 p-3 text-xs leading-relaxed text-[#6f4f12]">
                  <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
                  <p><b>Demo mode.</b> Supabase is not configured, so data is kept in memory and you can sign in as any role without a password.</p>
                </div>
                <fieldset>
                  <legend className="label">Sign in as</legend>
                  <div className="-mr-1 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {!demo.length && !error && [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
                    {demo.map((a) => (
                      <label key={a.id} className={cx("flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500",
                        demoId === a.id ? "border-brand-500 bg-brand-50/70 ring-1 ring-brand-500" : "border-slate-200 hover:border-brand-200 hover:bg-slate-50")}>
                        <input type="radio" name="demo-account" className="sr-only" checked={demoId === a.id} onChange={() => setDemoId(a.id)} />
                        <Avatar name={a.name} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{a.name}</span>
                          <span className="block text-xs text-slate-500">{ROLE_LABELS[a.role]}</span>
                        </span>
                        <span className={cx("grid h-4 w-4 shrink-0 place-items-center rounded-full border transition", demoId === a.id ? "border-brand-600 bg-brand-600" : "border-slate-300")}>
                          {demoId === a.id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Button className="group w-full" loading={busy} onClick={demoLogin} disabled={!demo.length}>Continue{!busy && <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />}</Button>
              </div>
            )}
          </div>
          <p className="fade-in mt-5 text-center text-xs text-slate-500">Operations team access only</p>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
