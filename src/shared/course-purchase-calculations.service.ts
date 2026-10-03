import { Injectable } from '@nestjs/common';
import {
  PaymentStatus,
  Prisma,
  WorkoutStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Workout statuses where a booked session hasn't ended yet and the client can
 * still resolve it themselves (cancel it, or approve the trainer's
 * submission). ClientRejected is deliberately not here: only the trainer can
 * move it on (by re-submitting), so counting it would leave a client blocked
 * by something they have no way to clear.
 */
export const IN_PROGRESS_WORKOUT_STATUSES: WorkoutStatus[] = [
  WorkoutStatus.PendingApproval,
  WorkoutStatus.TrainerApproved,
  WorkoutStatus.TrainerSubmitted,
];

/**
 * A purchase is "unfinished" when it's paid and the client either still has
 * sessions left to book on it or has a booked session that hasn't ended yet.
 * A client can't buy another course from a trainer while any purchase with
 * that trainer is unfinished. Unpaid and dead (Pending/Failed/Expired/
 * Cancelled/Reversed) purchases don't count — they aren't a course the client
 * actually has.
 */
export function isPurchaseUnfinished(
  paymentStatus: PaymentStatus | null | undefined,
  remainingSessions: number,
  inProgressWorkouts: number,
): boolean {
  return (
    paymentStatus === PaymentStatus.Successful &&
    (remainingSessions > 0 || inProgressWorkouts > 0)
  );
}

@Injectable()
export class CoursePurchaseCalculationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Remaining/used-sessions calculation for each purchase:
   * - usedSessions: how many Workouts have been booked against the purchase,
   *   excluding TrainerRejected — the trainer never accepted that booking,
   *   so training never started and it shouldn't consume the purchase's
   *   quota. Cancelled and ClientRejected still count (training was already
   *   underway or done by then — sessions aren't refunded once accepted).
   * - remainingSessions: course.sessions, plus the bonusSessions of any
   *   coupons redeemed on the purchase (a coupon grants that many bonus
   *   sessions on top of the course — separate from minSessions, which only
   *   gates which courses the coupon can be applied to), minus usedSessions.
   * This is the single source of truth for these numbers —
   * CoursePurchasesService and ClientTrainersService both depend on it via
   * SharedModule; do not duplicate this logic elsewhere.
   *
   * `client` defaults to the shared client. Pass the enclosing transaction's
   * client when the numbers must be read inside it — e.g. after taking a
   * purchase's row lock — so the counts come from the same transaction.
   */
  async computeRemainingSessions(
    purchaseIds: string[],
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const purchases = await client.coursePurchase.findMany({
      where: { id: { in: purchaseIds } },
      include: { course: true, coupons: { include: { coupon: true } } },
    });

    const usedCounts = await client.workout.groupBy({
      by: ['purchaseId'],
      where: {
        purchaseId: { in: purchaseIds },
        status: { not: WorkoutStatus.TrainerRejected },
      },
      _count: true,
    });
    const usedByPurchaseId = new Map(
      usedCounts.map((row) => [row.purchaseId, row._count]),
    );

    return new Map(
      purchases.map((purchase) => {
        const bonusSessions = purchase.coupons.reduce(
          (sum, { coupon }) => sum + coupon.bonusSessions,
          0,
        );
        const usedSessions = usedByPurchaseId.get(purchase.id) ?? 0;
        const remainingSessions =
          purchase.course.sessions + bonusSessions - usedSessions;
        return [purchase.id, { remainingSessions, usedSessions }];
      }),
    );
  }

  /**
   * How many workouts under each purchase are still in progress (see
   * IN_PROGRESS_WORKOUT_STATUSES). Purchases with none are absent from the
   * map. Feeds isPurchaseUnfinished.
   */
  async countInProgressWorkouts(
    purchaseIds: string[],
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const counts = await client.workout.groupBy({
      by: ['purchaseId'],
      where: {
        purchaseId: { in: purchaseIds },
        status: { in: IN_PROGRESS_WORKOUT_STATUSES },
      },
      _count: true,
    });
    return new Map(counts.map((row) => [row.purchaseId, row._count]));
  }
}
