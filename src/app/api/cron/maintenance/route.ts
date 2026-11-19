import { api, ok } from "@/lib/utils/response";
import { assertCron } from "@/lib/api/cron";
import { getStore } from "@/lib/data/store";
import { getProvider } from "@/lib/telephony/provider.factory";
import { archiveRecordings, closeAbandonedCalls } from "@/lib/services/recording.service";
import { dispatchDueReminders } from "@/lib/services/reminder-dispatch.service";

/**
 * Scheduled maintenance (vercel.json): send due WhatsApp reminders, close calls abandoned in
 * the IVR, archive recordings. Each part runs even if another fails.
 */
export const GET = api(async (req) => {
  assertCron(req);
  const store = await getStore();
  const run = async <T,>(fn: () => Promise<T>) => fn().catch((e: Error) => ({ error: e.message }));
  return ok({
    reminders: await run(() => dispatchDueReminders(store)),
    calls: await run(() => closeAbandonedCalls(store, getProvider())),
    recordings: await run(() => archiveRecordings(store)),
  });
}, { limit: 20 });
