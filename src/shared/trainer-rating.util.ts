import { Prisma } from '../../generated/prisma/client';
import { roundScore } from './score.util';

/**
 * Recomputes the cached `User.rating` (average review score, 2 decimals) and
 * `User.reviewCount` for one trainer from every review they have. Call it in
 * the same transaction as anything that adds or removes reviews, including
 * deletes that cascade into the Review table — GET /users/trainers/search and
 * GET /users/:id read these columns instead of aggregating.
 *
 * It recomputes rather than adjusting incrementally so the cached values can't
 * drift. It first takes the trainer's row lock, so two changes landing at once
 * are applied one after the other: under READ COMMITTED the second aggregate
 * then runs after the first commit and sees it. Without the lock each could
 * miss the other's uncommitted change and leave the cache wrong.
 *
 * The lock is FOR NO KEY UPDATE on purpose, not FOR UPDATE: inserting a Review
 * already holds a KEY SHARE lock on the trainer's User row (via the foreign
 * key), which FOR UPDATE conflicts with — two concurrent reviews that each
 * insert and then lock would deadlock on each other.
 */
export async function refreshTrainerRating(
  tx: Prisma.TransactionClient,
  trainerId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${trainerId} FOR NO KEY UPDATE`;

  const aggregate = await tx.review.aggregate({
    where: { targetUserId: trainerId },
    _avg: { score: true },
    _count: true,
  });
  await tx.user.update({
    where: { id: trainerId },
    data: {
      rating: roundScore(aggregate._avg.score),
      reviewCount: aggregate._count,
    },
  });
}
