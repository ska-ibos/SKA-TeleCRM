import type { Store } from "../data/types";
import { AppError, conflict, notFound } from "../data/types";
import type { Call, Client, ClientPhone, ClientTag, Department, Note, Reminder, Tag, TeamMember } from "@/types";
import type { z } from "zod";
import type { clientCreateSchema, clientSchema, phoneCreateSchema } from "../validations";
import { audit } from "./audit.service";
import { canSeeClient, type Scope } from "./access.service";

/**
 * Caller identification. A number shared by several clients (common for group companies
 * in the SKA OS master) is AMBIGUOUS: the caller is treated as unknown and the candidates
 * are returned so the CRM desk can pick one (adding the number in TeleCRM pins it).
 */
export async function identifyCaller(store: Store, phone: string): Promise<{ client: Client | null; candidates: string[] }> {
  const m = await store.matchClientByPhone(phone);
  const client = m.clientId ? await store.get<Client>("clients", m.clientId) : null;
  return { client, candidates: m.candidates };
}

export async function findClientByPhone(store: Store, phone: string): Promise<Client | null> {
  return (await identifyCaller(store, phone)).client;
}

/** Clients live in SKA OS when running on the shared database. */
function assertClientsWritable(store: Store) {
  if (store.capabilities.clientsReadOnly) {
    throw new AppError(403, "managed_externally",
      "Clients are managed in SKA OS. Create or edit the client there - TeleCRM picks it up automatically.");
  }
}
const isLocal = (p: ClientPhone) => (p.source ?? "telecrm") === "telecrm";

export async function listClients(store: Store, f: { q?: string; status?: string; tagId?: string } = {}, scope: Scope = { all: true }) {
  let clients = await store.list<Client>("clients", {
    eq: f.status ? { status: f.status } : undefined,
    order: { column: "created_at", ascending: false }, limit: 5000,
  });
  if (!scope.all) clients = clients.filter((c) => canSeeClient(scope, c.id));
  const [phones, ctags, tags] = await Promise.all([
    store.list<ClientPhone>("client_phone_numbers"), store.list<ClientTag>("client_tags"), store.list<Tag>("tags"),
  ]);
  if (f.q) {
    const q = f.q.toLowerCase(), digits = q.replace(/\D/g, "");
    clients = clients.filter((c) =>
      [c.name, c.company, c.email, c.pan, c.gstin, c.city].some((v) => v?.toLowerCase().includes(q)) ||
      (digits.length >= 3 && phones.some((p) => p.client_id === c.id && p.phone.includes(digits))));
  }
  if (f.tagId) clients = clients.filter((c) => ctags.some((t) => t.client_id === c.id && t.tag_id === f.tagId));
  return clients.map((c) => ({
    ...c,
    phones: phones.filter((p) => p.client_id === c.id).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
    tags: tags.filter((t) => ctags.some((ct) => ct.client_id === c.id && ct.tag_id === t.id)),
  }));
}

export async function getClientDetail(store: Store, id: string, scope: Scope = { all: true }) {
  const client = canSeeClient(scope, id) ? await store.get<Client>("clients", id) : null;
  if (!client) throw notFound("Client");
  const [phones, ctags, tags, notes, reminders, calls, team, depts] = await Promise.all([
    store.list<ClientPhone>("client_phone_numbers", { eq: { client_id: id } }),
    store.list<ClientTag>("client_tags", { eq: { client_id: id } }),
    store.list<Tag>("tags", { order: { column: "name" } }),
    store.list<Note>("notes", { eq: { client_id: id }, order: { column: "created_at", ascending: false } }),
    store.list<Reminder>("reminders", { eq: { client_id: id }, order: { column: "due_at" } }),
    store.list<Call>("calls", { eq: { client_id: id }, order: { column: "started_at", ascending: false }, limit: 100 }),
    store.list<TeamMember>("team_members"),
    store.list<Department>("departments"),
  ]);
  const member = (mid: string | null) => team.find((m) => m.id === mid);
  const name = (mid: string | null) => member(mid)?.full_name ?? null;
  return {
    client, phones, allTags: tags,
    tags: tags.filter((t) => ctags.some((c) => c.tag_id === t.id)),
    notes: notes.map((n) => ({ ...n, author_name: name(n.author_id) })),
    reminders: reminders.map((r) => ({ ...r, assigned_name: name(r.assigned_to) })),
    calls: calls.map((c) => {
      const who = c.answered_agent_id ?? c.routed_agent_id ?? c.initiated_by;
      return { ...c, agent_name: name(who), agent_extension: member(who)?.extension ?? null };
    }),
    contacts: clientContacts(calls, team, depts),
  };
}

export interface ClientContact {
  id: string; name: string; extension: string | null; departments: string[];
  last_at: string; last_direction: "inbound" | "outbound"; conversations: number;
}
/**
 * Team members this client has actually dealt with, most recent first: whoever answered one of
 * their calls, or called them. Shown on the client page with each person's direct extension.
 */
export function clientContacts(calls: Call[], team: TeamMember[], depts: Department[]): ClientContact[] {
  const out = new Map<string, ClientContact>();
  const byTime = [...calls].sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  for (const c of byTime) {
    const mid = c.answered_agent_id ?? (c.direction === "outbound" ? c.initiated_by : null);
    const m = team.find((x) => x.id === mid);
    if (!m || !m.is_active) continue;
    const e = out.get(m.id) ?? {
      id: m.id, name: m.full_name, extension: m.extension ?? null, departments: [],
      last_at: c.answered_at ?? c.started_at, last_direction: c.direction, conversations: 0,
    };
    e.conversations++;
    const dept = depts.find((d) => d.id === c.department_id && d.kind === "department")?.name;
    if (dept && !e.departments.includes(dept)) e.departments.push(dept);
    out.set(m.id, e);
  }
  return [...out.values()];
}

