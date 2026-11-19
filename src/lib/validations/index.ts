import { z } from "zod";
import { normalizePhone } from "../utils/phone";
import { isoRangeIssues } from "../utils/date-range";
import { DEFAULT_CONNECTING_PROMPT, DEFAULT_KNOWN_CALLER_PROMPT, DEFAULT_RECORDING_NOTICE } from "../constants";

const trimmed = (min: number, max: number, label: string) =>
  z.string({ error: `${label} is required` }).trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);
const optionalText = (max: number) =>
  z.string().trim().max(max, `Must be at most ${max} characters`).optional().nullable()
    .transform((v) => (v ? v : null));
const optionalPattern = (max: number, re: RegExp, msg: string) =>
  z.string().trim().max(max, `Must be at most ${max} characters`).optional().nullable()
    .transform((v) => (v ? v.replace(/\s+/g, " ") : null))
    .refine((v) => v === null || re.test(v), msg);
const safeName = (label: string) =>
  trimmed(2, 120, label).regex(/^[\p{L}\p{M}0-9 .,'&()\-/]+$/u, `${label} contains invalid characters`);

export const uuid = z.uuid("Invalid id");
export const phoneSchema = z.string({ error: "Phone number is required" }).trim().min(1, "Phone number is required")
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number (e.g. 98765 43210 or +91 98765 43210)" });
      return z.NEVER;
    }
    return n;
  });
const email = z.string().trim().toLowerCase().max(254).email("Enter a valid email address").optional().nullable()
  .or(z.literal("").transform(() => null)).transform((v) => v || null);

export const clientSchema = z.object({
  name: safeName("Client name"),
  company: optionalPattern(120, /^[\p{L}\p{M}0-9 .,'&()\-/@+#]+$/u, "Company contains invalid characters"),
  email,
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like ABCDE1234F").optional().nullable()
    .or(z.literal("").transform(() => null)).transform((v) => v || null),
  gstin: z.string().trim().toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5")
    .optional().nullable().or(z.literal("").transform(() => null)).transform((v) => v || null),
  city: optionalPattern(80, /^[\p{L}\p{M} .'\-()]+$/u, "City may only contain letters, spaces and . ' - ( )"),
  status: z.enum(["active", "inactive", "prospect"]).default("active"),
});
export const clientCreateSchema = clientSchema.extend({
  phones: z.array(z.object({ phone: phoneSchema, label: z.enum(["mobile", "office", "home", "other"]).default("mobile") }))
    .min(1, "Add at least one phone number").max(10, "At most 10 phone numbers")
    .refine((a) => new Set(a.map((p) => p.phone)).size === a.length, "Duplicate phone numbers"),
});
export const phoneCreateSchema = z.object({
  client_id: uuid, phone: phoneSchema,
  label: z.enum(["mobile", "office", "home", "other"]).default("mobile"),
  is_primary: z.boolean().default(false),
});

export const teamMemberSchema = z.object({
  /** SKA OS employee to link (Supabase mode). The login is taken from the employee record. */
  employee_id: uuid.nullish(), // no default: an omitted key must not unlink on PATCH
  full_name: safeName("Full name").max(80),
  email,
  phone: z.union([phoneSchema, z.literal("").transform(() => null), z.null()]).optional().transform((v) => v ?? null),
  role: z.enum(["admin", "crm_desk", "manager", "agent"]),
  status: z.enum(["available", "busy", "offline"]).default("offline"),
  is_crm_desk: z.boolean().default(false),
  is_active: z.boolean().default(true),
});
/**
 * PATCH body: only the keys that are sent change. Built without defaults on purpose -
 * `teamMemberSchema.partial()` would still fill `status: "offline"`, `is_active: true`, ...
 * and silently reset (or re-activate) the member.
 */
export const teamMemberPatchSchema = z.object({
  employee_id: uuid.nullish(),
  full_name: safeName("Full name").max(80).optional(),
  email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address").nullable().optional()
    .or(z.literal("").transform(() => null)),
  phone: z.union([phoneSchema, z.literal("").transform(() => null), z.null()]).optional(),
  role: z.enum(["admin", "crm_desk", "manager", "agent"]).optional(),
  status: z.enum(["available", "busy", "offline"]).optional(),
  is_crm_desk: z.boolean().optional(),
  is_active: z.boolean().optional(),
});
/** Optional on team create/update: the member's departments (IVR keys 3-9). Omitted = unchanged. */
export const memberDepartmentsSchema = z.object({
  department_ids: z.array(uuid).max(20, "At most 20 departments")
    .refine((a) => new Set(a).size === a.length, "Duplicate departments").optional(),
});
export const extensionSchema = z.object({
  team_member_id: uuid,
  extension: z.union([
    z.string().trim().regex(/^[0-9]{2,6}$/, "Extension must be 2–6 digits (single digits are reserved for IVR keys)"),
    z.literal("").transform(() => null), z.null(),
  ]),
});
export const statusSchema = z.object({ id: uuid, status: z.enum(["available", "busy", "offline"]) });

export const departmentSchema = z.object({
  name: trimmed(2, 60, "Department name"),
  description: optionalText(300),
  is_active: z.boolean().default(true),
});
export const departmentMembersSchema = z.object({ department_id: uuid, member_ids: z.array(uuid).max(50) });

export const noteSchema = z.object({ client_id: uuid, call_id: uuid.optional().nullable(), body: trimmed(1, 5000, "Note") });
export const tagSchema = z.object({
  name: trimmed(1, 40, "Tag name").regex(/^[\p{L}0-9 _\-]+$/u, "Tag may only contain letters, numbers, spaces, - and _"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #6366f1").default("#6366f1"),
});
export const clientTagSchema = z.object({ client_id: uuid, tag_id: uuid });

export const reminderSchema = z.object({
  title: trimmed(2, 200, "Title"),
  due_at: z.iso.datetime({ offset: true, error: "Enter a valid due date/time" })
    .refine((v) => Date.parse(v) < Date.now() + 366 * 86400_000, "Due date must be within the next year"),
  client_id: uuid.optional().nullable(),
  call_id: uuid.optional().nullable(),
  assigned_to: uuid.optional().nullable(),
});
export const reminderUpdateSchema = z.object({
  id: uuid, status: z.enum(["pending", "done", "cancelled"]).optional(),
  title: trimmed(2, 200, "Title").optional(),
  due_at: z.iso.datetime({ offset: true }).optional(),
  assigned_to: uuid.optional().nullable(),
});

const officeHoursSchema = z.object({
  timezone: z.string().min(1).refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Unknown timezone"),
  days: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one working day"),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
}).refine((o) => o.start < o.end, { message: "Closing time must be after opening time", path: ["end"] });
export const routingConfigSchema = z.object({
  sticky_days: z.number().int().min(1).max(30),
  max_reprompts: z.number().int().min(0).max(3),
  office_hours: officeHoursSchema,
  prompts: z.object({
    greeting: trimmed(10, 1000, "Greeting"), reprompt: trimmed(5, 500, "Re-prompt"), after_hours: trimmed(10, 1000, "After-hours message"),
    connecting: trimmed(10, 300, "Connecting announcement")
      .refine((v) => v.includes("{extension}"), "Include {extension} so the caller hears the number")
      .refine((v) => !/\{(?!name\}|extension\})[^}]*\}/.test(v), "Only {name} and {extension} can be used")
      .default(DEFAULT_CONNECTING_PROMPT),
    known_caller: z.string().trim().max(200, "Must be at most 200 characters")
      .refine((v) => !/\{(?!name\})[^}]*\}/.test(v), "Only {name} can be used")
      .default(DEFAULT_KNOWN_CALLER_PROMPT),
    recording_notice: z.string().trim().max(300, "Must be at most 300 characters").default(DEFAULT_RECORDING_NOTICE),
  }),
});

