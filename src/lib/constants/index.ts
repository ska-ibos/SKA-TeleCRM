export const APP_NAME = "SKA TeleCRM";
export const COMPANY = "Single Key Advisory Pvt. Ltd.";
export const CRM_DESK_NAME = "Jinofer";
export const OPERATIONS_LINE = "OPERATIONS";

export const DEPARTMENT_SEED: { key: number; name: string; kind: "crm" | "missed_call" | "department"; members: string[] }[] = [
  { key: 1, name: "CRM Desk", kind: "crm", members: ["Jinofer"] },
  { key: 2, name: "Missed-call callback", kind: "missed_call", members: [] },
  { key: 3, name: "FA 360", kind: "department", members: ["Urja", "Jenish", "Prassana"] },
  { key: 4, name: "Internal Audit", kind: "department", members: ["Hiren", "Shruti", "Rajat", "Prassana"] },
  { key: 5, name: "MIS", kind: "department", members: ["Urja", "Prachi", "Vilas"] },
  { key: 6, name: "GST", kind: "department", members: ["Sneha", "Hiren", "Shruti", "Komal", "Rajat"] },
  { key: 7, name: "Income Tax", kind: "department", members: ["Hiren", "Shruti", "Komal", "Rajat"] },
  { key: 8, name: "Accounting", kind: "department", members: ["Hiren", "Shruti", "Komal"] },
  { key: 9, name: "ROC", kind: "department", members: ["Shruti", "Rahul"] },
];

export interface OfficeHours { timezone: string; days: number[]; start: string; end: string }
export interface Prompts { greeting: string; reprompt: string; after_hours: string; connecting: string; known_caller: string; recording_notice: string }
/** Played while an agent who has an extension is rung. {name} and {extension} are filled in. */
export const DEFAULT_CONNECTING_PROMPT = "Connecting you to {name}. To reach {name} directly next time, enter extension {extension} when you call.";

export const DEFAULT_KNOWN_CALLER_PROMPT = "Namaste {name} ji.";
/** Legal notice that the call is recorded (Exotel records live calls). Empty = not spoken. */
export const DEFAULT_RECORDING_NOTICE = "This call may be recorded for quality and training purposes.";

export const DEFAULT_ROUTING_CONFIG = {
  sticky_days: 3,
  max_reprompts: 1,
  office_hours: { timezone: "Asia/Kolkata", days: [1, 2, 3, 4, 5, 6], start: "10:00", end: "19:00" } as OfficeHours,
  prompts: {
    greeting:
      "Welcome to Single Key Advisory. Enter the extension number, or press 1 for CRM desk, 2 if you missed our call, 3 for FA 360, 4 for Internal Audit, 5 for MIS, 6 for GST, 7 for Income Tax, 8 for Accounting, 9 for ROC.",
    reprompt: "Sorry, we did not receive a valid input. Please try again.",
    after_hours:
      "Thank you for calling Single Key Advisory. Our office hours are Monday to Saturday, 10 AM to 7 PM. Please leave a message after the tone and we will call you back.",
    connecting: DEFAULT_CONNECTING_PROMPT,
    // spoken before the greeting on live calls; {name} = the caller's client name (known callers only)
    known_caller: DEFAULT_KNOWN_CALLER_PROMPT,
    recording_notice: DEFAULT_RECORDING_NOTICE,
  } as Prompts,
};
export type RoutingConfig = typeof DEFAULT_ROUTING_CONFIG;

export const ROLE_LABELS = { admin: "Admin", crm_desk: "CRM Desk", manager: "Manager", agent: "Agent" } as const;

/** Who may do what - enforced in API routes (backend) and mirrored by RLS. */
export const PERMISSIONS = {
  "clients:write": ["admin", "crm_desk", "manager"],
  "clients:delete": ["admin", "manager"],
  "team:write": ["admin"],
  "departments:write": ["admin"],
  "extensions:write": ["admin"],
  "settings:write": ["admin"],
  "audit:read": ["admin"],
  "reports:read": ["admin", "manager", "crm_desk"],
  "calls:transfer": ["admin", "crm_desk", "manager", "agent"],
  "calls:outbound": ["admin", "crm_desk", "manager", "agent"],
  "simulator:use": ["admin", "crm_desk", "manager", "agent"],
  "tags:write": ["admin", "crm_desk", "manager"],
} as const;
export type Permission = keyof typeof PERMISSIONS;
