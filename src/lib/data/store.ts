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
export function authMode(): { mode: "supabase" | "demo" | "misconfigured"; missing: string[]; problem?: string } {
  const missing = SUPABASE_VARS.filter((k) => !process.env[k]?.trim());
  if (missing.length === SUPABASE_VARS.length) return { mode: "demo", missing: [] };
  if (missing.length) return { mode: "misconfigured", missing: [...missing] };
  const problem = keyProjectMismatch();
  if (problem) return { mode: "misconfigured", missing: [], problem };
  return { mode: "supabase", missing };
}

/**
 * Keys copied from another Supabase project are the most common setup mistake: every database
 * call then fails ("Invalid API key"). Legacy (JWT) keys name their project in the `ref` claim,
 * so compare it with the project in NEXT_PUBLIC_SUPABASE_URL. Never reveals the key itself.
 */
export function keyProjectMismatch(env: Record<string, string | undefined> = process.env): string | null {
  const host = (() => { try { return new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname; } catch { return ""; } })();
  const urlRef = /^([a-z0-9]{20})\.supabase\.co$/.exec(host)?.[1];
  if (!urlRef) return null; // custom domain / local stack: nothing to compare
  for (const name of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
    const ref = jwtRef(env[name]);
    if (ref && ref !== urlRef) return `${name} belongs to Supabase project ${ref}, but NEXT_PUBLIC_SUPABASE_URL is project ${urlRef}`;
  }
  const role = jwtClaim(env.SUPABASE_SERVICE_ROLE_KEY, "role");
  if (role && role !== "service_role") return `SUPABASE_SERVICE_ROLE_KEY is the "${role}" key - use the service_role key`;
  return null;
}
function jwtClaim(token: string | undefined, claim: string): string | null {
  const part = token?.trim().split(".")[1];
  if (!part) return null;
  try { const v = JSON.parse(Buffer.from(part, "base64url").toString())[claim]; return typeof v === "string" ? v : null; } catch { return null; }
}
const jwtRef = (token: string | undefined) => jwtClaim(token, "ref");

export const isSupabaseConfigured = () => authMode().mode === "supabase";

const g = globalThis as unknown as { __skaStore?: Store };

/** Supabase when configured, otherwise a seeded in-memory store (DEMO mode). */
export async function getStore(): Promise<Store> {
  if (g.__skaStore) return g.__skaStore;
  const { mode, missing } = authMode();
  if (mode === "misconfigured") {
    throw new AppError(503, "misconfigured", missing.length ? `Supabase is partly configured. Missing: ${missing.join(", ")}` : `Supabase is misconfigured: ${authMode().problem}`);
  }
  if (mode === "supabase") {
    const { SupabaseStore } = await import("./supabase.store");
    g.__skaStore = new SupabaseStore();
  } else {
    g.__skaStore = new MemoryStore();
  }
  return g.__skaStore;
}
