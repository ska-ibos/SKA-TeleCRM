-- =====================================================================
-- SKA TeleCRM — core schema (shared SKA OS database)
--
-- ADDITIVE ONLY. Every object is new and prefixed `tc_`. No existing table
-- is altered. Existing tables are referenced read-only:
--   public.tenants, public.clients, public.client_contacts,
--   public.employees, public.departments, auth.users
-- FKs into existing tables use ON DELETE SET NULL / CASCADE only, so TeleCRM
-- can never block SKA OS from deleting a client, employee or user.
--
-- Every row carries tenant_id. tc_ -> tc_ references are composite
-- (tenant_id, id) FKs so a row can never point at another tenant's data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.tc_set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Optimistic concurrency: every UPDATE bumps version. Writers send
-- "... where version = <read version>" and treat 0 rows as a conflict.
create or replace function public.tc_bump_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

-- E.164 normaliser. MUST stay in sync with src/lib/utils/phone.ts.
--   9876543210, 09876543210, 919876543210, +91 98765-43210 -> +919876543210
create or replace function public.tc_normalize_phone(p_raw text, p_country_code text default null)
returns text language plpgsql immutable parallel safe set search_path = '' as $$
declare
  raw text := btrim(coalesce(p_raw, ''));
  d   text;
  cc  text;
begin
  if raw = '' then return null; end if;
  d := regexp_replace(raw, '\D', '', 'g');
  if d = '' then return null; end if;

  if left(raw, 1) = '+' then
    return case when d ~ '^[1-9][0-9]{7,14}$' then '+' || d end;
  end if;

  cc := nullif(regexp_replace(coalesce(p_country_code, ''), '\D', '', 'g'), '');
  if cc is not null and length(d) = 10 and left(d, 1) <> '0' then
    return case when (cc || d) ~ '^[1-9][0-9]{7,14}$' then '+' || cc || d end;
  end if;

  if left(d, 2) = '00' then d := substr(d, 3);
  elsif length(d) = 11 and left(d, 1) = '0' then d := substr(d, 2);
  end if;

  if length(d) = 10 and d ~ '^[6-9]' then return '+91' || d; end if;
  if length(d) = 12 and left(d, 2) = '91' and substr(d, 3, 1) ~ '[6-9]' then return '+' || d; end if;
  if regexp_replace(raw, '\D', '', 'g') ~ '^0[0-9]{10}$' then return '+91' || d; end if; -- landline + STD
  if length(d) between 11 and 15 and left(d, 1) <> '0' then return '+' || d; end if;
  return null;
end $$;

-- Rows that reference public.clients must belong to the client's tenant.
create or replace function public.tc_guard_client_tenant() returns trigger
language plpgsql set search_path = '' as $$
declare v_tenant uuid;
begin
  if new.client_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id
     and new.tenant_id = old.tenant_id then
    return new;
  end if;
  select c.tenant_id into v_tenant from public.clients c where c.id = new.client_id;
  if v_tenant is not null and v_tenant <> new.tenant_id then
    raise exception using errcode = '22023', message = 'Client belongs to a different workspace';
  end if;
  return new; -- a missing client is reported by the FK
end $$;

