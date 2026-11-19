# Exotel integration (live calls)

TeleCRM decides every routing step; Exotel plays prompts, collects keys and rings mobiles.
Exotel stores none of our data. Plan: **PSTN** — agents answer on their own mobiles, clients
always see the office number (ExoPhone). Exotel's built-in sticky agent is **not** used.

Sources: Exotel support articles for the Connect (dynamic URL), Gather, Greeting (dynamic
text), Passthru, Switchcase and Voicemail applets, and developer.exotel.com for
*Connect Two Numbers* and *StatusCallback*.

## 1. Server settings (Vercel → Project → Environment Variables)

| Variable | Value |
|---|---|
| `TELEPHONY_PROVIDER` | `exotel` |
| `EXOTEL_ACCOUNT_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN` | Exotel Dashboard → Settings → API Settings |
| `EXOTEL_SUBDOMAIN` | `api.exotel.com` (Singapore) or `api.in.exotel.com` (Mumbai) — as shown in API Settings |
| `EXOTEL_OPERATIONS_NUMBER` | The ExoPhone in E.164, e.g. `+919513886363` |
| `APP_BASE_URL` | Public https address of the app, e.g. `https://telecrm.example.com` |
| `TELEPHONY_WEBHOOK_SECRET` | A long random string (e.g. `openssl rand -hex 24`) |

Never commit these. Exotel cannot sign its requests, so the secret is part of every URL you
paste into Exotel (`?token=…`). Treat those URLs as passwords; rotate the secret if one leaks.

In TeleCRM: every agent who can be rung needs a **mobile number** (Team page). Agents without
one are skipped on live calls (the caller goes to the CRM desk instead).

## 2. Call flow to build in Exotel (App Bazaar → Create a new flow)

`<APP>` = `APP_BASE_URL`, `<T>` = `TELEPHONY_WEBHOOK_SECRET`. All applet URLs use **GET**.

```
① Passthru  "start"     <APP>/api/exotel/flow/start?token=<T>
      ↓
② Switchcase (reads {"select": ...})
      menu      → ③
      sticky    → ③
      dial      → ⑤
      voicemail → ⑦
      ended     → Hangup
③ Gather    (configure via URL)  <APP>/api/exotel/flow/gather?token=<T>
      ↓ (after input, and on URL failure)
④ Passthru  "input"     <APP>/api/exotel/flow/input?token=<T>   → back to ② Switchcase
⑤ Greeting  (Read text like a robot = URL)  <APP>/api/exotel/flow/prompt?token=<T>
      ↓
⑥ Connect   (configure via URL)  <APP>/api/exotel/flow/connect?token=<T>
      After the call conversation ends → ⑨
      If nobody answers                → ⑦
      We didn't dial anyone            → ⑦
⑦ Greeting  (URL)  <APP>/api/exotel/flow/prompt?token=<T>     (says the voicemail / after-hours text)
      ↓
⑧ Voicemail  (finish key #)  → Passthru <APP>/api/exotel/flow/voicemail?token=<T> → Hangup
⑨ Passthru  "end"       <APP>/api/exotel/flow/end?token=<T>   → Hangup
```

Notes:
- **One Switchcase** with five cases: `menu`, `sticky`, `dial`, `voicemail`, `ended`. Every
  Passthru that answers with `{"select": …}` (start, input) leads to it. If Exotel's flow
  builder does not allow two applets to point at one Switchcase, add a second identical
  Switchcase after ④.
- **Fallbacks:** for every applet set the error / timeout path to a Connect applet that rings
  the CRM desk group directly, so a server problem never drops a call. Set the Gather and
  Connect *Fallback URL* to the same URL (Exotel retries it if the first attempt fails).
- **Timeouts:** Exotel waits 5 s for Gather and Connect URLs. Keep the app in the same region
  as the database (Vercel `bom1` / Mumbai if Supabase is in Mumbai).
- **Recording:** the Connect response asks Exotel to record (dual channel). The greeting says so
  (Settings → *Recording notice*).
- Do **not** enable Exotel's native sticky-agent option.

### What each URL returns

| Step | Response |
|---|---|
| `start`, `input` | `text/plain` body `{"select":"menu" \| "sticky" \| "dial" \| "voicemail" \| "ended"}` |
| `gather` | JSON: `gather_prompt.text` (welcome by name + recording notice + menu, or the sticky sub-menu), `max_input_digits` 7, `finish_on_key` `#`, `input_timeout` 4 s, `repeat_menu` 1 |
| `prompt` | `text/plain` text to speak ("Connecting you to Hiren … extension 2 0 5", voicemail or after-hours message). Answers HEAD with the same headers |
| `connect` | JSON: `destination.numbers` = the agent's mobile, `fetch_after_attempt: true`, `record: true`, `max_ringing_duration` 30 |
| `end`, `voicemail` | `text/plain` `{"select":"ended"}` |

