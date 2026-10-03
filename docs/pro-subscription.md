# FitWork Pro (trainer subscription)

Trainers can subscribe to **FitWork Pro** ($3.99/month) through the App Store /
Google Play. **RevenueCat** sits between the stores and us; this backend
mirrors the result and enforces the perks server-side (hiding something in the
app is not enough — anyone can call the API directly).

## What Pro gives (and where it's enforced)

| Perk | Enforced in |
|---|---|
| Listed first in trainer search | `UsersService.searchTrainers` — `orderBy` starts with `isPro desc` |
| Portfolio photos: free 5 / Pro 20 | `UploadsService` — see [photo-upload-flow.md](photo-upload-flow.md#portfolio-photo-limit-free-5--pro-20) |
| Open classes | Not built — there is no class feature yet. When there is, check Pro at its create endpoint and throw `ProRequiredException` |

Search order: Pro first, then **average review score** (high → low), then
**number of reviews** (high → low), then `firstName`, then `id` (a stable
tie-break so pagination never repeats or skips a trainer). This also changes
the order of non-Pro trainers: it used to be effectively alphabetical, because
nothing ever wrote `User.rating`.

## Data

- `Subscription` — one row per user (`userId` is ours, not the Apple/Google
  account, so Pro follows the user across devices). `status` is `ACTIVE`,
  `CANCELLED` (auto-renew off, **still Pro until `expiresAt`**),
  `BILLING_RETRY`, or `EXPIRED`.
- `SubscriptionEvent` — one row per matched RevenueCat webhook delivery
  (`eventId` is unique → dedupe).
- `User.isPro` — public badge + search-ranking flag. Can lag a lost webhook by
  up to a day. **Never gate a feature on it** — use `Subscription.expiresAt > now`
  (`SubscriptionsService.isProActive`).
- `User.rating` / `User.reviewCount` — cached average review score (2 decimals)
  and review count. The migration backfilled existing trainers. They are
  recomputed by `refreshTrainerRating` ([src/shared/trainer-rating.util.ts](../src/shared/trainer-rating.util.ts))
  in the same transaction as **anything that adds or removes reviews**:
  `ReviewsService.create` and `TrainerCoursesService.remove` (a course delete
  cascades into its reviews). Any new code path that deletes reviews,
  purchases or courses must call it too, or the cache goes stale. Users are
  never hard-deleted (see [user-soft-delete.md](user-soft-delete.md)), so
  removing an account leaves every review — and every cached rating — as is.
- `averageScore` in `GET /users/trainers/search` and `GET /users/:id` is read
  straight from `User.rating` (no per-request aggregation). `GET
  /reviews/user/:userId` still aggregates live, since it also returns
  `countByScore`.

## Endpoints

### `GET /api/v1/subscriptions/me` (JWT)

```json
{
  "isPro": true,
  "status": "CANCELLED",
  "productId": "monthly",
  "store": "APP_STORE",
  "startedAt": "2026-08-01T00:00:00.000Z",
  "expiresAt": "2026-11-01T00:00:00.000Z",
  "portfolioPhotoLimit": 20
}
```

`isPro` is computed from `expiresAt`, not the flag. A user who never subscribed
gets `isPro: false`, `portfolioPhotoLimit: 5` and `null` for the rest.
`store` is `APP_STORE`, `PLAY_STORE`, or `OTHER` (RevenueCat Test Store /
promotional grants). `expiresAt` is `null` for an entitlement that never
expires. These details are deliberately **not** on `GET /users/:id`, which any
logged-in user can call for any profile — that endpoint only exposes `isPro`.

### `POST /api/v1/subscriptions/sync` (JWT)

Re-reads the caller's entitlement from RevenueCat and returns the same shape as
`/me`. Call it right after a purchase or a restore so the app doesn't see Pro
from the SDK while the webhook is still on its way. Returns `503` if the server
has no `REVENUECAT_SECRET_API_KEY`.

### `POST /api/v1/subscriptions/webhook` (RevenueCat only)

No JWT. Authenticated by the `Authorization` header value configured on the
webhook in the RevenueCat dashboard (`REVENUECAT_WEBHOOK_AUTH`), compared in
constant time; with nothing configured every delivery is rejected (`401`).

The body is **never trusted for state**. It only says *which* user changed;
`SubscriptionsService.syncFromRevenueCat` then fetches the real entitlement
(`fitwork_pro`) with the secret API key and writes `Subscription` +
`User.isPro`. So every event type (`INITIAL_PURCHASE`, `RENEWAL`,
`CANCELLATION`, `UNCANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`,
`PRODUCT_CHANGE`, `TRANSFER`, …) is handled the same way, and new ones need no
code change. Events whose `app_user_id` isn't one of our users (e.g.
`$RCAnonymousID:…`) are acknowledged with `200` and ignored. A failed sync
returns `5xx` so RevenueCat retries.

Sandbox events are accepted in production on purpose (App Store / Play
reviewers purchase through sandbox); `Subscription.environment` records which
it was.

The app must call `Purchases.logIn(userId)` so RevenueCat's `app_user_id` is our
`User.id`.

## Errors: `403 PRO_REQUIRED`

Anything gated behind Pro answers:

```json
{ "statusCode": 403, "code": "PRO_REQUIRED", "message": "…" }
```

The app should open the Pro paywall when it sees `code: "PRO_REQUIRED"`. This is
the first error in the API with a machine-readable `code`.

## Midnight job

`SubscriptionExpiryTask` runs at 00:00 `Asia/Bangkok` (`@nestjs/schedule`) and
switches off `User.isPro` for anyone whose subscription has run out — a safety
net for a lost `EXPIRATION` webhook. One `UPDATE` touching only rows still
flagged, so running it twice, or on several instances at once, gives the same
result.

## Decisions worth knowing

- **Billing retry / grace period:** Pro stays on for as long as RevenueCat
  itself still reports the entitlement as active (i.e. the store's grace
  period). We don't add a grace window of our own.
- **Pro lapses with more than 5 photos:** nothing is deleted. Photos in slots
  above 5 stop being listed and slots above 5 can't be used; the trainer can
  still replace or delete slots 1–5. Everything returns on re-subscribing.
- The webhook's optional `X-RevenueCat-Webhook-Signature` (HMAC) is not
  implemented; the shared Authorization header is the only check.

## Config

| Env | Purpose |
|---|---|
| `REVENUECAT_WEBHOOK_AUTH` | Value of the webhook's "Authorization header" in RevenueCat |
| `REVENUECAT_SECRET_API_KEY` | Secret (`sk_…`) API key for the REST lookup |

Neither is required to boot. Use separate RevenueCat projects/apps (and so
separate values) for the `dev` and `prd` app flavors.

## Testing without a store or RevenueCat

`prisma/dev/set-pro.sql` flips a trainer to Pro (or to a lapsed Pro) by hand,
writing the same `Subscription` row + `User.isPro` the real sync does:

```bash
docker compose exec -T db psql -U fitwork -d fitwork \
  -v phone='+66812345678' -v days=30 < prisma/dev/set-pro.sql   # Pro for 30 days
docker compose exec -T db psql -U fitwork -d fitwork \
  -v phone='+66812345678' -v days=-1 < prisma/dev/set-pro.sql   # lapsed
```

The webhook → RevenueCat sync path can only be tried end to end once there is a
RevenueCat project (and an Apple/Google developer account for real purchases).
