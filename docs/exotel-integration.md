# Exotel integration (pending credentials)

Status: **placeholder only.** No Exotel API calls are made and no Exotel request/response formats have been assumed. Simulation mode is the default (`TELEPHONY_PROVIDER=simulation`).

## What exists

| File | Purpose |
|---|---|
| `src/lib/telephony/provider.interface.ts` | Provider contract: `dialAgent`, `placeOutbound`, `transfer` |
| `src/lib/telephony/exotel.provider.ts` | Adapter stub; throws "not configured" / "not implemented" |
| `src/lib/telephony/webhook.ts` | Webhook guard: provider configured + shared-secret header |
| `src/app/api/exotel/route` | IVR events → routing engine (provider-neutral JSON) |
| `src/app/api/exotel/status` | Dial outcome / hangup callbacks |
| `src/app/api/call/outbound` | Click-to-call (stores outbound history for key 2) |
| `src/app/api/call/transfer` | Transfer (answered transfer seeds sticky) |

The webhook routes currently accept a **provider-neutral** payload (`telephonyEventSchema`):

```json
{ "eventId": "...", "type": "incoming|input|sticky|dial_result|voicemail|hangup",
  "providerCallId": "...", "from": "+91...", "digits": "6", "result": "answered|busy|no_answer|failed" }
```

and return the engine's `RouteStep` (`action`: gather / gather_sticky / dial / connected / voicemail / hangup, plus `prompt` and `agent`). They return **503** until Exotel credentials are set, and **401** without the correct `x-webhook-secret`.

## To finish when official docs + credentials arrive

1. Fill `EXOTEL_*` and `TELEPHONY_WEBHOOK_SECRET` in the server environment (Vercel → Project → Environment Variables). Never commit them.
2. Implement `toTelephonyEvent()` to map Exotel's documented callback fields into the neutral shape; call it at the top of both webhook routes.
3. Replace the shared-secret check with Exotel's documented request verification, if any.
4. Implement `dialAgent`, `placeOutbound`, `transfer` against the documented endpoints, and translate `RouteStep` into the response Exotel's flow expects.
5. Do **not** enable Exotel's native sticky feature — sticky routing is owned by the CRM.
6. Set `TELEPHONY_PROVIDER=exotel` and run the simulator scenarios against a test number.

The routing engine, database and UI need no changes.

## Already in place for go-live

- **Raw event log**: every authenticated callback is stored in `tc_provider_events` *before* processing, with its outcome (processed / replayed / rejected / failed). Use it to check the field mapping against real Exotel traffic.
- **Idempotency**: duplicate `eventId`s replay the stored response. The same `eventId` with a different body is rejected with 422. A crashed worker's lock expires after 2 minutes, after which a retry takes over.
- **Concurrency**: per-call state transitions use optimistic locking. A racing callback gets 409 `concurrent_update`, so let Exotel retry it.
- **One row per Exotel call**: unique (tenant, provider, provider_call_id).
- **Lost callbacks**: `tc-close-stale-calls` (pg_cron, every 15 min) closes calls with no final callback after 6 h.
- **Outbound hangup** closes the call and records talk time (`endOutbound`).
