# OTP Verification Flow (Email + Phone)

This describes how email and phone OTP verification actually work on the
backend today, so the mobile client can drive them correctly. It covers all
4 endpoints, when each one auto-sends vs. requires an explicit call, and the
response shapes mobile reads to decide which screen to show next.

## TL;DR

- **Register (`POST /users`) auto-sends email OTP only.** Phone OTP is
  never auto-sent — the client must call `otp/phone/resend` itself
  whenever it wants a phone OTP sent (including the very first one).
- **`otp/resend` and `otp/phone/resend` both mean "send me a valid code
  now"**, not strictly "send again". The name is a bit misleading — see
  [Why "resend" fires on first open](#why-resend-fires-on-first-open).
- **Login (`POST /auth/login`) never blocks on verification status.** A
  correct password always returns tokens. The client is responsible for
  reading `emailVerified`/`phoneVerified` off the response and routing to
  a verify screen before letting the user into the app.
- **`GET /users/:id` also returns `emailVerified`/`phoneVerified`** — use
  this to re-check status anywhere other than right after login (e.g. a
  verify-gate screen on app reopen).

## Endpoints

All under `/api/v1/auth`.

| Endpoint | Body | Purpose |
|---|---|---|
| `POST /otp/verify` | `{ email, code }` | Verify an email OTP |
| `POST /otp/resend` | `{ email }` | Send (or re-send) an email OTP |
| `POST /otp/phone/verify` | `{ phone, code }` | Verify a phone OTP |
| `POST /otp/phone/resend` | `{ phone }` | Send (or re-send) a phone OTP |

### Verify response

Success (`200`):
```json
{ "verified": true }
```

Failure (`400`) — **same generic message for every failure case**
(unregistered email/phone, no pending OTP, expired, too many attempts, or
wrong code). Don't branch UI copy on this message — the API intentionally
never reveals which case it was, to prevent enumeration:
```json
{ "statusCode": 400, "message": "Invalid or expired code", "error": "Bad Request" }
```

If the email/phone was already verified before this call, verify still
returns `{ "verified": true }` without checking the code (idempotent).

### Resend response

Always `200` on a well-formed request:
```json
{ "success": true }
```

This is returned even when the email/phone doesn't exist, or is already
verified — resend is a deliberate no-op in both cases, not an error. The
client should never infer registration status from this response.

Cooldown: `400` if called again within 60 seconds of the last send:
```json
{ "statusCode": 400, "message": "Please wait before requesting another code" }
```

### OTP rules (both email and phone)

- 6-digit numeric code
- Expires after **10 minutes**
- **5 wrong attempts** locks that code — a new `resend` is required to get
  a fresh one, even if the 6th guess would've been correct
- Requesting a new OTP invalidates any previous unconsumed one for that
  user — only the latest code is ever valid

## When each OTP gets sent

### 1. Register — Trainer

`trainer_register_password_screen.dart` flow, confirmed against backend:

1. `POST /users` succeeds → email OTP is **sent automatically** by the
   backend as part of user creation. No client call needed for this one.
2. Client navigates to `/register/trainer/verify-phone`.
3. **Phone OTP is not auto-sent.** This screen must call
   `otp/phone/resend` itself (e.g. on `initState`) to get the first code
   out, then `otp/phone/verify` once the user enters it.
4. Client navigates to `/verify-email`. The email OTP from step 1 is
   still valid (well within the 10-minute window in normal flow) — no
   resend needed here, just `otp/verify`.
5. → `/login`.

### 2. Register — Client

`client_register_screen.dart` flow:

1. `POST /users` succeeds → email OTP auto-sent (same as trainer; the
   backend doesn't distinguish user type for this).
2. Client goes straight to `/verify-email` → `otp/verify`.
3. No phone OTP step in this flow at all.
4. → `/login`.

### 3. Login / app reopen — verify-gate

`login_screen.dart` and `splash_screen.dart` both route through a
verify-gate before home:

1. Gate calls `GET /users/:id`.
2. Reads `phoneVerified` / `emailVerified` booleans off the response (see
   below).
3. If `phoneVerified` is `false` → `/verify-phone`. Else if
   `emailVerified` is `false` → `/verify-email`. Else → home.
4. **No OTP is auto-sent here.** If the original code already expired (or
   was never received), the user has to tap resend manually on whichever
   verify screen they land on.

## Why login doesn't block on verification

`POST /auth/login` used to return `403 Forbidden` if email wasn't
verified. That's gone — **a correct password always returns tokens now**,
regardless of verification status:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "emailVerified": false,
  "phoneVerified": false
}
```

The client is expected to force the user through whichever verify
screen(s) are pending *after* getting this response, before letting them
past login into the real app. The backend does not gate anything else
(other endpoints, other modules) on these flags — enforcement is 100% a
client responsibility.

`POST /auth/refresh` does **not** return these flags — it only returns
`{ accessToken, refreshToken }`, same as before. If you need current
verification status after a refresh, call `GET /users/:id`.

## `GET /users/:id` verification fields

```json
{
  "id": "...",
  "phone": "0812345678",
  "email": "user@example.com",
  "phoneVerifiedAt": "2026-09-23T10:15:00.000Z",
  "emailVerifiedAt": null,
  "phoneVerified": true,
  "emailVerified": false,
  ...
}
```

Use the boolean fields (`phoneVerified`, `emailVerified`), not the raw
timestamp fields (`phoneVerifiedAt`, `emailVerifiedAt`) — the timestamps
are still present for other potential uses but are `null` vs. a date, not
`false` vs. `true`.

## Why "resend" fires on first open

The `otp/resend` and `otp/phone/resend` endpoint names suggest "send it
again", but in practice they're the only endpoint that exists for
"make sure a valid OTP has been sent" — there's no separate `send` vs.
`resend` distinction on the backend. Both endpoints:

- No-op silently if the email/phone isn't registered, or is already
  verified (returns `{ success: true }` either way — this is intentional,
  to avoid leaking which emails/phones are registered)
- Otherwise invalidate any previous code and send a fresh one

This means: **any verify screen that isn't guaranteed to follow right
after an auto-send should call its `resend` endpoint on open**, not just
when the user explicitly taps a "resend" button. The phone flow in
particular has no auto-send at all, so `otp/phone/resend` on `initState`
is correct and required — this isn't a workaround, it's the only way to
get a phone OTP sent.

## Known gaps / things not implemented

- **Phone OTP delivery is not wired to a real SMS gateway yet.** The
  backend logs the code to the server console
  (`[DEV SMS] OTP for <phone>: <code>`) instead of sending a real SMS.
  Don't expect a text message to arrive during testing — ask a backend
  dev for the code from server logs, or wait for a gateway to be
  connected before testing with real users.
- Email OTP does send a real email via Resend, and also logs the code to
  the server console (`[DEV EMAIL] OTP for <email>: <code>`) as a
  convenience — useful if an email doesn't arrive (check spam first).
