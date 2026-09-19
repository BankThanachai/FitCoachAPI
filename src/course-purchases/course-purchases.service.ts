import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentMethod,
  PaymentStatus,
  Prisma,
  UserType,
  WorkoutStatus,
} from '../../generated/prisma/client';
import { ClientTrainersService } from '../client-trainers/client-trainers.service';
import { CouponsService } from '../coupons/coupons.service';
import { translateOmiseFailure } from '../payments/omise-error.util';
import { OmiseService } from '../payments/omise.service';
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
    private readonly omiseService: OmiseService,
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
    // course.price (server-side) is the only source of truth for amount —
    // the client never gets to say how much it's being charged.
    const amount = course.price;

    if (purchaseAndJoinDto.method === PaymentMethod.Card) {
      if (!purchaseAndJoinDto.omiseToken) {
        throw new BadRequestException(
          'omiseToken is required for card payments',
        );
      }
      return this.purchaseAndJoinWithCard(
        clientId,
        courseId,
        course.trainerId,
        couponIds,
        amount,
        purchaseAndJoinDto.omiseToken,
      );
    }

    if (purchaseAndJoinDto.method === PaymentMethod.PromptPay) {
      return this.purchaseAndJoinWithPromptPay(
        clientId,
        courseId,
        course.trainerId,
        couponIds,
        amount,
      );
    }

    throw new BadRequestException(
      `Payment method ${purchaseAndJoinDto.method} is not supported yet`,
    );
  }

  private async commitPurchaseAndJoin(
    clientId: string,
    courseId: string,
    trainerId: string,
    couponIds: string[],
    paymentData: Parameters<PaymentsService['createInTransaction']>[3],
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const { relation, created: joined } =
        await this.clientTrainersService.ensureAcceptedInTransaction(
          tx,
          clientId,
          trainerId,
        );

      const purchase = await this.createPurchaseInTransaction(
        tx,
        clientId,
        courseId,
        trainerId,
        couponIds,
      );

      const payment = await this.paymentsService.createInTransaction(
        tx,
        clientId,
        purchase.id,
        paymentData,
      );

      return { relation, joined, purchase, payment };
    });

    if (result.joined) {
      await this.clientTrainersService.notifyJoined(
        clientId,
        trainerId,
        result.relation.id,
      );
    }

    return {
      clientTrainer: result.relation,
      purchase: result.purchase,
      payment: result.payment,
    };
  }

  private async purchaseAndJoinWithCard(
    clientId: string,
    courseId: string,
    trainerId: string,
    couponIds: string[],
    amount: Prisma.Decimal,
    omiseToken: string,
  ) {
    // Network call to Omise happens before any DB write — never commit the
    // purchase/join unless the charge actually succeeded.
    const charge = await this.omiseService.chargeWithToken(amount, omiseToken);

    if (charge.status !== 'successful') {
      throw new BadRequestException(translateOmiseFailure(charge.failure_code));
    }

    return this.commitPurchaseAndJoin(
      clientId,
      courseId,
      trainerId,
      couponIds,
      {
        method: PaymentMethod.Card,
        amount,
        opnChargeId: charge.id,
        status: PaymentStatus.Successful,
        paidAt: new Date(),
      },
    );
  }

  private async purchaseAndJoinWithPromptPay(
    clientId: string,
    courseId: string,
    trainerId: string,
    couponIds: string[],
    amount: Prisma.Decimal,
  ) {
    const source = await this.omiseService.createPromptPaySource(amount);
    const charge = await this.omiseService.chargeFromSource(amount, source.id);

    // PromptPay is async — the charge starts Pending. Joining/purchasing now
    // (rather than waiting for the webhook) treats paying as a stronger
    // signal than a request, same as ensureAcceptedInTransaction already
    // does; usability of the purchase itself is separately gated on
    // Payment.status === Successful (see CoursePurchasesService.ensureUsable).
    const result = await this.commitPurchaseAndJoin(
      clientId,
      courseId,
      trainerId,
      couponIds,
      {
        method: PaymentMethod.PromptPay,
        amount,
        opnChargeId: charge.id,
        opnSourceId: source.id,
        status: PaymentStatus.Pending,
      },
    );

    return {
      ...result,
      qrCodeUrl: charge.source?.scannable_code?.image?.download_uri,
      expiresAt: charge.expires_at,
    };
  }

  /**
   * A client's own course purchases, optionally narrowed to the courses of
   * one specific trainer (e.g. when a client wants to see only what they've
   * bought from a trainer they're currently viewing).
   */
  async findMyPurchasesUnderTrainer(clientId: string, trainerId?: string) {
    const purchases = await this.prisma.coursePurchase.findMany({
      where: { clientId, course: trainerId ? { trainerId } : undefined },
      include: {
        course: true,
        review: { select: { id: true } },
        _count: { select: { coupons: true } },
      },
      orderBy: { purchasedAt: 'desc' },
    });

    const [sessionsByPurchase, completedCounts] = await Promise.all([
      this.coursePurchaseCalculationsService.computeRemainingSessions(
        purchases.map((p) => p.id),
      ),
      this.prisma.workout.groupBy({
        by: ['purchaseId'],
        where: {
          purchaseId: { in: purchases.map((p) => p.id) },
          status: WorkoutStatus.Completed,
        },
        _count: true,
      }),
    ]);
    const completedByPurchaseId = new Map(
      completedCounts.map((row) => [row.purchaseId, row._count]),
    );

    return purchases.map(({ _count, review, ...purchase }) => {
      const sessions = sessionsByPurchase.get(purchase.id);
      return {
        ...purchase,
        remainingSessions: sessions?.remainingSessions ?? 0,
        usedSessions: sessions?.usedSessions ?? 0,
        // Sessions with status Completed only — distinct from usedSessions,
        // which also counts Cancelled ones (a booking still consumes the
        // purchase's quota even if cancelled). This is what actually gates
        // review eligibility and "เทรนสำเร็จแล้ว X ครั้ง" displays; computed
        // here instead of by the client so it stays correct once
        // GET /workouts/client is paginated and no longer returns every
        // workout in one response.
        completedSessions: completedByPurchaseId.get(purchase.id) ?? 0,
        couponsUsed: _count.coupons,
        hasReview: !!review,
      };
    });
  }

  async ensureUsable(purchaseId: string, clientId: string, trainerId: string) {
    const purchase = await this.prisma.coursePurchase.findUnique({
      where: { id: purchaseId },
      include: { course: true, payment: true },
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
    // A PromptPay purchase is created eagerly (Pending) before the payment
    // actually clears — it can't be used to book a session until the Omise
    // webhook (or a status poll) confirms it as Successful.
    if (
      purchase.payment &&
      purchase.payment.status !== PaymentStatus.Successful
    ) {
      throw new BadRequestException(
        'This course purchase has not been paid for yet',
      );
    }

    const remaining =
      await this.coursePurchaseCalculationsService.computeRemainingSessions([
        purchaseId,
      ]);
    const remainingSessions = remaining.get(purchaseId)?.remainingSessions ?? 0;
    if (remainingSessions <= 0) {
      throw new BadRequestException(
        'No remaining sessions left on this course purchase',
      );
    }

    return purchase;
  }
}
