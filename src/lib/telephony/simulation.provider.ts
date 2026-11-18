import { randomUUID } from "node:crypto";
import type { TelephonyProvider } from "./provider.interface";

/** SIMULATION — NO REAL PHONE CALL. Every action is logged; outcomes are supplied by the simulator UI/tests. */
export class SimulationProvider implements TelephonyProvider {
  readonly name = "simulation" as const;
  readonly isSimulation = true;
  readonly log: string[] = [];
  isConfigured() { return true; }
  async dialAgent({ agent, reason }: { agent: { full_name: string }; reason: string }) {
    this.log.push(`[SIM] ring ${agent.full_name} (${reason})`);
    return { providerRef: `sim-${randomUUID()}` };
  }
  async placeOutbound({ agent, to }: { agent: { full_name: string }; to: string }) {
    this.log.push(`[SIM] outbound ${agent.full_name} -> ${to}`);
    return { providerCallId: `sim-out-${randomUUID()}` };
  }
  async transfer({ from, to }: { from: { full_name: string } | null; to: { full_name: string } }) {
    this.log.push(`[SIM] transfer ${from?.full_name ?? "IVR"} -> ${to.full_name}`);
    return { providerRef: `sim-${randomUUID()}` };
  }
}
