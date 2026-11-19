import { api, ok, readJson } from "@/lib/utils/response";
import { AppError } from "@/lib/data/types";
import { apiCtx } from "@/lib/api/context";
import { routingConfigSchema } from "@/lib/validations";
import { loadRoutingConfig } from "@/lib/routing/department.service";
import { audit, listAudit } from "@/lib/services/audit.service";
import { can } from "@/lib/auth/permissions";
import { getProvider } from "@/lib/telephony/provider.factory";
import { isSupabaseConfigured } from "@/lib/data/store";
import { whatsappEnabled } from "@/lib/notify/whatsapp";

export const GET = api(async () => {
  const { store, user } = await apiCtx();
  const provider = getProvider();
  return ok({
    config: await loadRoutingConfig(store),
    audit: can(user.role, "audit:read") ? await listAudit(store, 1000) : [],
    system: {
      dataMode: isSupabaseConfigured() ? "supabase" : "demo (in-memory)",
      telephony: provider.name, telephonyConfigured: provider.isConfigured(),
      whatsapp: whatsappEnabled(),
    },
  });
});

/** Keys added by migration 20261119000001; older databases reject them until it is applied. */
const NEW_KEYS = new Set(["dept_miss_behavior", "missed_call_window_days", "parallel_ring_max"]);

export const PUT = api(async (req) => {
  const { store, user } = await apiCtx("settings:write");
  const cfg = routingConfigSchema.parse(await readJson(req));
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(cfg)) {
    try {
      const existing = await store.get("routing_config", key);
      if (existing) await store.update("routing_config", key, { value });
      else await store.insert("routing_config", { key, value });
    } catch (e) {
      // database not migrated yet: keep the other settings, report what could not be saved
      if (NEW_KEYS.has(key) && e instanceof AppError && e.status === 422) { skipped.push(key); continue; }
      throw e;
    }
  }
  await audit(store, user.memberId, "update", "routing_config", null, cfg);
  return ok({ ...cfg, skipped });
});
