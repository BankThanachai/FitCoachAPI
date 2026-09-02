import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserType } from '../../generated/prisma/client';
import { ClientTrainersService } from '../client-trainers/client-trainers.service';
import { CouponsService } from '../coupons/coupons.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CoursePurchaseCalculationsService } from '../shared/course-purchase-calculations.service';
import { CreateCoursePurchaseDto } from './dto/create-course-purchase.dto';
import { PurchaseAndJoinDto } from './dto/purchase-and-join.dto';

@Injectable()
export class CoursePurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly couponsService: CouponsService,
    private readonly clientTrainersService: ClientTrainersService,
    private readonly paymentsService: PaymentsService,
    private readonly coursePurchaseCalculationsService: CoursePurchaseCalculationsService,
  ) {}

  async validatePurchase(
    clientId: string,
    courseId: string,
    couponIds: string[],
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

    if (course.isTrial && couponIds.length !== 1) {
      throw new BadRequestException(
        'A trial course requires exactly one trial coupon',
      );
    }

    await this.couponsService.validateCouponsForCourse(
      couponIds,
      clientId,
      course,
    );

    return course;
  }

  async createPurchaseInTransaction(
    tx: Prisma.TransactionClient,
    clientId: string,
    courseId: string,
    trainerId: string,
    couponIds: string[],
  ) {
    const purchase = await tx.coursePurchase.create({
      data: { clientId, courseId },
    });

    for (const couponId of couponIds) {
      await this.couponsService.redeem(tx, couponId, trainerId, purchase.id);
    }

    return purchase;
  }

  async purchase(
    clientId: string,
    courseId: string,
    createCoursePurchaseDto: CreateCoursePurchaseDto,
  ) {
    const couponIds = createCoursePurchaseDto.couponIds ?? [];
    const course = await this.validatePurchase(clientId, courseId, couponIds);

    return this.prisma.$transaction((tx) =>
      this.createPurchaseInTransaction(
        tx,
        clientId,
        courseId,
        course.trainerId,
        couponIds,
      ),
    );
  }

  async purchaseAndJoin(
    clientId: string,
    courseId: string,
    purchaseAndJoinDto: PurchaseAndJoinDto,
  ) {
    const couponIds = purchaseAndJoinDto.couponIds ?? [];
    const course = await this.validatePurchase(clientId, courseId, couponIds);

    const result = await this.prisma.$transaction(async (tx) => {
      const { relation, created: joined } =
        await this.clientTrainersService.ensureAcceptedInTransaction(
          tx,
          clientId,
          course.trainerId,
        );

      const purchase = await this.createPurchaseInTransaction(
        tx,
        clientId,
        courseId,
        course.trainerId,
        couponIds,
      );

      const payment = await this.paymentsService.createInTransaction(
        tx,
        clientId,
        purchase.id,
        {
          method: purchaseAndJoinDto.method,
          amount: purchaseAndJoinDto.amount,
          opnChargeId: purchaseAndJoinDto.opnChargeId,
          opnSourceId: purchaseAndJoinDto.opnSourceId,
        },
      );

      return { relation, joined, purchase, payment };
    });

    if (result.joined) {
      await this.clientTrainersService.notifyJoined(
        clientId,
        course.trainerId,
        result.relation.id,
      );
    }

    return {
      clientTrainer: result.relation,
      purchase: result.purchase,
      payment: result.payment,
    };
  }

  async findByClient(clientId: string) {
    const purchases = await this.prisma.coursePurchase.findMany({
      where: { clientId },
      include: { course: true },
      orderBy: { purchasedAt: 'desc' },
    });

    const remainingByPurchase =
      await this.coursePurchaseCalculationsService.computeRemainingSessions(
        purchases.map((p) => p.id),
      );

    return purchases.map((purchase) => ({
      ...purchase,
      remainingSessions: remainingByPurchase.get(purchase.id) ?? 0,
    }));
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

    const remaining =
      await this.coursePurchaseCalculationsService.computeRemainingSessions([
        purchaseId,
      ]);
    const remainingSessions = remaining.get(purchaseId) ?? 0;
    if (remainingSessions <= 0) {
      throw new BadRequestException(
        'No remaining sessions left on this course purchase',
      );
    }

    return purchase;
  }
}
