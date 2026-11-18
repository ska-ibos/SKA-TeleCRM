import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppRole, SessionUser, TeamMember } from "@/types";
import { AppError, forbidden } from "../data/types";
import { authMode, getStore } from "../data/store";
import { getTenantId } from "../data/tenant";
import { createAdminClient, createClient } from "../supabase/server";
import { can } from "./permissions";
import type { Permission } from "../constants";

export const DEMO_COOKIE = "ska_demo";

function secret() {
  const s = process.env.DEMO_SESSION_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("DEMO_SESSION_SECRET must be set in production demo mode");
  return s || "dev-only-demo-secret-change-me";
}
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function encodeDemoSession(u: Omit<SessionUser, "mode">) {
  const payload = Buffer.from(JSON.stringify({ ...u, exp: Date.now() + 12 * 3600_000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeDemoSession(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const u = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (u.exp < Date.now()) return null;
    return { id: u.id, name: u.name, email: u.email ?? null, role: u.role, memberId: u.memberId ?? null, mode: "demo" };
  } catch {
    return null;
  }
}

/** Virtual demo accounts (no real people, no passwords). Team members can also sign in by name. */
export const DEMO_ACCOUNTS: { id: string; name: string; role: AppRole }[] = [
  { id: "demo-admin", name: "Demo Admin", role: "admin" },
  { id: "demo-manager", name: "Demo Manager", role: "manager" },
];

/**
 * Supabase mode (shared SKA OS database):
 *   1. the auth user must be a member of the TeleCRM workspace (public.memberships);
 *   2. an ACTIVE tc_team_members row linked by auth_user_id gives the TeleCRM role;
 *   3. otherwise SKA OS workspace admins get TeleCRM admin (so they can provision agents);
 *   4. anyone else signed in to SKA OS has no TeleCRM access.
 */
export type NoAccessReason = "not_member" | "not_provisioned" | "inactive";
export type AccessResult = { user: SessionUser; reason?: undefined } | { user: null; reason: NoAccessReason };

export const NO_ACCESS_MESSAGES: Record<NoAccessReason, string> = {
  not_member: "This login is not a member of the Single Key Advisory workspace.",
  not_provisioned: "Your SKA OS login is correct, but TeleCRM access has not been set up for you yet. Ask a TeleCRM admin to add you under Team.",
  inactive: "Your TeleCRM access has been deactivated. Contact a TeleCRM admin.",
};

interface AuthUser { id: string; email?: string | null; user_metadata?: Record<string, unknown> }

/**
 * Display name for a login that has no TeleCRM team-member row.
 * Source of truth is the SKA OS EMPLOYEE record linked to the login (HR name), because
 * profiles.full_name / auth metadata can be stale (e.g. an account re-assigned to a new person).
 * Fallbacks: profile name -> auth metadata -> email.
 */
async function displayNameFor(authUser: AuthUser, tenantId: string): Promise<string> {
  const db = createAdminClient();
  const [{ data: emp }, { data: profile }] = await Promise.all([
    db.from("employees").select("name").eq("auth_user_id", authUser.id).eq("tenant_id", tenantId).eq("status", "Active").limit(1).maybeSingle(),
    db.from("profiles").select("full_name").eq("id", authUser.id).maybeSingle(),
  ]);
  const meta = authUser.user_metadata as { full_name?: string; name?: string } | undefined;
  const pick = [emp?.name, profile?.full_name, meta?.full_name, meta?.name].map((v) => (typeof v === "string" ? v.trim() : "")).find(Boolean);
  return pick || authUser.email || "Admin";
}

/** Map an authenticated Supabase user to TeleCRM access (see rules above). */
export async function resolveSupabaseUser(authUser: AuthUser): Promise<AccessResult> {
  const uid = authUser.id;
  const tenantId = await getTenantId();
  const { data: membership, error } = await createAdminClient()
    .from("memberships").select("role").eq("user_id", uid).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new AppError(500, "db_error", "Could not verify workspace membership");
  if (!membership) return { user: null, reason: "not_member" };

  const store = await getStore();
  const [member] = await store.list<TeamMember>("team_members", { eq: { auth_user_id: uid }, limit: 1 });
  const base = { id: uid, mode: "supabase" as const, clientsManagedExternally: store.capabilities.clientsReadOnly };
  if (member) {
    if (!member.is_active) return { user: null, reason: "inactive" };
    return { user: { ...base, name: member.full_name, email: member.email ?? authUser.email ?? null, role: member.role, memberId: member.id } };
  }
  if (membership.role === "admin") {
    return { user: { ...base, name: await displayNameFor(authUser, tenantId), email: authUser.email ?? null, role: "admin", memberId: null } };
  }
  return { user: null, reason: "not_provisioned" };
}

/** Session + why there is none: `signedIn` but no user = valid login without TeleCRM access. */
export async function getSessionState(): Promise<{ user: SessionUser | null; signedIn: boolean; reason?: NoAccessReason }> {
  const { mode } = authMode();
  if (mode === "demo") {
    const user = decodeDemoSession((await cookies()).get(DEMO_COOKIE)?.value);
    return { user, signedIn: Boolean(user) };
  }
  if (mode !== "supabase") return { user: null, signedIn: false };
  const { data } = await (await createClient()).auth.getUser();
  if (!data.user) return { user: null, signedIn: false };
  const r = await resolveSupabaseUser(data.user);
  return { user: r.user, signedIn: true, reason: r.reason };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  return (await getSessionState()).user;
}

/** Backend role check - call at the top of every API route. */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError(401, "unauthenticated", "Please sign in to continue");
  if (permission && !can(user.role, permission)) throw forbidden();
  return user;
}
