# WhatsApp reminders (SendBuddy)

Due reminders are sent on WhatsApp to the **assignee's mobile** (Team page), as in spec v1.1
§8.5 / §11.2. In-app notification needs no setup: the bell in the header and the Reminders
page show what is due.

## 1. Connect SendBuddy

SendBuddy gives each account its own "send message" API URL in the panel (API / Developer
section), with the account's instance id / access token in it. Copy that URL and replace the
phone number and the message with the placeholders `{number}` and `{message}`:

```
SENDBUDDY_SEND_URL=https://<your-panel>/api/send?number={number}&type=text&message={message}&instance_id=<id>&access_token=<token>
```

The exact path and parameter names are whatever your panel shows — keep them as they are.

| Variable | Default | Meaning |
|---|---|---|
| `SENDBUDDY_SEND_URL` | — | The panel's send URL with `{number}` and `{message}`. Must be https |
| `SENDBUDDY_METHOD` | `GET` | `POST` if the panel's API is POST |
| `SENDBUDDY_BODY` | — | POST only: JSON body with the same placeholders, e.g. `{"number":"{number}","message":"{message}","instance_id":"…"}` |
| `SENDBUDDY_NUMBER_FORMAT` | `cc` | `cc` = 919876543210, `e164` = +919876543210, `local` = 9876543210 |

Put these in the server environment only (Vercel → Environment Variables). The URL contains
the account's token: it is never logged, stored in the database or sent to the browser.

Then **Settings → System → WhatsApp reminders → Test** sends a test message.

## 2. Run the sender every 5 minutes

`/api/reminders/dispatch` sends what is due. It needs `CRON_SECRET` and is called with
`Authorization: Bearer <CRON_SECRET>`. Vercel's free plan runs cron jobs only once a day
(the daily `/api/cron/maintenance` job also sends reminders), so schedule the 5-minute run from
the database with `pg_cron` + `pg_net` (both available on Supabase):

```sql
-- run once in the Supabase SQL editor (replace both placeholders)
create extension if not exists pg_net;
select cron.schedule('tc-dispatch-reminders', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://<APP_BASE_URL>/api/reminders/dispatch',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    body    := '{}'::jsonb);
$$);
```

(On a Vercel Pro plan you can instead add `{ "path": "/api/reminders/dispatch", "schedule": "*/5 * * * *" }`
to `vercel.json`.) To stop it: `select cron.unschedule('tc-dispatch-reminders');`

## 3. How sending works

- Each reminder has **Notify**: in the app and on WhatsApp (default), app only, or WhatsApp only.
  Callback reminders created by missed / after-hours calls use the default.
- A reminder is sent once, when it is due. It is claimed before sending, so overlapping runs
  never send it twice. A failed send is retried on the next run; the Reminders page shows
  *WhatsApp sent*, *WhatsApp retrying* (hover for the error) or *Not sent* (e.g. the assignee
  has no mobile number).
- Only reminders due in the last 24 h are sent, so a long outage does not flood anyone.
- Rescheduling a reminder sends it again at the new time.

Needs migration `20261119000001_telecrm_live_features.sql` (adds `notify_via`, `notified_at`,
`notify_error` to `tc_reminders`).
