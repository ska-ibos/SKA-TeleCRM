import { z } from "zod";
import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx } from "@/lib/api/context";
import { phoneSchema } from "@/lib/validations";
import { badRequest } from "@/lib/data/types";
import { sendWhatsApp } from "@/lib/notify/whatsapp";
import { audit } from "@/lib/services/audit.service";
import type { TeamMember } from "@/types";

/** Admin: send a test WhatsApp (to the given number, or to the admin's own mobile). */
export const POST = api(async (req) => {
  const { store, user } = await apiCtx("settings:write");
  const { to } = z.object({ to: phoneSchema.optional() }).parse(await readJson(req));
  const me = user.memberId ? await store.get<TeamMember>("team_members", user.memberId) : null;
  const number = to ?? me?.phone;
  if (!number) throw badRequest("Enter a number to send the test to", { to: "Enter a number" });
  await sendWhatsApp(number, "SKA TeleCRM: WhatsApp reminders are working.");
  await audit(store, user.memberId, "whatsapp_test", "settings", null, { to: number });
  return ok({ sent: true, to: number });
}, { limit: 10 });