/** From/To filter on calls and reports (see lib/utils/date-range.ts for the rules). */
export const dateRangeSchema = z.object({
  from: z.iso.datetime({ offset: true, error: "Start date must be a valid date" }).optional(),
  to: z.iso.datetime({ offset: true, error: "End date must be a valid date" }).optional(),
}).superRefine((r, ctx) => {
  for (const i of isoRangeIssues(r.from, r.to)) ctx.addIssue({ code: "custom", path: [i.path], message: i.message });
});

/* ---------- telephony / simulator ---------- */
const at = z.iso.datetime({ offset: true }).optional();
export const simulatorSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), from: phoneSchema, at, idempotencyKey: z.string().min(8).max(100) }),
  z.object({ action: z.literal("input"), callId: uuid, digits: z.string().regex(/^[0-9*#]{0,6}$/, "Digits only"), at, idempotencyKey: z.string().min(8).max(100) }),
  z.object({ action: z.literal("sticky"), callId: uuid, digit: z.string().max(1), at, idempotencyKey: z.string().min(8).max(100) }),
  z.object({ action: z.literal("dial_result"), callId: uuid, result: z.enum(["answered", "busy", "no_answer", "failed"]), at, idempotencyKey: z.string().min(8).max(100) }),
  z.object({ action: z.literal("voicemail"), callId: uuid, message: optionalText(500), at, idempotencyKey: z.string().min(8).max(100) }),
  z.object({ action: z.literal("hangup"), callId: uuid, at, idempotencyKey: z.string().min(8).max(100) }),
  z.object({ action: z.literal("reset") }),
]);
export const outboundSchema = z.object({
  agent_id: uuid, to: phoneSchema, result: z.enum(["answered", "busy", "no_answer", "failed"]).optional(),
  at, idempotencyKey: z.string().min(8).max(100),
});
export const transferSchema = z.object({
  call_id: uuid, to_member_id: uuid, department_id: uuid.optional().nullable(),
  result: z.enum(["answered", "busy", "no_answer", "failed"]).optional(), at, idempotencyKey: z.string().min(8).max(100),
});
/** SKA OS accounts sign in with a username (3-20 chars: letters, numbers, . _) or their email. */
export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your username or email").max(254)
    .refine((v) => (v.includes("@") ? z.email().safeParse(v).success : /^[A-Za-z0-9._]{3,20}$/.test(v)), "Enter a valid username or email"),
  password: z.string().min(1, "Enter your password").max(200),
});
