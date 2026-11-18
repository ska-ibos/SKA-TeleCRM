# Setup guide

## 1. Local demo (no accounts needed)

```bash
npm install
cp .env.example .env          # leave Supabase blank; set DEMO_SESSION_SECRET for `npm start`
npm run dev                   # http://localhost:3000
```

Without Supabase variables the app runs in **demo mode**: seeded in-memory data (departments + team, no phones/extensions), password-less sign-in as any role. Data resets on server restart.

## 2. Supabase

TeleCRM runs on the **shared SKA OS database**. The schema is already applied to project `btfznkhnuytcfaduvjbm` (`telecrm_01_core`, `telecrm_02_views_security`, `telecrm_03_seed`). See [database-schema.md](database-schema.md). Never run an older standalone schema against it.

1. In the server environment (`.env` / Vercel), set:
   - `NEXT_PUBLIC_SUPABASE_URL=https://btfznkhnuytcfaduvjbm.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Dashboard → Settings → API (publishable / anon key)
   - `SUPABASE_SERVICE_ROLE_KEY`: same page. **Server only. Never commit it.**
   - `TELECRM_TENANT_SLUG=ska` (default) or `TELECRM_TENANT_ID`
2. Sign in with an existing SKA OS login. **Workspace admins** get TeleCRM admin automatically.
3. **Team → Add member → SKA OS employee**: link each agent, then set role, routing phone and availability. The login comes from the employee record. Members not linked to an employee can be dialled but cannot sign in.
4. **Departments**: assign members to IVR keys 3–9 and the CRM desk (key 1). **Extensions**: assign 2–6 digit extensions.
5. **Clients** come from SKA OS automatically, along with their mobile and contact numbers for caller ID. They are read-only in TeleCRM. To pin a number that several clients share, add it on the client's page in TeleCRM.

To verify the database at any time, run `supabase/tests/rls.test.sql` in the SQL editor. It always rolls back, and its result line should contain no `FAIL`.

## 3. Checks

```bash
npm run typecheck
npm test
npm run build
```

## 4. Vercel

1. Import the repo in Vercel (framework: Next.js).
2. Add the env vars from `.env.example` (Production + Preview). Keep `TELEPHONY_PROVIDER=simulation` until Exotel is ready.
3. Deploy. Note: demo mode on Vercel is per serverless instance and not persistent — use Supabase for any shared environment.
