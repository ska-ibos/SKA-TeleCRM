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
export interface Prompts {
  greeting: string; reprompt: string; after_hours: string; connecting: string;
  known_caller: string; recording_notice: string; sticky_offer: string; voicemail: string;
}

/*
 * Default IVR wording - Hinglish, as specified (SKA TeleCRM spec v1.1 §5). Every prompt is
 * editable in Settings; values saved there win over these defaults.
 */
/** Played while an agent who has an extension is rung. {name} and {extension} are filled in. */
export const DEFAULT_CONNECTING_PROMPT = "Aapko {name} se connect kiya ja raha hai. Agli baar seedha {name} se baat karne ke liye extension {extension} ke baad hash dabaiye.";
/** Spoken first when the caller is a recognised client. {name} = client name. Empty = skipped. */
export const DEFAULT_KNOWN_CALLER_PROMPT = "Namaste {name} ji!";
/** Legal notice that the call is recorded (Exotel records live calls). Empty = not spoken. */
export const DEFAULT_RECORDING_NOTICE = "Yeh call record ki ja rahi hai.";
/** Sticky sub-menu. {department} and {name} are filled in. */
export const DEFAULT_STICKY_PROMPT = "{department} ke liye aapki pichhli baat {name} se hui thi. {name} se baat karne ke liye 1 dabaiye, nahi toh 2 dabaiye.";

export type DeptMissBehavior = "crm" | "ring_department_group";

export const DEFAULT_ROUTING_CONFIG = {
  sticky_days: 3,
  max_reprompts: 1,
  office_hours: { timezone: "Asia/Kolkata", days: [1, 2, 3, 4, 5, 6], start: "10:00", end: "19:00" } as OfficeHours,
  /** No valid sticky for a department: "crm" (CRM desk routes and seeds the sticky) or ring the department's members. */
  dept_miss_behavior: "crm" as DeptMissBehavior,
  /** Key 2 only follows outbound calls this recent. 0 = no limit. */
  missed_call_window_days: 0,
  /** How many people ring at once for the CRM desk / a department group. 1 = one after another (Exotel parallel ringing is a paid add-on). */
  parallel_ring_max: 1,
  prompts: {
    greeting:
      "Single Key Advisory mein aapka swagat hai. Jis team member se baat karni ho, unka extension pata ho toh extension ke baad hash dabaiye. Hamari CRM team ke liye 1 dabaiye. Missed call ke liye 2. FA 360 ke liye 3. Internal Audit ke liye 4. MIS ke liye 5. GST ke liye 6. Income Tax ke liye 7. Accounting ke liye 8. ROC ke liye 9.",
    reprompt: "Maaf kijiye, humein sahi input nahi mila. Kripya dobara koshish karein.",
    after_hours:
      "Single Key Advisory ko call karne ke liye dhanyavaad. Hamara office Somvaar se Shanivaar, subah 10 se shaam 7 baje tak khula rehta hai. Beep ke baad apna sandesh chhodiye, hum aapko call karenge.",
    voicemail: "Abhi hamari team vyast hai. Beep ke baad apna sandesh chhodiye, hum aapko jald hi call karenge.",
    connecting: DEFAULT_CONNECTING_PROMPT,
    sticky_offer: DEFAULT_STICKY_PROMPT,
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
