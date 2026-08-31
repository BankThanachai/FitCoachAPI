import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CouponType,
  Prisma,
  UserType,
  WorkoutStatus,
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

  private async computeTrainedSessions(clientId: string, trainerId: string) {
    return this.prisma.workout.count({
      where: {
        clientId,
        trainerId,
        status: { in: [WorkoutStatus.Confirmed, WorkoutStatus.Completed] },
      },
    });
  }

  async checkEligibility(
    couponId: string,
    clientId: string,
    trainerId: string,
    isTrialCourse: boolean,
  ) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id: couponId },
    });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    if (coupon.clientId !== clientId) {
      throw new ForbiddenException('This coupon does not belong to you');
    }
    if (coupon.usedAt) {
      throw new BadRequestException('This coupon has already been used');
    }
    if (coupon.expiresAt < new Date()) {
      throw new BadRequestException('This coupon has expired');
    }

    if (isTrialCourse) {
      if (coupon.couponType !== CouponType.Trial) {
        throw new BadRequestException(
          'Only a trial coupon can be used on a trial course',
        );
      }
      return { coupon, eligible: true };
    }

    if (coupon.couponType !== CouponType.Standard) {
      throw new BadRequestException(
        'A trial coupon can only be used on a trial course',
      );
    }

    const trainedSessions = await this.computeTrainedSessions(
      clientId,
      trainerId,
    );
    const eligible = trainedSessions >= (coupon.minSessions ?? 0);

    return { coupon, trainedSessions, eligible };
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
