import { timingSafeEqual } from "node:crypto";
import { api, ok } from "@/lib/utils/response";
import { AppError } from "@/lib/data/types";
import { getStore } from "@/lib/data/store";
import { getProvider } from "@/lib/telephony/provider.factory";
import { archiveRecordings, closeAbandonedCalls } from "@/lib/services/recording.service";

/**
 * Scheduled maintenance (vercel.json crons): close calls abandoned in the IVR and archive
 * recordings. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
 */
export const GET = api(async (req) => {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new AppError(503, "cron_not_configured", "CRON_SECRET is not set");
  const got = Buffer.from(req.headers.get("authorization") ?? ""), want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new AppError(401, "unauthenticated", "Invalid cron secret");
  const store = await getStore();
  const calls = await closeAbandonedCalls(store, getProvider());
  const recordings = await archiveRecordings(store);
  return ok({ calls, recordings });
}, { limit: 20 });
