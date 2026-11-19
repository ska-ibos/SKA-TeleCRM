import { api, ok, readJson } from "@/lib/utils/response";
import { apiCtx, param } from "@/lib/api/context";
import { clientTagSchema, tagSchema, uuid } from "@/lib/validations";
import { notFound } from "@/lib/data/types";
import { audit } from "@/lib/services/audit.service";
import type { ClientTag, Tag } from "@/types";
import { canSeeClient, scopeFor } from "@/lib/services/access.service";

export const GET = api(async () => {
  const { store } = await apiCtx();
  return ok(await store.list<Tag>("tags", { order: { column: "name" } }));
});

/** POST {name,color} creates a tag; POST {client_id, tag_id} assigns it. */
export const POST = api(async (req) => {
  const { store, user } = await apiCtx("tags:write");
  const body = (await readJson(req)) as Record<string, unknown>;
  if ("tag_id" in body) {
    const input = clientTagSchema.parse(body);
    if (!canSeeClient(await scopeFor(store, user), input.client_id) || !(await store.get("clients", input.client_id))) throw notFound("Client");
    if (!(await store.get("tags", input.tag_id))) throw notFound("Tag");
    const [dup] = await store.list<ClientTag>("client_tags", { eq: input });
    return ok(dup ?? (await store.insert("client_tags", input)), 201);
  }
  const tag = await store.insert<Tag>("tags", tagSchema.parse(body));
  await audit(store, user.memberId, "create", "tag", tag.id, { name: tag.name });
  return ok(tag, 201);
});

/** DELETE ?id=tag removes a tag; DELETE ?client_id&tag_id unassigns. */
export const DELETE = api(async (req) => {
  const { store, user } = await apiCtx("tags:write");
  const clientId = param(req, "client_id");
  if (clientId) {
    const input = clientTagSchema.parse({ client_id: clientId, tag_id: param(req, "tag_id") });
    for (const ct of await store.list<ClientTag>("client_tags", { eq: input })) await store.remove("client_tags", ct.id);
    return ok(true);
  }
  const id = uuid.parse(param(req, "id"));
  await store.remove("tags", id);
  await audit(store, user.memberId, "delete", "tag", id);
  return ok(true);
});
