import type { NextRequest } from "next/server";
import { api } from "@/lib/utils/response";
import { AppError } from "@/lib/data/types";
import { getStore } from "@/lib/data/store";
import { assertWebhook } from "@/lib/telephony/webhook";
import { withProviderEventLog } from "@/lib/services/provider-event.service";
import * as Flow from "@/lib/telephony/exotel.flow";

/**
 * Exotel call-flow applet URLs (see docs/exotel-integration.md for the flow to build):
 *   /api/exotel/flow/start      Passthru  -> text/plain {"select": "..."}  (Switchcase)
 *   /api/exotel/flow/gather     Gather    -> application/json gather settings
 *   /api/exotel/flow/input      Passthru  -> text/plain {"select": "..."}
 *   /api/exotel/flow/prompt     Greeting  -> text/plain text to speak
 *   /api/exotel/flow/connect    Connect   -> application/json destination numbers
 *   /api/exotel/flow/end        Passthru  -> text/plain {"select":"ended"}
 *   /api/exotel/flow/voicemail  Passthru  -> text/plain {"select":"ended"}
 * Every URL carries ?token=<TELEPHONY_WEBHOOK_SECRET>. Exotel waits at most 5 s for
 * Gather/Connect, so these handlers do no work beyond the routing decision.
 */
const STEPS = ["start", "gather", "input", "prompt", "connect", "end", "voicemail"] as const;
type Step = (typeof STEPS)[number];
type Ctx = { params: Promise<{ step: string }> };

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function stepOf(ctx: Ctx): Promise<Step> {
  const { step } = await ctx.params;
  if (!(STEPS as readonly string[]).includes(step)) throw new AppError(404, "not_found", "Unknown flow step");
  return step as Step;
}

/** Exotel sends applet parameters as a query string (GET) or a form body (POST). */
async function paramsOf(req: NextRequest): Promise<URLSearchParams> {
  const q = new URL(req.url).searchParams;
  if (req.method !== "POST") return q;
  const type = req.headers.get("content-type") ?? "";
  const merged = new URLSearchParams(q);
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) if (v != null && typeof v !== "object") merged.set(k, String(v));
  } else {
    const form = await req.formData().catch(() => null);
    form?.forEach((v, k) => { if (typeof v === "string") merged.set(k, v); });
  }
  return merged;
}

const handle = api<Ctx>(async (req, routeCtx) => {
  const provider = assertWebhook(req);
  const step = await stepOf(routeCtx);
  const raw = await paramsOf(req);
  raw.delete("token"); // never store the secret in the event log
  const p = Flow.readParams(raw);
  const store = await getStore();
  const ctx = { store, provider, now: new Date() };

  return withProviderEventLog(store,
    { provider: provider.name, endpoint: `flow/${step}`, payload: p, eventId: null, providerCallId: p.CallSid ?? null },
    async () => {
      switch (step) {
        case "start": case "input": case "end": case "voicemail": {
          const r = await Flow[step](ctx, p);
          return { result: text(JSON.stringify({ select: r.select })) };
        }
        case "gather": return { result: json(await Flow.gather(ctx, p)) };
        case "connect": return { result: json(await Flow.connect(ctx, p)) };
        case "prompt": return { result: text(await Flow.prompt(ctx, p)) };
      }
    });
}, { limit: 1200 });

export const GET = handle;
export const POST = handle;

/** Exotel checks dynamic Greeting URLs with HEAD first: same headers as GET, no side effects. */
export const HEAD = api<Ctx>(async (req, routeCtx) => {
  assertWebhook(req);
  const step = await stepOf(routeCtx);
  const type = step === "gather" || step === "connect" ? "application/json" : "text/plain; charset=utf-8";
  return new Response(null, { headers: { "content-type": type, "cache-control": "no-store" } });
}, { limit: 1200 });
