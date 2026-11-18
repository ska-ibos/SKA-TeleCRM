"use client";
import { Empty } from "../common/ui";
import type { EnrichedCall } from "@/lib/services/call.service";

const label = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

/** Today's call volume per hour. Single series, so the card title names it. */
export function CallsByHour({ calls }: { calls: EnrichedCall[] }) {
  if (!calls.length) return <Empty title="No calls today yet" hint="Volume by hour will appear here as calls come in." />;
  const hours = calls.map((c) => new Date(c.started_at).getHours());
  const first = Math.min(9, ...hours), last = Math.max(19, ...hours);
  const buckets = Array.from({ length: last - first + 1 }, (_, i) => {
    const h = first + i;
    return { h, n: hours.filter((x) => x === h).length };
  });
  const max = Math.max(...buckets.map((b) => b.n));
  const peak = buckets.find((b) => b.n === max)!;
  return (
    <div role="img" aria-label={`Calls per hour today. Busiest hour is ${label(peak.h)} with ${peak.n} calls.`}>
      <div className="flex h-36 items-end gap-0.5 sm:gap-1">
        {buckets.map((b, i) => (
          <div key={b.h} className="group relative flex h-full flex-1 items-end rounded-t-md hover:bg-brand-50/70">
            {b.n > 0 && (
              <div className="bar-y w-full rounded-t-[4px] bg-brand-400 transition-colors duration-150 group-hover:bg-brand-600"
                style={{ height: `${Math.max(6, (b.n / max) * 100)}%`, animationDelay: `${i * 25}ms` }} />
            )}
            {b === peak && <span className="absolute inset-x-0 text-center text-[11px] font-semibold text-slate-700" style={{ bottom: `calc(${(b.n / max) * 100}% + 2px)` }}>{b.n}</span>}
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-brand-950 px-2 py-1 text-[11px] font-medium text-white group-hover:block">
              {label(b.h)}: {b.n} {b.n === 1 ? "call" : "calls"}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-0.5 border-t border-slate-200 pt-1.5 sm:gap-1">
        {buckets.map((b, i) => <span key={b.h} className="flex-1 text-center text-[10px] text-slate-500">{i % 2 === 0 ? label(b.h) : ""}</span>)}
      </div>
    </div>
  );
}