/**
 * A number may be registered in TeleCRM for only one client. Numbers that only appear in the
 * SKA OS master/contacts for other clients are allowed: registering here pins the caller ID.
 */
async function assertPhonesFree(store: Store, phones: string[], exceptClient?: string) {
  for (const phone of phones) {
    const hit = (await store.list<ClientPhone>("client_phone_numbers", { eq: { phone } })).find(isLocal);
    if (hit && hit.client_id !== exceptClient) {
      const owner = await store.get<Client>("clients", hit.client_id);
      throw conflict(`${phone} already belongs to client "${owner?.name ?? "unknown"}"`);
    }
  }
}

export async function createClient(store: Store, input: z.infer<typeof clientCreateSchema>, actorId: string | null) {
  assertClientsWritable(store);
  await assertPhonesFree(store, input.phones.map((p) => p.phone));
  const { phones, ...data } = input;
  const client = await store.insert<Client>("clients", { ...data, created_by: actorId });
  try {
    for (const [i, p] of phones.entries()) {
      await store.insert("client_phone_numbers", { client_id: client.id, phone: p.phone, label: p.label, is_primary: i === 0 });
    }
  } catch (e) {
    await store.remove("clients", client.id); // keep create atomic
    throw e;
  }
  await audit(store, actorId, "create", "client", client.id, { name: client.name });
  return client;
}

export async function updateClient(store: Store, id: string, input: z.infer<typeof clientSchema>, actorId: string | null) {
  assertClientsWritable(store);
  const before = await store.get<Client>("clients", id);
  if (!before) throw notFound("Client");
  const after = await store.update<Client>("clients", id, input);
  const changed = Object.fromEntries(Object.entries(input).filter(([k, v]) => before[k as keyof Client] !== v));
  await audit(store, actorId, "update", "client", id, { changed });
  return after;
}

export async function deleteClient(store: Store, id: string, actorId: string | null) {
  assertClientsWritable(store);
  const c = await store.get<Client>("clients", id);
  if (!c) throw notFound("Client");
  await store.remove("clients", id);
  await audit(store, actorId, "delete", "client", id, { name: c.name });
}

export async function addPhone(store: Store, input: z.infer<typeof phoneCreateSchema>, actorId: string | null) {
  if (!(await store.get("clients", input.client_id))) throw notFound("Client");
  await assertPhonesFree(store, [input.phone]);
  const existing = (await store.list<ClientPhone>("client_phone_numbers", { eq: { client_id: input.client_id } })).filter(isLocal);
  if (existing.length >= 10) throw conflict("A client can have at most 10 phone numbers in TeleCRM");
  const makePrimary = input.is_primary || existing.length === 0;
  // unset the old primary first; the one-primary-per-client unique index turns a concurrent race into a 409
  if (makePrimary) for (const p of existing.filter((x) => x.is_primary)) await store.update("client_phone_numbers", p.id, { is_primary: false });
  const row = await store.insert<ClientPhone>("client_phone_numbers", { ...input, is_primary: makePrimary, created_by: actorId });
  await audit(store, actorId, "add_phone", "client", input.client_id, { phone: input.phone });
  return row;
}

export async function removePhone(store: Store, phoneId: string, actorId: string | null) {
  const p = await store.get<ClientPhone>("client_phone_numbers", phoneId);
  if (!p) throw notFound("Phone number");
  if (!isLocal(p)) throw conflict("This number comes from the SKA OS client record. Change it in SKA OS.");
  const all = await store.list<ClientPhone>("client_phone_numbers", { eq: { client_id: p.client_id } });
  if (all.length <= 1) throw conflict("A client must keep at least one phone number");
  await store.remove("client_phone_numbers", phoneId);
  const next = all.find((x) => x.id !== phoneId && isLocal(x));
  if (p.is_primary && next) await store.update("client_phone_numbers", next.id, { is_primary: true });
  await audit(store, actorId, "remove_phone", "client", p.client_id, { phone: p.phone });
}

/**
 * Unknown caller (or a number shared by several clients) -> link it to a client from the call
 * page (spec §12 "client calls from a new number"). Registers the number in TeleCRM for that
 * client (pins caller ID from now on) and attaches this call, and earlier unlinked calls from
 * the same number, so their history and stickies count for the client.
 */
export async function linkCallToClient(store: Store, callId: string, clientId: string, actorId: string | null) {
  const call = await store.get<Call>("calls", callId);
  if (!call) throw notFound("Call");
  if (!(await store.get<Client>("clients", clientId))) throw notFound("Client");
  const phone = call.direction === "inbound" ? call.from_number : call.to_number;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw conflict("This call has no phone number to link");
  const mine = (await store.list<ClientPhone>("client_phone_numbers", { eq: { client_id: clientId, phone } })).some(isLocal);
  if (!mine) await addPhone(store, { client_id: clientId, phone, label: "mobile", is_primary: false }, actorId);
  const unlinked = (await store.list<Call>("calls", { eq: { from_number: phone }, limit: 500 }))
    .concat(await store.list<Call>("calls", { eq: { to_number: phone }, limit: 500 }))
    .filter((c) => !c.client_id || c.id === callId);
  for (const c of new Map(unlinked.map((x) => [x.id, x])).values()) {
    await store.update("calls", c.id, { client_id: clientId });
  }
  await audit(store, actorId, "link_caller", "call", callId, { client_id: clientId, phone, calls: unlinked.length });
  return { client_id: clientId, phone, calls: unlinked.length };
}
