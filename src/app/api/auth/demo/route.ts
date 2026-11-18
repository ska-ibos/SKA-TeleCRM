import { cookies } from "next/headers";
import { z } from "zod";
import { api, fail, ok, readJson } from "@/lib/utils/response";
import { DEMO_ACCOUNTS, DEMO_COOKIE, encodeDemoSession } from "@/lib/auth/session";
import { getStore, isSupabaseConfigured } from "@/lib/data/store";
import type { TeamMember } from "@/types";

export const GET = api(async () => {
  if (isSupabaseConfigured()) return ok({ enabled: false, accounts: [] });
  const team = await (await getStore()).list<TeamMember>("team_members", { eq: { is_active: true }, order: { column: "full_name" } });
  return ok({
    enabled: true,
    accounts: [...DEMO_ACCOUNTS, ...team.map((m) => ({ id: m.id, name: m.full_name, role: m.role }))],
  });
});

export const POST = api(async (req) => {
  if (isSupabaseConfigured()) return fail(400, "demo_disabled", "Demo sign-in is disabled when Supabase is configured");
  const { accountId } = z.object({ accountId: z.string().min(1).max(64) }).parse(await readJson(req));
  const virtual = DEMO_ACCOUNTS.find((a) => a.id === accountId);
  const member = virtual ? null : await (await getStore()).get<TeamMember>("team_members", accountId);
  if (!virtual && (!member || !member.is_active)) return fail(404, "not_found", "Account not found");
  const u = virtual
    ? { id: virtual.id, name: virtual.name, email: null, role: virtual.role, memberId: null }
    : { id: member!.id, name: member!.full_name, email: member!.email, role: member!.role, memberId: member!.id };
  (await cookies()).set(DEMO_COOKIE, encodeDemoSession(u), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600,
  });
  return ok(u);
}, { limit: 20 });
