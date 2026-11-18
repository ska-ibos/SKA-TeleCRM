"use client";
import { useState } from "react";
import { CheckCircle2, Delete, PhoneCall, PhoneOff, Voicemail, Volume2 } from "lucide-react";
import { Button, cx } from "../common/ui";
import { Ext } from "../common/Ext";
import type { RouteStep } from "@/types";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const HINT: Record<string, string> = { "1": "CRM", "2": "Missed", "3": "FA 360", "4": "Audit", "5": "MIS", "6": "GST", "7": "Tax", "8": "Accts", "9": "ROC" };

export function IVRMenu({ step, busy, send }: {
  step: RouteStep; busy: boolean;
  send: (action: string, extra?: Record<string, unknown>) => void;
}) {
  const [digits, setDigits] = useState("");
  const [message, setMessage] = useState("");
  const press = (k: string) => {
    if (step.action === "gather_sticky") return send("sticky", { digit: k });
    setDigits((d) => (d + k).slice(0, 6));
  };
  const submit = (value = digits) => { send("input", { digits: value }); setDigits(""); };

  return (
    <div className="space-y-4">
      {step.prompt && (
        <div key={step.prompt} className="pop-in rounded-2xl bg-brand-950 p-4 text-sm leading-relaxed text-brand-50">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brass-300"><Volume2 className="h-3.5 w-3.5" />IVR says</p>
          {step.prompt}
        </div>
      )}

      {(step.action === "gather" || step.action === "gather_sticky") && (
        <>
          {step.action === "gather" && (
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="min-h-8 flex-1 font-mono text-2xl tracking-[0.3em]">{digits || <span className="font-sans text-sm tracking-normal text-slate-500">Single key or 2–6 digit extension</span>}</span>
              <button className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800" onClick={() => setDigits((d) => d.slice(0, -1))} aria-label="Backspace"><Delete className="h-5 w-5" /></button>
            </div>
          )}
          <div className="mx-auto grid max-w-[17rem] grid-cols-3 justify-items-center gap-2.5">
            {KEYS.map((k) => {
              const disabled = busy || (step.action === "gather_sticky" && k !== "1" && k !== "2");
              return (
                <button key={k} disabled={disabled} onClick={() => press(k)}
                  className={cx("flex h-[4.25rem] w-[4.25rem] flex-col items-center justify-center rounded-full border text-xl font-semibold transition duration-150 ease-soft active:scale-90",
                    disabled ? "border-slate-100 text-slate-300" : "border-slate-200 bg-white shadow-sm hover:-translate-y-0.5 hover:border-brand-300 hover:bg-brand-50 hover:shadow-md")}>
                  {k}
                  <span className={cx("text-[9px] font-semibold uppercase", disabled ? "text-slate-300" : "text-slate-500")}>
                    {step.action === "gather_sticky" ? (k === "1" ? "Connect" : k === "2" ? "CRM" : "") : HINT[k] ?? ""}
                  </span>
                </button>
              );
            })}
          </div>
          {step.action === "gather" && (
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy || !digits} onClick={() => submit()}>Send {digits.length > 1 ? "extension" : "key"}</Button>
              <Button variant="secondary" disabled={busy} onClick={() => submit("")}>No input (timeout)</Button>
            </div>
          )}
        </>
      )}

      {step.action === "dial" && (
        <div className="pop-in rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <p className="flex items-center gap-2.5 text-sm text-sky-900">
            <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-100">
              <span className="ping-dot absolute inset-0 rounded-full bg-sky-200" />
              <PhoneCall className="animate-ring relative h-4 w-4" />
            </span>
            <span>Ringing <b>{step.agent?.name}</b><Ext value={step.agent?.extension} />. Choose what the agent does:</span>
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button variant="success" disabled={busy} onClick={() => send("dial_result", { result: "answered" })}>Answers</Button>
            <Button variant="secondary" disabled={busy} onClick={() => send("dial_result", { result: "busy" })}>Busy</Button>
            <Button variant="secondary" disabled={busy} onClick={() => send("dial_result", { result: "no_answer" })}>No answer</Button>
          </div>
        </div>
      )}

      {step.action === "connected" && (
        <div className="pop-in flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Connected to <b>{step.agent?.name}</b><Ext value={step.agent?.extension} />. Transfer below to seed a sticky agent, or hang up.</span>
        </div>
      )}

      {step.action === "voicemail" && (
        <div className="pop-in space-y-2.5 rounded-2xl border border-violet-200 bg-violet-50 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-violet-900"><Voicemail className="h-4 w-4 shrink-0" />Voicemail: a callback reminder was created for the CRM desk</p>
          <textarea className="input" maxLength={500} placeholder="Simulated voicemail message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} />
          <Button disabled={busy} onClick={() => send("voicemail", { message })}>Leave voicemail</Button>
        </div>
      )}

      {step.state !== "ended" && (
        <Button variant="danger" className="w-full" disabled={busy} onClick={() => send("hangup")}><PhoneOff className="h-4 w-4" />Caller hangs up</Button>
      )}
      {step.state === "ended" && <p className="fade-in rounded-2xl bg-slate-100 p-3 text-center text-sm font-medium text-slate-600">Call ended.</p>}
    </div>
  );
}
