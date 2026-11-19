import type { Store } from "../data/types";
import type { Call } from "@/types";
import type { Recording } from "./call.service";
import * as Engine from "../routing/routing.engine";
import type { TelephonyProvider } from "../telephony/provider.interface";
import { saveRecording } from "../telephony/exotel.flow";

/** Private bucket created by migration 20261119000001. */
export const RECORDINGS_BUCKET = "telecrm-recordings";

const exotelEnv = () => {
  const e = process.env;
  return {
    sid: e.EXOTEL_ACCOUNT_SID?.trim(), key: e.EXOTEL_API_KEY?.trim(), token: e.EXOTEL_API_TOKEN?.trim(),
    host: e.EXOTEL_SUBDOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
  };
};

/** Exotel-hosted recording files may need the API key (secure recordings). Never sent anywhere else. */
export function exotelAuthHeader(url: string): string | null {
  const { key, token } = exotelEnv();
  let host = "";
  try { host = new URL(url).hostname; } catch { return null; }
  if (!key || !token || !/(^|\.)exotel\.(com|in)$/.test(host)) return null;
  return `Basic ${Buffer.from(`${key}:${token}`).toString("base64")}`;
}

/**
 * Copy Exotel recordings into private Supabase Storage (Exotel keeps them ~6 months).
 * Runs from the maintenance cron. Each file is downloaded once and its path saved; failures
 * are retried on the next run.
 */
export async function archiveRecordings(store: Store, opts: { limit?: number } = {}) {
  if (store.capabilities.mode !== "supabase") return { archived: 0, failed: 0, skipped: "not on Supabase" };
  const { createAdminClient } = await import("../supabase/server");
  const { getTenantId } = await import("../data/tenant");
  const db = createAdminClient();
  const tenant = await getTenantId();
  const pending = (await store.list<Recording>("recordings", { eq: { storage_path: null }, notNull: ["provider_url"], order: { column: "created_at" }, limit: opts.limit ?? 25 }));
  let archived = 0, failed = 0;
  for (const r of pending) {
    try {
      const headers: Record<string, string> = {};
      const auth = exotelAuthHeader(r.provider_url!);
      if (auth) headers.authorization = auth;
      const res = await fetch(r.provider_url!, { headers, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type")?.split(";")[0] || "audio/mpeg";
      const ext = type.includes("wav") ? "wav" : "mp3";
      const path = `${tenant}/${r.call_id}/${r.id}.${ext}`;
      const { error } = await db.storage.from(RECORDINGS_BUCKET).upload(path, Buffer.from(await res.arrayBuffer()), { contentType: type, upsert: true });
      if (error) throw new Error(error.message);
      await store.update("recordings", r.id, { storage_path: path });
      archived++;
    } catch (e) {
      failed++;
      console.error("[recordings] archive failed", r.id, (e as Error).message);
    }
  }
  return { archived, failed, pending: pending.length };
}

/**
 * Close live inbound calls whose caller hung up inside the IVR: Exotel calls none of our URLs
 * then. Asks Exotel's Call Details API for calls still open after `minutes`, and closes them
 * the normal way (hangup -> missed + callback reminder; or completed if they were connected),
 * saving the recording link. The pg_cron job still closes anything left after 6 h.
 * https://developer.exotel.com/docs/voice-v1/api-reference/call-details
 */
export async function closeAbandonedCalls(store: Store, provider: TelephonyProvider, opts: { minutes?: number; limit?: number; now?: Date } = {}) {
  const { sid, key, token, host } = exotelEnv();
  if (provider.isSimulation || !sid || !key || !token || !host) return { checked: 0, closed: 0, skipped: "Exotel not configured" };
  const now = opts.now ?? new Date();
  const before = new Date(now.getTime() - (opts.minutes ?? 15) * 60_000).toISOString();
  const open = (await store.list<Call>("calls", {
    eq: { provider: "exotel", direction: "inbound", ended_at: null }, lte: { started_at: before }, notNull: ["provider_call_id"],
    order: { column: "started_at" }, limit: opts.limit ?? 50,
  }));
  let closed = 0;
  for (const c of open) {
    try {
      const res = await fetch(`https://${host}/v1/Accounts/${encodeURIComponent(sid)}/Calls/${encodeURIComponent(c.provider_call_id!)}.json`, {
        headers: { authorization: `Basic ${Buffer.from(`${key}:${token}`).toString("base64")}`, accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { Call?: { Status?: string; EndTime?: string | null; RecordingUrl?: string | null } };
      const status = j.Call?.Status;
      if (!status || ["queued", "ringing", "in-progress"].includes(status)) continue; // still running
      const ctx = { store, provider, now };
      await Engine.hangup(ctx, c.id);
      await saveRecording(ctx, c.id, j.Call?.RecordingUrl ?? undefined, "call");
      closed++;
    } catch (e) {
      console.error("[maintenance] could not check call", c.id, (e as Error).message);
    }
  }
  return { checked: open.length, closed };
}
