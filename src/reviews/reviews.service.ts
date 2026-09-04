import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  UserType,
  WorkoutStatus,
} from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(reviewerId: string, createReviewDto: CreateReviewDto) {
    const reviewer = await this.prisma.user.findUnique({
      where: { id: reviewerId },
    });
    if (!reviewer) {
      throw new NotFoundException('Reviewer not found');
    }
    if (reviewer.type !== UserType.Client) {
      throw new BadRequestException('Only clients can write reviews');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: createReviewDto.targetUserId },
    });
    if (!target) {
      throw new NotFoundException('Target user not found');
    }
    if (target.type !== UserType.Trainer) {
      throw new BadRequestException('Reviews can only be written for trainers');
    }

    const existingReview = await this.prisma.review.findFirst({
      where: { reviewerId, targetUserId: createReviewDto.targetUserId },
    });
    if (existingReview) {
      throw new BadRequestException('You have already reviewed this trainer');
    }

    const completedWorkout = await this.prisma.workout.findFirst({
      where: {
        clientId: reviewerId,
        trainerId: createReviewDto.targetUserId,
        status: WorkoutStatus.Completed,
      },
    });
    if (!completedWorkout) {
      throw new BadRequestException(
        'You can only review a trainer after completing at least one workout with them',
      );
    }

    const review = await this.prisma.review.create({
      data: {
        score: createReviewDto.score,
        comment: createReviewDto.comment,
        reviewerId,
        targetUserId: createReviewDto.targetUserId,
      },
    });

    await this.notificationsService.create({
      userId: createReviewDto.targetUserId,
      type: NotificationType.NewReview,
      title: 'You received a new review',
      body: `${reviewer.name ?? 'A client'} gave you a ${createReviewDto.score}-star review`,
      entityType: 'Review',
      entityId: review.id,
    });

    return review;
  }

  async reply(id: string, trainerId: string, replyReviewDto: ReplyReviewDto) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException(`Review with id ${id} not found`);
    }
    if (review.targetUserId !== trainerId) {
      throw new ForbiddenException(
        'Only the trainer who received this review can reply to it',
      );
    }
    if (review.reply) {
      throw new BadRequestException('This review already has a reply');
    }

    return this.prisma.review.update({
      where: { id },
      data: { reply: replyReviewDto.reply, repliedAt: new Date() },
    });
  }

  async findByUser(targetUserId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!target) {
      throw new NotFoundException(`User with id ${targetUserId} not found`);
    }

    const [reviews, aggregate] = await Promise.all([
      this.prisma.review.findMany({
        where: { targetUserId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.review.aggregate({
        where: { targetUserId },
        _avg: { score: true },
        _count: true,
      }),
    ]);

    return {
      reviews,
      averageScore: aggregate._avg.score
        ? Math.round(aggregate._avg.score * 100) / 100
        : 0,
      totalReviews: aggregate._count,
    };
  }
}
