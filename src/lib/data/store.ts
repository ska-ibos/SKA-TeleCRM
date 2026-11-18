import { MemoryStore } from "./memory.store";
import { AppError, type Store } from "./types";

export * from "./types";

const SUPABASE_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/**
 * Single source of truth for the auth/data mode (server side):
 *  - "supabase": all three variables set -> real logins, shared SKA OS database;
 *  - "demo": none set -> in-memory data, password-less demo sign-in;
 *  - "misconfigured": only some set -> nobody can sign in until it is fixed (never a silent half-mode).
 */
export function authMode(): { mode: "supabase" | "demo" | "misconfigured"; missing: string[] } {
  const missing = SUPABASE_VARS.filter((k) => !process.env[k]?.trim());
  if (!missing.length) return { mode: "supabase", missing };
  if (missing.length === SUPABASE_VARS.length) return { mode: "demo", missing: [] };
  return { mode: "misconfigured", missing: [...missing] };
}

export const isSupabaseConfigured = () => authMode().mode === "supabase";

const g = globalThis as unknown as { __skaStore?: Store };

/** Supabase when configured, otherwise a seeded in-memory store (DEMO mode). */
export async function getStore(): Promise<Store> {
  if (g.__skaStore) return g.__skaStore;
  const { mode, missing } = authMode();
  if (mode === "misconfigured") {
    throw new AppError(503, "misconfigured", `Supabase is partly configured. Missing: ${missing.join(", ")}`);
  }
  if (mode === "supabase") {
    const { SupabaseStore } = await import("./supabase.store");
    g.__skaStore = new SupabaseStore();
  } else {
    g.__skaStore = new MemoryStore();
  }
  return g.__skaStore;
}
