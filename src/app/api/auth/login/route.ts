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
  if (mode === "misconfigured") return fail(503, "misconfigured", `Server is missing: ${missing.join(", ")}`);

  const { identifier, password } = loginSchema.parse(await readJson(req));
  let email = identifier;
  if (!identifier.includes("@")) {
    const { data, error } = await createAdminClient().rpc("username_login", { p_username: identifier });
    if (error) return fail(500, "lookup_failed", "Could not check the username. Please try again.");
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
