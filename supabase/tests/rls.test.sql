-- =====================================================================
-- TeleCRM verification against the SHARED SKA OS database.
-- Safe to run in the SQL editor: everything happens inside one DO block
-- that always ends with RAISE EXCEPTION, so the transaction is rolled back
-- and NOTHING is written. Read the result line in the error message:
--   DRYRUN (rolled back): 1.link=ok 2.ext_dup=ok ... 13.non_member=ok
-- Any "FAIL" means a constraint is missing.
-- (A local `supabase test db` stack cannot run this: it needs the SKA OS
--  tables public.tenants / clients / employees / memberships.)
-- =====================================================================
do $$
declare
  t uuid := (select id from tenants where slug = 'ska');
  emp record; m uuid; m2 uuid; cl uuid := (select id from clients where tenant_id = t limit 1);
  call uuid; s uuid; v int; n int; r text := ''; x text;
begin
  select id, name, auth_user_id into emp from employees
   where tenant_id = t and auth_user_id is not null and status = 'Active' limit 1;

  insert into tc_team_members (tenant_id, employee_id, full_name, role) values (t, emp.id, '', 'agent') returning id into m;
  select case when full_name = emp.name and auth_user_id = emp.auth_user_id then 'ok' else 'FAIL' end into x from tc_team_members where id = m;
  r := '1.link=' || x;
  insert into tc_team_members (tenant_id, full_name, extension) values (t, 'Test Agent Two', '201') returning id into m2;
  begin insert into tc_team_members (tenant_id, full_name, extension) values (t, 'Test Agent Three', '201'); r := r || ' 2.ext_dup=FAIL';
  exception when unique_violation then r := r || ' 2.ext_dup=ok'; end;

  insert into tc_calls (tenant_id, direction, from_number, to_number, provider, provider_call_id, client_id)
  values (t, 'inbound', '+919800000001', 'OPS', 'exotel', 'CA-1', cl) returning id into call;
  begin insert into tc_calls (tenant_id, direction, from_number, to_number, provider, provider_call_id) values (t, 'inbound', '+919800000001', 'OPS', 'exotel', 'CA-1'); r := r || ' 3.call_dup=FAIL';
  exception when unique_violation then r := r || ' 3.call_dup=ok'; end;

  insert into tc_call_sessions (tenant_id, call_id, state) values (t, call, 'greeting') returning id into s;
  update tc_call_sessions set state = 'dialing' where id = s and version = 0;
  update tc_call_sessions set state = 'connected' where id = s and version = 0; get diagnostics n = row_count;
  select version into v from tc_call_sessions where id = s;
  r := r || ' 4.cas=' || case when v = 1 and n = 0 then 'ok' else 'FAIL' end;

  insert into tc_reminders (tenant_id, call_id, title, due_at, source) values (t, call, 'Missed call', now(), 'missed');
  begin insert into tc_reminders (tenant_id, call_id, title, due_at, source) values (t, call, 'Missed call', now(), 'voicemail'); r := r || ' 5.reminder_dup=FAIL';
  exception when unique_violation then r := r || ' 5.reminder_dup=ok'; end;

  insert into tc_call_transfers (tenant_id, call_id, to_member_id) values (t, call, m2);
  begin insert into tc_call_transfers (tenant_id, call_id, to_member_id) values (t, call, m); r := r || ' 6.transfer_dup=FAIL';
  exception when unique_violation then r := r || ' 6.transfer_dup=ok'; end;

  begin update tc_routing_config set value = '99'::jsonb where tenant_id = t and key = 'sticky_days'; r := r || ' 7.cfg=FAIL';
  exception when check_violation then r := r || ' 7.cfg=ok'; end;

  begin update tc_calls set ended_at = started_at - interval '1 minute' where id = call; r := r || ' 8.time=FAIL';
  exception when check_violation then r := r || ' 8.time=ok'; end;

  insert into tc_audit_logs (tenant_id, actor_id, action, entity) values (t, m, 'test', 'test');
  begin update tc_audit_logs set action = 'tampered' where tenant_id = t and action = 'test'; r := r || ' 9.audit=FAIL';
  exception when insufficient_privilege then r := r || ' 9.audit=ok'; end;

  insert into tc_client_phones (tenant_id, client_id, phone, is_primary) values (t, cl, '+919811111111', true);
  begin insert into tc_client_phones (tenant_id, client_id, phone, is_primary) values (t, cl, '+919822222222', true); r := r || ' 10.primary=FAIL';
  exception when unique_violation then r := r || ' 10.primary=ok'; end;

  select case when count(*) = 1 and min(source) = 'telecrm' then 'ok' else 'FAIL' end into x from tc_match_client_by_phone(t, '98111 11111');
  r := r || ' 11.match=' || x;

  update tc_calls set started_at = now() - interval '7 hours' where id = call;
  perform tc_close_stale_calls();
  select status || '/' || (select state from tc_call_sessions where call_id = call) into x from tc_calls where id = call;
  r := r || ' 12.stale=' || x;

  -- grants
  set local role anon;
  begin select count(*) into n from tc_calls; r := r || ' 13.anon=FAIL';
  exception when insufficient_privilege then r := r || ' 13.anon=denied'; end;
  reset role;
  set local role authenticated;
  begin select count(*) into n from tc_team_members; r := r || ' 14.authed_members=FAIL';
  exception when insufficient_privilege then r := r || ' 14.authed_members=denied'; end;
  reset role;

  raise exception 'DRYRUN (rolled back): %', r;
end $$;
