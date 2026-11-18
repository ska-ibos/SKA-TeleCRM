# Operations IVR

Scope: **Operations line only.** No Sales number, IVR, queue or workflow exists in this project.

## Greeting (editable in Settings)

> Welcome to Single Key Advisory. Enter the extension number, or press 1 for CRM desk, 2 if you missed our call, 3 for FA 360, 4 for Internal Audit, 5 for MIS, 6 for GST, 7 for Income Tax, 8 for Accounting, 9 for ROC.

## Key map

| Input | Department | Behaviour |
|---|---|---|
| 2–6 digits | Extension | Ring the mapped agent → CRM desk on busy/no-answer. Unknown extension = invalid input |
| 1 | CRM Desk | Jinofer (CRM queue) |
| 2 | Missed-call callback | Most recent outbound agent for this caller → CRM desk |
| 3 | FA 360 | Urja, Jenish, Prassana — sticky lookup |
| 4 | Internal Audit | Hiren, Shruti, Rajat, Prassana — sticky lookup |
| 5 | MIS | Urja, Prachi, Vilas — sticky lookup |
| 6 | GST | Sneha, Hiren, Shruti, Komal, Rajat — sticky lookup |
| 7 | Income Tax | Hiren, Shruti, Komal, Rajat — sticky lookup |
| 8 | Accounting | Hiren, Shruti, Komal — sticky lookup |
| 9 | ROC | Shruti, Rahul — sticky lookup |
| invalid / none | — | Re-prompt once, then CRM desk |

## Sticky sub-menu

> {Agent} assisted you recently. Press 1 to connect to {Agent}, or press 2 for the CRM desk.

- 1 → ring the agent; busy / no-answer / unavailable → CRM desk
- 2 or anything else → CRM desk

## Office hours

Monday–Saturday, 10:00–19:00, Asia/Kolkata. Outside these hours the after-hours message plays, the caller may leave a voicemail, and a callback reminder is created for the CRM desk, due at the next opening time.

## CRM desk unavailable

If the CRM desk is busy/offline or does not answer, the call goes to voicemail and a **missed-call reminder** is created, so no call is lost.
