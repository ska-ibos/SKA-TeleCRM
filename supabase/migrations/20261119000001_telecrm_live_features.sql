-- =====================================================================
-- SKA TeleCRM — live-call features (spec v1.1 §4.12, §8.7).
-- Touches only TeleCRM-owned objects. Nothing is dropped except the
-- tc_routing_config value check, which is replaced by a wider one.
--   1. routing config keys: dept_miss_behavior, missed_call_window_days,
--      parallel_ring_max (existing keys keep their rules)
--   2. private Storage bucket for archived call recordings
--   3. WhatsApp reminder delivery columns on tc_reminders (spec §4.11, §8.5)
-- Idempotent: safe to run more than once.
-- =====================================================================

-- 1. Routing config keys -------------------------------------------------
alter table public.tc_routing_config drop constraint if exists tc_routing_config_key_check;
alter table public.tc_routing_config drop constraint if exists tc_routing_config_value_shape;

alter table public.tc_routing_config add constraint tc_routing_config_key_check check (key in (
  'sticky_days', 'max_reprompts', 'office_hours', 'prompts',
  'dept_miss_behavior', 'missed_call_window_days', 'parallel_ring_max'));

alter table public.tc_routing_config add constraint tc_routing_config_value_shape check (
  case key
    when 'sticky_days'   then case when jsonb_typeof(value) = 'number'
                                   then (value #>> '{}')::numeric between 1 and 30 else false end
    when 'max_reprompts' then case when jsonb_typeof(value) = 'number'
                                   then (value #>> '{}')::numeric between 0 and 3 else false end
    when 'office_hours'  then jsonb_typeof(value) = 'object'
                              and value ?& array['timezone', 'days', 'start', 'end']
    when 'prompts'       then jsonb_typeof(value) = 'object'
                              and value ?& array['greeting', 'reprompt', 'after_hours']
    when 'dept_miss_behavior' then value in ('"crm"'::jsonb, '"ring_department_group"'::jsonb)
    when 'missed_call_window_days' then case when jsonb_typeof(value) = 'number'
                                   then (value #>> '{}')::numeric between 0 and 365 else false end
    when 'parallel_ring_max' then case when jsonb_typeof(value) = 'number'
                                   then (value #>> '{}')::numeric between 1 and 10 else false end
    else false
  end);

-- 2. Recording archive bucket (private; served through short-lived signed URLs) ---
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('telecrm-recordings', 'telecrm-recordings', false, 52428800,
        array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'application/octet-stream'])
on conflict (id) do nothing;
-- No storage policies are added: only the service role (the TeleCRM server, after its
-- own role checks) reads or writes this bucket.

-- 3. WhatsApp reminders ---------------------------------------------------
alter table public.tc_reminders
  add column if not exists notify_via   text not null default 'both',
  add column if not exists notified_at  timestamptz,
  add column if not exists notify_error text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tc_reminders_notify_via_check') then
    alter table public.tc_reminders add constraint tc_reminders_notify_via_check
      check (notify_via in ('in_app', 'whatsapp', 'both'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tc_reminders_notify_error_len') then
    alter table public.tc_reminders add constraint tc_reminders_notify_error_len
      check (notify_error is null or length(notify_error) <= 500);
  end if;
end $$;
-- due, not yet sent: what the dispatcher scans every few minutes
create index if not exists tc_reminders_dispatch_idx on public.tc_reminders (tenant_id, due_at)
  where status = 'pending' and notified_at is null;
