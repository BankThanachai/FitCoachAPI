import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClientTrainerStatus,
  NotificationType,
  Prisma,
  UserType,
} from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientTrainerDto } from './dto/create-client-trainer.dto';
import { UpdateClientTrainerStatusDto } from './dto/update-client-trainer-status.dto';

@Injectable()
export class ClientTrainersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Client sends a request to add a trainer; starts out Pending until the trainer accepts. */
  async create(
    clientId: string,
    createClientTrainerDto: CreateClientTrainerDto,
  ) {
    const client = await this.prisma.user.findUnique({
      where: { id: clientId },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    if (client.type !== UserType.Client) {
      throw new BadRequestException('Only clients can add a trainer');
    }

    const trainer = await this.prisma.user.findUnique({
      where: { id: createClientTrainerDto.trainerId },
    });
    if (!trainer) {
      throw new NotFoundException('Trainer not found');
    }
    if (trainer.type !== UserType.Trainer) {
      throw new BadRequestException('Target user is not a trainer');
    }

    const latest = await this.findLatest(
      clientId,
      createClientTrainerDto.trainerId,
    );
    if (
      latest &&
      (latest.status === ClientTrainerStatus.Pending ||
        latest.status === ClientTrainerStatus.Accepted)
    ) {
      throw new ConflictException(
        `This trainer has already been ${latest.status === ClientTrainerStatus.Pending ? 'requested' : 'added'}`,
      );
    }

    const relation = await this.prisma.clientTrainer.create({
      data: {
        clientId,
        trainerId: createClientTrainerDto.trainerId,
      },
    });

    await this.notificationsService.create({
      userId: createClientTrainerDto.trainerId,
      type: NotificationType.ClientTrainerRequest,
      title: 'New client request',
      body: `${client.name ?? 'A client'} wants to add you as their trainer`,
      entityType: 'ClientTrainer',
      entityId: relation.id,
    });

    return relation;
  }

  /** Most recent relation row for this pair, since a client can request the same trainer again after a rejection. */
  private async findLatest(clientId: string, trainerId: string) {
    return this.prisma.clientTrainer.findFirst({
      where: { clientId, trainerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Ensures an Accepted relation exists between client and trainer, creating
   * one if none exists yet. Used by flows that join a trainer implicitly
   * (e.g. purchase-and-join) rather than through the request/accept flow.
   * A prior Rejected relation does not block this — same as create(), which
   * only treats Pending/Accepted as a conflict and lets the client try
   * again otherwise. Paying for a course is treated as a stronger signal
   * than a plain request, so a new relation is created as Accepted rather
   * than Pending.
   * Notification dispatch is left to the caller, to run after the enclosing
   * transaction commits (same pattern as create()/updateStatus()).
   */
  async ensureAcceptedInTransaction(
    tx: Prisma.TransactionClient,
    clientId: string,
    trainerId: string,
  ) {
    const existing = await tx.clientTrainer.findFirst({
      where: { clientId, trainerId },
      orderBy: { createdAt: 'desc' },
    });

    if (existing && existing.status !== ClientTrainerStatus.Rejected) {
      return { relation: existing, created: false };
    }

    const client = await tx.user.findUnique({ where: { id: clientId } });
    if (!client || client.type !== UserType.Client) {
      throw new BadRequestException('Only clients can join a trainer');
    }

    const trainer = await tx.user.findUnique({ where: { id: trainerId } });
    if (!trainer || trainer.type !== UserType.Trainer) {
      throw new BadRequestException('Target user is not a trainer');
    }

    const relation = await tx.clientTrainer.create({
      data: {
        clientId,
        trainerId,
        status: ClientTrainerStatus.Accepted,
      },
    });

    return { relation, created: true };
  }

  /** Notifies the trainer after ensureAcceptedInTransaction created a new relation (called post-commit, outside the transaction). */
  async notifyJoined(clientId: string, trainerId: string, relationId: string) {
    const client = await this.prisma.user.findUnique({
      where: { id: clientId },
    });
    await this.notificationsService.create({
      userId: trainerId,
      type: NotificationType.ClientTrainerAccepted,
      title: 'New client joined',
      body: `${client?.name ?? 'A client'} joined you and purchased a course`,
      entityType: 'ClientTrainer',
      entityId: relationId,
    });
  }

  /** Trainers this client has a relation with, each annotated with whether they've bought a course and how many sessions remain on the latest purchase. */
  async findByClient(clientId: string) {
    const relations = await this.prisma.clientTrainer.findMany({
      where: { clientId },
      include: { trainer: { omit: { password: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const latestPurchaseByTrainerId = await this.findLatestPurchasesByTrainer(
      clientId,
      relations.map((relation) => relation.trainerId),
    );

    return relations.map((relation) => {
      const latestPurchase = latestPurchaseByTrainerId.get(
        relation.trainerId,
      );
      return {
        ...relation,
        hasPurchase: latestPurchase !== undefined,
        remainingSessions: latestPurchase?.remainingSessions ?? 0,
      };
    });
  }

  /**
   * For each given trainer, finds this client's most recent CoursePurchase
   * with that trainer and computes its remaining sessions (course.sessions
   * minus how many Workouts have been booked against it — cancellations
   * still count, sessions are never refunded). Trainers with no purchase
   * are simply absent from the returned map.
   */
  private async findLatestPurchasesByTrainer(
    clientId: string,
    trainerIds: string[],
  ) {
    const purchases = await this.prisma.coursePurchase.findMany({
      where: { clientId, course: { trainerId: { in: trainerIds } } },
      include: { course: true },
      orderBy: { purchasedAt: 'desc' },
    });

    // purchases is already ordered newest-first, so the first purchase seen
    // per trainer here is that trainer's latest one.
    const latestByTrainerId = new Map<string, (typeof purchases)[number]>();
    for (const purchase of purchases) {
      if (!latestByTrainerId.has(purchase.course.trainerId)) {
        latestByTrainerId.set(purchase.course.trainerId, purchase);
      }
    }

    const usedCounts = await this.prisma.workout.groupBy({
      by: ['purchaseId'],
      where: { purchaseId: { in: purchases.map((purchase) => purchase.id) } },
      _count: true,
    });
    const usedByPurchaseId = new Map(
      usedCounts.map((row) => [row.purchaseId, row._count]),
    );

    const result = new Map<string, { remainingSessions: number }>();
    for (const [trainerId, purchase] of latestByTrainerId) {
      result.set(trainerId, {
        remainingSessions:
          purchase.course.sessions - (usedByPurchaseId.get(purchase.id) ?? 0),
      });
    }
    return result;
  }

  /** Clients this trainer has a relation with (requests, accepted, and rejected). */
  async findByTrainer(trainerId: string) {
    return this.prisma.clientTrainer.findMany({
      where: { trainerId },
      include: { client: { omit: { password: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Trainer accepts or rejects the client's latest request; notifies the client only on acceptance. */
  async updateStatus(
    trainerId: string,
    clientId: string,
    updateClientTrainerStatusDto: UpdateClientTrainerStatusDto,
  ) {
    const existing = await this.findLatest(clientId, trainerId);
    if (!existing) {
      throw new NotFoundException('Relation not found');
    }

    const updated = await this.prisma.clientTrainer.update({
      where: { id: existing.id },
      data: { status: updateClientTrainerStatusDto.status },
    });

    if (updated.status === ClientTrainerStatus.Accepted) {
      const trainer = await this.prisma.user.findUnique({
        where: { id: trainerId },
      });
      await this.notificationsService.create({
        userId: clientId,
        type: NotificationType.ClientTrainerAccepted,
        title: 'Trainer request accepted',
        body: `${trainer?.name ?? 'A trainer'} accepted your request`,
        entityType: 'ClientTrainer',
        entityId: updated.id,
      });
    }

    return updated;
  }

  /** Deletes the latest relation row for this pair (e.g. client removes a trainer they'd added). */
  async remove(clientId: string, trainerId: string) {
    const relation = await this.findLatest(clientId, trainerId);
    if (!relation) {
      throw new NotFoundException('Relation not found');
    }
    return this.prisma.clientTrainer.delete({
      where: { id: relation.id },
    });
  }
}
