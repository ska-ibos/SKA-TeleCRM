import { createAdminClient } from "../supabase/server";
import { getTenantId } from "./tenant";
import {
  AppError, conflict, notFound, staleWrite,
  type PhoneMatch, type Query, type Store, type StoreCapabilities, type TableName, type UpdateOptions,
} from "./types";

/**
 * Logical table -> physical objects in the shared SKA OS database.
 * `read` may be a read-only view; `write: null` means TeleCRM never writes it.
 * See supabase/migrations/20261104000001_telecrm_core.sql.
 */
const MAP: Record<TableName, { read: string; write: string | null; pk?: string }> = {
  team_members:         { read: "tc_team_members",           write: "tc_team_members" },
  departments:          { read: "tc_departments",            write: "tc_departments" },
  department_members:   { read: "tc_department_members",     write: "tc_department_members" },
  clients:              { read: "tc_clients_v",              write: null },              // SKA OS client master
  client_phone_numbers: { read: "tc_client_phone_directory", write: "tc_client_phones" }, // + clients.mobile + contacts
  calls:                { read: "tc_calls",                  write: "tc_calls" },
  call_sessions:        { read: "tc_call_sessions",          write: "tc_call_sessions" },
  call_transfers:       { read: "tc_call_transfers",         write: "tc_call_transfers" },
  notes:                { read: "tc_notes",                  write: "tc_notes" },
  tags:                 { read: "tc_tags",                   write: "tc_tags" },
  client_tags:          { read: "tc_client_tags",            write: "tc_client_tags" },
  reminders:            { read: "tc_reminders",              write: "tc_reminders" },
  recordings:           { read: "tc_recordings",             write: "tc_recordings" },
  routing_config:       { read: "tc_routing_config",         write: "tc_routing_config", pk: "key" },
  audit_logs:           { read: "tc_audit_logs",             write: "tc_audit_logs" },
  webhook_events:       { read: "tc_webhook_events",         write: "tc_webhook_events" },
  provider_events:      { read: "tc_provider_events",        write: "tc_provider_events" },
  employees:            { read: "tc_employee_directory",     write: null },              // SKA OS employees
};

const PAGE = 1000;       // PostgREST max rows per request
const MAX_ROWS = 20_000; // safety cap for unbounded lists

/** Friendly messages for unique indexes (see migrations). */
const UNIQUE_MESSAGES: Record<string, string> = {
  tc_team_members_ext_uq: "This extension is already assigned to another team member",
  tc_team_members_name_uq: "A team member with this name already exists",
  tc_team_members_email_uq: "A team member with this email already exists",
  tc_team_members_phone_uq: "A team member with this phone number already exists",
  tc_team_members_employee_uq: "This employee is already a TeleCRM team member",
  tc_team_members_auth_uq: "This login is already linked to a team member",
  tc_client_phones_tenant_id_phone_key: "This phone number is already registered to a client in TeleCRM",
  tc_client_phones_one_primary: "Another number was made primary at the same time. Please retry.",
  tc_call_transfers_one_inflight: "A transfer is already in progress for this call",
  tc_departments_tenant_id_ivr_key_key: "This IVR key is already used",
  tc_departments_name_uq: "A department with this name already exists",
  tc_tags_name_uq: "A tag with this name already exists",
  tc_client_tags_client_id_tag_id_key: "This tag is already on the client",
};

interface PgError { code?: string; message: string; details?: string }

function mapError(e: PgError): never {
  if (e.code === "23505") {
    const name = /constraint "([^"]+)"/.exec(e.message)?.[1] ?? "";
    throw conflict(UNIQUE_MESSAGES[name] ?? "A record with the same unique value already exists");
  }
  if (e.code === "23503") throw new AppError(409, "conflict", "Related record is missing or still in use");
  if (e.code === "23514" || e.code === "23502") throw new AppError(422, "validation_error", "A value failed a database check");
  if (e.code === "22023") throw new AppError(422, "validation_error", e.message);
  if (e.code === "42501") throw new AppError(403, "forbidden", e.message);
  if (e.code === "57014") throw new AppError(503, "timeout", "The database took too long to respond. Please retry.");
  throw new AppError(500, "db_error", e.message);
}

export class SupabaseStore implements Store {
  readonly capabilities: StoreCapabilities = { mode: "supabase", clientsReadOnly: true, bulkDeleteAllowed: false };
  private db = createAdminClient();

