# SKA TeleCRM — Single Key Advisory Pvt. Ltd.

Operations CRM with a smart call-routing engine: Operations IVR, extensions, CRM desk, missed-call callback, per-department sticky agents (3-day), after-hours voicemail, transfers, reminders, reports and audit. **Operations only — no Sales features.**

Telephony runs in **simulation mode** (no real phone calls) until Exotel credentials and official API details are provided.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev        # http://localhost:3000 → "Demo Admin"
```

No Supabase keys? The app runs in demo mode with seeded in-memory data. With keys, it runs on the **shared SKA OS database** (additive `tc_*` tables; clients and employees are read from SKA OS). See [docs/setup-guide.md](docs/setup-guide.md) and [docs/database-schema.md](docs/database-schema.md).

## Try the routing (Call Simulator)

1. **Clients → New client**, add a phone number.
2. **Simulator** → pick the client → *Start inbound call* → press `6` → no sticky → rings Jinofer → *Answers*.
3. Transfer to **Hiren** (department GST, *Agent answers*) → hang up. Hiren is now GST sticky.
4. Start another call → press `6` → "Hiren assisted you recently…" → press `1`.
5. Click **+73 h** and call again → sticky expired → CRM desk.
6. Missed-call: *Outbound call* (Hiren → client, *misses*) → new inbound call → press `2` → Hiren.
7. Set Hiren **Busy** / click **No answer** → CRM desk fallback. Pick **Sun (closed)** → after-hours message + callback reminder.

## Stack

Next.js 16 (App Router, `src/proxy.ts`), React 19, TypeScript, Tailwind CSS 4, Supabase (Postgres, Auth, RLS, Storage, Realtime), Zod, Vitest. Deploy on Vercel.

## Scripts

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | TypeScript |
| `npm test` | Unit, integration and routing tests (controlled dates) |
| `npx supabase test db` | RLS tests (local Supabase stack) |

## Docs

- [Architecture & diagrams](docs/architecture.md)
- [Operations IVR](docs/operations-ivr.md)
- [Routing rules](docs/routing-rules.md)
- [Database schema](docs/database-schema.md)
- [Exotel integration](docs/exotel-integration.md)
- [Setup guide](docs/setup-guide.md)

## Roles

Admin (everything), CRM Desk (clients, calls, reminders, reports), Manager (clients incl. delete, reports), Agent (read CRM, notes, own reminders, own calls). Enforced in API routes and by RLS.