### How the steps map to the routing engine

| Exotel event | Engine |
|---|---|
| start / first Gather | `startInbound` (caller ID, after-hours check). Registered once per `CallSid` |
| input (`digits`, quotes and `#` stripped) | `handleInput` (extension / key 1–9) or `handleStickyChoice` |
| Connect re-fetch with `DialCallStatus` busy / no-answer / failed | `handleDialResult` → CRM desk number, or voicemail (same number again so Exotel stops) |
| end (`DialCallStatus=completed`) | answered by the rung agent → `hangup` (duration from the leg's `OnCallDuration`) |
| voicemail (`RecordingUrl`) | `leaveVoicemail` → callback reminder + recording link saved |

Duplicate or late callbacks answer from the call's current state instead of failing.

## 3. Click-to-call (outbound, feeds key 2)

The **Call** button on a client calls Exotel *Connect Two Numbers*:
`POST https://<EXOTEL_SUBDOMAIN>/v1/Accounts/<SID>/Calls/connect.json` with `From` = agent
mobile (rung first), `To` = client, `CallerId` = ExoPhone, `Record=true`,
`CustomField` = our call id, `StatusCallback` = `<APP>/api/exotel/status?token=<T>`
(events `answered` + `terminal`, JSON). The status callback closes the call with its talk time;
the agent then becomes the client's "last outbound agent" for key 2.

If Exotel refuses (wrong credentials, trial/KYC limits), the call is saved as **failed** with
Exotel's message, and the agent sees the reason.

## 4. Transfers

Exotel has no transfer API on the PSTN plan. The agent transfers on the handset (warm transfer),
then records the outcome on the call page in TeleCRM (**Transfer call → Did they take the call?**).
An answered transfer to a department member seeds that department's sticky agent. Only the
agent on the call, the CRM desk, a manager or an admin can record it.

## 5. Trial account

- Outbound calls work only to **verified users** of your Exotel account until KYC is approved
  (Exotel returns "not yet KYC compliant"). Add each test agent as an Exotel user and verify
  their mobile.
- The shared trial number **095138 86363** asks callers whose number is not registered on your
  account for your PIN before the flow runs.

## 6. Test checklist (real calls)

1. Call the ExoPhone from a client's registered number → hear "Namaste <name> ji" + recording notice + menu.
2. Press **1** → CRM desk mobile rings; answer, talk, hang up → Call History shows *completed*, agent, duration.
3. Press **6** (no history) → CRM desk; on the call page record a transfer to Hiren as answered → call again within 3 days, press **6** → "Hiren assisted you recently…", press **1** → Hiren rings.
4. Enter **205#** → "Connecting you to Hiren … extension 2 0 5" → Hiren rings; let it ring out → CRM desk rings.
5. Make both miss → voicemail; leave a message → reminder on *Reminders*, recording on the call.
6. Click **Call** on a client → your mobile rings, then the client; client sees the office number → client calls back, presses **2** → you ring.
7. Call outside office hours → after-hours message + voicemail.
8. In Supabase, check `tc_provider_events` for any `rejected` / `failed` rows (every Exotel request is logged there with its outcome).

## 7. Maintenance job (`vercel.json` cron → `/api/cron/maintenance`)

Needs `CRON_SECRET` (Vercel sends it as `Authorization: Bearer …`). Each run:
- **Callers who hang up during the menu** — Exotel calls none of our URLs, so the job asks
  Exotel's Call Details API about inbound calls still open after 15 min and closes them
  (missed + callback reminder, or completed if they were connected), saving the recording link.
  The database job `tc-close-stale-calls` still closes anything left after 6 h.
- **Recordings** — copies Exotel recordings into the private `telecrm-recordings` bucket
  (Exotel keeps them ~6 months). Playback (`/api/recordings`) uses the copy once it exists,
  otherwise streams Exotel's file through the server; URLs never reach the browser.

`vercel.json` schedules it daily (Vercel's free plan allows one run a day). On a Pro plan set
`"schedule": "*/15 * * * *"`.

## 8. Not covered yet

- **WhatsApp reminders (SendBuddy)** — needs SendBuddy's API details. Reminders are shown
  in-app (bell in the header, Reminders page) until then.
- **Sales line** (second ExoPhone) — Phase 4 of the spec.