  private pk(t: TableName) { return MAP[t].pk ?? "id"; }
  private writable(t: TableName) {
    const w = MAP[t].write;
    if (!w) throw new AppError(403, "managed_externally", `${t.replace(/_/g, " ")} are managed in SKA OS and are read-only in TeleCRM`);
    return w;
  }
  /** routing_config rows are keyed by `key`; services address every row by `id`. */
  private shape<T>(t: TableName, r: Record<string, unknown>): T {
    if (t === "routing_config") return { id: r.key, ...r } as T;
    if (t === "client_phone_numbers" && !("source" in r)) return { ...r, source: "telecrm" } as T;
    return r as T;
  }

  async list<T>(table: TableName, q: Query = {}): Promise<T[]> {
    const tenant = await getTenantId();
    const build = () => {
      let b = this.db.from(MAP[table].read).select("*").eq("tenant_id", tenant);
      for (const [k, v] of Object.entries(q.eq ?? {})) b = v === null ? b.is(k, null) : b.eq(k, v);
      for (const [k, v] of Object.entries(q.in ?? {})) b = b.in(k, v);
      for (const k of q.notNull ?? []) b = b.not(k, "is", null);
      for (const [k, v] of Object.entries(q.gte ?? {})) b = b.gte(k, v);
      for (const [k, v] of Object.entries(q.lte ?? {})) b = b.lte(k, v);
      if (q.search?.term) {
        const term = q.search.term.replace(/[%,()*\\]/g, "");
        if (term) b = b.or(q.search.columns.map((c) => `${c}.ilike.%${term}%`).join(","));
      }
      // stable ordering is required for correct pagination
      b = b.order(q.order?.column ?? this.pk(table), { ascending: q.order?.ascending ?? true, nullsFirst: false });
      if (q.order && q.order.column !== this.pk(table)) b = b.order(this.pk(table), { ascending: true });
      return b;
    };

    const want = Math.min(q.limit ?? MAX_ROWS, MAX_ROWS);
    const out: Record<string, unknown>[] = [];
    for (let from = 0; from < want; from += PAGE) {
      const to = Math.min(from + PAGE, want) - 1;
      const { data, error } = await build().range(from, to);
      if (error) mapError(error);
      out.push(...(data ?? []));
      if (!data || data.length < to - from + 1) break;
    }
    return out.map((r) => this.shape<T>(table, r));
  }

  async get<T>(table: TableName, id: string): Promise<T | null> {
    const tenant = await getTenantId();
    const { data, error } = await this.db.from(MAP[table].read).select("*")
      .eq("tenant_id", tenant).eq(this.pk(table), id).maybeSingle();
    if (error) mapError(error);
    return data ? this.shape<T>(table, data) : null;
  }

  async insert<T>(table: TableName, row: Record<string, unknown>): Promise<T> {
    const tenant = await getTenantId();
    const { data, error } = await this.db.from(this.writable(table)).insert({ ...row, tenant_id: tenant }).select().single();
    if (error) mapError(error);
    return this.shape<T>(table, data);
  }

  async update<T>(table: TableName, id: string, patch: Record<string, unknown>, opts: UpdateOptions = {}): Promise<T> {
    const tenant = await getTenantId();
    const { tenant_id: _t, id: _i, ...safe } = patch; // tenant/pk are immutable from the app
    let b = this.db.from(this.writable(table)).update(safe).eq("tenant_id", tenant).eq(this.pk(table), id);
    for (const [k, v] of Object.entries(opts.expect ?? {})) b = v === null ? b.is(k, null) : b.eq(k, v);
    const { data, error } = await b.select().maybeSingle();
    if (error) mapError(error);
    if (!data) {
      if (opts.expect && (await this.get(table, id))) throw staleWrite(table.replace(/_/g, " "));
      throw notFound(table);
    }
    return this.shape<T>(table, data);
  }

  async remove(table: TableName, id: string): Promise<void> {
    const tenant = await getTenantId();
    const { error } = await this.db.from(this.writable(table)).delete().eq("tenant_id", tenant).eq(this.pk(table), id);
    if (error) mapError(error);
  }

  async matchClientByPhone(phone: string): Promise<PhoneMatch> {
    const tenant = await getTenantId();
    const { data, error } = await this.db.rpc("tc_match_client_by_phone", { p_tenant: tenant, p_phone: phone });
    if (error) mapError(error);
    const rows = (data ?? []) as { client_id: string; source: string; candidates: number }[];
    return {
      clientId: rows.length === 1 && rows[0].candidates === 1 ? rows[0].client_id : null,
      source: rows[0]?.source ?? null,
      candidates: rows.map((r) => r.client_id),
    };
  }
}
