import type { Store } from "../data/types";
import type { TeamMember } from "@/types";

export const looksLikeExtension = (digits: string) => /^[0-9]{2,6}$/.test(digits);

export async function findAgentByExtension(store: Store, extension: string): Promise<TeamMember | null> {
  if (!looksLikeExtension(extension)) return null;
  const [m] = await store.list<TeamMember>("team_members", { eq: { extension, is_active: true }, limit: 1 });
  return m ?? null;
}
