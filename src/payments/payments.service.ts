import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Charges } from 'omise';
import { Prisma, PaymentStatus, UserType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../shared/pagination.util';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { SearchPaymentDto } from './dto/search-payment.dto';
import { translateOmiseFailure } from './omise-error.util';
import { OmiseService } from './omise.service';

const PAGE_SIZE_DEFAULT = 20;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly omiseService: OmiseService,
  ) {}

  async create(clientId: string, createPaymentDto: CreatePaymentDto) {
    const client = await this.prisma.user.findUnique({
      where: { id: clientId },
    });
    if (!client || client.type !== UserType.Client) {
      throw new BadRequestException('Only clients can create payments');
    }

    if (createPaymentDto.purchaseId) {
      const purchase = await this.prisma.coursePurchase.findUnique({
        where: { id: createPaymentDto.purchaseId },
      });
      if (!purchase) {
        throw new NotFoundException('Course purchase not found');
      }
      if (purchase.clientId !== clientId) {
        throw new BadRequestException(
          'This course purchase does not belong to this client',
        );
      }
    }

    return this.prisma.payment.create({
      data: {
        clientId,
        purchaseId: createPaymentDto.purchaseId,
        method: createPaymentDto.method,
        amount: createPaymentDto.amount,
        opnChargeId: createPaymentDto.opnChargeId,
        opnSourceId: createPaymentDto.opnSourceId,
      },
    });
  }

  async createInTransaction(
    tx: Prisma.TransactionClient,
    clientId: string,
    purchaseId: string,
    data: Pick<CreatePaymentDto, 'method'> & {
      amount: number | Prisma.Decimal;
      // Absent when nothing was ever charged (e.g. a free trial course) —
      // no Omise charge/source exists to reference.
      opnChargeId?: string;
      opnSourceId?: string;
      status: PaymentStatus;
      paidAt?: Date;
    },
  ) {
    return tx.payment.create({
      data: {
        clientId,
        purchaseId,
        method: data.method,
        amount: data.amount,
        opnChargeId: data.opnChargeId,
        opnSourceId: data.opnSourceId,
        status: data.status,
        paidAt: data.paidAt,
      },
    });
  }

  async search(searchPaymentDto: SearchPaymentDto) {
    const page = searchPaymentDto.page ?? 1;
    const pageSize = searchPaymentDto.pageSize ?? PAGE_SIZE_DEFAULT;

    const where: Prisma.PaymentWhereInput = {
      status: searchPaymentDto.status,
      method: searchPaymentDto.method,
      clientId: searchPaymentDto.clientId,
      purchaseId: searchPaymentDto.purchaseId,
      opnChargeId: searchPaymentDto.opnChargeId,
      createdAt:
        searchPaymentDto.createdFrom || searchPaymentDto.createdTo
          ? {
              gte: searchPaymentDto.createdFrom
                ? new Date(searchPaymentDto.createdFrom)
                : undefined,
              lte: searchPaymentDto.createdTo
                ? new Date(searchPaymentDto.createdTo)
                : undefined,
            }
          : undefined,
    };

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return paginate(payments, page, pageSize, total);
  }

  async findOne(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { events: { orderBy: { receivedAt: 'desc' } }, refunds: true },
    });
    if (!payment) {
      throw new NotFoundException(`Payment with id ${id} not found`);
    }
    return payment;
  }

  private mapOpnStatus(chargeStatus: unknown): PaymentStatus | undefined {
    switch (chargeStatus) {
      case 'successful':
        return PaymentStatus.Successful;
      case 'failed':
        return PaymentStatus.Failed;
      case 'expired':
        return PaymentStatus.Expired;
      case 'reversed':
        return PaymentStatus.Reversed;
      default:
        return undefined;
    }
  }

  // A coupon is marked used at purchase time, before a PromptPay charge is
  // known to succeed (see purchaseAndJoinWithPromptPay). If the charge later
  // fails/expires/is cancelled, that coupon must go back to being usable —
  // otherwise it's stuck forever, since Payment.purchaseId is @unique and a
  // retry has to create a brand new CoursePurchase rather than reuse this one.
  private async releaseCouponsForPurchase(
    tx: Prisma.TransactionClient,
    purchaseId: string,
  ) {
    const purchaseCoupons = await tx.purchaseCoupon.findMany({
      where: { purchaseId },
      select: { couponId: true },
    });
    if (purchaseCoupons.length === 0) {
      return;
    }
    await tx.coupon.updateMany({
      where: { id: { in: purchaseCoupons.map((pc) => pc.couponId) } },
      data: { usedAt: null, usedTrainerId: null },
    });
  }

  private isDeadEnd(status: PaymentStatus): boolean {
    return status === PaymentStatus.Failed || status === PaymentStatus.Expired;
  }

  // Applies a verified Omise charge (i.e. one fetched via retrieveCharge,
  // never the raw webhook payload) to the matching Payment row, returning
  // the up-to-date row. Releases any coupons tied to the purchase if the
  // charge turned out to be a dead end (Failed/Expired).
  private async applyVerifiedCharge(
    payment: Prisma.PaymentGetPayload<object>,
    charge: Charges.ICharge,
  ) {
    const status = this.mapOpnStatus(charge.status);
    if (!status || status === payment.status) {
      return payment;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status,
          paidAt: status === PaymentStatus.Successful ? new Date() : undefined,
          failureCode: charge.failure_code ?? undefined,
          failureMessage: charge.failure_message ?? undefined,
        },
      });

      if (this.isDeadEnd(status) && payment.purchaseId) {
        await this.releaseCouponsForPurchase(tx, payment.purchaseId);
      }

      return updated;
    });
  }

  async handleWebhookEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ) {
    const chargeData = payload.data as Record<string, unknown> | undefined;
    const opnEventId =
      (typeof payload.id === 'string' && payload.id) ||
      (chargeData && typeof chargeData.id === 'string' && chargeData.id) ||
      undefined;
    if (!opnEventId) {
      throw new BadRequestException('Webhook payload is missing an id');
    }

    const existingEvent = await this.prisma.paymentEvent.findUnique({
      where: { opnEventId },
    });
    if (existingEvent) {
      return { deduplicated: true, matched: false };
    }

    // The payload's charge id only tells us WHICH charge to look up — never
    // trust its status/failure_code/etc, since the payload itself is
    // unauthenticated and can be forged. Always re-fetch from Omise with the
    // secret key before writing anything derived from it to the DB.
    const opnChargeId =
      chargeData && typeof chargeData.id === 'string'
        ? chargeData.id
        : undefined;
    if (!opnChargeId) {
      return { deduplicated: false, matched: false };
    }

    const payment = await this.prisma.payment.findUnique({
      where: { opnChargeId },
    });
    if (!payment) {
      return { deduplicated: false, matched: false };
    }

    const verifiedCharge = await this.omiseService.retrieveCharge(opnChargeId);
    const status = this.mapOpnStatus(verifiedCharge.status);

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          opnEventId,
          eventType,
          rawPayload: payload as Prisma.InputJsonValue,
        },
      });

      if (status && status !== payment.status) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status,
            paidAt:
              status === PaymentStatus.Successful ? new Date() : undefined,
            failureCode: verifiedCharge.failure_code ?? undefined,
            failureMessage: verifiedCharge.failure_message ?? undefined,
          },
        });

        if (this.isDeadEnd(status) && payment.purchaseId) {
          await this.releaseCouponsForPurchase(tx, payment.purchaseId);
        }
      }
    });

    return { deduplicated: false, matched: true };
  }

  // Client polling endpoint for async (PromptPay) payments. If still Pending
  // locally, reconciles against Omise directly rather than waiting on the
  // webhook, so the client isn't stuck if a webhook delivery is delayed/lost.
  async getStatus(chargeId: string, clientId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { opnChargeId: chargeId },
    });
    if (!payment) {
      throw new NotFoundException(
        `Payment with charge id ${chargeId} not found`,
      );
    }
    if (payment.clientId !== clientId) {
      throw new ForbiddenException('This payment does not belong to you');
    }

    if (payment.status !== PaymentStatus.Pending) {
      return {
        status: payment.status,
        paidAt: payment.paidAt,
        failureMessage: payment.failureMessage,
      };
    }

    const verifiedCharge = await this.omiseService.retrieveCharge(chargeId);
    const updated = await this.applyVerifiedCharge(payment, verifiedCharge);

    return {
      status: updated.status,
      paidAt: updated.paidAt,
      failureMessage:
        updated.status === PaymentStatus.Failed ||
        updated.status === PaymentStatus.Expired
          ? translateOmiseFailure(verifiedCharge.failure_code)
          : undefined,
      // Lets the client re-show the same QR (e.g. after navigating back to
      // the purchase list and tapping "pay now" again) instead of creating a
      // redundant charge — qrCodeUrl is never persisted, so it's re-derived
      // from Omise here rather than added as a new column.
      ...(updated.status === PaymentStatus.Pending
        ? {
            qrCodeUrl:
              verifiedCharge.source?.scannable_code?.image?.download_uri,
            expiresAt: verifiedCharge.expires_at,
          }
        : {}),
    };
  }

  // Lets a client back out of a pending PromptPay purchase instead of
  // waiting out the full QR expiry. Omise's charge-expire API
  // (charges.expire) explicitly does not support the promptpay source type
  // (docs.omise.co/charges-api lists alipay_cn/alipay_hk/barcode_alipay/
  // dana/gcash/kakaopay/paypay/touch_n_go only) — there is nothing to call
  // on Omise's side, so this only ever updates our own DB. This means the
  // QR technically stays scannable on Omise's side until its real
  // expires_at; if the user pays anyway after cancelling, a late
  // webhook/poll would find the Payment row already deleted and have
  // nothing left to reconcile. Same class of risk as today's Expired race,
  // not introduced by this method; not solved here.
  //
  // Cancelling deletes the CoursePurchase (and, via cascade, its
  // PurchaseCoupon/Workout/Review rows) rather than just marking the
  // Payment Cancelled — mobile wants "cancel" to mean the purchase never
  // happened, not a purchase left behind in a dead state. Payment itself
  // isn't cascade-deleted by CoursePurchase (its FK is ON DELETE SET NULL,
  // to preserve payment history for a case like an expired/failed charge),
  // so it's deleted explicitly here too.
  async cancel(chargeId: string, clientId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { opnChargeId: chargeId },
    });
    if (!payment) {
      throw new NotFoundException(
        `Payment with charge id ${chargeId} not found`,
      );
    }
    if (payment.clientId !== clientId) {
      throw new ForbiddenException('This payment does not belong to you');
    }

    await this.prisma.$transaction(async (tx) => {
      // updateMany + a Pending guard (rather than read-then-write) so a
      // webhook/poll that concurrently confirmed Successful can't be
      // clobbered by a cancel landing a moment later — same optimistic-lock
      // pattern as CouponsService.redeem. The status is set to Cancelled
      // first (rather than deleting straight away) purely to hold this
      // guard; the row is deleted a few lines below regardless.
      const result = await tx.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.Pending },
        data: { status: PaymentStatus.Cancelled },
      });
      if (result.count === 0) {
        throw new BadRequestException(
          'This payment can no longer be cancelled',
        );
      }

      if (!payment.purchaseId) {
        await tx.payment.delete({ where: { id: payment.id } });
        return;
      }

      // Release coupons first — releaseCouponsForPurchase reads the
      // PurchaseCoupon rows, which are about to be cascade-deleted along
      // with the CoursePurchase below.
      await this.releaseCouponsForPurchase(tx, payment.purchaseId);

      // Should be unreachable in practice: ensureUsable() already blocks
      // booking a workout (and a review requires a completed, paid
      // purchase) against any purchase that isn't Successful, and this
      // purchase is still Pending. Guarded explicitly anyway so a delete
      // never silently cascades away real workout/review history if some
      // future code path breaks that invariant.
      const purchase = await tx.coursePurchase.findUniqueOrThrow({
        where: { id: payment.purchaseId },
        include: {
          _count: { select: { workouts: true } },
          review: { select: { id: true } },
        },
      });
      if (purchase._count.workouts > 0 || purchase.review) {
        throw new BadRequestException(
          'This course purchase cannot be cancelled because it already has workouts or a review',
        );
      }

      await tx.payment.delete({ where: { id: payment.id } });
      await tx.coursePurchase.delete({ where: { id: payment.purchaseId } });
    });

    return { deleted: true };
  }
}
