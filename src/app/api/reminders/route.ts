import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx, param } from "@/lib/api/context";
import { reminderSchema, reminderUpdateSchema } from "@/lib/validations";
import { createReminder, listReminders, updateReminder } from "@/lib/services/reminder.service";
import { canSeeClient, scopeFor } from "@/lib/services/access.service";
import { notFound } from "@/lib/data/types";

export const GET = api(async (req) => {
  const { store, user } = await apiCtx();
  // agents only see their own reminders (assigned to or created by them)
  const mine = param(req, "mine") === "1" || user.role === "agent";
  return ok(await listReminders(store, { status: param(req, "status"), assignedTo: mine ? user.memberId ?? "none" : undefined }));
});

export const POST = api(async (req) => {
  const { store, user } = await apiCtx();
  const input = reminderSchema.parse(await readJson(req));
  if (input.client_id && !canSeeClient(await scopeFor(store, user), input.client_id)) throw notFound("Client");
  return ok(await createReminder(store, input, user), 201);
});

export const PATCH = api(async (req) => {
  const { store, user } = await apiCtx();
  return ok(await updateReminder(store, reminderUpdateSchema.parse(await readJson(req)), user));
});
