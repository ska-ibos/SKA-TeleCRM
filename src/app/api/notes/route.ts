import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx, param } from "@/lib/api/context";
import { noteSchema, uuid } from "@/lib/validations";
import { forbidden, notFound } from "@/lib/data/types";
import { audit } from "@/lib/services/audit.service";
import type { Client, Note, TeamMember } from "@/types";
import { canSeeClient, scopeFor } from "@/lib/services/access.service";

export const GET = api(async (req) => {
  const { store, user } = await apiCtx();
  const scope = await scopeFor(store, user);
  const clientId = param(req, "client_id");
  const [notes, team, clients] = await Promise.all([
    store.list<Note>("notes", { eq: clientId ? { client_id: uuid.parse(clientId) } : undefined, order: { column: "created_at", ascending: false }, limit: 300 }),
    store.list<TeamMember>("team_members"), store.list<Client>("clients"),
  ]);
  const q = param(req, "q")?.toLowerCase();
  return ok(notes.filter((n) => canSeeClient(scope, n.client_id) && (!q || n.body.toLowerCase().includes(q))).map((n) => ({
    ...n, author_name: team.find((m) => m.id === n.author_id)?.full_name ?? "System",
    client_name: clients.find((c) => c.id === n.client_id)?.name ?? null,
  })));
});

export const POST = api(async (req) => {
  const { store, user } = await apiCtx();
  const input = noteSchema.parse(await readJson(req));
  if (!canSeeClient(await scopeFor(store, user), input.client_id) || !(await store.get("clients", input.client_id))) throw notFound("Client");
  if (input.call_id && !(await store.get("calls", input.call_id))) throw notFound("Call");
  const note = await store.insert<Note>("notes", { ...input, author_id: user.memberId });
  await audit(store, user.memberId, "create", "note", note.id, { client_id: input.client_id });
  return ok(note, 201);
});

export const DELETE = api(async (req) => {
  const { store, user } = await apiCtx();
  const id = uuid.parse(param(req, "id"));
  const note = await store.get<Note>("notes", id);
  if (!note) throw notFound("Note");
  if (user.role !== "admin" && note.author_id !== user.memberId) throw forbidden("Only the author or an admin can delete this note");
  await store.remove("notes", id);
  await audit(store, user.memberId, "delete", "note", id);
  return ok(true);
});
