import { createAdminClient } from "../supabase/server";
import { AppError } from "./types";

/**
 * The SKA OS workspace (public.tenants) TeleCRM operates in.
 * TELECRM_TENANT_ID wins; otherwise resolved once from TELECRM_TENANT_SLUG (default "ska").
 */
const g = globalThis as unknown as { __skaTenant?: Promise<string> };

export function getTenantId(): Promise<string> {
  g.__skaTenant ??= resolve().catch((e) => {
    g.__skaTenant = undefined; // retry on next request
    throw e;
  });
  return g.__skaTenant;
}

async function resolve(): Promise<string> {
  const db = createAdminClient();
  const id = process.env.TELECRM_TENANT_ID?.trim();
  const slug = process.env.TELECRM_TENANT_SLUG?.trim() || "ska";
  const q = db.from("tenants").select("id, status");
  const { data, error } = await (id ? q.eq("id", id) : q.eq("slug", slug)).maybeSingle();
  if (error) throw new AppError(500, "db_error", `Could not resolve workspace: ${error.message}`);
  if (!data) throw new AppError(500, "tenant_missing", `Workspace ${id ?? slug} not found in public.tenants`);
  if (data.status !== "active") throw new AppError(503, "tenant_inactive", "This workspace is not active");
  return data.id as string;
}
