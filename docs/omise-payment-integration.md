# Omise/Opn Payment Integration — Backend Handoff for Mobile (Flutter)

This document describes what changed on the FitCoachAPI (NestJS) backend to
support real Omise/Opn payments (Card + PromptPay), so the Flutter-side agent
knows exactly what to call, when, and with what payload.

Backend repo root: `/Users/be8-thanachaiw/Desktop/Project/Learning/My App/FitCoachAPI`

## Files changed/added (read these for ground truth)

- `src/course-purchases/dto/purchase-and-join.dto.ts` — request body shape
- `src/course-purchases/course-purchases.service.ts` — `purchaseAndJoin()`,
  `purchaseAndJoinWithCard()`, `purchaseAndJoinWithPromptPay()`, `ensureUsable()`
- `src/payments/payments.controller.ts` — all payment-related routes
- `src/payments/payments.service.ts` — `getStatus()`, `handleWebhookEvent()`
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
- Show a countdown/expiry using `expiresAt`
- Start polling `GET /api/v1/payments/:chargeId/status` (below), using
  `payment.opnChargeId` as `:chargeId`, until status is no longer `Pending`
- **A `Pending` PromptPay purchase cannot be used yet** — e.g. the client
  cannot book a workout session against it until the payment clears. If the
  mobile UI lets a user navigate to book a session right after purchase,
  booking will fail with `BadRequestException: "This course purchase has not
  been paid for yet"` until the payment is `Successful`.

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
  "status": "Pending" | "Successful" | "Failed" | "Expired" | "Reversed",
  "paidAt": "2026-09-19T12:00:00Z" | null,
  "failureMessage": "การชำระเงินไม่สำเร็จ..." // only present if Failed/Expired
}
```

Suggested polling interval: every 2-3 seconds while `status === "Pending"`,
stop once it's any other value. This endpoint is ownership-checked (403 if
the payment doesn't belong to the calling client) and — if still `Pending`
locally — actively re-checks with Omise on each call, so it will reflect a
successful payment even if a webhook delivery is delayed, without mobile
needing to know anything about webhooks.

## Endpoint 3 — Webhook (backend/Omise only, not relevant to mobile)

```
POST /api/v1/payments/webhook
```

Called by Omise's servers directly, not by the app. Mentioned here only so
mobile understands *why* polling (Endpoint 2) is the reliable signal to use
instead of e.g. assuming a push notification will arrive — **there is no push
notification for payment completion in this backend today.** No FCM/APNs
wiring exists for this flow. Poll for status.

## What's explicitly NOT implemented (don't build UI assuming these work)

- `TrueMoneyWallet` and `InternetBanking` — enum values exist in the schema
  for the future, but `purchaseAndJoin` currently throws `BadRequestException`
  ("Payment method X is not supported yet") if sent. Only `Card` and
  `PromptPay` work.
- Push notifications for payment completion — polling only.

## Order of operations mobile needs to implement

1. User picks a course + optional coupons, picks payment method.
2. **If Card**: tokenize the card client-side using Omise's Public Key SDK
   (get the current `OMISE_PUBLIC_KEY` value from the backend `.env` — ask,
   don't guess — it's a `pkey_test_...` string in test mode) → get back a
   token string → call Endpoint 1 with `method: "Card", omiseToken: "<token>"`.
   - Success → done, purchase is immediately usable.
   - Failure → show the returned Thai error message, let user retry.
3. **If PromptPay**: call Endpoint 1 with `method: "PromptPay"` (no token) →
   get back `qrCodeUrl` + `expiresAt` + `payment.opnChargeId` → show QR →
   poll Endpoint 2 with that `opnChargeId` every few seconds until status
   changes → on `Successful`, purchase becomes usable; on `Failed`/`Expired`,
   show the error and let the user retry (which creates a fresh
   purchase+payment — the old `Pending` one stays as a dead/expired record).

## Auth

Both endpoints require the same client JWT bearer token already used
elsewhere in the app (`Authorization: Bearer <token>`) — no new auth
mechanism was introduced.
