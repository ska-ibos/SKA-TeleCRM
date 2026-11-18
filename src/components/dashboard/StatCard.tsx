"use client";
import type { LucideIcon } from "lucide-react";
import { AnimatedNumber } from "../common/ui";

const accents = {
  indigo: "bg-brand-50 text-brand-600", green: "bg-emerald-50 text-emerald-700",
  amber: "bg-brass-100 text-brass-600", rose: "bg-rose-50 text-rose-600", sky: "bg-sky-50 text-sky-700",
};

export function StatCard({ label, value, suffix, hint, icon: Icon, accent = "indigo" }: { label: string; value: string | number; suffix?: string; hint?: string; icon: LucideIcon; accent?: keyof typeof accents }) {
  return (
    <div className="card card-lift group flex items-start justify-between gap-3 p-5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
        <p className="mt-1.5 font-display text-[2rem] font-medium leading-none tracking-tight text-slate-900">
          {typeof value === "number" ? <AnimatedNumber value={value} suffix={suffix} /> : value}
        </p>
        {hint && <p className="mt-2 truncate text-xs text-slate-500">{hint}</p>}
      </div>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-transform duration-300 ease-soft group-hover:scale-110 ${accents[accent]}`}>
        <Icon className="h-5 w-5" />
      </span>
    </div>
  );
}
