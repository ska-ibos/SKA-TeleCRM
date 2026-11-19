# Routing rules (as implemented)

Source: `src/lib/routing/`. Tests: `tests/routing/routing.engine.test.ts` (controlled dates).

## Caller identification
The caller number is normalised to E.164 and matched against `client_phone_numbers.phone` (unique).

## Sticky agent (keys 3–9)
- Scope: **per client + department** (unknown callers: per phone number).
- Qualifying conversation: an **inbound** call for that department that was **answered** by an **active member of that department** (`calls.answered_agent_id` + `answered_at`).
- The **latest** qualifying conversation wins; validity is `sticky_days` (default **3**) from its `answered_at`.
- A fresh qualifying conversation therefore resets the expiry automatically — no separate sticky table to drift.
- The CRM desk answering a department call does **not** create a sticky (not a department member). A CRM-desk **transfer** answered by a department member **does** (sticky learning).
- Exotel native sticky is never used.
- Simulated calls only count for simulated callers, real calls only for real ones (the simulator can run on the live database).
- Live calls: Exotel has no transfer API on the PSTN plan, so the agent transfers on the handset and records the outcome in TeleCRM; an answered transfer to a department member seeds the sticky.
- No valid sticky → CRM desk.

## Missed-call (key 2)
Latest `calls` row with `direction = outbound` to the caller's number (or the caller's client) with `initiated_by` set → that agent. No history, agent inactive/busy/offline, or no answer → CRM desk.

## Availability
`team_members.status`: `available` is dialled; `busy` / `offline` skip straight to the fallback. Dial outcomes `busy` / `no_answer` / `failed` also fall back. On live calls an agent without a mobile number in TeleCRM is also skipped.

## Fallback chain
target agent → CRM desk members one after another (key-1 department or `is_crm_desk`, *available*, never the same person twice) → voicemail + callback reminder.

With `dept_miss_behavior = ring_department_group`, a department key without a valid sticky rings the department's free members one by one, then the CRM desk. An answered call seeds the sticky as usual.

`parallel_ring_max` > 1 rings the whole CRM desk / department group at once on Exotel (`parallel_ringing`; a paid Exotel add-on). The member who picks up is recorded from `DialWhomNumber`.

`missed_call_window_days` > 0 limits key 2 to outbound calls that recent.

## Invalid input
`max_reprompts` (default 1) re-prompts, then CRM desk.

## After hours
Checked at call start in `office_hours.timezone`. Call is marked `after_hours`, state `voicemail`, and an `after_hours` reminder is created for the next opening.

## Idempotency
- Provider callbacks: `withIdempotency(provider, eventId)`; duplicate `incoming` events with the same provider call id return the existing call.
- Simulator / outbound / transfer requests carry an `idempotencyKey`.
- One callback reminder per call.