-- ---------------------------------------------------------------------
-- 1. Team members / agents (linked to SKA OS employees + auth users)
-- ---------------------------------------------------------------------
create table public.tc_team_members (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  employee_id   uuid references public.employees(id) on delete set null,
  auth_user_id  uuid references auth.users(id) on delete set null,
  full_name     text not null check (length(btrim(full_name)) between 2 and 80),
  email         text check (email is null or (length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone         text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  extension     text check (extension is null or extension ~ '^[0-9]{2,6}$'),
  role          text not null default 'agent' check (role in ('admin', 'crm_desk', 'manager', 'agent')),
  status        text not null default 'offline' check (status in ('available', 'busy', 'offline')),
  is_crm_desk   boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index tc_team_members_name_uq      on public.tc_team_members (tenant_id, lower(btrim(full_name)));
create unique index tc_team_members_email_uq     on public.tc_team_members (tenant_id, lower(email)) where email is not null;
create unique index tc_team_members_phone_uq     on public.tc_team_members (tenant_id, phone) where phone is not null;
create unique index tc_team_members_ext_uq       on public.tc_team_members (tenant_id, extension) where extension is not null;
create unique index tc_team_members_employee_uq  on public.tc_team_members (tenant_id, employee_id) where employee_id is not null;
create unique index tc_team_members_auth_uq      on public.tc_team_members (auth_user_id) where auth_user_id is not null;
create index tc_team_members_avail_idx           on public.tc_team_members (tenant_id, is_active, status);
create index tc_team_members_employee_fk_idx     on public.tc_team_members (employee_id);

-- Link to SKA OS: copy login + name from the employee; enforce same tenant
-- and that the login is a member of this tenant.
create or replace function public.tc_team_members_link() returns trigger
language plpgsql set search_path = '' as $$
declare e record;
begin
  if new.employee_id is not null
     and (tg_op = 'INSERT' or new.employee_id is distinct from old.employee_id) then
    select emp.tenant_id, emp.auth_user_id, emp.name, emp.email
      into e from public.employees emp where emp.id = new.employee_id;
    if not found then
      raise exception using errcode = '22023', message = 'Employee not found';
    end if;
    if e.tenant_id <> new.tenant_id then
      raise exception using errcode = '22023', message = 'Employee belongs to a different workspace';
    end if;
    new.auth_user_id := coalesce(e.auth_user_id, new.auth_user_id);
    new.full_name    := coalesce(nullif(btrim(new.full_name), ''), e.name);
    new.email        := coalesce(new.email, nullif(lower(btrim(e.email)), ''));
  end if;

  if new.auth_user_id is not null
     and (tg_op = 'INSERT' or new.auth_user_id is distinct from old.auth_user_id)
     and not exists (select 1 from public.memberships m
                     where m.user_id = new.auth_user_id and m.tenant_id = new.tenant_id) then
    raise exception using errcode = '22023', message = 'Login is not a member of this workspace';
  end if;
  return new;
end $$;

create trigger tc_team_members_link before insert or update of employee_id, auth_user_id, tenant_id
  on public.tc_team_members for each row execute function public.tc_team_members_link();
create trigger tc_team_members_updated before update on public.tc_team_members
  for each row execute function public.tc_set_updated_at();

-- ---------------------------------------------------------------------
-- 2. IVR departments (keys 1–9) and their members
-- ---------------------------------------------------------------------
create table public.tc_departments (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  ivr_key            smallint not null check (ivr_key between 1 and 9),
  name               text not null check (length(btrim(name)) between 2 and 60),
  kind               text not null default 'department' check (kind in ('crm', 'missed_call', 'department')),
  description        text check (description is null or length(description) <= 300),
  ops_department_id  uuid references public.departments(id) on delete set null, -- optional link to SKA OS dept
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, ivr_key)
);
create unique index tc_departments_name_uq on public.tc_departments (tenant_id, lower(btrim(name)));
-- exactly one CRM desk and one missed-call key per tenant
create unique index tc_departments_special_uq on public.tc_departments (tenant_id, kind) where kind in ('crm', 'missed_call');
create index tc_departments_ops_fk_idx on public.tc_departments (ops_department_id);
create trigger tc_departments_updated before update on public.tc_departments
  for each row execute function public.tc_set_updated_at();

create table public.tc_department_members (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  department_id   uuid not null,
  team_member_id  uuid not null,
  created_at      timestamptz not null default now(),
  unique (department_id, team_member_id),
  foreign key (tenant_id, department_id)  references public.tc_departments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, team_member_id) references public.tc_team_members (tenant_id, id) on delete cascade
);
create index tc_department_members_member_idx on public.tc_department_members (team_member_id);

-- ---------------------------------------------------------------------
-- 3. Caller-ID phone numbers added from TeleCRM (SKA OS clients.mobile and
--    client_contacts are read through tc_client_phone_directory; never copied)
-- ---------------------------------------------------------------------
create table public.tc_client_phones (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  phone       text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  label       text not null default 'mobile' check (label in ('mobile', 'office', 'home', 'other')),
  is_primary  boolean not null default false,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, phone),
  foreign key (tenant_id, created_by) references public.tc_team_members (tenant_id, id) on delete set null (created_by)
);
create unique index tc_client_phones_one_primary on public.tc_client_phones (client_id) where is_primary;
create index tc_client_phones_client_idx on public.tc_client_phones (client_id);
create index tc_client_phones_created_by_idx on public.tc_client_phones (created_by);
create trigger tc_client_phones_tenant before insert or update on public.tc_client_phones
  for each row execute function public.tc_guard_client_tenant();
