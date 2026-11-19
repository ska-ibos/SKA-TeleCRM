import type { NextRequest } from "next/server";
import { api, ok } from "@/lib/utils/response";
import { getStore } from "@/lib/data/store";
import { assertWebhook } from "@/lib/telephony/webhook";
import { withIdempotency } from "@/lib/services/idempotency.service";
import { withProviderEventLog } from "@/lib/services/provider-event.service";
import { outboundStatus, type ExotelStatus } from "@/lib/telephony/exotel.flow";

/**
 * Exotel StatusCallback for click-to-call (Calls/connect): `answered` and `terminal` events.
 * We ask for JSON (StatusCallbackContentType=application/json); form bodies are accepted too.
 * Raw-logged first; idempotent per (CallSid, event, status), so Exotel retries are harmless.
 * https://developer.exotel.com/docs/voice-v1/api-reference/status-callback
 */
export const POST = api(async (req: NextRequest) => {
  const provider = assertWebhook(req);
  const body = await readBody(req);
  const store = await getStore();
  return ok(await withProviderEventLog(store,
    { provider: provider.name, endpoint: "status", payload: body, eventId: null, providerCallId: body.CallSid ?? null },
    async () => {
      const key = `status:${body.CallSid ?? body.CustomField ?? "?"}:${body.EventType ?? "terminal"}:${body.Status ?? ""}`;
      const call = await withIdempotency(store, provider.name, key,
        () => outboundStatus({ store, provider, now: new Date() }, body), { payload: body });
      return { result: { id: call.id, status: call.status } };
    }));
}, { limit: 1200 });

async function readBody(req: NextRequest): Promise<ExotelStatus> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return pick(j);
  }
  const form = await req.formData().catch(() => null);
  const o: Record<string, unknown> = {};
  form?.forEach((v, k) => { if (typeof v === "string") o[k] = v; });
  return pick(o);
}

const FIELDS = ["CallSid", "Status", "EventType", "ConversationDuration", "RecordingUrl", "CustomField", "DateUpdated"] as const;
function pick(o: Record<string, unknown>): ExotelStatus {
  const out: Record<string, string> = {};
  for (const k of FIELDS) if (o[k] != null && typeof o[k] !== "object") out[k] = String(o[k]).slice(0, 2000);
  return out as ExotelStatus;
}
