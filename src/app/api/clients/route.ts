import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx, param } from "@/lib/api/context";
import { clientCreateSchema, clientSchema, uuid } from "@/lib/validations";
import { createClient, deleteClient, getClientDetail, listClients, updateClient } from "@/lib/services/client.service";
import { toCsv } from "@/lib/utils/csv";
import { scopeFor } from "@/lib/services/access.service";

export const GET = api(async (req) => {
  const { store, user } = await apiCtx();
  const scope = await scopeFor(store, user);
  const id = param(req, "id");
  if (id) return ok(await getClientDetail(store, uuid.parse(id), scope));
  const rows = await listClients(store, { q: param(req, "q")?.slice(0, 100), status: param(req, "status"), tagId: param(req, "tag") }, scope);
  if (param(req, "format") === "csv") {
    const csv = toCsv(rows.map((c) => ({ ...c, phones: c.phones.map((p) => p.phone).join(" "), tags: c.tags.map((t) => t.name).join(" ") })),
      ["name", "company", "email", "pan", "gstin", "city", "status", "phones", "tags", "created_at"]);
    return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=clients.csv" } });
  }
  return ok(rows);
});

export const POST = api(async (req) => {
  const { store, user } = await apiCtx("clients:write");
  return ok(await createClient(store, clientCreateSchema.parse(await readJson(req)), user.memberId), 201);
});

export const PATCH = api(async (req) => {
  const { store, user } = await apiCtx("clients:write");
  const id = uuid.parse(param(req, "id"));
  return ok(await updateClient(store, id, clientSchema.parse(await readJson(req)), user.memberId));
});

export const DELETE = api(async (req) => {
  const { store, user } = await apiCtx("clients:delete");
  await deleteClient(store, uuid.parse(param(req, "id")), user.memberId);
  return ok(true);
});
