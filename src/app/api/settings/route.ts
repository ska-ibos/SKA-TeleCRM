import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx } from "@/lib/api/context";
import { routingConfigSchema } from "@/lib/validations";
import { loadRoutingConfig } from "@/lib/routing/department.service";
import { audit, listAudit } from "@/lib/services/audit.service";
import { can } from "@/lib/auth/permissions";
import { getProvider } from "@/lib/telephony/provider.factory";
import { isSupabaseConfigured } from "@/lib/data/store";

export const GET = api(async () => {
  const { store, user } = await apiCtx();
  const provider = getProvider();
  return ok({
    config: await loadRoutingConfig(store),
    audit: can(user.role, "audit:read") ? await listAudit(store, 1000) : [],
    system: {
      dataMode: isSupabaseConfigured() ? "supabase" : "demo (in-memory)",
      telephony: provider.name, telephonyConfigured: provider.isConfigured(),
    },
  });
});

export const PUT = api(async (req) => {
  const { store, user } = await apiCtx("settings:write");
  const cfg = routingConfigSchema.parse(await readJson(req));
  for (const [key, value] of Object.entries(cfg)) {
    const existing = await store.get("routing_config", key);
    if (existing) await store.update("routing_config", key, { value });
    else await store.insert("routing_config", { key, value });
  }
  await audit(store, user.memberId, "update", "routing_config", null, cfg);
  return ok(cfg);
});
