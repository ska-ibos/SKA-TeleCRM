-- =====================================================================
-- SKA TeleCRM — read-only views over SKA OS data, phone matching,
-- maintenance jobs, and security (RLS, grants, realtime).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Clients — READ-ONLY projection of the SKA OS client master.
--    TeleCRM never inserts/updates/deletes public.clients.
-- ---------------------------------------------------------------------
create view public.tc_clients_v with (security_invoker = true) as
select
  c.id,
  c.tenant_id,
  coalesce(nullif(btrim(c.name), ''), nullif(btrim(c.full_name), ''), c.company_name, 'Unnamed client') as name,
  c.company_name                         as company,
  nullif(lower(btrim(c.email)), '')      as email,
  nullif(upper(btrim(c.pan_number)), '') as pan,
  nullif(upper(btrim(c.gst_number)), '') as gstin,
  c.city,
  coalesce(lower(btrim(c.status)), 'active') as status,
  c.client_code,
  c.client_group,
  c.assigned_crm,
  null::uuid   as created_by,
  c.created_at,
  c.created_at as updated_at
from public.clients c;

-- ---------------------------------------------------------------------
-- 2. Caller-ID directory: TeleCRM phones + SKA OS client mobile + contacts,
--    normalised to E.164, de-duplicated per (client, phone).
--    Precedence when matching: telecrm (explicit) > client_master > client_contact.
-- ---------------------------------------------------------------------
create view public.tc_client_phone_directory with (security_invoker = true) as
select distinct on (x.tenant_id, x.client_id, x.phone)
  x.id, x.tenant_id, x.client_id, x.phone, x.label, x.is_primary, x.source, x.priority, x.created_at
from (
  select p.id, p.tenant_id, p.client_id, p.phone, p.label, p.is_primary,
         'telecrm'::text as source, 1 as priority, p.created_at
  from public.tc_client_phones p
  union all
  select md5('clients.mobile:' || c.id::text)::uuid, c.tenant_id, c.id,
         public.tc_normalize_phone(c.mobile, c.mobile_country_code), 'mobile', true,
         'client_master', 2, c.created_at
  from public.clients c
  where public.tc_normalize_phone(c.mobile, c.mobile_country_code) is not null
  union all
  select md5('client_contacts:' || cc.id::text)::uuid, cc.tenant_id, cc.client_id,
         public.tc_normalize_phone(cc.contact, cc.country_code),
         case cc.kind when 'accountant' then 'office' else 'other' end, false,
         'client_contact', 3, cc.created_at
  from public.client_contacts cc
  where public.tc_normalize_phone(cc.contact, cc.country_code) is not null
) x
order by x.tenant_id, x.client_id, x.phone, x.priority;

-- Returns the client(s) of the best-precedence tier for a phone.
-- Exactly one row = identified. More than one = ambiguous (caller treated as unknown).
create or replace function public.tc_match_client_by_phone(p_tenant uuid, p_phone text)
returns table (client_id uuid, source text, candidates integer)
language sql stable set search_path = '' as $$
  with hits as (
    select d.client_id, d.source, d.priority
    from public.tc_client_phone_directory d
    where d.tenant_id = p_tenant
      and d.phone = public.tc_normalize_phone(p_phone)
  ), best as (
    select h.client_id, h.source
    from hits h
    where h.priority = (select min(priority) from hits)
  )
  select b.client_id, min(b.source), (select count(distinct client_id) from best)::integer
  from best b
  group by b.client_id
  order by b.client_id
  limit 5;
$$;

-- ---------------------------------------------------------------------
-- 3. Employees available to be provisioned as TeleCRM agents (read-only)
-- ---------------------------------------------------------------------
create view public.tc_employee_directory with (security_invoker = true) as
select
  e.id,
  e.tenant_id,
  e.name,
  nullif(lower(btrim(e.email)), '')  as email,
  public.tc_normalize_phone(e.mobile) as phone,
  e.status,
  e.auth_user_id,
  e.login_enabled,
  coalesce((select array_agg(d.name order by d.sort_order)
            from public.employee_departments ed
            join public.departments d on d.id = ed.department_id
            where ed.employee_id = e.id), '{}') as departments,
  tm.id as team_member_id
from public.employees e
left join public.tc_team_members tm on tm.employee_id = e.id and tm.tenant_id = e.tenant_id;

