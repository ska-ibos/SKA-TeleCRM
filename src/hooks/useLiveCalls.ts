"use client";
import { useEffect } from "react";
import { useApi } from "./useApi";
import { createClient, supabaseEnabled } from "@/lib/supabase/client";
import type { EnrichedCall } from "@/lib/services/call.service";

/** Live calls via Supabase Realtime when configured; polling fallback (always on, slower with realtime). */
export function useLiveCalls() {
  const q = useApi<EnrichedCall[]>("/api/calls?live=1", supabaseEnabled ? 15000 : 3000);
  const { reload } = q;
  useEffect(() => {
    if (!supabaseEnabled) return;
    const sb = createClient(); // shared singleton client
    // Unique topic per mount: sb.channel(name) returns an EXISTING channel when the name is taken
    // (React strict-mode double mount, or two components using this hook), and adding a listener
    // to an already-subscribed channel throws. removeChannel below is async, so names can't be reused.
    const topic = `live-calls:${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
    const ch = sb.channel(topic)
      .on("postgres_changes", { event: "*", schema: "public", table: "tc_calls" }, () => reload())
      .subscribe();
    return () => { void sb.removeChannel(ch); };
  }, [reload]);
  return q;
}
