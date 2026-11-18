/**
 * Login artwork: the real routing path of an Operations call.
 * A signal leaves the caller, passes the IVR and reaches one outcome per cycle.
 */
const INTO_IVR = "M122 130 H176";
const OUTCOMES = ["M304 130 C330 130 330 44 356 44", "M304 130 H356", "M304 130 C330 130 330 216 356 216"];
// Three calls per 6s cycle: each enters the IVR, then 0.7s later takes one outcome.
const PULSES = OUTCOMES.flatMap((d, i) => [{ d: INTO_IVR, delay: i * 2 }, { d, delay: i * 2 + 0.7 }]);

function Node({ x, y, w, title, sub, strong }: { x: number; y: number; w: number; title: string; sub: string; strong?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height="56" rx="13" fill={strong ? "#e6c98a" : "rgb(255 255 255 / 0.07)"} stroke={strong ? "none" : "rgb(255 255 255 / 0.18)"} />
      <text x={x + w / 2} y={y + 24} textAnchor="middle" fontSize="13" fontWeight="600" fill={strong ? "#0a211e" : "#fff"}>{title}</text>
      <text x={x + w / 2} y={y + 41} textAnchor="middle" fontSize="10.5" fill={strong ? "#16453e" : "#aed7ce"}>{sub}</text>
    </g>
  );
}

export function RoutingDiagram() {
  return (
    <svg viewBox="0 0 490 260" className="w-full max-w-[34rem]" role="img" aria-label="An incoming call passes through the Operations IVR and reaches the sticky agent, the CRM desk, or a callback reminder.">
      {[INTO_IVR, ...OUTCOMES].map((d) => <path key={d} d={d} fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth="1.5" />)}
      {PULSES.map((p) => (
        <path key={p.delay} d={p.d} pathLength={100} fill="none" stroke="#e6c98a" strokeWidth="2.5" strokeLinecap="round" className="route-pulse" style={{ animationDelay: `${p.delay}s` }} />
      ))}
      <Node x={2} y={102} w={120} title="Client calls" sub="Identified by number" />
      <Node x={176} y={102} w={128} title="Operations IVR" sub="Keys 1–9 or extension" strong />
      <Node x={356} y={16} w={132} title="Sticky agent" sub="Spoke to them recently" />
      <Node x={356} y={102} w={132} title="CRM desk" sub="Fallback for every path" />
      <Node x={356} y={188} w={132} title="Callback reminder" sub="So no call is lost" />
    </svg>
  );
}
