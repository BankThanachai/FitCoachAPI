import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CoursePurchaseCalculationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Remaining-sessions calculation: course.sessions minus how many Workouts
   * have been booked against each purchase (cancellations still count —
   * sessions are never refunded). This is the single source of truth for
   * this number — CoursePurchasesService and ClientTrainersService both
   * depend on it via SharedModule; do not duplicate this logic elsewhere.
   */
  async computeRemainingSessions(purchaseIds: string[]) {
    const purchases = await this.prisma.coursePurchase.findMany({
      where: { id: { in: purchaseIds } },
      include: { course: true },
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
      purchases.map((purchase) => [
        purchase.id,
        purchase.course.sessions - (usedByPurchaseId.get(purchase.id) ?? 0),
      ]),
    );
  }
}
