import type { Store } from "../data/types";
import { badRequest, forbidden, notFound } from "../data/types";
import type { Client, Reminder, SessionUser, TeamMember } from "@/types";
import type { z } from "zod";
import type { reminderSchema, reminderUpdateSchema } from "../validations";
import { audit } from "./audit.service";

export async function listReminders(store: Store, f: { status?: string; assignedTo?: string } = {}) {
  const eq: Record<string, unknown> = {};
  if (f.status) eq.status = f.status;
  if (f.assignedTo) eq.assigned_to = f.assignedTo;
  const [rows, team, clients] = await Promise.all([
    store.list<Reminder>("reminders", { eq, order: { column: "due_at" }, limit: 500 }),
    store.list<TeamMember>("team_members"), store.list<Client>("clients"),
  ]);
  return rows.map((r) => ({
    ...r,
    assigned_name: team.find((m) => m.id === r.assigned_to)?.full_name ?? null,
    client_name: clients.find((c) => c.id === r.client_id)?.name ?? null,
  }));
}

export async function createReminder(store: Store, input: z.infer<typeof reminderSchema>, user: SessionUser) {
  if (new Date(input.due_at).getTime() < Date.now() - 60_000) throw badRequest("Due date must be in the future", { due_at: "Due date must be in the future" });
  if (input.client_id && !(await store.get("clients", input.client_id))) throw notFound("Client");
  if (input.assigned_to && !(await store.get("team_members", input.assigned_to))) throw notFound("Assignee");
  const r = await store.insert<Reminder>("reminders", {
    ...input, assigned_to: input.assigned_to ?? user.memberId, created_by: user.memberId, status: "pending", source: "manual",
  });
  await audit(store, user.memberId, "create", "reminder", r.id, { title: r.title });
  return r;
}

export async function updateReminder(store: Store, input: z.infer<typeof reminderUpdateSchema>, user: SessionUser) {
  const r = await store.get<Reminder>("reminders", input.id);
  if (!r) throw notFound("Reminder");
  const staff = ["admin", "crm_desk", "manager"].includes(user.role);
  if (!staff && r.assigned_to !== user.memberId && r.created_by !== user.memberId) throw forbidden("You can only update your own reminders");
  const { id, ...patch } = input;
  const updated = await store.update<Reminder>("reminders", id, patch);
  await audit(store, user.memberId, "update", "reminder", id, patch);
  return updated;
}