create trigger tc_client_phones_updated before update on public.tc_client_phones
  for each row execute function public.tc_set_updated_at();

-- ---------------------------------------------------------------------
-- 4. Calls
-- ---------------------------------------------------------------------
create table public.tc_calls (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  direction          text not null check (direction in ('inbound', 'outbound')),
  client_id          uuid references public.clients(id) on delete set null,
  from_number        text not null check (length(from_number) between 3 and 32),
  to_number          text not null check (length(to_number) between 3 and 32),
  status             text not null default 'ringing' check (status in
                       ('ringing', 'in_ivr', 'queued', 'connecting', 'answered', 'completed',
                        'missed', 'busy', 'no_answer', 'voicemail', 'failed')),
  ivr_input          text check (ivr_input is null or ivr_input ~ '^[0-9*#]{1,10}$'),
  department_id      uuid,
  routed_agent_id    uuid,
  answered_agent_id  uuid,
  initiated_by       uuid,
  route_reason       text check (route_reason is null or length(route_reason) <= 1000),
  after_hours        boolean not null default false,
  is_simulated       boolean not null default false,
  provider           text not null default 'simulation' check (provider in ('simulation', 'exotel')),
  provider_call_id   text check (provider_call_id is null or length(provider_call_id) between 1 and 200),
  started_at         timestamptz not null default now(),
  answered_at        timestamptz,
  ended_at           timestamptz,
  duration_sec       integer check (duration_sec is null or duration_sec between 0 and 86400),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, id),
  constraint tc_calls_answer_after_start check (answered_at is null or answered_at >= started_at),
  constraint tc_calls_end_after_start    check (ended_at is null or ended_at >= started_at),
  foreign key (tenant_id, department_id)     references public.tc_departments (tenant_id, id)  on delete set null (department_id),
  foreign key (tenant_id, routed_agent_id)   references public.tc_team_members (tenant_id, id) on delete set null (routed_agent_id),
  foreign key (tenant_id, answered_agent_id) references public.tc_team_members (tenant_id, id) on delete set null (answered_agent_id),
  foreign key (tenant_id, initiated_by)      references public.tc_team_members (tenant_id, id) on delete set null (initiated_by)
);
-- idempotent provider webhooks: one row per provider call id
create unique index tc_calls_provider_call_uq on public.tc_calls (tenant_id, provider, provider_call_id) where provider_call_id is not null;
create index tc_calls_started_idx      on public.tc_calls (tenant_id, started_at desc);
create index tc_calls_status_idx       on public.tc_calls (tenant_id, status, started_at desc);
create index tc_calls_live_idx         on public.tc_calls (tenant_id, started_at desc) where ended_at is null;
create index tc_calls_client_idx       on public.tc_calls (client_id, started_at desc) where client_id is not null;
-- sticky agent lookups (latest answered inbound per client|phone + department)
create index tc_calls_sticky_client_idx on public.tc_calls (client_id, department_id, answered_at desc)
  where direction = 'inbound' and answered_agent_id is not null;
create index tc_calls_sticky_phone_idx  on public.tc_calls (tenant_id, from_number, department_id, answered_at desc)
  where direction = 'inbound' and answered_agent_id is not null;
