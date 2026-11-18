import { randomUUID } from "node:crypto";
import { conflict, notFound, staleWrite, type PhoneMatch, type Query, type Store, type StoreCapabilities, type TableName, type UpdateOptions } from "./types";
import { buildSeed } from "./seed";

type Row = Record<string, unknown> & { id: string };

/** Unique constraints mirrored from supabase/migrations (incl. partial indexes via `where`). */
interface Unique { cols: string[]; where?: (r: Row) => boolean; message?: string }
const UNIQUE: Partial<Record<TableName, Unique[]>> = {
  team_members: [
    { cols: ["full_name"] }, { cols: ["email"] }, { cols: ["phone"] },
    { cols: ["extension"], message: "This extension is already assigned to another team member" },
    { cols: ["employee_id"], message: "This employee is already a TeleCRM team member" },
    { cols: ["auth_user_id"] },
  ],
  departments: [{ cols: ["ivr_key"] }, { cols: ["name"] }],
  department_members: [{ cols: ["department_id", "team_member_id"] }],
  client_phone_numbers: [
    { cols: ["phone"], message: "This phone number is already registered to a client" },
    { cols: ["client_id"], where: (r) => r.is_primary === true },
  ],
  calls: [{ cols: ["provider", "provider_call_id"] }],
  call_sessions: [{ cols: ["call_id"] }],
  call_transfers: [{ cols: ["call_id"], where: (r) => r.status === "initiated", message: "A transfer is already in progress for this call" }],
  tags: [{ cols: ["name"] }],
  client_tags: [{ cols: ["client_id", "tag_id"] }],
  reminders: [{ cols: ["call_id"], where: (r) => r.source !== "manual" }],
  webhook_events: [{ cols: ["provider", "event_key"] }],
};
const CASCADE: Partial<Record<TableName, [TableName, string][]>> = {
  clients: [["client_phone_numbers", "client_id"], ["notes", "client_id"], ["client_tags", "client_id"], ["reminders", "client_id"]],
  departments: [["department_members", "department_id"]],
  team_members: [["department_members", "team_member_id"]],
  tags: [["client_tags", "tag_id"]],
  calls: [["call_sessions", "call_id"], ["call_transfers", "call_id"]],
};
/** Tables with an optimistic-lock `version` column (bumped on every update, like the DB trigger). */
const VERSIONED = new Set<TableName>(["call_sessions"]);
/** Defaults the DB would fill. */
const DEFAULTS: Partial<Record<TableName, Record<string, unknown>>> = {
  call_sessions: { version: 0 },
  client_phone_numbers: { source: "telecrm" },
  webhook_events: { status: "processing", request_hash: null },
};

export function matches(row: Row, q: Query = {}): boolean {
  for (const [k, v] of Object.entries(q.eq ?? {})) if ((row[k] ?? null) !== v) return false;
  for (const [k, vs] of Object.entries(q.in ?? {})) if (!vs.includes(row[k])) return false;
  for (const k of q.notNull ?? []) if (row[k] == null) return false;
  for (const [k, v] of Object.entries(q.gte ?? {})) if (row[k] == null || String(row[k]) < v) return false;
  for (const [k, v] of Object.entries(q.lte ?? {})) if (row[k] == null || String(row[k]) > v) return false;
  if (q.search?.term) {
    const t = q.search.term.toLowerCase();
    if (!q.search.columns.some((c) => String(row[c] ?? "").toLowerCase().includes(t))) return false;
  }
  return true;
}

const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);

export class MemoryStore implements Store {
  readonly capabilities: StoreCapabilities = { mode: "memory", clientsReadOnly: false, bulkDeleteAllowed: true };
  private tables = new Map<TableName, Row[]>();

  constructor(seed = true) {
    if (seed) for (const [t, rows] of Object.entries(buildSeed())) this.tables.set(t as TableName, rows as Row[]);
  }
  private t(name: TableName) {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }
  private checkUnique(table: TableName, row: Row) {
    for (const u of UNIQUE[table] ?? []) {
      if (u.cols.some((c) => row[c] == null)) continue;
      if (u.where && !u.where(row)) continue;
      const dup = this.t(table).find((r) => r.id !== row.id && (!u.where || u.where(r)) && u.cols.every((c) => norm(r[c]) === norm(row[c])));
      if (dup) throw conflict(u.message ?? `A record with the same ${u.cols.join(" + ").replace(/_/g, " ")} already exists`);
    }
  }
  async list<T>(table: TableName, q: Query = {}): Promise<T[]> {
    let rows = this.t(table).filter((r) => matches(r, q));
    if (q.order) {
      const { column, ascending = true } = q.order;
      rows = [...rows].sort((a, b) => {
        const av = a[column] as string, bv = b[column] as string;
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (q.limit) rows = rows.slice(0, q.limit);
    return structuredClone(rows) as T[];
  }
  async get<T>(table: TableName, id: string): Promise<T | null> {
    const r = this.t(table).find((x) => x.id === id);
    return r ? (structuredClone(r) as T) : null;
  }
  async insert<T>(table: TableName, data: Record<string, unknown>): Promise<T> {
    const now = new Date().toISOString();
    const id = table === "routing_config" ? String(data.key) : randomUUID();
    const row = { id, created_at: now, updated_at: now, ...DEFAULTS[table], ...data } as Row;
    this.checkUnique(table, row);
    this.t(table).push(row);
    return structuredClone(row) as T;
  }
  async update<T>(table: TableName, id: string, patch: Record<string, unknown>, opts: UpdateOptions = {}): Promise<T> {
    const rows = this.t(table);
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) throw notFound(table);
    for (const [k, v] of Object.entries(opts.expect ?? {})) if ((rows[i][k] ?? null) !== v) throw staleWrite(table);
    const next = { ...rows[i], ...patch, id, updated_at: new Date().toISOString() } as Row;
    if (VERSIONED.has(table)) next.version = Number(rows[i].version ?? 0) + 1;
    this.checkUnique(table, next);
    rows[i] = next;
    return structuredClone(next) as T;
  }
  async remove(table: TableName, id: string): Promise<void> {
    for (const [child, fk] of CASCADE[table] ?? []) {
      for (const r of this.t(child).filter((x) => x[fk] === id)) await this.remove(child, r.id);
    }
    this.tables.set(table, this.t(table).filter((r) => r.id !== id));
  }
  async matchClientByPhone(phone: string): Promise<PhoneMatch> {
    const ids = [...new Set(this.t("client_phone_numbers").filter((p) => p.phone === phone).map((p) => String(p.client_id)))];
    return { clientId: ids.length === 1 ? ids[0] : null, source: ids.length ? "telecrm" : null, candidates: ids };
  }
}
