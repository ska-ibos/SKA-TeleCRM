import { isConflict, type Store } from "../data/types";
import type { Call, Reminder, TeamMember } from "@/types";
import { getCrmDeskMembers } from "./department.service";
import { nextOfficeOpening } from "../utils/date";
import type { OfficeHours } from "../constants";

/**
 * First available CRM desk member, or null when the whole desk is busy/offline.
 * `requirePhone`: live telephony rings mobiles, so a desk member without a number cannot take the call.
 */
export async function pickCrmDesk(store: Store, exclude: string[] = [], opts: { requirePhone?: boolean } = {}): Promise<TeamMember | null> {
  const desk = (await getCrmDeskMembers(store)).filter((m) => !exclude.includes(m.id) && (!opts.requirePhone || m.phone));
  return desk.find((m) => m.status === "available") ?? null;
}

/** Missed / after-hours call -> one callback reminder per call for the CRM desk (idempotent). */
export async function createCallbackReminder(
  store: Store, call: Call, p: { now: Date; officeHours: OfficeHours; source: "after_hours" | "voicemail" | "missed"; message?: string | null },
): Promise<Reminder> {
  const findAuto = async () =>
    (await store.list<Reminder>("reminders", { eq: { call_id: call.id } })).find((r) => r.source !== "manual");
  const existing = await findAuto();
  if (existing) return existing;
  const [desk] = await getCrmDeskMembers(store);
  const label = { after_hours: "After-hours call", voicemail: "Voicemail", missed: "Missed call" }[p.source];
  try {
    return await store.insert<Reminder>("reminders", {
      title: `${label} from ${call.from_number} - call back`,
      due_at: nextOfficeOpening(p.now, p.officeHours).toISOString(),
      client_id: call.client_id, call_id: call.id, assigned_to: desk?.id ?? null,
      status: "pending", source: p.source,
    });
  } catch (e) {
    // concurrent hangup + voicemail events: the one-auto-reminder-per-call index let one win
    const winner = isConflict(e) ? await findAuto() : undefined;
    if (winner) return winner;
    throw e;
  }
}
