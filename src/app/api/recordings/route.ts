import { api } from "@/lib/utils/response";
import { apiCtx, param } from "@/lib/api/context";
import { uuid } from "@/lib/validations";
import { AppError, notFound } from "@/lib/data/types";
import { isSupabaseConfigured } from "@/lib/data/store";
import { canHearRecording, scopeFor } from "@/lib/services/access.service";
import { audit } from "@/lib/services/audit.service";
import { RECORDINGS_BUCKET, exotelAuthHeader } from "@/lib/services/recording.service";
import type { Recording } from "@/lib/services/call.service";
import type { Call } from "@/types";

/**
 * Play a recording (spec §8.7, §13: admin, the department's manager, or the person who
 * handled the call). Archived copies are served from private Storage through a 5-minute
 * signed URL; otherwise the Exotel file is streamed through the server (Exotel's secure
 * recordings need the API key), so recording URLs never reach the browser.
 */
export const GET = api(async (req) => {
  const { store, user } = await apiCtx();
  const rec = await store.get<Recording>("recordings", uuid.parse(param(req, "id")));
  if (!rec) throw notFound("Recording");
  const call = await store.get<Call>("calls", rec.call_id);
  if (!call || !canHearRecording(user, await scopeFor(store, user), call)) throw notFound("Recording");
  await audit(store, user.memberId, "play_recording", "call", call.id, { recording_id: rec.id });

  if (rec.storage_path && isSupabaseConfigured()) {
    const { createAdminClient } = await import("@/lib/supabase/server");
    const { data, error } = await createAdminClient().storage.from(RECORDINGS_BUCKET).createSignedUrl(rec.storage_path, 300);
    if (error || !data) throw new AppError(502, "storage_error", "The archived recording could not be opened");
    return Response.redirect(data.signedUrl, 302);
  }
  if (!rec.provider_url) throw notFound("Recording file");

  const headers: Record<string, string> = {};
  const auth = exotelAuthHeader(rec.provider_url);
  if (auth) headers.authorization = auth;
  const range = req.headers.get("range");
  if (range) headers.range = range;
  const res = await fetch(rec.provider_url, { headers, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res || (!res.ok && res.status !== 206)) throw new AppError(502, "recording_unavailable", "The recording is not available from Exotel yet. Try again in a few minutes.");
  const out = new Headers({ "cache-control": "private, no-store", "content-type": res.headers.get("content-type") ?? "audio/mpeg" });
  for (const h of ["content-length", "content-range", "accept-ranges"]) { const v = res.headers.get(h); if (v) out.set(h, v); }
  return new Response(res.body, { status: res.status, headers: out });
}, { limit: 120 });
