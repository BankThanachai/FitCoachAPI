# Auth Lockout & Rate Limits

Every way a wrong guess (password or OTP code) or too many requests gets
punished on `/auth/*`, in one place. Four independent mechanisms, each
protecting against a different threat — they don't share state or
counters with each other.

## Quick reference

| Mechanism | Triggers on | Threshold | Penalty | Scope |
|---|---|---|---|---|
| [Login lockout](#1-login-lockout-wrong-password) | Wrong password | 3 in a row | 5 min block | Per account |
| [OTP attempt limit](#2-otp-attempt-limit-wrong-code) | Wrong OTP code | 3 in a row | 5 min block (email/phone locked separately) | Per account, per channel |
| [OTP resend cooldown](#3-otp-resend-cooldown) | Requesting a new OTP too soon | 1 request | 60 sec wait | Per account |
| [IP rate limit](#4-ip-rate-limit) | Too many requests overall | 10/min | 30 min block | Per IP address |

All three `429`-returning penalty types use the **same response
shape**:
```json
{
  "statusCode": 429,
  "message": "...",
  "retryAfterSeconds": 300
}
```
`retryAfterSeconds` is always the actual remaining time as of that
response — never hardcode "5 minutes" or "30 minutes" client-side, read
this field and count down from it instead.

Both the login and OTP wrong-guess `400`/`401` responses (not the `429`
lock itself) also include `attemptsRemaining`, so the client can show "N
tries left" without tracking the count itself — see each section below
for the exact values in every case.

---

## 1. Login lockout (wrong password)

`POST /auth/login` — [`auth.service.ts`](../src/auth/auth.service.ts)

- **3 consecutive wrong passwords** locks the account for **5 minutes**.
- Locks the **account**, not an IP or device — applies the same whether
  the identifier used was email or phone, since both resolve to the same
  user.
- While locked, every attempt against that account gets `429` —
  **including one with the correct password**. The backend checks the
  lock before it even looks at the password, on purpose (see
  [Why the lock is checked before the password](#why-the-lock-is-checked-before-the-password)).

```json
{
  "statusCode": 429,
  "message": "Too many failed login attempts. Try again later.",
  "retryAfterSeconds": 300
}
```

**Resetting the counter:** any successful login (correct password, not
currently locked) resets the failed-attempt count back to 0. Getting it
right on attempt 1 or 2 never triggers anything — only 3 *consecutive*
misses locks it, and a success anywhere in between resets the streak.
The counter is also reset the moment a request comes in for an account
whose lock has already expired, before that request's own password check
even runs — so a lockout cycle always needs 3 fresh consecutive misses to
trigger, never fewer, no matter how long ago the previous lock ended.

### `attemptsRemaining` on a wrong password

Every `401` for a wrong password (and for an unregistered email/phone —
see below) includes `attemptsRemaining`, so the client can show "N tries
left" without tracking the count itself:

```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "attemptsRemaining": 2
}
```

`attemptsRemaining` counts down from 2 → 1 → 0 across 3 consecutive wrong
attempts; the 3rd one locks the account and returns `429` instead of a
`401` with `attemptsRemaining: 0`. **An unregistered email/phone returns
the exact same body** (`attemptsRemaining: 2`, the same as a real
account's first wrong attempt) — deliberately, so the response gives no
way to tell "no such account" apart from "account exists, wrong
password" by checking whether the field is present or what it says.
Don't use this field to infer whether an identifier is registered.

### Why the lock is checked before the password

If a locked account's correct password returned something different from
its wrong password (e.g. still `401` for wrong, but a distinguishable
response for right), a client — or an attacker automating a client —
could use that difference to confirm a guessed password without ever
actually getting in. So while locked, the backend never runs
`bcrypt.compare` at all; every request for that account gets the same
`429`, correct password or not, until the 5 minutes pass.

---

## 2. OTP attempt limit (wrong code)

`POST /auth/otp/verify` and `POST /auth/otp/phone/verify` —
[`auth.service.ts`](../src/auth/auth.service.ts)

- **3 wrong codes in a row** locks that verification channel for the
  account for **5 minutes** — same threshold and duration as login
  lockout, but a completely separate lock (its own field on the account,
  its own timer).
- Email and phone OTP lock **independently**. Locking out email OTP by
  repeatedly guessing wrong has no effect on phone OTP for the same
  account, and vice versa.
- While locked, **both verify and resend are blocked** for that channel —
  even a resend request (asking for a brand-new code) gets rejected, not
  just verify. This is deliberate: without it, resend would be a way
  around the lock (burn through 3 attempts, immediately resend to get a
  fresh row with its counter back at 0, repeat indefinitely).
- Wrong code, expired code (10 minutes after it was sent), or no pending
  code at all — all still return the same generic `400` **until the 3rd
  wrong attempt**, at which point that becomes a `429` instead:

```json
// Attempts 1-2 — attemptsRemaining counts down
{ "statusCode": 400, "message": "Invalid or expired code", "attemptsRemaining": 1 }

// 3rd consecutive wrong attempt, and every request during the 5-minute lock
{
  "statusCode": 429,
  "message": "Too many failed verification attempts. Try again later.",
  "retryAfterSeconds": 300
}
```

### `attemptsRemaining` on a wrong code

Same idea as [login lockout's `attemptsRemaining`](#attemptsremaining-on-a-wrong-password):
every `400` includes it, so the client can show "N tries left" without
tracking the count itself.

- A wrong code against a real, unexpired, unconsumed OTP: counts down
  `2 → 1 → 0` across 3 wrong guesses — the 3rd one locks instead and
  returns `429`, not a `400` with `attemptsRemaining: 0`.
- An unregistered email/phone, or no pending/expired code at all: always
  reports a *full* `attemptsRemaining` (3) — same shape in all three
  cases, since none of them have actually consumed a guess against a real
  code.
- A code whose attempt count is already at the cap (the lock expired but
  this exact code row wasn't replaced by a resend): reports
  `attemptsRemaining: 0` — that specific code stays dead regardless; only
  a fresh `resend` produces a code with attempts available again.

Don't try to distinguish the `400` failure cases from the message or from
whether `attemptsRemaining` looks "full" vs. partial in a way that infers
registration status — the no-pending-code and unregistered-identifier
cases are deliberately identical (both report `attemptsRemaining: 3`) to
prevent an attacker from using the response to figure out which
emails/phones are registered. Once locked out (`429`), the only path
forward is waiting out the 5 minutes — there's no "resend to reset"
shortcut.

---

## 3. OTP resend cooldown

`POST /auth/otp/resend` and `POST /auth/otp/phone/resend`

- Requesting a new OTP within **60 seconds** of the last one for that
  account returns `400`:
  ```json
  { "statusCode": 400, "message": "Please wait before requesting another code" }
  ```
- This is a flat `400`, not a `429` — it's not a security lockout, just a
  spam guard, so it doesn't follow the `retryAfterSeconds` shape above.
  Disable/throttle the resend button client-side to match this 60-second
  window, but the server enforces it regardless of what the client does.
  Repeated rejections here don't accumulate into anything — there's no
  separate lock for spamming resend itself; the only way resend gets
  blocked outright is if [OTP attempt limit](#2-otp-attempt-limit-wrong-code)
  above is already active for that channel (wrong codes, not resend
  spam, is what locks it).
- Requesting a new code (after the cooldown) invalidates any previous
  unconsumed code for that account — only the latest one is ever valid.

---

## 4. IP rate limit

Every route under `/auth` (login, all 4 OTP endpoints, refresh, logout) —
[`app.module.ts`](../src/app.module.ts),
[`auth.controller.ts`](../src/auth/auth.controller.ts),
[`shared/auth-throttler.guard.ts`](../src/shared/auth-throttler.guard.ts)

- **10 requests/minute per IP address**, counted across all `/auth/*`
  routes combined (not per-route).
- Exceeding it **blocks that IP for 30 minutes** — not just until the
  1-minute window resets. This is a real penalty, not a brief pause.

```json
{
  "statusCode": 429,
  "message": "Too many requests. Try again later.",
  "retryAfterSeconds": 1800
}
```

This is independent of the login lockout and OTP attempt limit above —
it exists to stop one IP from hammering *many different accounts*
(credential stuffing) or spamming OTP sends, not to protect any single
account (the account-level mechanisms already do that). In normal use —
a real person using the app, even fumbling through a few retries — this
should never trigger; 10 requests/minute is well above anything a human
generates by hand.

---

## How these interact

These four mechanisms are checked independently and don't share counters.
A concrete example: someone mistyping their password repeatedly from one
device will hit the **login lockout** (3 wrong in a row → locked 5 min)
long before they'd ever get close to the **IP rate limit** (10 requests
total across everything under `/auth`) — the login lockout is the one
that actually fires in that scenario. The IP rate limit mostly matters
for automated/scripted abuse hitting the API much faster than a human
would, or targeting multiple accounts from one IP.

None of these are visible to, or resettable by, the mobile client. If a
user gets locked out and needs an early reset for a legitimate reason
(e.g. support ticket), that requires a manual DB change from someone with
backend access — there's no self-service unlock endpoint today.
