import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushNotificationService } from './push-notification.service';

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  async create(input: CreateNotificationInput) {
    const notification = await this.prisma.notification.create({
      data: input,
    });

    // Best-effort: the Notification row is the source of truth (the app
    // polls it regardless), so a push failure must never fail the caller's
    // request — log and move on.
    this.pushNotificationService
      .sendToUser(
        input.userId,
        { title: input.title, body: input.body },
        input.entityType && input.entityId
          ? { entityType: input.entityType, entityId: input.entityId }
          : undefined,
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to push notification ${notification.id} to user ${input.userId}: ${String(error)}`,
        );
      });

    return notification;
  }

  async findByUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countUnread(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { unreadCount: count };
  }

  async markAsRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification || notification.userId !== userId) {
      throw new NotFoundException(`Notification with id ${id} not found`);
    }
    if (notification.readAt) {
      return notification;
    }

    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }
}
