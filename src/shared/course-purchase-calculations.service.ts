import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CoursePurchaseCalculationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Remaining/used-sessions calculation for each purchase:
   * - usedSessions: how many Workouts have been booked against the purchase
   *   (cancellations still count — sessions are never refunded).
   * - remainingSessions: course.sessions, plus the bonusSessions of any
   *   coupons redeemed on the purchase (a coupon grants that many bonus
   *   sessions on top of the course — separate from minSessions, which only
   *   gates which courses the coupon can be applied to), minus usedSessions.
   * This is the single source of truth for these numbers —
   * CoursePurchasesService and ClientTrainersService both depend on it via
   * SharedModule; do not duplicate this logic elsewhere.
   */
  async computeRemainingSessions(purchaseIds: string[]) {
    const purchases = await this.prisma.coursePurchase.findMany({
      where: { id: { in: purchaseIds } },
      include: { course: true, coupons: { include: { coupon: true } } },
    });

    const usedCounts = await this.prisma.workout.groupBy({
      by: ['purchaseId'],
      where: { purchaseId: { in: purchaseIds } },
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
}