-- ---------------------------------------------------------------------
-- 4. Maintenance
-- ---------------------------------------------------------------------
-- Closes calls whose provider never sent a final callback (lost webhook).
create or replace function public.tc_close_stale_calls(p_older_than interval default interval '6 hours')
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with stale as (
    select c.id from public.tc_calls c
    where c.ended_at is null and c.started_at < now() - p_older_than
    for update skip locked
  ), closed as (
    update public.tc_calls c set
      status = case when c.answered_at is not null then 'completed'
                    when c.status in ('missed', 'voicemail') then c.status
                    else 'failed' end,
      ended_at = greatest(now(), c.started_at, coalesce(c.answered_at, c.started_at)),
      route_reason = left(coalesce(c.route_reason || '; ', '') || 'Auto-closed: no final provider callback', 1000)
    from stale where c.id = stale.id
    returning c.id
  )
  update public.tc_call_sessions s
     set state = 'ended',
         context = jsonb_set(s.context, '{trail}',
                     coalesce(s.context -> 'trail', '[]'::jsonb) || to_jsonb('Auto-closed by maintenance'::text))
    from closed
   where s.call_id = closed.id and s.state <> 'ended';
  get diagnostics n = row_count;
  return n;
end $$;

-- No retention/purge job: by policy nothing in this database is deleted
-- automatically. Old rows stay; created_at/received_at indexes keep them cheap.

-- ---------------------------------------------------------------------
-- 5. Security
--    This database grants anon/authenticated full rights on new public
--    objects by default — revoke explicitly. The Next.js server uses the
--    service role after its own role checks; browsers get nothing except
--    realtime SELECT on tc_calls for active TeleCRM users.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'tc_team_members', 'tc_departments', 'tc_department_members', 'tc_client_phones',
    'tc_calls', 'tc_call_sessions', 'tc_call_transfers', 'tc_recordings',
    'tc_notes', 'tc_tags', 'tc_client_tags', 'tc_reminders', 'tc_routing_config',
    'tc_audit_logs', 'tc_webhook_events', 'tc_provider_events'
  ] loop
    -- ENABLE (not FORCE): owner-run maintenance functions/cron must still see rows
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;

  foreach t in array array['tc_clients_v', 'tc_client_phone_directory', 'tc_employee_directory'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to service_role', t);
  end loop;
end $$;

-- audit log: no deletes, even for the service role
revoke delete, truncate on public.tc_audit_logs from service_role;

-- Realtime screen-pop: active TeleCRM users (or SKA OS tenant admins) may read calls.
create or replace function public.tc_is_active_user(p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
           select 1 from public.tc_team_members m
           where m.auth_user_id = auth.uid() and m.tenant_id = p_tenant and m.is_active)
         or public.is_tenant_admin(p_tenant);
$$;

grant select on public.tc_calls to authenticated;
create policy tc_calls_read_active_users on public.tc_calls
  for select to authenticated
  using (public.tc_is_active_user(tenant_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tc_calls') then
    alter publication supabase_realtime add table public.tc_calls;
  end if;
end $$;

-- Functions: nothing callable by anon/authenticated except the RLS helper.
revoke all on function public.tc_set_updated_at()                    from public, anon, authenticated;
revoke all on function public.tc_bump_version()                      from public, anon, authenticated;
revoke all on function public.tc_guard_client_tenant()               from public, anon, authenticated;
revoke all on function public.tc_team_members_link()                 from public, anon, authenticated;
revoke all on function public.tc_audit_logs_immutable()              from public, anon, authenticated;
revoke all on function public.tc_normalize_phone(text, text)         from public, anon, authenticated;
revoke all on function public.tc_match_client_by_phone(uuid, text)   from public, anon, authenticated;
revoke all on function public.tc_close_stale_calls(interval)         from public, anon, authenticated;
revoke all on function public.tc_is_active_user(uuid)                from public, anon;
grant execute on function public.tc_normalize_phone(text, text)       to service_role;
grant execute on function public.tc_match_client_by_phone(uuid, text) to service_role;
grant execute on function public.tc_close_stale_calls(interval)       to service_role;
grant execute on function public.tc_is_active_user(uuid)              to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Scheduled maintenance (pg_cron). UPDATE only — never deletes.
-- ---------------------------------------------------------------------
select cron.schedule('tc-close-stale-calls', '*/15 * * * *', $$select public.tc_close_stale_calls()$$);
