/** Logical table names used by services. Each store maps them to its own storage. */
export type TableName =
  | "team_members" | "departments" | "department_members" | "clients" | "client_phone_numbers"
  | "calls" | "call_sessions" | "call_transfers" | "notes" | "tags" | "client_tags" | "reminders"
  | "recordings" | "routing_config" | "audit_logs" | "webhook_events" | "provider_events" | "employees";

export interface Query {
  eq?: Record<string, unknown>;
  in?: Record<string, unknown[]>;
  notNull?: string[];
  gte?: Record<string, string>;
  lte?: Record<string, string>;
  search?: { columns: string[]; term: string };
  order?: { column: string; ascending?: boolean };
  limit?: number;
}

export interface UpdateOptions {
  /**
   * Compare-and-set: the update only applies if the row currently has these values
   * (e.g. `{ version: 3 }` or `{ status: "initiated" }`). Otherwise throws 409 `stale_write`.
   */
  expect?: Record<string, unknown>;
}

/** Result of caller identification. Exactly one candidate = identified. */
export interface PhoneMatch {
  clientId: string | null;
  source: string | null;
  candidates: string[];
}

export interface StoreCapabilities {
  mode: "memory" | "supabase";
  /** Client master owned by another system (SKA OS): TeleCRM may not create/edit/delete clients. */
  clientsReadOnly: boolean;
  /** Hard-deleting shared records (e.g. bulk simulator reset) is not allowed. */
  bulkDeleteAllowed: boolean;
}

/** Minimal persistence contract used by every service (memory for demo/tests, Supabase in prod). */
export interface Store {
  readonly capabilities: StoreCapabilities;
  list<T>(table: TableName, q?: Query): Promise<T[]>;
  get<T>(table: TableName, id: string): Promise<T | null>;
  insert<T>(table: TableName, row: Record<string, unknown>): Promise<T>;
  update<T>(table: TableName, id: string, patch: Record<string, unknown>, opts?: UpdateOptions): Promise<T>;
  remove(table: TableName, id: string): Promise<void>;
  matchClientByPhone(phone: string): Promise<PhoneMatch>;
}

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(404, "not_found", `${what} not found`);
export const conflict = (msg: string) => new AppError(409, "conflict", msg);
export const staleWrite = (what: string) =>
  new AppError(409, "stale_write", `${what} was changed by another request. Please retry.`);
export const forbidden = (msg = "You do not have permission to perform this action") => new AppError(403, "forbidden", msg);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, "bad_request", msg, details);
export const isConflict = (e: unknown) => e instanceof AppError && e.status === 409;
export const isStaleWrite = (e: unknown) => e instanceof AppError && e.code === "stale_write";
