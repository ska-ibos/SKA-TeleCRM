-- TeleCRM runs on the shared SKA OS database. Seed data (IVR keys 1-9 and
-- routing config for the `ska` tenant) lives in
--   supabase/migrations/20261104000003_telecrm_seed.sql
-- and is idempotent. People are NOT seeded: provision agents from SKA OS
-- employees in the app (Team -> Add member -> SKA OS employee).
select 1;
