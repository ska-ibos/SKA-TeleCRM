import { api, ok } from "@/lib/utils/response";
import { assertCron } from "@/lib/api/cron";
import { getStore } from "@/lib/data/store";
import { dispatchDueReminders } from "@/lib/services/reminder-dispatch.service";

/**
 * Send due reminders on WhatsApp (spec §10 `/api/reminders/dispatch`). Call every 5 minutes
 * with `Authorization: Bearer <CRON_SECRET>` - from Supabase pg_cron + pg_net, or Vercel Cron
 * on a Pro plan (see docs/whatsapp-reminders.md). Safe to call often: each reminder goes once.
 */
const handler = api(async (req) => {
  assertCron(req);
  return ok(await dispatchDueReminders(await getStore()));
}, { limit: 60 });
export const GET = handler;
export const POST = handler;
