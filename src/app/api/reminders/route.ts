import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx, param } from "@/lib/api/context";
import { reminderSchema, reminderUpdateSchema } from "@/lib/validations";
import { createReminder, listReminders, updateReminder } from "@/lib/services/reminder.service";

export const GET = api(async (req) => {
  const { store, user } = await apiCtx();
  const mine = param(req, "mine") === "1";
  return ok(await listReminders(store, { status: param(req, "status"), assignedTo: mine ? user.memberId ?? "none" : undefined }));
});

export const POST = api(async (req) => {
  const { store, user } = await apiCtx();
  return ok(await createReminder(store, reminderSchema.parse(await readJson(req)), user), 201);
});

export const PATCH = api(async (req) => {
  const { store, user } = await apiCtx();
  return ok(await updateReminder(store, reminderUpdateSchema.parse(await readJson(req)), user));
});