-- key-2 missed-call lookups (latest outbound per client|phone)
create index tc_calls_outbound_phone_idx  on public.tc_calls (tenant_id, to_number, started_at desc)
  where direction = 'outbound' and initiated_by is not null;
create index tc_calls_outbound_client_idx on public.tc_calls (client_id, started_at desc)
  where direction = 'outbound' and initiated_by is not null;
create index tc_calls_simulated_idx    on public.tc_calls (tenant_id) where is_simulated;
create index tc_calls_department_fk_idx on public.tc_calls (department_id);
create index tc_calls_routed_fk_idx     on public.tc_calls (routed_agent_id);
create index tc_calls_answered_fk_idx   on public.tc_calls (answered_agent_id);
create index tc_calls_initiated_fk_idx  on public.tc_calls (initiated_by);
create trigger tc_calls_tenant before insert or update on public.tc_calls
  for each row execute function public.tc_guard_client_tenant();
create trigger tc_calls_updated before update on public.tc_calls
  for each row execute function public.tc_set_updated_at();

-- IVR state machine per call (version = optimistic lock for concurrent webhooks)
create table public.tc_call_sessions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  call_id           uuid not null unique,
  state             text not null check (state in ('greeting', 'sticky_offer', 'dialing', 'connected', 'voicemail', 'ended')),
  attempts          smallint not null default 0 check (attempts between 0 and 10),
  offered_agent_id  uuid,
  target_agent_id   uuid,
  context           jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 65536),
  version           integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (tenant_id, call_id)          references public.tc_calls (tenant_id, id)        on delete cascade,
  foreign key (tenant_id, offered_agent_id) references public.tc_team_members (tenant_id, id) on delete set null (offered_agent_id),
  foreign key (tenant_id, target_agent_id)  references public.tc_team_members (tenant_id, id) on delete set null (target_agent_id)
);
create index tc_call_sessions_offered_fk_idx on public.tc_call_sessions (offered_agent_id);
create index tc_call_sessions_target_fk_idx  on public.tc_call_sessions (target_agent_id);
create index tc_call_sessions_open_idx       on public.tc_call_sessions (tenant_id, updated_at) where state <> 'ended';
create trigger tc_call_sessions_version before update on public.tc_call_sessions
  for each row execute function public.tc_bump_version();

