import { cookies } from "next/headers";
import { api, ok } from "@/lib/utils/response";
import { DEMO_COOKIE } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/data/store";
import { createClient } from "@/lib/supabase/server";

export const POST = api(async () => {
  (await cookies()).delete(DEMO_COOKIE);
  if (isSupabaseConfigured()) await (await createClient()).auth.signOut();
  return ok(true);
});
