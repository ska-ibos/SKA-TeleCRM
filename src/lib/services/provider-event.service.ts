import type { Store } from "../data/types";
import { AppError } from "../data/types";

type Outcome = "processed" | "replayed" | "rejected" | "failed";

/**
 * Append-only log of every authenticated provider callback, stored BEFORE processing.
 * Used for debugging, replay, and verifying the field mapping when the official Exotel
 * format is wired in. Logging must never break call handling, so failures are swallowed.
 */
export async function recordProviderEvent(
  store: Store,
  p: { provider: string; endpoint: string; payload: unknown; eventId?: string | null; providerCallId?: string | null },
): Promise<string | null> {
  try {
    const payload = p.payload && typeof p.payload === "object" ? p.payload : { raw: p.payload ?? null };
    const row = await store.insert<{ id: string }>("provider_events", {
      provider: p.provider, endpoint: p.endpoint.slice(0, 100), payload,
      event_id: p.eventId?.slice(0, 300) ?? null, provider_call_id: p.providerCallId?.slice(0, 200) ?? null,
      outcome: "received",
    });
    return row.id;
  } catch (e) {
    console.error("[provider-event] could not record event", e);
    return null;
  }
}

export async function finishProviderEvent(store: Store, id: string | null, outcome: Outcome, err?: unknown) {
  if (!id) return;
  const error = err instanceof AppError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : err ? String(err) : null;
  try {
    await store.update("provider_events", id, { outcome, error: error?.slice(0, 2000) ?? null, processed_at: new Date().toISOString() });
  } catch (e) {
    console.error("[provider-event] could not finish event", e);
  }
}

/** Run a webhook handler with raw-event logging around it. */
export async function withProviderEventLog<T>(
  store: Store,
  meta: { provider: string; endpoint: string; payload: unknown; eventId?: string | null; providerCallId?: string | null },
  fn: () => Promise<{ result: T; replayed?: boolean }>,
): Promise<T> {
  const id = await recordProviderEvent(store, meta);
  try {
    const { result, replayed } = await fn();
    await finishProviderEvent(store, id, replayed ? "replayed" : "processed");
    return result;
  } catch (e) {
    const rejected = e instanceof AppError && e.status < 500;
    await finishProviderEvent(store, id, rejected ? "rejected" : "failed", e);
    throw e;
  }
}
