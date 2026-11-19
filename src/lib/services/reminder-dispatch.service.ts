import type { Store } from "../data/types";
import { isStaleWrite } from "../data/types";
import type { Client, Reminder, TeamMember } from "@/types";
import { sendWhatsApp, whatsappEnabled } from "../notify/whatsapp";
import { fmtDateTime } from "../utils/date";

/**
 * Send due reminders over WhatsApp (spec §8.5, §11.2): every pending reminder whose time has
 * come and that asks for WhatsApp (`notify_via` = whatsapp | both; default both) goes to the
 * assignee's mobile once.
 *  - claimed first with compare-and-set on `notified_at`, so two runs never send it twice;
 *  - a failed send is released (`notified_at` back to null, error kept) and retried next run;
 *  - only reminders due in the last `maxAgeHours` are sent (no flood after an outage).
 * In-app notification needs no sending: the header bell and Reminders page show due items.
 */
export async function dispatchDueReminders(store: Store, opts: { now?: Date; maxAgeHours?: number; limit?: number; send?: typeof sendWhatsApp } = {}) {
  if (!opts.send && !whatsappEnabled()) return { sent: 0, failed: 0, skipped: 0, note: "WhatsApp (SendBuddy) not configured" };
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.maxAgeHours ?? 24) * 3600_000).toISOString();
  const due = await store.list<Reminder>("reminders", {
    eq: { status: "pending", notified_at: null }, gte: { due_at: since }, lte: { due_at: now.toISOString() },
    order: { column: "due_at" }, limit: opts.limit ?? 100,
  });
  const send = opts.send ?? sendWhatsApp;
  let sent = 0, failed = 0, skipped = 0;
  for (const r of due) {
    const via = r.notify_via ?? "both";
    if (via === "in_app") { skipped++; continue; }
    const to = r.assigned_to ? await store.get<TeamMember>("team_members", r.assigned_to) : null;
    if (!to?.phone || !to.is_active) {
      // nobody to message: mark it so it is not picked up again, with the reason
      await claim(store, r, now, `No WhatsApp number for ${to?.full_name ?? "the assignee"}`);
      skipped++;
      continue;
    }
    if (!(await claim(store, r, now, null))) continue; // another run took it
    try {
      await send(to.phone, await messageFor(store, r));
      sent++;
    } catch (e) {
      failed++;
      await store.update("reminders", r.id, { notified_at: null, notify_error: (e as Error).message.slice(0, 500) }).catch(() => undefined);
    }
  }
  return { sent, failed, skipped, due: due.length };
}

async function claim(store: Store, r: Reminder, now: Date, error: string | null): Promise<boolean> {
  try {
    await store.update("reminders", r.id, { notified_at: now.toISOString(), notify_error: error }, { expect: { notified_at: null } });
    return true;
  } catch (e) {
    if (isStaleWrite(e)) return false;
    throw e;
  }
}

export async function messageFor(store: Store, r: Reminder): Promise<string> {
  const client = r.client_id ? await store.get<Client>("clients", r.client_id) : null;
  const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  return [
    `SKA TeleCRM reminder: ${r.title}`,
    `Due: ${fmtDateTime(r.due_at)}`,
    client ? `Client: ${client.name}` : null,
    base ? `${base}/reminders` : null,
  ].filter(Boolean).join("\n");
}
