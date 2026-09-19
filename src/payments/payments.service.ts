import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PaymentStatus, UserType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paginate } from '../shared/pagination.util';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { SearchPaymentDto } from './dto/search-payment.dto';
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

      if (status) {
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
    const status = this.mapOpnStatus(verifiedCharge.status);

    if (!status || status === payment.status) {
      return {
        status: payment.status,
        paidAt: payment.paidAt,
        failureMessage: payment.failureMessage,
      };
    }

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status,
        paidAt: status === PaymentStatus.Successful ? new Date() : undefined,
        failureCode: verifiedCharge.failure_code ?? undefined,
        failureMessage: verifiedCharge.failure_message ?? undefined,
      },
    });

    return {
      status: updated.status,
      paidAt: updated.paidAt,
      failureMessage: updated.failureMessage,
    };
  }
}

