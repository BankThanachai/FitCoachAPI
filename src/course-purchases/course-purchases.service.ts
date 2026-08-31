import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserType } from '../../generated/prisma/client';
import { CouponsService } from '../coupons/coupons.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCoursePurchaseDto } from './dto/create-course-purchase.dto';

@Injectable()
export class CoursePurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly couponsService: CouponsService,
  ) {}

  async purchase(
    clientId: string,
    courseId: string,
    createCoursePurchaseDto: CreateCoursePurchaseDto,
  ) {
    const client = await this.prisma.user.findUnique({
      where: { id: clientId },
    });
    if (!client || client.type !== UserType.Client) {
      throw new BadRequestException('Only clients can purchase courses');
    }

    const course = await this.prisma.trainerCourse.findUnique({
      where: { id: courseId },
    });
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const couponIds = createCoursePurchaseDto.couponIds ?? [];
    if (course.isTrial && couponIds.length !== 1) {
      throw new BadRequestException(
        'A trial course requires exactly one trial coupon',
      );
    }

    for (const couponId of couponIds) {
      const { eligible } = await this.couponsService.checkEligibility(
        couponId,
        clientId,
        course.trainerId,
        course.isTrial,
      );
      if (!eligible) {
        throw new BadRequestException(
          'You have not trained enough sessions with this trainer to use this coupon',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const purchase = await tx.coursePurchase.create({
        data: { clientId, courseId },
      });

      for (const couponId of couponIds) {
        await this.couponsService.redeem(
          tx,
          couponId,
          course.trainerId,
          purchase.id,
        );
      }

      return purchase;
    });
  }

  async findByClient(clientId: string) {
    const purchases = await this.prisma.coursePurchase.findMany({
      where: { clientId },
      include: { course: true },
      orderBy: { purchasedAt: 'desc' },
    });

    const remainingByPurchase = await this.computeRemainingSessions(
      purchases.map((p) => p.id),
    );

    return purchases.map((purchase) => ({
      ...purchase,
      remainingSessions: remainingByPurchase.get(purchase.id) ?? 0,
    }));
  }

  private async computeRemainingSessions(purchaseIds: string[]) {
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

  async ensureUsable(purchaseId: string, clientId: string, trainerId: string) {
    const purchase = await this.prisma.coursePurchase.findUnique({
      where: { id: purchaseId },
      include: { course: true },
    });
    if (!purchase) {
      throw new NotFoundException('Course purchase not found');
    }
    if (purchase.clientId !== clientId) {
      throw new BadRequestException(
        'This course purchase does not belong to this client',
      );
    }
    if (purchase.course.trainerId !== trainerId) {
      throw new BadRequestException(
        'This course purchase does not belong to this trainer',
      );
    }

    const remaining = await this.computeRemainingSessions([purchaseId]);
    const remainingSessions = remaining.get(purchaseId) ?? 0;
    if (remainingSessions <= 0) {
      throw new BadRequestException(
        'No remaining sessions left on this course purchase',
      );
    }

    return purchase;
  }
}
