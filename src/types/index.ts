export type AppRole = "admin" | "crm_desk" | "manager" | "agent";
export type AgentStatus = "available" | "busy" | "offline";
export type CallDirection = "inbound" | "outbound";
export type CallStatus =
  | "ringing" | "in_ivr" | "queued" | "connecting" | "answered" | "completed"
  | "missed" | "busy" | "no_answer" | "voicemail" | "failed";
export type DialResult = "answered" | "busy" | "no_answer" | "failed";

export interface TeamMember {
  id: string; full_name: string; email: string | null; phone: string | null;
  extension: string | null; role: AppRole; status: AgentStatus;
  is_crm_desk: boolean; is_active: boolean; created_at: string; updated_at: string;
  /** SKA OS link (Supabase mode). Login is resolved through auth_user_id. */
  employee_id?: string | null; auth_user_id?: string | null;
}
/** SKA OS employee that can be provisioned as a TeleCRM team member (read-only). */
export interface EmployeeDirectoryEntry {
  id: string; name: string; email: string | null; phone: string | null; status: string;
  auth_user_id: string | null; login_enabled: boolean; departments: string[]; team_member_id: string | null;
}
export interface Department {
  id: string; ivr_key: number; name: string; kind: "crm" | "missed_call" | "department";
  description: string | null; is_active: boolean; created_at: string;
}
export interface DepartmentMember { id: string; department_id: string; team_member_id: string; created_at: string }
export interface Client {
  id: string; name: string; company: string | null; email: string | null; pan: string | null;
  gstin: string | null; city: string | null; status: "active" | "inactive" | "prospect";
  created_by: string | null; created_at: string; updated_at: string;
}
/** source: "telecrm" (editable here) | "client_master" | "client_contact" (owned by SKA OS, read-only) */
export interface ClientPhone { id: string; client_id: string; phone: string; label: string; is_primary: boolean; source?: string; created_at: string }
export interface Call {
  id: string; direction: CallDirection; client_id: string | null; from_number: string; to_number: string;
  status: CallStatus; ivr_input: string | null; department_id: string | null;
  routed_agent_id: string | null; answered_agent_id: string | null; initiated_by: string | null;
  route_reason: string | null; after_hours: boolean; is_simulated: boolean; provider: string;
  provider_call_id: string | null; started_at: string; answered_at: string | null; ended_at: string | null;
  duration_sec: number | null; created_at: string;
}
export type SessionState = "greeting" | "sticky_offer" | "dialing" | "connected" | "voicemail" | "ended";
export interface CallSession {
  id: string; call_id: string; state: SessionState; attempts: number;
  offered_agent_id: string | null; target_agent_id: string | null;
  context: { fallback?: "crm" | "voicemail"; pool?: "crm" | "department"; poolDept?: string | null; tried?: string[]; trail?: string[]; transferId?: string; departmentId?: string | null; candidateClientIds?: string[] };
  /** Optimistic lock, bumped on every update. */
  version: number;
  created_at: string; updated_at: string;
}
export interface CallTransfer {
  id: string; call_id: string; from_member_id: string | null; to_member_id: string;
  department_id: string | null; status: "initiated" | "answered" | "busy" | "no_answer" | "failed"; created_at: string;
}
export interface Note { id: string; client_id: string; call_id: string | null; author_id: string | null; body: string; created_at: string }
export interface Tag { id: string; name: string; color: string; created_at: string }
export interface ClientTag { id: string; client_id: string; tag_id: string; created_at: string }
export interface Reminder {
  id: string; client_id: string | null; call_id: string | null; assigned_to: string | null; created_by: string | null;
  title: string; due_at: string; status: "pending" | "done" | "cancelled";
  source: "manual" | "after_hours" | "voicemail" | "missed"; created_at: string;
  /** WhatsApp delivery (migration 20261119000001). Missing = "both". */
  notify_via?: "in_app" | "whatsapp" | "both"; notified_at?: string | null; notify_error?: string | null;
}
export interface AuditLog { id: string; actor_id: string | null; action: string; entity: string; entity_id: string | null; details: Record<string, unknown>; created_at: string }
export interface RoutingConfigRow { key: string; value: unknown; id?: string }

export interface SessionUser {
  id: string; name: string; email: string | null; role: AppRole; memberId: string | null; mode: "demo" | "supabase";
  /** True when clients live in SKA OS (Supabase mode): no create/edit/delete in TeleCRM. */
  clientsManagedExternally?: boolean;
  /** True when TELEPHONY_PROVIDER=exotel: calls are real, no simulated outcomes in the UI. */
  liveTelephony?: boolean;
  /** True when WhatsApp reminders (SendBuddy) are set up on the server. */
  whatsapp?: boolean;
}

/** Result of every routing step: what the IVR/telephony layer must do next. */
export interface RouteStep {
  callId: string;
  state: SessionState;
  action: "gather" | "gather_sticky" | "dial" | "connected" | "voicemail" | "hangup";
  prompt?: string;
  agent?: { id: string; name: string; extension?: string | null } | null;
  reason: string;
  trail: string[];
}
