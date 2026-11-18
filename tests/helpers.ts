import { MemoryStore } from "@/lib/data/memory.store";
import { SimulationProvider } from "@/lib/telephony/simulation.provider";
import type { EngineCtx } from "@/lib/routing/routing.engine";
import type { TeamMember } from "@/types";

/** Monday 2026-11-02 11:00 IST (inside office hours) */
export const MON_11AM = new Date("2026-11-02T05:30:00Z");
export const at = (base: Date, hours: number) => new Date(base.getTime() + hours * 3600_000);

export async function setup() {
  const store = new MemoryStore();
  const provider = new SimulationProvider();
  const team = await store.list<TeamMember>("team_members");
  const member = (name: string) => team.find((m) => m.full_name === name)!;
  const ctx = (now: Date): EngineCtx => ({ store, provider, now });
  const client = await store.insert<{ id: string }>("clients", { name: "Rahul Client", status: "active" });
  await store.insert("client_phone_numbers", { client_id: client.id, phone: "+919800000001", label: "mobile", is_primary: true });
  const setStatus = (name: string, status: TeamMember["status"]) => store.update("team_members", member(name).id, { status });
  return { store, provider, member, ctx, client, setStatus, phone: "+919800000001" };
}
