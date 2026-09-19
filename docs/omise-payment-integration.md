# Omise/Opn Payment Integration — Backend Handoff for Mobile (Flutter)

This document describes what changed on the FitCoachAPI (NestJS) backend to
support real Omise/Opn payments (Card + PromptPay), so the Flutter-side agent
knows exactly what to call, when, and with what payload.

Backend repo root: `/Users/be8-thanachaiw/Desktop/Project/Learning/My App/FitCoachAPI`

## Files changed/added (read these for ground truth)

- `src/course-purchases/dto/purchase-and-join.dto.ts` — request body shape
- `src/course-purchases/course-purchases.service.ts` — `purchaseAndJoin()`,
  `purchaseAndJoinWithoutPayment()`, `purchaseAndJoinWithCard()`,
  `purchaseAndJoinWithPromptPay()`, `ensureUsable()`,
  `findMyPurchasesUnderTrainer()`
- `src/payments/payments.controller.ts` — all payment-related routes
- `src/payments/payments.service.ts` — `getStatus()`, `handleWebhookEvent()`,
  `cancel()`
- `src/payments/omise.service.ts` — Omise SDK wrapper (backend-only, not
  directly relevant to mobile, but shows exactly what's sent to Omise)
- `src/payments/omise.config.ts` — env vars (`OMISE_PUBLIC_KEY` is the one
  mobile needs; ask backend dev for its current value, don't hardcode/guess)

## What changed conceptually

Before: `POST /trainer-courses/:courseId/purchase-and-join` accepted
`amount`, `opnChargeId`, `opnSourceId` directly from the client and trusted
them blindly — no real payment gateway was ever called. This was mocked.

Now: the backend computes the charge amount itself from the course's real
price and actually calls the Omise API. The client no longer sends `amount`,
`opnChargeId`, or `opnSourceId` at all. For Card payments, the client must
first tokenize the card via the Omise Public Key (client-side, using
Omise.js/Omise's mobile SDK — **never send raw card numbers to this
backend**) and send only the resulting token string.

## Global API prefix

All routes are mounted under `/api/v1/...` (global prefix `api` +
URI versioning `v1`, set in `src/main.ts`). Example: the purchase endpoint's
full path is `POST /api/v1/trainer-courses/:courseId/purchase-and-join`.

## Endpoint 1 — Purchase a course (Card or PromptPay)

```
POST /api/v1/trainer-courses/:courseId/purchase-and-join
Authorization: Bearer <client JWT>
Content-Type: application/json
```

Request body (`PurchaseAndJoinDto`):

```jsonc
{
  "couponIds": ["uuid", "..."],   // optional
  "method": "Card" | "PromptPay", // PaymentMethod enum — only these two are wired up
  "omiseToken": "tokn_test_..."   // REQUIRED only when method === "Card"
                                   // Must NOT be sent for PromptPay
}
```

Note: `amount` is **no longer accepted** — the backend reads `TrainerCourse.price`
itself. If mobile still sends `amount`, it will be silently ignored (global
`ValidationPipe` has `whitelist: true`, so unknown fields are stripped) —
except raw card fields would be *rejected* (`forbidNonWhitelisted: true`), so
this also acts as a safety net against accidentally sending card numbers.

### Card flow — response

Card charges are synchronous. The backend calls Omise immediately:

- **Success** (charge status `successful`): HTTP 200/201, returns
  ```jsonc
  {
    "clientTrainer": { /* ClientTrainer relation */ },
    "purchase": { /* CoursePurchase */ },
    "payment": { /* Payment row, status: "Successful" */ }
  }
  ```
  The course purchase and trainer join are already committed and usable —
  no further polling needed.

- **Failure** (charge declined/failed): HTTP 400 `BadRequestException` with a
  **Thai, user-facing** message already translated from Omise's failure code
  (e.g. `"บัตรมีวงเงินไม่เพียงพอ"`). Show this message directly to the user.
  Nothing is committed — no purchase, no join, no payment row. The user can
  retry with a new token.

### PromptPay flow — response

PromptPay is asynchronous (QR-based). The backend:
1. Creates an Omise Source + Charge from it (charge starts `pending`)
2. **Commits the purchase/join immediately** (status starts `Pending`) — but
   the purchase is **not usable yet** (see `ensureUsable` note below)
3. Returns immediately with the QR to show the user, HTTP 200/201:
   ```jsonc
   {
     "clientTrainer": { /* ... */ },
     "purchase": { /* CoursePurchase */ },
     "payment": { /* Payment row, status: "Pending", opnChargeId: "chrg_..." */ },
     "qrCodeUrl": "https://api.omise.co/.../download",  // render this as an <Image>
     "expiresAt": "2026-09-19T12:34:56Z"                 // ISO timestamp, QR expiry
   }
   ```

Mobile must:
- Render `qrCodeUrl` as an image (it's a direct image URL from Omise, already
  a scannable PromptPay QR — not raw QR data to encode yourselves)
- Show a countdown/expiry using `expiresAt` — **fixed at 15 minutes from
  generation** (backend explicitly sets Omise's `expires_at` charge param to
  `now + 15min`; Omise's own default is 24h if left unset, which is what an
  earlier version of this backend was doing by mistake — if `expiresAt` ever
  looks like ~24h out again, that's a backend regression, not something to
  work around client-side)
- Start polling `GET /api/v1/payments/:chargeId/status` (below), using
  `payment.opnChargeId` as `:chargeId`, until status is no longer `Pending`
- **A `Pending` PromptPay purchase cannot be used yet** — e.g. the client
  cannot book a workout session against it until the payment clears. If the
  mobile UI lets a user navigate to book a session right after purchase,
  booking will fail with `BadRequestException: "This course purchase has not
  been paid for yet"` until the payment is `Successful`.

### Trial course flow (amount = 0) — skips Omise entirely

A trial course (`TrainerCourse.isTrial === true`) is always free — its price
is 0, and it's always purchased together with exactly one Trial coupon. Omise
rejects any charge below its THB minimum (20 baht), so **the backend never
calls Omise at all when the computed amount is 0** — this applies regardless
of which `method` was sent in the request body.

- Call Endpoint 1 exactly as usual: `couponIds: [<trial coupon id>]`,
  `method` can be `"Card"` or `"PromptPay"` (or really anything accepted by
  the enum) — **it's accepted but has no effect** when amount is 0. If
  `method: "Card"`, `omiseToken` is **not required** for this case (send it
  or omit it, both work — it's ignored).
- Response comes back immediately, same shape as the successful Card flow:
  ```jsonc
  {
    "clientTrainer": { /* ... */ },
    "purchase": { /* CoursePurchase */ },
    "payment": { /* Payment row, status: "Successful", amount: 0, opnChargeId: null */ }
  }
  ```
- **No `qrCodeUrl` or `expiresAt`** in the response for this case (those only
  appear on the async PromptPay-with-a-real-charge path). If mobile is
  branching on the presence of `qrCodeUrl` to decide whether to show a QR
  screen, that check already correctly skips the QR screen here — no special
  casing needed for trial courses beyond that.
- Purchase is immediately usable (`payment.status` is already `"Successful"`)
  — **no polling needed**, same as a successful Card payment.

Practical implication for mobile: you do not need to detect "is this a trial
course" client-side and special-case the request — send the purchase request
the same way you always would (whatever `method` your UI currently defaults
to for a free/trial course is fine), and read the response the same way you
already do for Card. The only thing to avoid is assuming a `qrCodeUrl` will
always be present just because `method` was `"PromptPay"` — check for its
presence rather than branching purely on the `method` you sent.

## Endpoint 2 — Poll payment status (PromptPay only; new endpoint)

```
GET /api/v1/payments/:chargeId/status
Authorization: Bearer <client JWT>
```

`:chargeId` = the `opnChargeId` string returned in the purchase response's
`payment.opnChargeId` (looks like `chrg_test_...`).

Response:
```jsonc
{
  "status": "Pending" | "Successful" | "Failed" | "Expired" | "Reversed" | "Cancelled",
  "paidAt": "2026-09-19T12:00:00Z" | null,
  "failureMessage": "การชำระเงินไม่สำเร็จ...", // only present if Failed/Expired
  // only present while status === "Pending" (i.e. only ever for a
  // PromptPay charge; Card charges never stay Pending):
  "qrCodeUrl": "https://api.omise.co/.../download",
  "expiresAt": "2026-09-19T12:34:56Z"
}
```

`"Cancelled"` is a new status value (added alongside Endpoint 5 below) —
if mobile has a switch/enum over `PaymentStatus` anywhere, add this case.
It behaves like a dead end, same as `"Failed"`/`"Expired"`: no `qrCodeUrl`,
purchase never becomes usable, user must start a fresh purchase.

`qrCodeUrl`/`expiresAt` are **re-fetched from Omise on every call while
Pending**, not stored — this lets you re-show the exact same QR when the user
navigates back to a course they haven't finished paying for yet (see the
"returning to a pending purchase" flow below), without creating a new charge
each time. Once `status` moves past `Pending` (`Successful`/`Failed`/
`Expired`/`Reversed`), these two fields are omitted entirely — there's
nothing left to scan.

Suggested polling interval: every 2-3 seconds while `status === "Pending"`,
stop once it's any other value. This endpoint is ownership-checked (403 if
the payment doesn't belong to the calling client) and — if still `Pending`
locally — actively re-checks with Omise on each call, so it will reflect a
successful payment even if a webhook delivery is delayed, without mobile
needing to know anything about webhooks.

**Behavior change**: after a successful cancel (Endpoint 5), the `Payment`
row is deleted, not just marked `"Cancelled"`. Calling this endpoint with
that `chargeId` afterward returns HTTP 404 `NotFoundException`, not
`{ status: "Cancelled" }`. Mobile should not call this endpoint after it has
itself just cancelled that charge — there's nothing left to poll.

## Endpoint 3 — Webhook (backend/Omise only, not relevant to mobile)

```
POST /api/v1/payments/webhook
```

Called by Omise's servers directly, not by the app. Mentioned here only so
mobile understands *why* polling (Endpoint 2) is the reliable signal to use
instead of e.g. assuming a push notification will arrive — **there is no push
notification for payment completion in this backend today.** No FCM/APNs
wiring exists for this flow. Poll for status.

## Endpoint 4 — Course purchases list now includes payment status

```
GET /api/v1/users/me/course-purchases[?trainerId=<uuid>]
Authorization: Bearer <client JWT>
```

(Route/query param unchanged — only the response shape gained two new fields
per purchase, backed by `CoursePurchasesService.findMyPurchasesUnderTrainer`.)

Each purchase row now includes:
```jsonc
{
  "id": "...",
  "course": { /* ... */ },
  "remainingSessions": 10,
  // NEW:
  "paymentStatus": "Pending" | "Successful" | "Failed" | "Expired" | "Reversed" | "Cancelled" | null,
  "opnChargeId": "chrg_test_..." | null
}
```

- `paymentStatus` is the **raw DB value** — it is not reconciled against
  Omise here (that would mean an Omise API call per row in a list endpoint).
  If a PromptPay charge actually expired hours ago but nobody ever polled
  Endpoint 2 or the webhook never arrived, this list can still show
  `"Pending"` momentarily stale. That's expected — call Endpoint 2 (which
  does reconcile) when the user actually taps into a pending purchase, not
  from this list endpoint.
- `paymentStatus`/`opnChargeId` are `null` together only in the edge case of
  a purchase with no `Payment` row at all (shouldn't happen via the normal
  purchase flow today, but the field is nullable defensively).
- Use `paymentStatus !== "Successful"` as the signal to disable
  booking-related actions on that course card and show a "pay now" button
  instead — mirrors the server-side gate already enforced in `ensureUsable()`
  (booking a workout throws `BadRequestException` if the purchase's payment
  isn't `Successful`), so this is UI-side defense-in-depth, not the actual
  enforcement.
- Use `opnChargeId` directly as `:chargeId` for Endpoint 2 — no separate
  lookup needed.
- **A cancelled purchase (Endpoint 5) simply disappears from this list** —
  it is not returned with `paymentStatus: "Cancelled"`. See Endpoint 5.

## Endpoint 5 — Cancel a pending PromptPay payment (deletes the purchase)

```
POST /api/v1/payments/:chargeId/cancel
Authorization: Bearer <client JWT>
```

Lets a user back out of a PromptPay purchase immediately instead of waiting
out the full 15-minute QR expiry. `:chargeId` is the same `opnChargeId` used
for Endpoint 2.

**This deletes the `CoursePurchase` row (and its `Payment`) entirely** — it
does not just mark the payment `"Cancelled"` and leave a dead record behind
(that was the original behavior; changed based on mobile feedback that
"cancel" should mean the purchase never happened, not a purchase stuck in a
cancelled state). `PaymentStatus.Cancelled` still exists as an enum value
(used only transiently inside the cancel transaction, and kept around for
historical/future use), but you will not see it as a persisted
`paymentStatus` on any purchase — a cancelled purchase's row is gone, full
stop.

Response (HTTP 200):
```jsonc
{ "deleted": true }
```

- Only works while `status === "Pending"` — cancelling anything else
  (`Successful`/`Failed`/`Expired`) returns HTTP 400
  `BadRequestException: "This payment can no longer be cancelled"`. Mobile
  should only show the cancel button when `paymentStatus === "Pending"`
  (same gate as when Endpoint 4 shows "pay now"/QR-resume).
- Ownership-checked like Endpoint 2 (403 if the payment isn't the caller's).
- **This is a local-only cancellation on Omise's side** — Omise has no API to
  invalidate a PromptPay QR early (their charge-expire endpoint explicitly
  excludes the `promptpay` source type), so the QR image itself technically
  stays scannable on Omise's side until its real `expires_at`. In practice
  this is harmless: once the `Payment`/`CoursePurchase` rows are deleted,
  there's nothing left in this system for a late scan to attach to even if
  Omise reports the charge as paid afterward. If mobile wants to be extra
  safe, hide the QR from the UI as soon as cancel succeeds rather than
  relying on the QR itself becoming unscannable.
- Any coupon applied to the cancelled purchase is automatically released
  (see below) and can be used again on a fresh purchase.
- If the purchase somehow already has a `Workout` booked or a `Review`
  against it (shouldn't be reachable — both require a `Successful` payment,
  and this only runs while still `Pending`), cancel refuses with HTTP 400
  rather than silently deleting that history via cascade.

## Coupons are released automatically on a dead-end payment

A coupon selected at purchase time is marked used immediately — before a
PromptPay charge is known to succeed. If that payment later becomes
`"Failed"` or `"Expired"` (via webhook or Endpoint 2's reconciliation), or
the purchase is cancelled outright (Endpoint 5), the backend automatically
frees the coupon back up. Mobile doesn't need to do anything special here —
a coupon that was used on a now-dead purchase will simply work again the
next time it's sent in a fresh `purchaseAndJoin` call. (Previously this was
a real bug: a coupon used on a failed PromptPay attempt was stuck forever
with no way to retry using it — now fixed server-side.)

## Returning to a pending PromptPay purchase (e.g. after backgrounding the app)

If a user starts a PromptPay purchase, sees the QR, then leaves (backs out,
kills the app, lets the QR expire) before scanning:

1. The purchase still shows up in Endpoint 4's list (course purchases are
   committed immediately as `Pending`, per the PromptPay flow above).
2. Mobile reads `paymentStatus !== "Successful"` on that row → renders it as
   "awaiting payment" (disabled booking actions, a "pay now" / "ชำระเงิน"
   button, and now also a "cancel" / "ยกเลิก" button — see Endpoint 5)
   instead of a normal usable purchase card.
3. User taps "pay now" → call Endpoint 2 with that row's `opnChargeId`:
   - `status === "Pending"` and `qrCodeUrl` present → show that QR again,
     resume polling. No new charge is created.
   - `status === "Failed"` or `"Expired"` → tell the user this attempt is
     dead and they need to purchase again from scratch (new call to
     Endpoint 1). **There is no retry-in-place for an existing purchase** —
     `Payment.purchaseId` is a unique 1:1 relation in the schema, so a dead
     `Payment` can't be replaced with a new charge; a fresh `purchaseAndJoin`
     call is required, which creates its own new `CoursePurchase` +
     `Payment`. (A many-payments-per-purchase model to support true
     in-place retry is a possible future schema change, out of scope here.)
     Any coupon used on the dead attempt is already released (see above) and
     can be reused on this fresh call. Unlike a cancel, a `Failed`/`Expired`
     purchase row is *not* deleted — it stays as a dead record (same as
     before); only an explicit cancel (step 4) deletes it.
4. Alternatively, user taps "cancel" instead of "pay now" → call Endpoint 5
   → the purchase and payment rows are deleted outright, coupon released —
   the card disappears from Endpoint 4's list on the next fetch, rather than
   sticking around showing a dead/cancelled state.

## What's explicitly NOT implemented (don't build UI assuming these work)

- `TrueMoneyWallet` and `InternetBanking` — enum values exist in the schema
  for the future, but `purchaseAndJoin` currently throws `BadRequestException`
  ("Payment method X is not supported yet") if sent. Only `Card` and
  `PromptPay` work.
- Push notifications for payment completion — polling only.

## Order of operations mobile needs to implement

1. User picks a course + optional coupons, picks payment method (if the
   course isn't free — see trial-course section above for the amount-0 case,
   which doesn't need special handling on the request side).
2. **If Card**: tokenize the card client-side using Omise's Public Key SDK
   (get the current `OMISE_PUBLIC_KEY` value from the backend `.env` — ask,
   don't guess — it's a `pkey_test_...` string in test mode) → get back a
   token string → call Endpoint 1 with `method: "Card", omiseToken: "<token>"`.
   - Success → done, purchase is immediately usable.
   - Failure → show the returned Thai error message, let user retry.
3. **If PromptPay**: call Endpoint 1 with `method: "PromptPay"` (no token) →
   check the response for `qrCodeUrl`:
   - **Present** → show QR, poll Endpoint 2 with `payment.opnChargeId` every
     few seconds until status changes → on `Successful`, purchase becomes
     usable; on `Failed`/`Expired`, show the error and let the user retry
     (which creates a fresh purchase+payment — the old `Pending` one stays as
     a dead/expired record).
   - **Absent** → this was actually a free/trial course purchase (amount 0);
     `payment.status` is already `"Successful"` — treat it like a successful
     Card purchase, no QR screen, no polling.
4. On any subsequent app visit, read `paymentStatus` from Endpoint 4's list
   to detect purchases still awaiting payment — see "Returning to a pending
   PromptPay purchase" above for that flow, including the cancel button
   (Endpoint 5).

## Auth

All client-facing endpoints above (1, 2, 4, 5) require the same client JWT
bearer token already used elsewhere in the app
(`Authorization: Bearer <token>`) — no new auth mechanism was introduced.
Endpoint 3 (webhook) is called by Omise directly and has no JWT.
