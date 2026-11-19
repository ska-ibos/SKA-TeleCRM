import { api, fail, ok, readJson } from "@/lib/utils/response";
import { loginSchema } from "@/lib/validations";
import { authMode } from "@/lib/data/store";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NO_ACCESS_MESSAGES, resolveSupabaseUser } from "@/lib/auth/session";

const BAD_CREDENTIALS = "Incorrect username/email or password";

/**
 * Password sign-in with an SKA OS username OR email (same accounts as SKA OS).
 * Usernames resolve via SKA OS's own `public.username_login`. Unknown usernames and wrong
 * passwords return the same message (no account enumeration). A valid login without
 * TeleCRM access is signed out again and told exactly why.
 */
export const POST = api(async (req) => {
  const { mode, missing } = authMode();
  if (mode === "demo") return fail(400, "demo_mode", "Supabase is not configured - use demo sign-in");
  if (mode === "misconfigured") return fail(503, "misconfigured", missing.length ? `Server is missing: ${missing.join(", ")}` : `Server misconfigured: ${authMode().problem}`);

  const { identifier, password } = loginSchema.parse(await readJson(req));
  let email = identifier;
  if (!identifier.includes("@")) {
    const { data, error } = await createAdminClient().rpc("username_login", { p_username: identifier });
    if (error) {
      // say why, so a setup problem is not mistaken for a wrong password
      console.error("[login] username_login failed", error.code, error.message);
      const m = `${error.code ?? ""} ${error.message ?? ""}`;
      if (/PGRST202|could not find the function/i.test(m)) {
        return fail(503, "lookup_unavailable", "This database has no SKA OS username login (username_login). Check that NEXT_PUBLIC_SUPABASE_URL points to the SKA OS project, or sign in with your email.");
      }
      if (/invalid api key|jwt|apikey|401/i.test(m)) {
        return fail(503, "lookup_unavailable", "The server's Supabase key was rejected. SUPABASE_SERVICE_ROLE_KEY must be the service_role key of the same project as NEXT_PUBLIC_SUPABASE_URL.");
      }
      if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(m)) {
        return fail(503, "lookup_unavailable", "The server could not reach Supabase. Check the internet connection and NEXT_PUBLIC_SUPABASE_URL.");
      }
      return fail(500, "lookup_failed", "Could not check the username. Please try again, or sign in with your email.");
    }
    if (!data) return fail(401, "invalid_credentials", BAD_CREDENTIALS);
    email = String(data);
  }

  const sb = await createClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    const msg = error?.message ?? "";
    if (/invalid login credentials/i.test(msg)) return fail(401, "invalid_credentials", BAD_CREDENTIALS);
    if (/email not confirmed/i.test(msg)) return fail(403, "email_not_confirmed", "This account's email is not confirmed yet.");
    return fail(400, "sign_in_failed", msg || "Sign-in failed");
  }

  const access = await resolveSupabaseUser(data.user);
  if (!access.user) {
    await sb.auth.signOut();
    return fail(403, access.reason, NO_ACCESS_MESSAGES[access.reason]);
  }
  return ok(access.user);
}, { limit: 10 });
