-- =====================================================================
-- SKA TeleCRM — seed IVR keys and routing config for the SKA tenant.
-- Idempotent (ON CONFLICT DO NOTHING). Seeds NO people, phones or
-- extensions: agents are provisioned from SKA OS employees in the app
-- (Team -> Add from SKA OS) because the IVR roster names do not map
-- 1:1 to employee records.
-- =====================================================================

with t as (select id from public.tenants where slug = 'ska')
insert into public.tc_departments (tenant_id, ivr_key, name, kind, ops_department_id)
select t.id, v.ivr_key, v.name, v.kind,
       (select d.id from public.departments d where d.tenant_id = t.id and d.name = v.ops_name limit 1)
from t, (values
  (1::smallint, 'CRM Desk',             'crm',         null),
  (2::smallint, 'Missed-call callback', 'missed_call', null),
  (3::smallint, 'FA 360',               'department',  null),
  (4::smallint, 'Internal Audit',       'department',  'Internal Audit'),
  (5::smallint, 'MIS',                  'department',  'MIS Services'),
  (6::smallint, 'GST',                  'department',  'Gst Services'),
  (7::smallint, 'Income Tax',           'department',  'Income Tax Services'),
  (8::smallint, 'Accounting',           'department',  null),
  (9::smallint, 'ROC',                  'department',  'ROC Filings')
) as v(ivr_key, name, kind, ops_name)
on conflict (tenant_id, ivr_key) do nothing;

with t as (select id from public.tenants where slug = 'ska')
insert into public.tc_routing_config (tenant_id, key, value)
select t.id, v.key, v.value::jsonb
from t, (values
  ('sticky_days',   '3'),
  ('max_reprompts', '1'),
  ('office_hours',  '{"timezone":"Asia/Kolkata","days":[1,2,3,4,5,6],"start":"10:00","end":"19:00"}'),
  ('prompts',       '{"greeting":"Welcome to Single Key Advisory. Enter the extension number, or press 1 for CRM desk, 2 if you missed our call, 3 for FA 360, 4 for Internal Audit, 5 for MIS, 6 for GST, 7 for Income Tax, 8 for Accounting, 9 for ROC.","reprompt":"Sorry, we did not receive a valid input. Please try again.","after_hours":"Thank you for calling Single Key Advisory. Our office hours are Monday to Saturday, 10 AM to 7 PM. Please leave a message after the tone and we will call you back."}')
) as v(key, value)
on conflict (tenant_id, key) do nothing;
