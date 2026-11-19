import { timingSafeEqual } from "node:crypto";
import { AppError } from "../data/types";

/** Scheduled jobs (Vercel Cron or Supabase pg_cron) send `Authorization: Bearer <CRON_SECRET>`. */
export function assertCron(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new AppError(503, "cron_not_configured", "CRON_SECRET is not set");
  const got = Buffer.from(req.headers.get("authorization") ?? ""), want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new AppError(401, "unauthenticated", "Invalid cron secret");
}
