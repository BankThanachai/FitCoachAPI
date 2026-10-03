-- Dev only: switch a trainer's FitWork Pro on or off by hand, without a store
-- purchase or a RevenueCat project. Writes the same two things the real sync
-- does (Subscription row + User.isPro), so the app, /subscriptions/me, the
-- photo limit and the search ranking all behave as if the trainer had bought
-- Pro. Do not run against production.
--
--   days > 0   Pro for that many days from now (status ACTIVE)
--   days <= 0  Pro already lapsed (status EXPIRED, isPro false) — use -1 to
--              test what a lapsed subscription looks like
--
-- Usage (phone is the trainer's login phone, exactly as stored):
--   docker compose exec -T db psql -U fitwork -d fitwork \
--     -v phone='+66812345678' -v days=30 < prisma/dev/set-pro.sql

WITH target AS (
  SELECT "id" FROM "User" WHERE "phone" = :'phone' AND "type" = 'Trainer'
), upserted AS (
  INSERT INTO "Subscription" (
    "id", "userId", "store", "productId", "status", "startedAt", "expiresAt",
    "environment", "lastSyncedAt", "createdAt", "updatedAt"
  )
  SELECT
    gen_random_uuid()::text, "id", 'OTHER'::"SubscriptionStore", 'dev_manual',
    (CASE WHEN :days > 0 THEN 'ACTIVE' ELSE 'EXPIRED' END)::"SubscriptionStatus",
    now(), now() + make_interval(days => :days),
    'SANDBOX'::"SubscriptionEnvironment", now(), now(), now()
  FROM target
  ON CONFLICT ("userId") DO UPDATE SET
    "status" = EXCLUDED."status",
    "expiresAt" = EXCLUDED."expiresAt",
    "lastSyncedAt" = now(),
    "updatedAt" = now()
  RETURNING "userId"
)
UPDATE "User" SET "isPro" = (:days > 0)
WHERE "id" IN (SELECT "userId" FROM upserted)
RETURNING "id", "phone", "isPro";
