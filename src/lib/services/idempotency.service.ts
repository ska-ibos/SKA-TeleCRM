import { createHash } from "node:crypto";
import type { Store } from "../data/types";
import { AppError, isConflict, isStaleWrite } from "../data/types";

interface EventRow {
  id: string; provider: string; event_key: string; request_hash: string | null;
  status: "processing" | "completed"; response: unknown; locked_until: string;
}

const LOCK_MS = 120_000;
const RELEASED = "1970-01-01T00:00:00.000Z";

/** Deterministic JSON (sorted keys) so the same request always hashes the same. */
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
export const requestHash = (payload: unknown) => createHash("sha256").update(stable(payload)).digest("hex");

const inProgress = () => new AppError(409, "in_progress", "This request is already being processed");

/**
 * Exactly-once execution per (provider, key):
 * - a claim row is inserted first; the unique (tenant, provider, event_key) index means
 *   concurrent duplicates cannot both run;
 * - a completed key replays the stored response;
 * - the same key with a DIFFERENT payload is rejected (422) instead of silently replayed;
 * - a claim whose lock expired (crashed worker) is taken over with a compare-and-set;
 * - on failure the lock is released (row kept, never deleted) so a retry can run.
 */
export async function withIdempotency<T>(
  store: Store, provider: string, key: string, fn: () => Promise<T>,
  opts: { payload?: unknown; lockMs?: number } = {},
): Promise<T> {
  const hash = opts.payload === undefined ? null : requestHash(opts.payload);
  const lockUntil = () => new Date(Date.now() + (opts.lockMs ?? LOCK_MS)).toISOString();
  let claim: EventRow | null = null;

  for (let attempt = 0; attempt < 3 && !claim; attempt++) {
    try {
      claim = await store.insert<EventRow>("webhook_events", {
        provider, event_key: key, request_hash: hash, status: "processing", response: null, locked_until: lockUntil(),
      });
    } catch (e) {
      if (!isConflict(e)) throw e;
      const [prev] = await store.list<EventRow>("webhook_events", { eq: { provider, event_key: key }, limit: 1 });
      if (!prev) continue; // raced with something unusual; retry the insert
      if (hash && prev.request_hash && prev.request_hash !== hash) {
        throw new AppError(422, "idempotency_key_reused", "This idempotency key was already used for a different request");
      }
      if (prev.status === "completed") return prev.response as T;
      if (new Date(prev.locked_until).getTime() > Date.now()) throw inProgress();
      try {
        claim = await store.update<EventRow>("webhook_events", prev.id,
          { locked_until: lockUntil(), request_hash: prev.request_hash ?? hash },
          { expect: { status: "processing", locked_until: prev.locked_until } });
      } catch (err) {
        if (isStaleWrite(err)) throw inProgress(); // another worker took it over first
        throw err;
      }
    }
  }
  if (!claim) throw inProgress();

  let result: T;
  try {
    result = await fn();
  } catch (e) {
    await store.update("webhook_events", claim.id, { locked_until: RELEASED }).catch(() => undefined);
    throw e;
  }
  await store.update("webhook_events", claim.id, {
    status: "completed", response: JSON.parse(JSON.stringify(result ?? {})), locked_until: RELEASED,
  });
  return result;
}
