# Database schema

TeleCRM runs inside the **shared SKA OS Supabase database** (project `btfznkhnuytcfaduvjbm`).

Ground rules (applied 2026-11-04):
- **Additive only.** Every TeleCRM object is new and prefixed `tc_`. No existing table is altered.
- **Nothing is dropped, deleted or truncated** by migrations or scheduled jobs. There is no purge job.
- **SKA OS data is read-only for TeleCRM.** `clients`, `client_contacts` and `employees` are read through views. FKs into SKA OS tables use only `ON DELETE SET NULL` / `CASCADE`, so TeleCRM can never block SKA OS from deleting a client, employee or user.
- **Tenant-scoped.** Every row has `tenant_id`. `tc_` → `tc_` references are composite `(tenant_id, id)` FKs, so a row can't point at another workspace's data. Rows that point at `public.clients` are checked by a trigger.

Migrations: `supabase/migrations/2026110400000{1,2,3}_telecrm_*.sql` (applied as `telecrm_01_core`, `telecrm_02_views_security`, `telecrm_03_seed`).
Verification: `supabase/tests/rls.test.sql` (dry run that always rolls back).

## Tables (TeleCRM-owned)

| Table (logical name) | Purpose | Integrity / race guards |
|---|---|---|
| `tc_team_members` (`team_members`) | Agents. Optional link to `employees`; the login comes from `employees.auth_user_id` | unique per tenant: name (case-insensitive), email, phone, **extension**, employee; unique auth user. A trigger copies name/login from the employee, enforces same tenant, and requires the login to be a member of the workspace |
| `tc_departments` (`departments`) | IVR keys 1–9, optional link to SKA OS `departments` | unique (tenant, ivr_key), name; exactly one `crm` and one `missed_call` per tenant |
| `tc_department_members` | Department ↔ agent | unique (department, member) |
| `tc_client_phones` (`client_phone_numbers` writes) | Caller-ID numbers added in TeleCRM | unique (tenant, phone); one primary per client |
| `tc_calls` | Every call | **unique (tenant, provider, provider_call_id)** for webhook idempotency; `answered_at`/`ended_at` ≥ `started_at`; partial indexes for sticky, key-2, live queue |
| `tc_call_sessions` | IVR state machine | unique call; **`version` optimistic lock** bumped by trigger; context ≤ 64 KB |
| `tc_call_transfers` | Transfers (seed sticky) | **one in-flight (`initiated`) transfer per call** |
| `tc_recordings` | Recording / voicemail locations | needs a storage path or an https URL |
| `tc_notes`, `tc_tags`, `tc_client_tags` | CRM notes and tags | length checks; unique tag name; unique (client, tag) |
| `tc_reminders` | Follow-ups and callbacks | **one automatic callback per call** (partial unique) |
| `tc_routing_config` | sticky_days, max_reprompts, office_hours, prompts | PK (tenant, key); a check constraint validates value shape and ranges |
| `tc_audit_logs` | Who did what | **immutable** (update trigger; no DELETE grant even for the service role) |
| `tc_webhook_events` (`webhook_events`) | Idempotency keys | unique (tenant, provider, key); request hash; lock expiry |
| `tc_provider_events` | Raw log of every authenticated provider callback | payload ≤ 256 KB; outcome processed/replayed/rejected/failed |

## Read-only views over SKA OS data

| View (logical name) | Source | Notes |
|---|---|---|
| `tc_clients_v` (`clients`) | `public.clients` | Not updatable; the service role has SELECT only. Create/edit clients in SKA OS |
| `tc_client_phone_directory` (`client_phone_numbers` reads) | `tc_client_phones` + `clients.mobile` + `client_contacts.contact`, normalised to E.164 | `source` = telecrm / client_master / client_contact |
| `tc_employee_directory` (`employees`) | `employees` + departments | Used to provision agents |

## Functions

| Function | Purpose |
|---|---|
| `tc_normalize_phone(raw, cc)` | E.164 normaliser. **Must match `src/lib/utils/phone.ts`** |
| `tc_match_client_by_phone(tenant, phone)` | Caller ID. Precedence: TeleCRM number > client mobile > contact. More than one client in the winning tier = ambiguous → unknown caller + candidates (143 numbers are currently shared, e.g. group companies) |
| `tc_close_stale_calls(interval)` | pg_cron `tc-close-stale-calls` every 15 min. Closes calls with no final callback after 6 h. **UPDATE only** |
| `tc_is_active_user(tenant)` | RLS helper for realtime on `tc_calls` |

## Concurrency model

| Risk | Guard |
|---|---|
| Provider retries the same webhook | `withIdempotency`: unique key claim. A completed key replays its response; a different payload under the same key gets 422; an expired lock is taken over by compare-and-set; a failure releases the lock (no delete) |
| Two "incoming" events for one call | unique provider call id. The loser re-reads and replays the winner's step |
| DTMF and status callbacks racing on one call | session `version` compare-and-set. The loser gets 409 `concurrent_update` and the provider retries |
| Duplicate dial/transfer/outbound outcome | compare-and-set on `status` (`connecting` / `initiated`) / `ended_at is null`. The first outcome wins |
| Missed + voicemail at once | one automatic reminder per call (partial unique) |
| Two numbers set as primary | one primary per client (partial unique) → 409 |

## Security

RLS is enabled on every `tc_` table. Default grants from `anon`/`authenticated` are revoked: this database grants new public objects to them by default, so this must be done explicitly. The Next.js server uses the service role after its own role checks. Browsers get only realtime `SELECT` on `tc_calls`, limited by RLS to active TeleCRM users and SKA OS workspace admins.

Supabase advisor: "RLS enabled, no policy" on 15 tables is intentional (server-only).

## Role access (enforced in API routes)

| | admin | crm_desk | manager | agent |
|---|---|---|---|---|
| Read CRM data | ✓ | ✓ | ✓ | ✓ |
| Add caller-ID numbers / tags | ✓ | ✓ | ✓ | – |
| Create / edit / delete clients | in SKA OS only | | | |
| Team, departments, extensions, settings | ✓ | – | – | – |
| Reminders update | ✓ | ✓ | ✓ | own / assigned |
| Audit logs | ✓ | – | – | – |

Sign-in (Supabase mode): the user must be a member of the workspace. An active `tc_team_members` row linked to their login gives their TeleCRM role. SKA OS workspace admins without a row get TeleCRM admin, so they can provision agents.
