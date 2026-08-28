import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  UserType,
  WorkoutStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCouponDto } from './dto/create-coupon.dto';

const PAGE_SIZE = 20;

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
        minHours: createCouponDto.minHours,
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

  private async computeTrainedHours(clientId: string, trainerId: string) {
    const workouts = await this.prisma.workout.findMany({
      where: {
        clientId,
        trainerId,
        status: { in: [WorkoutStatus.Confirmed, WorkoutStatus.Completed] },
      },
      select: { fromTime: true, toTime: true },
    });

    const totalMs = workouts.reduce(
      (sum, w) => sum + (w.toTime.getTime() - w.fromTime.getTime()),
      0,
    );
    return totalMs / (1000 * 60 * 60);
  }

  async checkEligibility(couponId: string, clientId: string, trainerId: string) {
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

    const trainedHours = await this.computeTrainedHours(clientId, trainerId);
    const eligible = trainedHours >= Number(coupon.minHours);

    return { coupon, trainedHours, eligible };
  }

  async redeem(
    tx: Prisma.TransactionClient,
    couponId: string,
    trainerId: string,
  ) {
    const result = await tx.coupon.updateMany({
      where: { id: couponId, usedAt: null },
      data: { usedAt: new Date(), usedTrainerId: trainerId },
    });
    if (result.count === 0) {
      throw new BadRequestException('This coupon has already been used');
    }
  }
}
