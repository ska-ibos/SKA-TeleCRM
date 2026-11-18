"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: opts.body ? { "content-type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", "Network error - check your connection and try again");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
    const e = json?.error;
    const fields = e?.details && typeof e.details === "object" ? (e.details as Record<string, string>) : {};
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `Request failed (${res.status})`, fields);
  }
  return json.data as T;
}

/** Fetch + reload helper with loading/error state. Optional polling interval. */
export function useApi<T>(url: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const urlRef = useRef(url);
  urlRef.current = url;

  const reload = useCallback(async () => {
    if (!urlRef.current) return;
    try {
      setData(await apiFetch<T>(urlRef.current));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(Boolean(url));
    reload();
    if (!pollMs || !url) return;
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [url, pollMs, reload]);

  return { data, error, loading, reload, setData };
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
