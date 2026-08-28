import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, UserType } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMessageDto } from './dto/create-message.dto';

const PAGE_SIZE = 20;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async findOrCreateConversation(clientId: string, trainerId: string) {
    const client = await this.prisma.user.findUnique({
      where: { id: clientId },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    if (client.type !== UserType.Client) {
      throw new BadRequestException('clientId must belong to a Client');
    }

    const trainer = await this.prisma.user.findUnique({
      where: { id: trainerId },
    });
    if (!trainer) {
      throw new NotFoundException('Trainer not found');
    }
    if (trainer.type !== UserType.Trainer) {
      throw new BadRequestException('trainerId must belong to a Trainer');
    }

    return this.prisma.conversation.upsert({
      where: { clientId_trainerId: { clientId, trainerId } },
      update: {},
      create: { clientId, trainerId },
    });
  }

  private ensureParticipant(
    senderId: string,
    conversation: { clientId: string; trainerId: string },
  ) {
    if (
      senderId !== conversation.clientId &&
      senderId !== conversation.trainerId
    ) {
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }
  }

  async create(senderId: string, createMessageDto: CreateMessageDto) {
    const conversation = await this.findOrCreateConversation(
      createMessageDto.clientId,
      createMessageDto.trainerId,
    );
    this.ensureParticipant(senderId, conversation);

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId,
        content: createMessageDto.content,
      },
    });

    const recipientId =
      senderId === conversation.clientId
        ? conversation.trainerId
        : conversation.clientId;
    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
    });
    await this.notificationsService.create({
      userId: recipientId,
      type: NotificationType.NewMessage,
      title: 'New message',
      body: `${sender?.name ?? 'Someone'}: ${createMessageDto.content}`,
      entityType: 'Conversation',
      entityId: conversation.id,
    });

    return message;
  }

  async findConversation(
    requesterId: string,
    clientId: string,
    trainerId: string,
    page: number,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { clientId_trainerId: { clientId, trainerId } },
    });
    if (!conversation) {
      return { messages: [], page, pageSize: PAGE_SIZE, totalMessages: 0 };
    }
    this.ensureParticipant(requesterId, conversation);

    const [messages, totalMessages] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.message.count({
        where: { conversationId: conversation.id },
      }),
    ]);

    if (page === 1) {
      await this.prisma.message.updateMany({
        where: {
          conversationId: conversation.id,
          senderId: { not: requesterId },
          readAt: null,
        },
        data: { readAt: new Date() },
      });
    }

    return { messages, page, pageSize: PAGE_SIZE, totalMessages };
  }

  async findConversationsForUser(userId: string, page: number) {
    const conversations = await this.prisma.conversation.findMany({
      where: { OR: [{ clientId: userId }, { trainerId: userId }] },
      include: {
        client: { select: { id: true, name: true } },
        trainer: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    const unreadCounts = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: conversations.map((c) => c.id) },
        senderId: { not: userId },
        readAt: null,
      },
      _count: true,
    });
    const unreadByConversationId = new Map(
      unreadCounts.map((row) => [row.conversationId, row._count]),
    );

    const sorted = conversations
      .map((conversation) => ({
        id: conversation.id,
        client: conversation.client,
        trainer: conversation.trainer,
        createdAt: conversation.createdAt,
        lastMessage: conversation.messages[0] ?? null,
        unreadCount: unreadByConversationId.get(conversation.id) ?? 0,
      }))
      .sort((a, b) => {
        const aTime = (a.lastMessage?.createdAt ?? a.createdAt).getTime();
        const bTime = (b.lastMessage?.createdAt ?? b.createdAt).getTime();
        return bTime - aTime;
      });

    const totalConversations = sorted.length;
    const totalUnread = sorted.reduce((sum, c) => sum + c.unreadCount, 0);
    const start = (page - 1) * PAGE_SIZE;
    const items = sorted.slice(start, start + PAGE_SIZE);

    return {
      conversations: items,
      page,
      pageSize: PAGE_SIZE,
      totalConversations,
      totalUnread,
    };
  }
}