create table public.tc_call_transfers (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  call_id         uuid not null,
  from_member_id  uuid,
  to_member_id    uuid,
  department_id   uuid,
  status          text not null default 'initiated' check (status in ('initiated', 'answered', 'busy', 'no_answer', 'failed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (tenant_id, call_id)        references public.tc_calls (tenant_id, id)        on delete cascade,
  foreign key (tenant_id, from_member_id) references public.tc_team_members (tenant_id, id) on delete set null (from_member_id),
  foreign key (tenant_id, to_member_id)   references public.tc_team_members (tenant_id, id) on delete set null (to_member_id),
  foreign key (tenant_id, department_id)  references public.tc_departments (tenant_id, id)  on delete set null (department_id)
);
-- race guard: only one in-flight transfer per call
create unique index tc_call_transfers_one_inflight on public.tc_call_transfers (call_id) where status = 'initiated';
create index tc_call_transfers_call_idx    on public.tc_call_transfers (call_id, created_at);
create index tc_call_transfers_from_fk_idx on public.tc_call_transfers (from_member_id);
create index tc_call_transfers_to_fk_idx   on public.tc_call_transfers (to_member_id);
create index tc_call_transfers_dept_fk_idx on public.tc_call_transfers (department_id);
create trigger tc_call_transfers_updated before update on public.tc_call_transfers
  for each row execute function public.tc_set_updated_at();

create table public.tc_recordings (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  call_id           uuid not null,
  storage_path      text check (storage_path is null or length(storage_path) between 1 and 500),
  provider_url      text check (provider_url is null or provider_url ~ '^https://'),
  duration_sec      integer check (duration_sec is null or duration_sec between 0 and 86400),
  kind              text not null default 'call' check (kind in ('call', 'voicemail')),
  created_at        timestamptz not null default now(),
  constraint tc_recordings_has_location check (storage_path is not null or provider_url is not null),
  foreign key (tenant_id, call_id) references public.tc_calls (tenant_id, id) on delete cascade
);
create unique index tc_recordings_path_uq on public.tc_recordings (tenant_id, storage_path) where storage_path is not null;
create unique index tc_recordings_url_uq  on public.tc_recordings (call_id, provider_url) where provider_url is not null;
create index tc_recordings_call_idx on public.tc_recordings (call_id);

-- ---------------------------------------------------------------------
-- 5. CRM: notes, tags, reminders
-- ---------------------------------------------------------------------
create table public.tc_notes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  call_id     uuid,
  author_id   uuid,
  body        text not null check (length(btrim(body)) between 1 and 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (tenant_id, call_id)   references public.tc_calls (tenant_id, id)        on delete set null (call_id),
  foreign key (tenant_id, author_id) references public.tc_team_members (tenant_id, id) on delete set null (author_id)
);
create index tc_notes_client_idx    on public.tc_notes (client_id, created_at desc);
create index tc_notes_tenant_idx    on public.tc_notes (tenant_id, created_at desc);
create index tc_notes_call_idx      on public.tc_notes (call_id) where call_id is not null;
create index tc_notes_author_fk_idx on public.tc_notes (author_id);
create trigger tc_notes_tenant before insert or update on public.tc_notes
  for each row execute function public.tc_guard_client_tenant();
create trigger tc_notes_updated before update on public.tc_notes
  for each row execute function public.tc_set_updated_at();

create table public.tc_tags (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 40),
  color       text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index tc_tags_name_uq on public.tc_tags (tenant_id, lower(btrim(name)));
create trigger tc_tags_updated before update on public.tc_tags
  for each row execute function public.tc_set_updated_at();

create table public.tc_client_tags (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  tag_id      uuid not null,
  created_at  timestamptz not null default now(),
  unique (client_id, tag_id),
  foreign key (tenant_id, tag_id) references public.tc_tags (tenant_id, id) on delete cascade
);
create index tc_client_tags_tag_idx on public.tc_client_tags (tag_id);
create trigger tc_client_tags_tenant before insert or update on public.tc_client_tags
  for each row execute function public.tc_guard_client_tenant();

create table public.tc_reminders (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  client_id    uuid references public.clients(id) on delete cascade,
  call_id      uuid,
  assigned_to  uuid,
  created_by   uuid,
  title        text not null check (length(btrim(title)) between 2 and 300),
  due_at       timestamptz not null,
  status       text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  source       text not null default 'manual' check (source in ('manual', 'after_hours', 'voicemail', 'missed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (tenant_id, call_id)     references public.tc_calls (tenant_id, id)        on delete set null (call_id),
  foreign key (tenant_id, assigned_to) references public.tc_team_members (tenant_id, id) on delete set null (assigned_to),
  foreign key (tenant_id, created_by)  references public.tc_team_members (tenant_id, id) on delete set null (created_by)
);
-- race guard: exactly one automatic callback reminder per call
create unique index tc_reminders_one_auto_per_call on public.tc_reminders (call_id)
  where source <> 'manual' and call_id is not null;
create index tc_reminders_due_idx       on public.tc_reminders (tenant_id, status, due_at);
create index tc_reminders_assignee_idx  on public.tc_reminders (assigned_to, status, due_at);
create index tc_reminders_client_idx    on public.tc_reminders (client_id, due_at) where client_id is not null;
create index tc_reminders_creator_fk_idx on public.tc_reminders (created_by);
create trigger tc_reminders_tenant before insert or update on public.tc_reminders
  for each row execute function public.tc_guard_client_tenant();
create trigger tc_reminders_updated before update on public.tc_reminders
  for each row execute function public.tc_set_updated_at();

-- ---------------------------------------------------------------------
-- 6. Routing config (validated key/value per tenant)
-- ---------------------------------------------------------------------
create table public.tc_routing_config (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  key         text not null check (key in ('sticky_days', 'max_reprompts', 'office_hours', 'prompts')),
  value       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, key),
  constraint tc_routing_config_value_shape check (
    case key
      when 'sticky_days'   then case when jsonb_typeof(value) = 'number'
                                     then (value #>> '{}')::numeric between 1 and 30 else false end
      when 'max_reprompts' then case when jsonb_typeof(value) = 'number'
                                     then (value #>> '{}')::numeric between 0 and 3 else false end
      when 'office_hours'  then jsonb_typeof(value) = 'object'
                                and value ?& array['timezone', 'days', 'start', 'end']
      when 'prompts'       then jsonb_typeof(value) = 'object'
                                and value ?& array['greeting', 'reprompt', 'after_hours']
      else false
    end)
);
create trigger tc_routing_config_updated before update on public.tc_routing_config
  for each row execute function public.tc_set_updated_at();

-- ---------------------------------------------------------------------
-- 7. Audit log (append-only)
-- ---------------------------------------------------------------------
create table public.tc_audit_logs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  actor_id    uuid,
  action      text not null check (length(action) between 1 and 64),
  entity      text not null check (length(entity) between 1 and 64),
  entity_id   text check (entity_id is null or length(entity_id) <= 200),
  details     jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, actor_id) references public.tc_team_members (tenant_id, id) on delete set null (actor_id)
);
create index tc_audit_logs_created_idx  on public.tc_audit_logs (tenant_id, created_at desc);
create index tc_audit_logs_entity_idx   on public.tc_audit_logs (entity, entity_id);
create index tc_audit_logs_actor_fk_idx on public.tc_audit_logs (actor_id);

create or replace function public.tc_audit_logs_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- only the FK action (actor removed -> actor_id null) may touch a row
  if new.actor_id is null and old.actor_id is not null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception using errcode = '42501', message = 'Audit log entries are immutable';
end $$;
create trigger tc_audit_logs_immutable before update on public.tc_audit_logs
  for each row execute function public.tc_audit_logs_immutable();

-- ---------------------------------------------------------------------
-- 8. Idempotency + raw provider event log
-- ---------------------------------------------------------------------
create table public.tc_webhook_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  provider      text not null check (length(provider) between 1 and 40),
  event_key     text not null check (length(event_key) between 1 and 300),
  request_hash  text check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$'),
  status        text not null default 'processing' check (status in ('processing', 'completed')),
  response      jsonb,
  locked_until  timestamptz not null default (now() + interval '2 minutes'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, provider, event_key),
  constraint tc_webhook_events_completed_has_response check (status <> 'completed' or response is not null)
);
create index tc_webhook_events_created_idx on public.tc_webhook_events (created_at);
create trigger tc_webhook_events_updated before update on public.tc_webhook_events
  for each row execute function public.tc_set_updated_at();

-- Every raw provider callback is stored before processing (debugging, replay,
-- and mapping verification when the official Exotel format is wired in).
create table public.tc_provider_events (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  provider          text not null check (provider in ('simulation', 'exotel')),
  endpoint          text not null check (length(endpoint) between 1 and 100),
  event_id          text check (event_id is null or length(event_id) <= 300),
  provider_call_id  text check (provider_call_id is null or length(provider_call_id) <= 200),
  payload           jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 262144),
  outcome           text not null default 'received' check (outcome in ('received', 'processed', 'replayed', 'rejected', 'failed')),
  error             text check (error is null or length(error) <= 2000),
  received_at       timestamptz not null default now(),
  processed_at      timestamptz
);
create index tc_provider_events_call_idx     on public.tc_provider_events (tenant_id, provider_call_id, received_at desc);
create index tc_provider_events_received_idx on public.tc_provider_events (received_at);
create index tc_provider_events_failed_idx   on public.tc_provider_events (tenant_id, received_at desc) where outcome in ('rejected', 'failed');
