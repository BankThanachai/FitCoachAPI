import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Coupon,
  CouponType,
  Prisma,
  UserType,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCouponDto } from './dto/create-coupon.dto';

const PAGE_SIZE = 20;
const TRIAL_COUPON_EXPIRY_DAYS = 90;

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCouponDto: CreateCouponDto) {
    const client = await this.prisma.user.findUnique({
      where: { id: createCouponDto.clientId },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    if (client.type !== UserType.Client) {
      throw new BadRequestException('clientId must belong to a Client');
    }

    const expiresAt = new Date(createCouponDto.expiresAt);
    if (expiresAt <= new Date()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    return this.prisma.coupon.create({
      data: {
        title: createCouponDto.title,
        description: createCouponDto.description,
        clientId: createCouponDto.clientId,
        minSessions: createCouponDto.minSessions,
        expiresAt,
      },
    });
  }

  async issueTrialCoupon(tx: Prisma.TransactionClient, clientId: string) {
    const expiresAt = new Date(
      Date.now() + TRIAL_COUPON_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    await tx.coupon.create({
      data: {
        clientId,
        couponType: CouponType.Trial,
        title: 'ทดลองเทรนฟรี 1 ครั้ง',
        description:
          'ใช้ได้กับคอร์สทดลองเล่นของเทรนเนอร์คนไหนก็ได้ 1 ครั้ง สำหรับสมาชิกใหม่',
        minSessions: 0,
        expiresAt,
      },
    });
  }

  async findByClient(clientId: string, page: number) {
    const [coupons, totalCoupons] = await Promise.all([
      this.prisma.coupon.findMany({
        where: { clientId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.coupon.count({ where: { clientId } }),
    ]);

    const now = new Date();
    const items = coupons.map((coupon) => ({
      ...coupon,
      status: this.resolveStatus(coupon, now),
    }));

    return { coupons: items, page, pageSize: PAGE_SIZE, totalCoupons };
  }

  async hasUnusedTrialCoupon(clientId: string) {
    const coupon = await this.prisma.coupon.findFirst({
      where: {
        clientId,
        couponType: CouponType.Trial,
        usedAt: null,
        expiresAt: { gte: new Date() },
      },
    });
    return coupon !== null;
  }

  private resolveStatus(
    coupon: { usedAt: Date | null; expiresAt: Date },
    now: Date,
  ) {
    if (coupon.usedAt) {
      return 'Used';
    }
    if (coupon.expiresAt < now) {
      return 'Expired';
    }
    return 'Active';
  }

  /**
   * Validates that couponIds can all be applied to a purchase of the given
   * course, and returns the loaded Coupon rows if so.
   *
   * Rules:
   * - Every coupon must belong to clientId, be unused, and unexpired.
   * - couponType must match course.isTrial (Trial coupons only on trial
   *   courses, Standard coupons only on non-trial courses).
   * - For non-trial courses, the sum of minSessions across all coupons in
   *   this batch must not exceed course.sessions — e.g. a course with 20
   *   sessions can absorb two 10-session coupons or one 20-session coupon,
   *   but not two 20-session coupons. Trial coupons carry minSessions=0,
   *   so this sum is always satisfied for trial courses.
   */
  async validateCouponsForCourse(
    couponIds: string[],
    clientId: string,
    course: { sessions: number; isTrial: boolean },
  ): Promise<Coupon[]> {
    if (couponIds.length === 0) {
      return [];
    }

    const coupons = await this.prisma.coupon.findMany({
      where: { id: { in: couponIds } },
    });
    if (coupons.length !== couponIds.length) {
      throw new NotFoundException('One or more coupons were not found');
    }

    const now = new Date();
    const expectedType = course.isTrial
      ? CouponType.Trial
      : CouponType.Standard;
    for (const coupon of coupons) {
      if (coupon.clientId !== clientId) {
        throw new ForbiddenException('This coupon does not belong to you');
      }
      if (coupon.usedAt) {
        throw new BadRequestException('This coupon has already been used');
      }
      if (coupon.expiresAt < now) {
        throw new BadRequestException('This coupon has expired');
      }
      if (coupon.couponType !== expectedType) {
        throw new BadRequestException(
          course.isTrial
            ? 'Only a trial coupon can be used on a trial course'
            : 'A trial coupon can only be used on a trial course',
        );
      }
    }

    if (!course.isTrial) {
      const totalMinSessions = coupons.reduce(
        (sum, coupon) => sum + (coupon.minSessions ?? 0),
        0,
      );
      if (totalMinSessions > course.sessions) {
        throw new BadRequestException(
          'The combined session requirement of these coupons exceeds the sessions in this course',
        );
      }
    }

    return coupons;
  }

  async redeem(
    tx: Prisma.TransactionClient,
    couponId: string,
    trainerId: string,
    purchaseId: string,
  ) {
    const result = await tx.coupon.updateMany({
      where: { id: couponId, usedAt: null },
      data: { usedAt: new Date(), usedTrainerId: trainerId },
    });
    if (result.count === 0) {
      throw new BadRequestException('This coupon has already been used');
    }

    await tx.purchaseCoupon.create({
      data: { purchaseId, couponId },
    });
  }
}
