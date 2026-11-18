"use client";
import { Badge, Trail, statusTone } from "../common/ui";
import type { RouteStep } from "@/types";

export function RoutingResult({ step }: { step: RouteStep | null }) {
  if (!step) return <p className="py-4 text-center text-sm text-slate-500">Start a call to see the routing decision trail.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">State</span><Badge tone="indigo">{step.state}</Badge>
        <span className="text-slate-500">Action</span><Badge tone={statusTone(step.action === "connected" ? "answered" : step.action === "voicemail" ? "voicemail" : "connecting")}>{step.action}</Badge>
        {step.agent && <><span className="text-slate-500">Agent</span><Badge tone="green">{step.agent.name}</Badge></>}
      </div>
      <Trail items={step.trail} />
    </div>
  );
}
