import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PaymentStatus,
  UserType,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { SearchPaymentDto } from './dto/search-payment.dto';

const PAGE_SIZE_DEFAULT = 20;

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

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
    createPaymentDto: Pick<
      CreatePaymentDto,
      'method' | 'amount' | 'opnChargeId' | 'opnSourceId'
    >,
  ) {
    return tx.payment.create({
      data: {
        clientId,
        purchaseId,
        method: createPaymentDto.method,
        amount: createPaymentDto.amount,
        opnChargeId: createPaymentDto.opnChargeId,
        opnSourceId: createPaymentDto.opnSourceId,
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

    return {
      data: payments,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      total,
    };
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

    const status = this.mapOpnStatus(chargeData?.status);
    const failureCode =
      chargeData && typeof chargeData.failure_code === 'string'
        ? chargeData.failure_code
        : undefined;
    const failureMessage =
      chargeData && typeof chargeData.failure_message === 'string'
        ? chargeData.failure_message
        : undefined;

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
            failureCode,
            failureMessage,
          },
        });
      }
    });

    return { deduplicated: false, matched: true };
  }
}
