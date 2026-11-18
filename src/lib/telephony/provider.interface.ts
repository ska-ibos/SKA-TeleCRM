import type { TeamMember } from "@/types";

export interface DialRequest { callId: string; agent: TeamMember; reason: string }
export interface OutboundRequest { callId: string; agent: TeamMember; to: string }
export interface TransferRequest { callId: string; from: TeamMember | null; to: TeamMember }

/** Provider-agnostic telephony contract. The routing engine only talks to this. */
export interface TelephonyProvider {
  readonly name: "simulation" | "exotel";
  readonly isSimulation: boolean;
  isConfigured(): boolean;
  /** Ring an agent. Outcome arrives later through a status callback (engine.handleDialResult). */
  dialAgent(req: DialRequest): Promise<{ providerRef: string | null }>;
  placeOutbound(req: OutboundRequest): Promise<{ providerCallId: string | null }>;
  transfer(req: TransferRequest): Promise<{ providerRef: string | null }>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} is not configured. Add credentials in environment variables or use TELEPHONY_PROVIDER=simulation.`);
  }
}
