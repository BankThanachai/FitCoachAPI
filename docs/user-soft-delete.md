# User soft delete (Active / Inactive)

Users are **never hard-deleted**. `DELETE /api/v1/users/:id` marks the account
`Inactive` (`User.status`, `User.deactivatedAt`) and returns the user, now with
`status: "Inactive"`. The row and everything that points at it — reviews,
workouts, purchases, chats, payments — stays exactly as it was.

## What changes for an Inactive user

Viewing is **unchanged**: every endpoint that reads data (profile, lists, chats,
workouts, reviews, courses, portfolio photos, ...) keeps returning an Inactive
user's data exactly as before, and the user object carries `status` so the app
can tell. Only these things change:

| Where | Behavior |
|---|---|
| `GET /users/trainers/search` | An Inactive trainer is **not listed** |
| `POST /trainer-courses/:id/purchase`, `.../purchase-and-join` | A client can't buy a course from an Inactive trainer: `400` with `code: "TRAINER_INACTIVE"` (nothing is charged or created). The course itself can still be viewed. The check is in `CoursePurchasesService.validatePurchase`, which both endpoints go through |
| `POST /auth/login` | Rejected with the same `401 Invalid credentials` (and `attemptsRemaining`) as an unknown account — a response can't be used to tell "deactivated" from "never existed" |
| `POST /auth/refresh`, OTP verify / resend | Rejected / treated as an unknown account |
| Any authenticated request by that user | `JwtStrategy` re-checks the user is Active on every request, so an access token issued **before** deactivation stops working immediately (`401`) instead of living out its 15 minutes. This is one extra primary-key lookup per authenticated request |
| `PATCH /users/:id`, `DELETE /users/:id` | `404` for an Inactive user: it can't be edited, or deactivated a second time. `GET /users/:id` and `GET /users` still return it |
| Deactivation itself | Revokes every refresh token and deletes the user's device tokens (no more push), in one transaction |

Everything else — booking, messaging, requests, assigning exercises, reviews —
behaves as it did before soft delete; nothing else is blocked.

## Email and phone are unique among Active users only

A deactivated account gives its email and phone back: the same email/phone can
be registered again as a brand-new account (new id). Several Inactive accounts
may share one email/phone; at most one **Active** account can.

This is enforced in the database with two **partial unique indexes**,
`User_email_active_key` and `User_phone_active_key` (`WHERE status = 'Active'`),
created in the `user_soft_delete` migration. Because of that:

- Prisma can't declare a partial unique index, so the schema has **no `@unique`
  on `User.email` / `User.phone`** and the indexes live only in the migration.
  Prisma's diff ignores them (checked: `prisma migrate diff` does not try to
  drop them), so `migrate dev` won't remove them.
- `prisma.user.findUnique({ where: { email } })` / `{ phone }` therefore doesn't
  compile any more. Look users up by email/phone with
  `findFirst({ where: { email, status: UserStatus.Active } })` — never without
  the `status` filter, or an old Inactive account could be matched.
- Registering a duplicate of an Active account still fails with the same vague
  `409` as before (the unique violation surfaces as `P2002`).
- Reactivating an Inactive account whose email/phone has since been taken by an
  Active one is rejected by the database. There is **no reactivation endpoint**
  today; an account only becomes Active again by editing the row directly.

## Known gaps

- **Bank accounts** keep their `(bankName, accountNumber)` uniqueness across all
  users, Inactive included, so re-registering with a bank account that belonged
  to a deactivated account is rejected as already registered.
- **Pro subscriptions** are not cancelled: the store keeps billing until the
  user cancels in the App Store / Play Store.
- **Existing bookings with a deactivated trainer** are untouched: the trainer
  can no longer log in to approve or run them, so pending ones stay pending.
- **Authorization:** `DELETE /users/:id` (like `PATCH /users/:id`) only requires
  a logged-in user — it does not check that the caller owns the account.
